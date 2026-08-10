import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const execFileAsync = promisify(execFile);
const RUNTIME_PATH = /^(?:prd-annotator\/(?:src\/.*\.(?:cjs|js|mjs)|prd-annotator\.js)|prd-annotator-skill\/scripts\/.*\.(?:cjs|js|mjs))$/;
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

function maskJavaScript(source, literalRanges = []) {
  const code = [...source];
  const commentFree = [...source];
  const literalByStart = new Map(literalRanges.map((range) => [range.start, range]));
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
      const literal = literalByStart.get(cursor);
      if (literal) {
        maskRange(code, literal.start, literal.end);
        maskRange(commentFree, literal.start, literal.end);
        cursor = literal.end;
        continue;
      }
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
    const literal = literalByStart.get(index);
    if (literal) {
      maskRange(code, literal.start, literal.end);
      maskRange(commentFree, literal.start, literal.end);
      index = literal.end;
      continue;
    }
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

function parseRuntimeAst(source, sourceType) {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: sourceType === "module",
      ecmaVersion: "latest",
      sourceType
    });
  } catch {
    return null;
  }
}

function isFsModuleSpecifier(value) {
  return typeof value === "string" && /^(?:node:)?fs(?:\/promises)?$/.test(value);
}

function staticPropertyName(node) {
  if (!node || node.computed) return null;
  if (node.property?.type === "Identifier") return node.property.name;
  return null;
}

function astChildNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node || {})) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item?.type) children.push(item);
      }
    } else if (value?.type) {
      children.push(value);
    }
  }
  return children;
}

function regexLiteralRanges(ast) {
  const ranges = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "Literal" && node.regex) {
      ranges.push({ start: node.start, end: node.end });
      return;
    }
    for (const child of astChildNodes(node)) walk(child);
  };
  walk(ast);
  return ranges;
}

