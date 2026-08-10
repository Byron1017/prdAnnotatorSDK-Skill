import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const RUNTIME_PATH = /^(?:prd-annotator\/(?:src\/.*\.(?:js|mjs)|prd-annotator\.js)|prd-annotator-skill\/scripts\/.*\.(?:js|mjs))$/;
const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READ_METHODS = new Set(["GET", "HEAD"]);
const FS_MODULE_SPECIFIER = "(?:node:)?fs(?:/promises)?";
const FS_OPERATIONS = new Set([
  "rm", "rmSync", "remove", "removeSync", "unlink", "unlinkSync", "rmdir", "rmdirSync"
]);
const DIRECT_WRITE_TRANSPORTS = [
  { label: "server constructor", expression: /\b(?:createServer|WebSocketServer)\b/ },
  { label: "listening endpoint", expression: /\.listen\s*\(/ },
  { label: "XMLHttpRequest", expression: /\b(?:new\s+)?XMLHttpRequest\s*\(/ },
  { label: "sendBeacon", expression: /\bnavigator\s*\.\s*sendBeacon\s*\(/ },
  { label: "bidirectional browser transport", expression: /\bnew\s+(?:WebSocket|WebTransport)\s*\(/ },
  { label: "write-oriented HTTP client", expression: /\b(?:axios|apiClient|httpClient)\s*\.\s*(?:post|put|patch|delete)\s*\(/i }
];
const DESTRUCTIVE_WORKFLOW_NAME = new RegExp(
  "\\b(?:delete|clear|purge|reset)[A-Za-z0-9_$]*(?:annotation|project|page|prd|document|data)[A-Za-z0-9_$]*\\b",
  "i"
);

// This is a deterministic syntax policy, not arbitrary-code semantic analysis.
// Allow only exact cleanup calls inside known staging/lock/rollback functions.
const SAFE_CLEANUP_CONTEXTS = new Map(Object.entries({
  "prd-annotator-skill/scripts/install-project.mjs": [
    { functionName: "removeCreatedDirectories", operation: "rmdir", argument: "directory" },
    { functionName: "applyTransaction", operation: "rm", argument: "operation.absolutePath" },
    { functionName: "applyTransaction", operation: "rm", argument: "stagingRoot", stagingPrefix: ".prd-annotator-install-" }
  ],
  "prd-annotator-skill/scripts/merge-annotations.mjs": [
    { functionName: "atomicWriteAnnotation", operation: "rm", argument: "staging.absolutePath" },
    { functionName: "withPageMergeLock", operation: "rmdir", argument: "lockPath" }
  ],
  "prd-annotator-skill/scripts/refresh-project.mjs": [
    { functionName: "removeCreatedDirectories", operation: "rmdir", argument: "directory" },
    { functionName: "applyTransaction", operation: "rm", argument: "operation.absolutePath" },
    { functionName: "applyTransaction", operation: "rm", argument: "stagingRoot", stagingPrefix: ".prd-annotator-refresh-" }
  ],
  "prd-annotator-skill/scripts/remove-project.mjs": [
    { functionName: "applyRemovalTransaction", operation: "rm", argument: "operation.stagePath" },
    { functionName: "applyRemovalTransaction", operation: "rm", argument: "stagingRoot", stagingPrefix: ".prd-annotator-remove-" }
  ],
  "prd-annotator-skill/scripts/lib/mutation-lock.mjs": [
    { functionName: "withProjectMutationLock", operation: "rmdir", argument: "lockPath" }
  ],
  "prd-annotator-skill/scripts/lib/project-transaction.mjs": [
    { functionName: "removeCreatedDirectories", operation: "rmdir", argument: "directory" },
    { functionName: "applyProjectTransaction", operation: "rm", argument: "stagingRoot", stagingPrefix: ".prd-annotator-transaction-" }
  ]
}));

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function maskJavaScript(source) {
  const code = [...source];
  const commentFree = [...source];
  const maskRange = (target, start, end) => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (target[cursor] !== "\n" && target[cursor] !== "\r") target[cursor] = " ";
    }
  };
  const maskComment = (start) => {
    if (source[start + 1] === "/") {
      const end = source.indexOf("\n", start + 2);
      const stop = end === -1 ? source.length : end;
      maskRange(code, start, stop);
      maskRange(commentFree, start, stop);
      return stop;
    }
    const closing = source.indexOf("*/", start + 2);
    const stop = closing === -1 ? source.length : closing + 2;
    maskRange(code, start, stop);
    maskRange(commentFree, start, stop);
    return stop;
  };
  const maskQuotedString = (start, quote) => {
    let cursor = start + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    maskRange(code, start, cursor);
    return cursor;
  };
  let scanTemplate;
  const scanTemplateExpression = (start) => {
    let cursor = start;
    let braceDepth = 0;
    while (cursor < source.length) {
      if (source[cursor] === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) {
        cursor = maskComment(cursor);
        continue;
      }
      if (source[cursor] === "'" || source[cursor] === "\"") {
        cursor = maskQuotedString(cursor, source[cursor]);
        continue;
      }
      if (source[cursor] === "`") {
        cursor = scanTemplate(cursor);
        continue;
      }
      if (source[cursor] === "{") {
        braceDepth += 1;
      } else if (source[cursor] === "}") {
        if (braceDepth === 0) return cursor + 1;
        braceDepth -= 1;
      }
      cursor += 1;
    }
    return cursor;
  };
  scanTemplate = (start) => {
    maskRange(code, start, start + 1);
    let cursor = start + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        maskRange(code, cursor, Math.min(cursor + 2, source.length));
        cursor += 2;
        continue;
      }
      if (source[cursor] === "`") {
        maskRange(code, cursor, cursor + 1);
        return cursor + 1;
      }
      if (source[cursor] === "$" && source[cursor + 1] === "{") {
        maskRange(code, cursor, cursor + 1);
        cursor = scanTemplateExpression(cursor + 2);
        continue;
      }
      maskRange(code, cursor, cursor + 1);
      cursor += 1;
    }
    return cursor;
  };

  let index = 0;
  while (index < source.length) {
    if (source[index] === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = maskComment(index);
      continue;
    }
    if (source[index] === "'" || source[index] === "\"") {
      index = maskQuotedString(index, source[index]);
      continue;
    }
    if (source[index] === "`") {
      index = scanTemplate(index);
      continue;
    }
    index += 1;
  }
  return { code: code.join(""), commentFree: commentFree.join("") };
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (/\s/.test(source[cursor] || "")) cursor += 1;
  return cursor;
}

function readStringLiteral(source, index) {
  const start = skipWhitespace(source, index);
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  let value = "";
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === quote) return { value, end: cursor + 1 };
    if (character === "\\") {
      const escaped = source[cursor + 1];
      const replacements = { n: "\n", r: "\r", t: "\t" };
      value += replacements[escaped] ?? escaped ?? "";
      cursor += 1;
    } else {
      value += character;
    }
  }
  return null;
}

