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
const FS_OPERATIONS = new Set(["rm", "rmSync", "unlink", "unlinkSync", "rmdir", "rmdirSync"]);
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
  let index = 0;
  const maskRange = (target, start, end) => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (target[cursor] !== "\n" && target[cursor] !== "\r") target[cursor] = " ";
    }
  };

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      maskRange(code, index, stop);
      maskRange(commentFree, index, stop);
      index = stop;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const closing = source.indexOf("*/", index + 2);
      const stop = closing === -1 ? source.length : closing + 2;
      maskRange(code, index, stop);
      maskRange(commentFree, index, stop);
      index = stop;
      continue;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === "`") {
      const quote = source[index];
      let cursor = index + 1;
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
      maskRange(code, index, cursor);
      index = cursor;
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
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=`, "g");
  for (const match of code.matchAll(declaration)) {
    const name = match[1];
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

function resolveMethodValue(source, code, bindings, expressionStart, expressionEnd) {
  const literal = readStringLiteral(source, expressionStart);
  if (literal) return literal.value.toUpperCase();
  const start = skipWhitespace(code, expressionStart);
  const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(start, expressionEnd));
  if (!identifier) return null;
  const binding = resolveBinding(bindings, identifier[1]);
  return binding?.type === "string" ? binding.value.toUpperCase() : null;
}

function objectFetchMethod(source, code, bindings, range) {
  const objectCode = code.slice(range.start, range.end);
  const objectSource = source.slice(range.start, range.end);
  // A spread or computed key can conceal or override the effective method.
  // Reject the whole options object regardless of property ordering.
  if (/(?:^|[{,])\s*(?:\.\.\.|\[)/.test(objectCode)) return "<dynamic>";
  if (/(?:^|[{,])\s*(?:["']method["']|`method`)\s*:/.test(objectSource)) return "<dynamic>";
  if (/(?:^|[{,])\s*(?:(?:get|set|async)\s+)?method\s*\(/.test(objectCode)) return "<dynamic>";
  const explicit = [...objectCode.matchAll(/\bmethod\s*:/g)];
  const shorthand = [...objectCode.matchAll(/(?:^|[,{}])\s*method\s*(?=[,}])/g)];
  if (explicit.length + shorthand.length > 1) return "<dynamic>";
  if (explicit.length === 1) {
    const [match] = explicit;
    const expressionStart = range.start + match.index + match[0].length;
    return resolveMethodValue(source, code, bindings, expressionStart, range.end) || "<dynamic>";
  }
  if (shorthand.length === 1) {
    const binding = resolveBinding(bindings, "method");
    return binding?.type === "string" ? binding.value.toUpperCase() : "<dynamic>";
  }
  return null;
}

function fetchUsesWriteTransport(source, code) {
  const bindings = collectBindings(source, code);
  const fetchCall = /\bfetch\s*\(/g;
  for (const match of code.matchAll(fetchCall)) {
    const opening = match.index + match[0].lastIndexOf("(");
    const closing = findMatching(code, opening, "(", ")");
    if (closing === -1) return true;
    const args = splitArguments(code, opening, closing);
    if (args.length < 2 || !code.slice(args[1].start, args[1].end).trim()) continue;
    const optionsStart = skipWhitespace(code, args[1].start);
    if (/^(?:undefined|null)\b/.test(code.slice(optionsStart, args[1].end))) continue;
    let method;
    if (code[optionsStart] === "{") {
      method = objectFetchMethod(source, code, bindings, args[1]);
    } else {
      const identifier = new RegExp(`^(${IDENTIFIER})\\b`).exec(code.slice(optionsStart, args[1].end));
      const binding = identifier ? resolveBinding(bindings, identifier[1]) : null;
      if (binding?.type === "object") {
        method = objectFetchMethod(source, code, bindings, binding);
      } else {
        return true;
      }
    }
    if (method === null || READ_METHODS.has(method)) continue;
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
  const bindings = new Map([...FS_OPERATIONS].map((name) => [name, name]));
  const namespaces = new Set();
  const namedImport = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])node:fs(?:\/promises)?\2/g;
  for (const match of commentFree.matchAll(namedImport)) {
    for (const specifier of match[1].split(",")) {
      const parsed = new RegExp(`^\\s*(${[...FS_OPERATIONS].join("|")})(?:\\s+as\\s+(${IDENTIFIER}))?\\s*$`).exec(specifier);
      if (parsed) bindings.set(parsed[2] || parsed[1], parsed[1]);
    }
  }
  const namespaceImport = new RegExp(`\\bimport\\s*\\*\\s*as\\s*(${IDENTIFIER})\\s*from\\s*(["'])node:fs(?:/promises)?\\2`, "g");
  for (const match of commentFree.matchAll(namespaceImport)) namespaces.add(match[1]);

  let changed = true;
  while (changed) {
    changed = false;
    const alias = new RegExp(`\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*(${IDENTIFIER})(?:\\s*\\.\\s*(${IDENTIFIER}))?\\s*[;,]`, "g");
    for (const match of code.matchAll(alias)) {
      const [, target, source, member] = match;
      const operation = member && namespaces.has(source) && FS_OPERATIONS.has(member)
        ? member
        : !member && bindings.get(source);
      if (operation && bindings.get(target) !== operation) {
        bindings.set(target, operation);
        changed = true;
      }
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
    const opening = match.index + match[0].lastIndexOf("(");
    calls.push({
      position: match.index,
      callee: match[1],
      operation,
      argument: firstArgument(code, opening)
    });
  }
  const memberCall = new RegExp(`\\b(${IDENTIFIER})\\s*\\.\\s*(${[...FS_OPERATIONS].join("|")})\\s*\\(`, "g");
  for (const match of code.matchAll(memberCall)) {
    if (!namespaces.has(match[1])) continue;
    const opening = match.index + match[0].lastIndexOf("(");
    calls.push({
      position: match.index,
      callee: `${match[1]}.${match[2]}`,
      operation: match[2],
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
  if (fetchUsesWriteTransport(source, code)) saveReasons.push("non-read-only fetch");

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