function destructiveFsCalls(source, code, ast) {
  const other = { kind: "other" };
  const namespace = { kind: "namespace" };
  const operation = (name) => ({ kind: "operation", operation: name });
  const createScope = (parent, type = "block") => ({ parent, type, bindings: new Map() });
  const rootScope = createScope(null, "program");
  const nodeScopes = new WeakMap();
  const assignments = [];
  const declare = (scope, name, descriptor) => {
    if (!name) return;
    let binding = scope.bindings.get(name);
    if (!binding) {
      binding = { kind: "binding", descriptors: [] };
      scope.bindings.set(name, binding);
    }
    binding.descriptors.push(descriptor);
  };
  const declareUninitialized = (scope, name) => {
    if (!name || scope.bindings.has(name)) return;
    declare(scope, name, { kind: "resolved", value: other });
  };
  const lookupBinding = (scope, name) => {
    let current = scope;
    while (current) {
      if (current.bindings.has(name)) return current.bindings.get(name);
      current = current.parent;
    }
    return null;
  };
  const nearestVarScope = (scope) => {
    let current = scope;
    while (
      current.parent
      && current.type !== "function"
      && current.type !== "program"
      && current.type !== "static"
    ) {
      current = current.parent;
    }
    return current;
  };
  const boundIdentifiers = (pattern, output = []) => {
    if (!pattern) return output;
    if (pattern.type === "Identifier") output.push(pattern.name);
    else if (pattern.type === "AssignmentPattern") boundIdentifiers(pattern.left, output);
    else if (pattern.type === "RestElement") boundIdentifiers(pattern.argument, output);
    else if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        boundIdentifiers(property.type === "RestElement" ? property.argument : property.value, output);
      }
    } else if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) boundIdentifiers(element, output);
    }
    return output;
  };
  const declareOtherPattern = (scope, pattern) => {
    for (const name of boundIdentifiers(pattern)) declare(scope, name, { kind: "resolved", value: other });
  };
  const registerVariablePattern = (targetScope, expressionScope, pattern, expression, path = []) => {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") {
      registerVariablePattern(targetScope, expressionScope, pattern.left, expression, path);
      return;
    }
    if (pattern.type === "Identifier") {
      if (!expression) {
        declareUninitialized(targetScope, pattern.name);
        return;
      }
      declare(targetScope, pattern.name, {
        kind: "expression",
        expression,
        expressionScope,
        path
      });
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        if (property.type === "RestElement" || property.computed) {
          declareOtherPattern(targetScope, property.type === "RestElement" ? property.argument : property.value);
          continue;
        }
        const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
        registerVariablePattern(targetScope, expressionScope, property.value, expression, [...path, key]);
      }
      return;
    }
    if (pattern.type === "ArrayPattern" && expression?.type === "ArrayExpression" && path.length === 0) {
      for (let index = 0; index < pattern.elements.length; index += 1) {
        registerVariablePattern(
          targetScope,
          expressionScope,
          pattern.elements[index],
          expression.elements[index]
        );
      }
      return;
    }
    declareOtherPattern(targetScope, pattern);
  };
  const registerAssignmentPattern = (targetScope, pattern, expression, expressionScope, path = []) => {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") {
      registerAssignmentPattern(targetScope, pattern.left, expression, expressionScope, path);
      registerAssignmentPattern(targetScope, pattern.left, pattern.right, expressionScope);
      return;
    }
    if (pattern.type === "Identifier") {
      const binding = lookupBinding(targetScope, pattern.name);
      if (!binding) return;
      binding.descriptors.push(expression
        ? { kind: "expression", expression, expressionScope, path }
        : { kind: "resolved", value: other });
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        if (property.type === "RestElement" || property.computed) continue;
        const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
        registerAssignmentPattern(
          targetScope,
          property.value,
          expression,
          expressionScope,
          [...path, key]
        );
      }
      return;
    }
    if (pattern.type === "ArrayPattern" && expression?.type === "ArrayExpression" && path.length === 0) {
      for (let index = 0; index < pattern.elements.length; index += 1) {
        registerAssignmentPattern(
          targetScope,
          pattern.elements[index],
          expression.elements[index],
          expressionScope
        );
      }
    }
  };
  const registerParameterDefaults = (scope, pattern) => {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") {
      registerAssignmentPattern(scope, pattern.left, pattern.right, scope);
      registerParameterDefaults(scope, pattern.left);
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        registerParameterDefaults(
          scope,
          property.type === "RestElement" ? property.argument : property.value
        );
      }
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) registerParameterDefaults(scope, element);
    }
  };
  const importBinding = (specifier, moduleName) => {
    if (!isFsModuleSpecifier(moduleName)) return other;
    if (specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportNamespaceSpecifier") {
      return namespace;
    }
    const imported = specifier.imported?.name ?? specifier.imported?.value;
    if (imported === "promises") return namespace;
    if (FS_OPERATIONS.has(imported)) return operation(imported);
    return other;
  };

  const buildScopes = (node, scope, functionBody = false) => {
    if (!node) return;
    nodeScopes.set(node, scope);
    if (node.type === "Program") {
      for (const statement of node.body) buildScopes(statement, scope);
      return;
    }
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        declare(scope, specifier.local.name, {
          kind: "resolved",
          value: importBinding(specifier, node.source.value)
        });
      }
      return;
    }
    if (node.type === "FunctionDeclaration") {
      if (node.id) declare(scope, node.id.name, { kind: "resolved", value: other });
      const functionScope = createScope(scope, "function");
      if (node.id) declare(functionScope, node.id.name, { kind: "resolved", value: other });
      for (const parameter of node.params) declareOtherPattern(functionScope, parameter);
      for (const parameter of node.params) registerParameterDefaults(functionScope, parameter);
      for (const parameter of node.params) buildScopes(parameter, functionScope);
      buildScopes(node.body, functionScope, true);
      return;
    }
    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      const functionScope = createScope(scope, "function");
      if (node.id) declare(functionScope, node.id.name, { kind: "resolved", value: other });
      for (const parameter of node.params) declareOtherPattern(functionScope, parameter);
      for (const parameter of node.params) registerParameterDefaults(functionScope, parameter);
      for (const parameter of node.params) buildScopes(parameter, functionScope);
      buildScopes(node.body, functionScope, node.body.type === "BlockStatement");
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration" && node.id) {
        declare(scope, node.id.name, { kind: "resolved", value: other });
      }
      const classScope = createScope(scope, "class");
      nodeScopes.set(node.body, classScope);
      if (node.id) declare(classScope, node.id.name, { kind: "resolved", value: other });
      buildScopes(node.superClass, scope);
      for (const element of node.body.body) buildScopes(element, classScope);
      return;
    }
    if (node.type === "BlockStatement") {
      const blockScope = functionBody ? scope : createScope(scope);
      nodeScopes.set(node, blockScope);
      for (const statement of node.body) buildScopes(statement, blockScope);
      return;
    }
    if (node.type === "CatchClause") {
      const catchScope = createScope(scope);
      nodeScopes.set(node, catchScope);
      declareOtherPattern(catchScope, node.param);
      buildScopes(node.param, catchScope);
      buildScopes(node.body, catchScope, true);
      return;
    }
    if (node.type === "ForStatement") {
      const loopScope = createScope(scope);
      nodeScopes.set(node, loopScope);
      buildScopes(node.init, loopScope);
      buildScopes(node.test, loopScope);
      buildScopes(node.update, loopScope);
      buildScopes(node.body, loopScope);
      return;
    }
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const loopScope = createScope(scope);
      nodeScopes.set(node, loopScope);
      buildScopes(node.left, loopScope);
      buildScopes(node.right, loopScope);
      buildScopes(node.body, loopScope);
      return;
    }
    if (node.type === "SwitchStatement") {
      buildScopes(node.discriminant, scope);
      const switchScope = createScope(scope);
      nodeScopes.set(node, switchScope);
      for (const switchCase of node.cases) buildScopes(switchCase, switchScope);
      return;
    }
    if (node.type === "StaticBlock") {
      const staticScope = createScope(scope, "static");
      nodeScopes.set(node, staticScope);
      for (const statement of node.body) buildScopes(statement, staticScope);
      return;
    }
    if (node.type === "VariableDeclaration") {
      const targetScope = node.kind === "var" ? nearestVarScope(scope) : scope;
      for (const declarator of node.declarations) {
        registerVariablePattern(targetScope, scope, declarator.id, declarator.init);
        buildScopes(declarator.id, scope);
        buildScopes(declarator.init, scope);
      }
      return;
    }
    if (node.type === "AssignmentExpression") {
      assignments.push({
        pattern: node.left,
        expression: node.operator === "=" ? node.right : null,
        expressionScope: scope,
        targetScope: scope
      });
      buildScopes(node.left, scope);
      buildScopes(node.right, scope);
      return;
    }
    for (const child of astChildNodes(node)) buildScopes(child, scope);
  };
  buildScopes(ast, rootScope);
  for (const assignment of assignments) {
    registerAssignmentPattern(
      assignment.targetScope,
      assignment.pattern,
      assignment.expression,
      assignment.expressionScope
    );
  }

  const mergeValues = (values) => {
    const merged = new Map();
    for (const value of values.flat()) {
      const key = value.kind === "operation"
        ? `operation:${value.operation}:${value.alternate || "direct"}`
        : value.kind === "invoker" || value.kind === "binder"
          ? `${value.kind}:${value.operation}:${value.invocation}`
          : value.kind === "object"
            ? `object:${value.expression.start}:${value.expression.end}`
          : value.kind;
      if (!merged.has(key)) merged.set(key, value);
    }
    return [...merged.values()];
  };
  const memberBinding = (bindings, property, seen) => {
    return mergeValues(bindings.flatMap((binding) => {
      if (binding.kind === "namespace") {
        if (property === "promises") return namespace;
        if (FS_OPERATIONS.has(property)) return operation(property);
        return other;
      }
      if (binding.kind === "object") {
        const values = binding.properties.get(property);
        if (!values) return other;
        return values.map((value) => resolveExpression(value, binding.scope, seen));
      }
      if (binding.kind === "operation" && (property === "call" || property === "apply")) {
        return { kind: "invoker", operation: binding.operation, invocation: property };
      }
      if (binding.kind === "operation" && property === "bind") {
        return { kind: "binder", operation: binding.operation, invocation: property };
      }
      return other;
    }));
  };
  const resolveName = (scope, name, seen) => {
    const binding = lookupBinding(scope, name);
    return binding ? resolveDescriptor(binding, seen) : [other];
  };
  const resolveExpression = (expression, scope, seen) => {
    if (!expression) return [other];
    if (expression.type === "Identifier") return resolveName(scope, expression.name, seen);
    if (expression.type === "MemberExpression") {
      const property = staticPropertyName(expression);
      return property
        ? memberBinding(resolveExpression(expression.object, scope, seen), property, seen)
        : [other];
    }
    if (expression.type === "ObjectExpression") {
      const properties = new Map();
      let opaque = false;
      for (const property of expression.properties) {
        if (property.type === "SpreadElement" || property.computed || property.kind !== "init") {
          opaque = true;
          continue;
        }
        const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
        const values = properties.get(key) || [];
        values.push(property.value);
        properties.set(key, values);
      }
      return [
        { kind: "object", expression, properties, scope },
        ...(opaque ? [other] : [])
      ];
    }
    if (expression.type === "AssignmentExpression" && expression.operator === "=") {
      return resolveExpression(expression.right, scope, seen);
    }
    if (expression.type === "SequenceExpression") {
      const lastExpression = expression.expressions.at(-1);
      return lastExpression ? resolveExpression(lastExpression, scope, seen) : [other];
    }
    if (
      expression.type === "CallExpression"
      && expression.callee.type === "Identifier"
      && expression.callee.name === "require"
      && !lookupBinding(scope, "require")
      && expression.arguments.length === 1
      && expression.arguments[0].type === "Literal"
      && isFsModuleSpecifier(expression.arguments[0].value)
    ) return [namespace];
    if (expression.type === "CallExpression") {
      const calleeBindings = resolveExpression(expression.callee, scope, seen);
      const boundOperations = calleeBindings
        .filter((binding) => binding.kind === "binder")
        .map((binding) => ({
          kind: "operation",
          operation: binding.operation,
          alternate: "bind"
        }));
      if (boundOperations.length > 0) {
        if (calleeBindings.some((binding) => binding.kind !== "binder")) boundOperations.push(other);
        return mergeValues(boundOperations);
      }
    }
    return [other];
  };
  function resolveDescriptor(descriptor, seen = new Set()) {
    if (!descriptor) return [other];
    if (descriptor.kind === "resolved") return [descriptor.value];
    if (seen.has(descriptor)) return [other];
    const nextSeen = new Set(seen).add(descriptor);
    if (descriptor.kind === "binding") {
      return mergeValues(descriptor.descriptors.map((item) => resolveDescriptor(item, nextSeen)));
    }
    let value = resolveExpression(descriptor.expression, descriptor.expressionScope, nextSeen);
    for (const property of descriptor.path) value = memberBinding(value, property, nextSeen);
    return value;
  }

  const staticNodeName = (node) => {
    if (!node || node.computed) return null;
    if (node.key?.type === "Identifier") return node.key.name;
    if (node.key?.type === "Literal") return String(node.key.value);
    return null;
  };
  const functionName = (node, parent) => {
    if (node.id?.name) return node.id.name;
    if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
      return parent.id.name;
    }
    if (parent?.type === "AssignmentExpression" && parent.left.type === "Identifier") {
      return parent.left.name;
    }
    if (parent?.type === "MethodDefinition" || parent?.type === "Property") {
      return staticNodeName(parent);
    }
    return null;
  };
  const isFunctionNode = (node) => node.type === "FunctionDeclaration"
    || node.type === "FunctionExpression"
    || node.type === "ArrowFunctionExpression";
  const isProgramLevelFunctionDeclaration = (node, parent, grandparent) => {
    if (node.type !== "FunctionDeclaration") return false;
    if (parent?.type === "Program") return true;
    return (parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration")
      && grandparent?.type === "Program";
  };
  const calls = [];
  const walk = (node, ancestors = [], context = null) => {
    if (!node) return;
    const parent = ancestors.at(-1) || null;
    const grandparent = ancestors.at(-2) || null;
    const currentContext = isFunctionNode(node)
      ? {
          name: functionName(node, parent),
          start: node.start,
          end: node.end,
          eligibleCleanup: isProgramLevelFunctionDeclaration(node, parent, grandparent)
        }
      : context;
    if (node.type === "CallExpression") {
      const scope = nodeScopes.get(node) || rootScope;
      const bindings = resolveExpression(node.callee, scope, new Set());
      const operations = bindings.filter(
        (binding) => binding.kind === "operation" || binding.kind === "invoker"
      );
      if (operations.length > 0) {
        const [firstOperation] = operations;
        calls.push({
          position: node.callee.start,
          callee: source.slice(node.callee.start, node.callee.end).replace(/\s+/g, ""),
          operation: firstOperation.operation,
          ambiguous: bindings.length > 1 || operations.some(
            (binding) => binding.operation !== firstOperation.operation
          ),
          alternateInvocation: firstOperation.invocation || firstOperation.alternate || null,
          context: currentContext,
          argumentBinding: node.arguments[0]?.type === "Identifier"
            ? lookupBinding(scope, node.arguments[0].name)
            : null,
          argument: node.arguments[0]
            ? code.slice(node.arguments[0].start, node.arguments[0].end).replace(/\s+/g, "")
            : ""
        });
      }
    }
    for (const child of astChildNodes(node)) walk(child, [...ancestors, node], currentContext);
  };
  walk(ast);
  return { calls, parseFailed: false };
}