function findMatching(source, openingIndex, opening, closing) {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === opening) depth += 1;
    if (source[index] === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitArguments(code, openingIndex, closingIndex) {
  const ranges = [];
  let start = openingIndex + 1;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = start; index < closingIndex; index += 1) {
    if (code[index] === "(") round += 1;
    else if (code[index] === ")") round -= 1;
    else if (code[index] === "[") square += 1;
    else if (code[index] === "]") square -= 1;
    else if (code[index] === "{") curly += 1;
    else if (code[index] === "}") curly -= 1;
    else if (code[index] === "," && round === 0 && square === 0 && curly === 0) {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: closingIndex });
  return ranges;
}

function collectBindings(source, code) {
  const bindings = new Map();
  const declaredNames = new Set();
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=`, "g");
  for (const match of code.matchAll(declaration)) {
    const name = match[1];
    if (declaredNames.has(name)) {
      bindings.set(name, { type: "ambiguous" });
      continue;
    }
    declaredNames.add(name);
    const declarationEnd = match.index + match[0].length;
    const literal = readStringLiteral(source, declarationEnd);
    if (literal) {
      bindings.set(name, { type: "string", value: literal.value });
      continue;
    }
    const initializerStart = skipWhitespace(code, declarationEnd);
    if (code[initializerStart] === "{") {
      const end = findMatching(code, initializerStart, "{", "}");
      if (end !== -1) bindings.set(name, { type: "object", start: initializerStart, end: end + 1 });
      continue;
    }
    const request = /^(?:new\s+)?Request\s*\(/.exec(code.slice(initializerStart));
    if (request) {
      const opening = initializerStart + request[0].lastIndexOf("(");
      const closing = findMatching(code, opening, "(", ")");
      if (closing !== -1) bindings.set(name, { type: "request", start: initializerStart, end: closing + 1 });
      continue;
    }
    const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(initializerStart));
    if (identifier) bindings.set(name, { type: "alias", name: identifier[1] });
  }
  return bindings;
}

function resolveBinding(bindings, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const binding = bindings.get(name);
  if (binding?.type === "alias") return resolveBinding(bindings, binding.name, seen);
  return binding || null;
}

function resolveMethodValue(source, code, commentFree, bindings, expressionStart, expressionEnd) {
  const literalStart = skipWhitespace(commentFree, expressionStart);
  const literal = readStringLiteral(source, literalStart);
  if (literal) return literal.value.toUpperCase();
  const start = skipWhitespace(code, expressionStart);
  const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(start, expressionEnd));
  if (!identifier) return null;
  const binding = resolveBinding(bindings, identifier[1]);
  return binding?.type === "string" ? binding.value.toUpperCase() : null;
}

function topLevelObjectProperties(code, range) {
  const opening = skipWhitespace(code, range.start);
  if (code[opening] !== "{") return null;
  const closing = findMatching(code, opening, "{", "}");
  if (closing === -1 || closing >= range.end) return null;
  return splitArguments(code, opening, closing);
}

function objectFetchMethod(source, code, commentFree, bindings, range) {
  const properties = topLevelObjectProperties(code, range);
  if (!properties) return "<dynamic>";
  const methods = [];
  for (const property of properties) {
    const propertyCode = code.slice(property.start, property.end);
    if (!propertyCode.trim()) continue;
    const codeStart = skipWhitespace(code, property.start);
    if (code.startsWith("...", codeStart) || code[codeStart] === "[") return "<dynamic>";

    const keyStart = skipWhitespace(commentFree, property.start);
    const quotedKey = readStringLiteral(source, keyStart);
    if (quotedKey) {
      const colon = skipWhitespace(commentFree, quotedKey.end);
      if (commentFree[colon] === ":" && quotedKey.value === "method") {
        methods.push(
          resolveMethodValue(source, code, commentFree, bindings, colon + 1, property.end) || "<dynamic>"
        );
      }
      continue;
    }

    const accessor = /^(?:(?:get|set|async)\s+)?method\s*\(/.exec(code.slice(codeStart, property.end));
    if (accessor) return "<dynamic>";
    const methodKey = /^method\b/.exec(code.slice(codeStart, property.end));
    if (!methodKey) continue;
    const afterKey = skipWhitespace(code, codeStart + methodKey[0].length);
    if (code[afterKey] === ":") {
      methods.push(
        resolveMethodValue(source, code, commentFree, bindings, afterKey + 1, property.end) || "<dynamic>"
      );
    } else if (!code.slice(afterKey, property.end).trim()) {
      const binding = resolveBinding(bindings, "method");
      methods.push(binding?.type === "string" ? binding.value.toUpperCase() : "<dynamic>");
    } else {
      return "<dynamic>";
    }
  }
  if (methods.length > 1) return "<dynamic>";
  return methods[0] || null;
}

function fetchInputMethod(source, code, commentFree, bindings, range, seenRequests = new Set()) {
  const literalStart = skipWhitespace(commentFree, range.start);
  if (readStringLiteral(source, literalStart)) return "GET";
  const codeStart = skipWhitespace(code, range.start);
  const directRequest = /^(?:new\s+)?Request\s*\(/.exec(code.slice(codeStart, range.end));
  if (directRequest) {
    const opening = codeStart + directRequest[0].lastIndexOf("(");
    const closing = findMatching(code, opening, "(", ")");
    if (closing === -1 || closing >= range.end) return "<dynamic>";
    const requestKey = `${codeStart}:${closing}`;
    if (seenRequests.has(requestKey)) return "<dynamic>";
    const nextSeen = new Set(seenRequests).add(requestKey);
    const args = splitArguments(code, opening, closing);
    if (args.length > 1 && code.slice(args[1].start, args[1].end).trim()) {
      const optionsStart = skipWhitespace(code, args[1].start);
      if (!/^(?:undefined|null)\b/.test(code.slice(optionsStart, args[1].end))) {
        let method;
        if (code[optionsStart] === "{") {
          method = objectFetchMethod(source, code, commentFree, bindings, args[1]);
        } else {
          const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(optionsStart, args[1].end));
          const binding = identifier ? resolveBinding(bindings, identifier[1]) : null;
          method = binding?.type === "object"
            ? objectFetchMethod(source, code, commentFree, bindings, binding)
            : "<dynamic>";
        }
        if (method !== null) return method;
      }
    }
    return fetchInputMethod(source, code, commentFree, bindings, args[0], nextSeen);
  }
  const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(codeStart, range.end));
  const binding = identifier ? resolveBinding(bindings, identifier[1]) : null;
  if (binding?.type === "string") return "GET";
  if (binding?.type === "request") {
    return fetchInputMethod(source, code, commentFree, bindings, binding, seenRequests);
  }
  return "<dynamic>";
}

function fetchUsesWriteTransport(source, code, commentFree) {
  const bindings = collectBindings(source, code);
  const fetchCall = /\bfetch\s*\(/g;
  for (const match of code.matchAll(fetchCall)) {
    const opening = match.index + match[0].lastIndexOf("(");
    const closing = findMatching(code, opening, "(", ")");
    if (closing === -1) return true;
    const args = splitArguments(code, opening, closing);
    const inputMethod = fetchInputMethod(source, code, commentFree, bindings, args[0]);
    if (args.length < 2 || !code.slice(args[1].start, args[1].end).trim()) {
      if (!READ_METHODS.has(inputMethod)) return true;
      continue;
    }
    const optionsStart = skipWhitespace(code, args[1].start);
    if (/^(?:undefined|null)\b/.test(code.slice(optionsStart, args[1].end))) {
      if (!READ_METHODS.has(inputMethod)) return true;
      continue;
    }
    let method;
    if (code[optionsStart] === "{") {
      method = objectFetchMethod(source, code, commentFree, bindings, args[1]);
    } else {
      const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(optionsStart, args[1].end));
      const binding = identifier ? resolveBinding(bindings, identifier[1]) : null;
      if (binding?.type === "object") {
        method = objectFetchMethod(source, code, commentFree, bindings, binding);
      } else {
        return true;
      }
    }
    if (method === null) method = inputMethod;
    if (READ_METHODS.has(method)) continue;
    if (WRITE_METHODS.has(method) || method === "<dynamic>") return true;
    return true;
  }
  return false;
}

function findFunctionRanges(code) {
  const ranges = [];
  const declaration = new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?function\\s+(${IDENTIFIER})\\s*\\([^)]*\\)\\s*\\{`,
    "g"
  );
  for (const match of code.matchAll(declaration)) {
    const opening = match.index + match[0].lastIndexOf("{");
    const closing = findMatching(code, opening, "{", "}");
    if (closing !== -1) ranges.push({ name: match[1], start: opening, end: closing + 1 });
  }
  return ranges;
}

function enclosingFunction(ranges, position) {
  return ranges
    .filter((range) => range.start < position && position < range.end)
    .sort((left, right) => right.start - left.start)[0] || null;
}

function collectFsBindings(commentFree, code) {
  const bindings = new Map();
  const namespaces = new Set();
  const registerDestructuring = (specifiers) => {
    let registered = false;
    for (const specifier of specifiers.split(",")) {
      const parsed = new RegExp(
        `^\\s*(${[...FS_OPERATIONS].join("|")}|promises)`
          + `(?:\\s*:\\s*(${IDENTIFIER}))?\\s*$`
      ).exec(specifier);
      if (!parsed) continue;
      const [, property, alias] = parsed;
      const localName = alias || property;
      if (property === "promises") {
        if (!namespaces.has(localName)) {
          namespaces.add(localName);
          registered = true;
        }
      } else if (bindings.get(localName) !== property) {
        bindings.set(localName, property);
        registered = true;
      }
    }
    return registered;
  };
  const namedImport = new RegExp(
    `\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*(["'])${FS_MODULE_SPECIFIER}\\2`,
    "g"
  );
  for (const match of commentFree.matchAll(namedImport)) {
    for (const specifier of match[1].split(",")) {
      const parsed = new RegExp(`^\\s*(${[...FS_OPERATIONS].join("|")})(?:\\s+as\\s+(${IDENTIFIER}))?\\s*$`).exec(specifier);
      if (parsed) bindings.set(parsed[2] || parsed[1], parsed[1]);
    }
  }
  const namespaceImport = new RegExp(
    `\\bimport\\s*\\*\\s*as\\s*(${IDENTIFIER})\\s*from\\s*(["'])${FS_MODULE_SPECIFIER}\\2`,
    "g"
  );
  for (const match of commentFree.matchAll(namespaceImport)) namespaces.add(match[1]);
  const promisesImport = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])(?:node:)?fs\2/g;
  for (const match of commentFree.matchAll(promisesImport)) {
    for (const specifier of match[1].split(",")) {
      const parsed = new RegExp(
        `^\\s*promises(?:\\s+as\\s+(${IDENTIFIER}))?\\s*$`
      ).exec(specifier);
      if (parsed) namespaces.add(parsed[1] || "promises");
    }
  }
  const defaultFsImport = new RegExp(
    `\\bimport\\s+(${IDENTIFIER})\\s+from\\s*(["'])${FS_MODULE_SPECIFIER}\\2`,
    "g"
  );
  for (const match of commentFree.matchAll(defaultFsImport)) namespaces.add(match[1]);
  const commonJsPromises = new RegExp(
    `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*require\\(\\s*(["'])`
      + `${FS_MODULE_SPECIFIER}\\2\\s*\\)(?:\\s*\\.\\s*promises)?`,
    "g"
  );
  for (const match of commentFree.matchAll(commonJsPromises)) namespaces.add(match[1]);
  const destructuredRequire = new RegExp(
    `\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*require\\(\\s*(["'])`
      + `${FS_MODULE_SPECIFIER}\\2\\s*\\)(?:\\s*\\.\\s*promises)?\\s*[;,]`,
    "g"
  );
  for (const match of commentFree.matchAll(destructuredRequire)) {
    registerDestructuring(match[1]);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const alias = new RegExp(
      `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*(${IDENTIFIER})`
      + `(?:\\s*\\.\\s*(${IDENTIFIER}))?(?:\\s*\\.\\s*(${IDENTIFIER}))?\\s*[;,]`,
      "g"
    );
    for (const match of code.matchAll(alias)) {
      const [, target, source, firstMember, secondMember] = match;
      const namespaceAlias = !firstMember && namespaces.has(source)
        || firstMember === "promises" && !secondMember && namespaces.has(source);
      if (namespaceAlias && !namespaces.has(target)) {
        namespaces.add(target);
        changed = true;
      }
      const memberOperation = secondMember && firstMember === "promises"
        ? secondMember
        : !secondMember ? firstMember : null;
      const operation = memberOperation && namespaces.has(source) && FS_OPERATIONS.has(memberOperation)
        ? memberOperation
        : !firstMember && bindings.get(source);
      if (operation && bindings.get(target) !== operation) {
        bindings.set(target, operation);
        changed = true;
      }
    }
    const destructuredNamespace = new RegExp(
      `\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(${IDENTIFIER})`
        + `(?:\\s*\\.\\s*promises)?\\s*[;,]`,
      "g"
    );
    for (const match of code.matchAll(destructuredNamespace)) {
      if (namespaces.has(match[2]) && registerDestructuring(match[1])) changed = true;
    }
  }
  return { bindings, namespaces };
}