function expressionStartsWith(expression, prefix) {
  if (expression?.type === "Literal" && typeof expression.value === "string") {
    return expression.value.startsWith(prefix);
  }
  if (expression?.type === "TemplateLiteral") {
    return (expression.quasis[0]?.value.cooked || "").startsWith(prefix);
  }
  return false;
}

function bindingHasStagingPrefix(binding, prefix) {
  if (!binding || binding.descriptors.length !== 1) return false;
  const [descriptor] = binding.descriptors;
  if (
    descriptor.kind !== "expression"
    || descriptor.path.length !== 0
    || descriptor.expression?.type !== "CallExpression"
  ) return false;
  const { callee, arguments: args } = descriptor.expression;
  return callee.type === "MemberExpression"
    && !callee.computed
    && callee.object.type === "Identifier"
    && callee.object.name === "path"
    && callee.property.type === "Identifier"
    && callee.property.name === "join"
    && args.some((argument) => expressionStartsWith(argument, prefix));
}

function isAllowedCleanup(relativePath, call) {
  const context = call.context;
  if (
    !context
    || !context.eligibleCleanup
    || call.ambiguous
    || call.alternateInvocation
    || call.callee !== call.operation
  ) return false;
  const rules = SAFE_CLEANUP_CONTEXTS.get(relativePath) || [];
  return rules.some((rule) => {
    if (
      rule.functionName !== context.name
      || rule.operation !== call.operation
      || rule.argument !== call.argument
    ) return false;
    if (!rule.stagingPrefix) return true;
    return bindingHasStagingPrefix(call.argumentBinding, rule.stagingPrefix);
  });
}

function inspectRuntimeSource(relativePath, source) {
  const sourceType = relativePath.endsWith(".cjs") ? "script" : "module";
  const ast = parseRuntimeAst(source, sourceType);
  const { code, commentFree } = maskJavaScript(source, ast ? regexLiteralRanges(ast) : []);
  const saveReasons = DIRECT_WRITE_TRANSPORTS
    .filter(({ expression }) => expression.test(code))
    .map(({ label }) => label);
  if (fetchUsesWriteTransport(source, code, commentFree)) saveReasons.push("non-read-only fetch");

  const fsInspection = ast
    ? destructiveFsCalls(source, code, ast)
    : { calls: [], parseFailed: true };
  const unsafeFsCalls = fsInspection.calls
    .filter((call) => !isAllowedCleanup(relativePath, call));
  return {
    saveReasons,
    destructive: DESTRUCTIVE_WORKFLOW_NAME.test(code)
      || fsInspection.parseFailed
      || unsafeFsCalls.length > 0
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