function firstArgument(code, openingIndex) {
  const closing = findMatching(code, openingIndex, "(", ")");
  if (closing === -1) return "<invalid>";
  const [first] = splitArguments(code, openingIndex, closing);
  return code.slice(first.start, first.end).replace(/\s+/g, "");
}

function destructiveFsCalls(source, code, commentFree) {
  const { bindings, namespaces } = collectFsBindings(commentFree, code);
  const calls = [];
  const directCall = new RegExp(`\\b(${IDENTIFIER})\\s*\\(`, "g");
  for (const match of code.matchAll(directCall)) {
    const operation = bindings.get(match[1]);
    if (!operation) continue;
    if (code.slice(0, match.index).trimEnd().endsWith(".")) continue;
    const opening = match.index + match[0].lastIndexOf("(");
    calls.push({
      position: match.index,
      callee: match[1],
      operation,
      argument: firstArgument(code, opening)
    });
  }
  const memberCall = new RegExp(
    `\\b(${IDENTIFIER})\\s*\\.\\s*(?:(promises)\\s*\\.\\s*)?`
    + `(${[...FS_OPERATIONS].join("|")})\\s*\\(`,
    "g"
  );
  for (const match of code.matchAll(memberCall)) {
    if (!namespaces.has(match[1])) continue;
    const opening = match.index + match[0].lastIndexOf("(");
    calls.push({
      position: match.index,
      callee: `${match[1]}.${match[2] ? "promises." : ""}${match[3]}`,
      operation: match[3],
      argument: firstArgument(code, opening)
    });
  }
  return calls;
}

function isAllowedCleanup(relativePath, call, functions, commentFree) {
  const context = enclosingFunction(functions, call.position);
  if (!context || call.callee !== call.operation) return false;
  const rules = SAFE_CLEANUP_CONTEXTS.get(relativePath) || [];
  return rules.some((rule) => {
    if (
      rule.functionName !== context.name
      || rule.operation !== call.operation
      || rule.argument !== call.argument
    ) return false;
    if (!rule.stagingPrefix) return true;
    const functionSource = commentFree.slice(context.start, context.end);
    const prefix = rule.stagingPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `\\bconst\\s+stagingRoot\\s*=\\s*path\\.join\\([\\s\\S]*?["'\`]${prefix}`
    ).test(functionSource);
  });
}

function inspectRuntimeSource(relativePath, source) {
  const { code, commentFree } = maskJavaScript(source);
  const saveReasons = DIRECT_WRITE_TRANSPORTS
    .filter(({ expression }) => expression.test(code))
    .map(({ label }) => label);
  if (fetchUsesWriteTransport(source, code, commentFree)) saveReasons.push("non-read-only fetch");

  const functions = findFunctionRanges(code);
  const unsafeFsCalls = destructiveFsCalls(source, code, commentFree)
    .filter((call) => !isAllowedCleanup(relativePath, call, functions, commentFree));
  return {
    saveReasons,
    destructive: DESTRUCTIVE_WORKFLOW_NAME.test(code) || unsafeFsCalls.length > 0
  };
}

async function listTrackedPaths(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    windowsHide: true
  });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

export async function checkRepository({ repositoryRoot, trackedPaths } = {}) {
  if (!repositoryRoot) throw new Error("repositoryRoot is required");
  const paths = (trackedPaths || await listTrackedPaths(repositoryRoot))
    .map(normalizePath)
    .sort();
  const failures = [];

  for (const relativePath of paths) {
    if (!/^[\x20-\x7e]+$/.test(relativePath)) {
      failures.push(`Non-ASCII tracked path: ${relativePath}`);
    }
  }

  for (const relativePath of paths.filter((item) => RUNTIME_PATH.test(item))) {
    const source = await readFile(
      path.join(repositoryRoot, ...relativePath.split("/")),
      "utf8"
    );
    const inspection = inspectRuntimeSource(relativePath, source);
    if (inspection.saveReasons.length > 0) {
      failures.push(
        `Runtime save service: ${relativePath} (${inspection.saveReasons.join(", ")})`
      );
    }
    if (inspection.destructive) {
      failures.push(`Destructive project-data workflow: ${relativePath}`);
    }
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  return { trackedPaths: paths.length };
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const result = await checkRepository({ repositoryRoot });
  process.stdout.write(
    `Repository check passed: ${result.trackedPaths} ASCII tracked paths; syntactic runtime write and destructive-workflow policy passed\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
