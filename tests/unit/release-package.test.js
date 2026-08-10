import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { packageRelease } from "../../scripts/package-release.mjs";
import { checkRepository } from "../../scripts/check-repository.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeTrackedFile(root, relativePath, source) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source, "utf8");
  return absolutePath;
}

describe("Release packaging", () => {
  it("packages a checksum-verifiable SDK Release", async () => {
    const outputRoot = temporaryDirectory("prd-release-");

    await packageRelease({ repositoryRoot, outputRoot });

    const sdk = readFileSync(path.join(outputRoot, "prd-annotator.js"));
    const checksum = readFileSync(
      path.join(outputRoot, "prd-annotator.js.sha256"),
      "utf8"
    ).trim();
    expect(checksum).toBe(createHash("sha256").update(sdk).digest("hex"));
    expect(readJson(path.join(outputRoot, "release-manifest.json"))).toMatchObject({
      version: "2.0.0",
      assets: {
        sdk: "prd-annotator.js",
        checksum: "prd-annotator.js.sha256"
      }
    });
    expect(sdk.toString("utf8").split(/\r?\n/, 1)[0])
      .toBe("/*! PRD Annotator SDK v2.0.0 */");
  });

  it("replaces only named Release assets and preserves unrelated output files", async () => {
    const outputRoot = temporaryDirectory("prd-release-preserve-");
    for (const name of [
      "prd-annotator.js",
      "prd-annotator.js.sha256",
      "release-manifest.json"
    ]) {
      writeFileSync(path.join(outputRoot, name), "stale\n", "utf8");
    }
    writeFileSync(path.join(outputRoot, "keep-me.txt"), "user-owned\n", "utf8");

    await packageRelease({ repositoryRoot, outputRoot });

    expect(readFileSync(path.join(outputRoot, "keep-me.txt"), "utf8"))
      .toBe("user-owned\n");
    expect(readFileSync(path.join(outputRoot, "prd-annotator.js"), "utf8"))
      .not.toBe("stale\n");
  });
});

describe("repository policy scan", () => {
  it("rejects non-ASCII tracked paths", async () => {
    const root = temporaryDirectory("prd-repository-check-");

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: ["README.md", "文档.md"]
    })).rejects.toThrow("Non-ASCII tracked path: 文档.md");
  });

  it("rejects runtime save services and destructive project-data methods", async () => {
    const root = temporaryDirectory("prd-repository-runtime-");
    mkdirSync(path.join(root, "prd-annotator/src"), { recursive: true });
    mkdirSync(path.join(root, "prd-annotator-skill/scripts"), { recursive: true });
    writeFileSync(
      path.join(root, "prd-annotator/src/runtime.js"),
      "fetch('/save-annotations', { method: 'POST' });\n",
      "utf8"
    );
    writeFileSync(
      path.join(root, "prd-annotator-skill/scripts/unsafe.mjs"),
      "await rm(projectData, { recursive: true });\n",
      "utf8"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [
        "prd-annotator/src/runtime.js",
        "prd-annotator-skill/scripts/unsafe.mjs"
      ]
    })).rejects.toThrow(/Runtime save service|Destructive project-data workflow/);
  });

  it.each([
    [
      "XMLHttpRequest",
      "const request = new XMLHttpRequest(); request.open('POST', '/annotations'); request.send(payload);\n"
    ],
    [
      "sendBeacon",
      "navigator.sendBeacon('/annotations', payload);\n"
    ],
    [
      "WebSocket",
      "const socket = new WebSocket('wss://example.test/annotations'); socket.send(payload);\n"
    ],
    [
      "a variable fetch method",
      "const writeMethod = 'PATCH'; fetch('/annotations', { method: writeMethod, body: payload });\n"
    ],
    [
      "a shorthand variable fetch method",
      "const method = 'DELETE'; fetch('/annotations/1', { method, body: payload });\n"
    ],
    [
      "spread fetch options",
      "const options = { method: 'POST' }; fetch('/annotations', { ...options });\n"
    ],
    [
      "a computed fetch method property",
      "fetch('/annotations/1', { ['method']: 'DELETE' });\n"
    ],
    [
      "a quoted fetch method property",
      "fetch('/annotations', { 'method': 'POST' });\n"
    ],
    [
      "a fetch method getter",
      "fetch('/annotations', { get method() { return 'POST'; } });\n"
    ],
    [
      "a later duplicate fetch method",
      "fetch('/annotations', { method: 'GET', method: 'POST' });\n"
    ],
    [
      "a write binding shadowed by a later read binding",
      "function write() { const method = 'POST'; fetch('/annotations', { method }); } function read() { const method = 'GET'; return method; }\n"
    ],
    [
      "a write binding declared after an unrelated read binding",
      "function read() { const method = 'GET'; return method; } function write() { const method = 'POST'; fetch('/annotations', { method }); }\n"
    ],
    [
      "duplicate read-method bindings kept opaque",
      "function first() { const method = 'GET'; fetch('/first', { method }); } function second() { const method = 'HEAD'; return method; }\n"
    ],
    [
      "a fetch call inside template interpolation",
      "const result = `${fetch('/annotations', { method: 'POST' })}`;\n"
    ],
    [
      "a fetch call inside nested template interpolation",
      "const result = `${`${fetch('/annotations', { method: 'POST' })}`}`;\n"
    ],
    [
      "a comment between a quoted method key and colon",
      "fetch('/annotations', { \"method\" /* policy comment */ : 'POST' });\n"
    ],
    [
      "a leading comment before a quoted method key",
      "fetch('/annotations', { /* leading, { ignored } */ 'method': 'DELETE' });\n"
    ],
    [
      "a direct Request write",
      "fetch(new Request('/annotations', { method: 'POST', body: payload }));\n"
    ],
    [
      "a bound Request write",
      "const request = new Request('/annotations', { method: 'POST', body: payload }); fetch(request);\n"
    ],
    [
      "an opaque Request input",
      "fetch(request);\n"
    ],
    [
      "a Request write hidden by a later safe duplicate binding",
      "function write() { const request = new Request('/annotations', { method: 'POST' }); fetch(request); } function read() { const request = new Request('/data', { method: 'GET' }); return request; }\n"
    ],
    [
      "a Request write after an earlier safe duplicate binding",
      "function read() { const request = new Request('/data', { method: 'GET' }); return request; } function write() { const request = new Request('/annotations', { method: 'POST' }); fetch(request); }\n"
    ]
  ])("rejects browser write transport through %s", async (_label, source) => {
    const root = temporaryDirectory("prd-repository-write-transport-");
    const relativePath = "prd-annotator/src/runtime.js";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Runtime save service: ${relativePath}`);
  });

  it("rejects a destructive filesystem call inside template interpolation", async () => {
    const root = temporaryDirectory("prd-repository-template-fs-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import { rm } from 'node:fs/promises'; const result = `${rm(projectRoot, { recursive: true })}`;\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("permits provably read-only fetches and harmless transport strings", async () => {
    const root = temporaryDirectory("prd-repository-read-transport-");
    const relativePath = "prd-annotator/src/runtime.js";
    writeTrackedFile(
      root,
      relativePath,
      [
        "const labels = ['XMLHttpRequest', 'navigator.sendBeacon', 'POST'];",
        "fetch('/sync-status.json');",
        "fetch('/empty-options.json', {});",
        "fetch('/documents.json', { method: 'GET' });",
        "fetch('/quoted-get.json', { \"method\": 'GET' });",
        "fetch('/quoted-head.json', { 'method': 'HEAD' });",
        "fetch('/spread-headers.json', { headers: { ...headers } });",
        "fetch('/computed-headers.json', { headers: { [headerName]: value } });",
        "fetch('/quoted-computed-headers.json', { headers: { \"X-Test\": value, ['X-Other']: otherValue } });",
        "const literalTemplate = `fetch('/annotations', { method: 'POST' })`;",
        "const readTemplate = `${fetch('/template-get.json', { method: 'GET' })}`;",
        "const nestedReadTemplate = `${`${fetch('/template-head.json', { method: 'HEAD' })}`}`;",
        "fetch('/commented-quoted-get.json', { \"method\" /* comment */ : 'GET' });",
        "fetch('/commented-quoted-head.json', { /* leading, { ignored } */ 'method': 'HEAD' });",
        "fetch(new Request('/request-default.json'));",
        "fetch(new Request('/request-get.json', { method: 'GET' }));",
        "const defaultRequest = new Request('/bound-default.json');",
        "fetch(defaultRequest);",
        "const headRequest = new Request('/bound-head.json', { method: 'HEAD' });",
        "fetch(headRequest);",
        "const method = 'HEAD';",
        "fetch('/health', { method });"
      ].join("\n")
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "export function clearAllAnnotations() {}\n",
    "export function resetPageData() {}\n",
    "export function deleteProject() {}\n",
    "export const purgeManagedDocuments = () => {};\n"
  ])("rejects destructive workflow name: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-destructive-name-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it.each([
    "import { rm as wipe } from 'node:fs/promises'; await wipe(annotationPath, { force: true });\n",
    "import { rm } from 'node:fs/promises'; const wipe = rm; await wipe(projectRoot, { recursive: true });\n",
    "import * as fileSystem from 'node:fs/promises'; await fileSystem.unlink(manifestPath);\n",
    "import { promises as fileSystem } from 'node:fs'; await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; await fileSystem.unlink(manifestPath);\n",
    "const fileSystem = require('node:fs').promises; await fileSystem.rmdir(projectRoot);\n",
    "const fileSystem = require('node:fs/promises'); await fileSystem.remove(projectRoot);\n",
    "import * as fileSystem from 'node:fs'; await fileSystem.promises.rm(projectRoot, { recursive: true });\n",
    "import * as fileSystem from 'node:fs'; await fileSystem.promises.unlink(manifestPath);\n",
    "import fileSystem from 'node:fs'; await fileSystem.rmdir(projectRoot);\n",
    "import fileSystem from 'node:fs'; await fileSystem.remove(projectRoot);\n",
    "import * as fileSystem from 'node:fs'; const wipe = fileSystem.promises.rm; await wipe(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs'; const promises = fileSystem.promises; const wipe = promises.unlink; await wipe(manifestPath);\n",
    "import fileSystem from 'fs'; await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import * as fileSystem from 'fs'; await fileSystem.unlink(manifestPath);\n",
    "import fileSystem from 'fs/promises'; await fileSystem.remove(projectRoot);\n",
    "import * as fileSystem from 'fs/promises'; await fileSystem.rmdir(projectRoot);\n",
    "const fileSystem = require('fs'); await fileSystem.rm(projectRoot, { recursive: true });\n",
    "const fileSystem = require('fs').promises; await fileSystem.unlink(manifestPath);\n",
    "const fileSystem = require('fs/promises'); await fileSystem.remove(projectRoot);\n",
    "import { promises } from 'node:fs'; await promises.rm(projectRoot, { recursive: true });\n",
    "import { promises } from 'fs'; await promises.unlink(manifestPath);\n",
    "const { rm: wipe } = require('fs/promises'); await wipe(projectRoot, { recursive: true });\n",
    "const { unlink } = require('node:fs'); await unlink(manifestPath);\n",
    "import fileSystem from 'fs'; const { unlink: wipe } = fileSystem.promises; await wipe(manifestPath);\n",
    "import * as fileSystem from 'node:fs'; const { rmdir } = fileSystem; await rmdir(projectRoot);\n",
    "import { promises as fileSystem } from 'fs'; const { rm: wipe } = fileSystem; await wipe(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; const { unlink } = fileSystem; await unlink(manifestPath);\n",
    "const { rm: wipe = fallback } = require('fs/promises'); await wipe(projectRoot, { recursive: true });\n",
    "const { rm = fallback } = require('node:fs'); await rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'fs'; const { rm: wipe = fallback } = fileSystem.promises; await wipe(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs'; const { rm = fallback } = fileSystem; await rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'\nconst { rm: wipe } = fileSystem\nawait wipe(projectRoot, { recursive: true })\n",
    "import fileSystem from 'fs/promises'\nconst wipe = fileSystem.rm\nawait wipe(projectRoot, { recursive: true })\n",
    "import { rm } from 'node:fs/promises'\nconst wipe = rm\nawait wipe(projectRoot, { recursive: true })\n",
    "const { rm: wipe = () => {} } = require('fs/promises'); await wipe(projectRoot, { recursive: true });\n",
    "const { rm: wipe = choose(() => ({ nested: {} })) } = require('node:fs/promises'); await wipe(projectRoot, { recursive: true });\n"
  ])("rejects aliased destructive filesystem call: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-destructive-alias-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it.each([
    "import fileSystem from 'node:fs/promises'; for (let fileSystem = local; ready; ready = false) {} await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; for (let fileSystem in values) {} await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; for (let fileSystem of values) {} await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; switch (kind) { case 'local': let fileSystem = custom; break; default: break; } await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fileSystem from 'node:fs/promises'; class Worker { static { const fileSystem = custom; fileSystem.rm(value); } } await fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; function run() { var fileSystem = fs; var fileSystem; fileSystem.rm(projectRoot, { recursive: true }); } run();\n",
    "import fs from 'node:fs/promises'; function run() { var wipe = fs.rm; var wipe; wipe(projectRoot, { recursive: true }); } run();\n",
    "import fs from 'node:fs/promises'; function run() { var fileSystem = fs; fileSystem.rm(projectRoot, { recursive: true }); var fileSystem = custom; } run();\n",
    "const fileSystem = require('node:fs/promises'); fileSystem.rm(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; let wipe; wipe = fs.rm; wipe(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; let tools; tools = fs; tools.rm(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs'; let promises; promises = fs.promises; let wipe; wipe = promises.unlink; wipe(manifestPath);\n",
    "import fs from 'node:fs/promises'; let wipe; wipe = fs.rm; wipe = callback; wipe(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; let wipe; ({ rm: wipe } = fs); wipe(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; let rm; ({ rm } = fs); rm(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs/promises'; let wipe; ({ rm: wipe = fallback } = fs); wipe(projectRoot, { recursive: true });\n",
    "import fs from 'node:fs'; let wipe; ({ unlink: wipe } = fs.promises); wipe(manifestPath);\n",
    "import fs from 'node:fs/promises'; let wipe; [wipe] = [fs.rm]; wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; function cleanup(wipe = rm) { wipe(projectRoot, { recursive: true }); } cleanup();\n",
    "import { rm } from 'node:fs/promises'; const cleanup = (wipe = rm) => wipe(projectRoot, { recursive: true }); cleanup();\n",
    "import { rm } from 'node:fs/promises'; function cleanup({ wipe = rm } = {}) { wipe(projectRoot, { recursive: true }); } cleanup();\n",
    "import fs from 'node:fs/promises'; function cleanup({ rm: wipe } = fs) { wipe(projectRoot, { recursive: true }); } cleanup();\n",
    "import { rm } from 'node:fs/promises'; rm.call(null, projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; rm.apply(null, [projectRoot, { recursive: true }]);\n",
    "import { rm } from 'node:fs/promises'; const wipe = rm.bind(null); wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const { wipe } = { wipe: rm }; wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const { nested: { wipe } } = { nested: { wipe: rm } }; wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const { rm: wipe } = { rm }; wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; let wipe, alias; wipe = alias = rm; wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; let wipe, alias; wipe = alias = rm; alias(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const tools = {}; tools.wipe = rm; tools.wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const tools = {}; tools.wipe = rm; tools.wipe = callback; tools.wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const tools = {}; const alias = tools; alias.wipe = rm; tools.wipe(projectRoot, { recursive: true });\n",
    "import { rm } from 'node:fs/promises'; const tools = { ops: {} }; tools.ops.wipe = rm; tools.ops.wipe(projectRoot, { recursive: true });\n"
  ])("rejects structurally scoped or assigned destructive filesystem call: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-structural-fs-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("terminates deterministically when scope-local destructive aliases reuse a name", () => {
    const root = temporaryDirectory("prd-repository-fs-convergence-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(
      root,
      relativePath,
      [
        "import fileSystem from 'node:fs/promises';",
        "function one() { const { rm: act } = fileSystem; act(a, { recursive: true }); }",
        "function two() { const { unlink: act } = fileSystem; act(b); }"
      ].join("\n")
    );
    const moduleUrl = pathToFileURL(path.join(repositoryRoot, "scripts/check-repository.mjs")).href;
    const runner = [
      `import { checkRepository } from ${JSON.stringify(moduleUrl)};`,
      `try { await checkRepository({ repositoryRoot: ${JSON.stringify(root)}, trackedPaths: [${JSON.stringify(relativePath)}] }); process.exitCode = 2; }`,
      "catch { process.exitCode = 0; }"
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", runner], {
      encoding: "utf8",
      timeout: 1500,
      windowsHide: true
    });

    expect(result.error?.code).not.toBe("ETIMEDOUT");
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "import { promises as fileSystem } from 'node:fs'; await fileSystem.readFile(documentPath);\n",
    "import fileSystem from 'node:fs/promises'; await fileSystem.readFile(documentPath);\n",
    "const fileSystem = require('node:fs/promises'); await fileSystem.readFile(documentPath);\n",
    "import * as fileSystem from 'node:fs'; await fileSystem.readFile(documentPath);\n",
    "import * as fileSystem from 'node:fs'; await fileSystem.promises.readFile(documentPath);\n",
    "import fileSystem from 'node:fs'; await fileSystem.readFile(documentPath);\n",
    "import fileSystem from 'fs'; await fileSystem.readFile(documentPath);\n",
    "import * as fileSystem from 'fs/promises'; await fileSystem.readFile(documentPath);\n",
    "const fileSystem = require('fs').promises; await fileSystem.readFile(documentPath);\n",
    "import { promises } from 'fs'; await promises.readFile(documentPath);\n",
    "function remove(item) { return item; } remove(item);\n",
    "const rm = callback; rm(value);\n",
    "const tools = { remove, rm, unlink, rmdir }; const { remove: erase, rm: wipe, unlink, rmdir } = tools; erase(item); wipe(value); unlink(path); rmdir(path);\n",
    "import fileSystem from 'fs'; const { readFile } = fileSystem; await readFile(documentPath);\n",
    "import fileSystem from 'node:fs'; const { readFile = fallback } = fileSystem; await readFile(documentPath);\n",
    "const tools = { rm: callback }; const { rm: wipe = fallback } = tools; wipe(value);\n",
    "import fileSystem from 'node:fs/promises'; function useLocal(fileSystem) { fileSystem.rm(value); } useLocal({ rm: callback });\n",
    "import fileSystem from 'fs/promises'; function useLocal() { const fileSystem = { rm: callback }; fileSystem.rm(value); } useLocal();\n",
    "function useLocal(act, remove) { act(value); remove(value); } useLocal(callback, callback);\n"
  ])("permits non-destructive filesystem alias call: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-read-alias-");
    const relativePath = "prd-annotator-skill/scripts/read-only.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "import fileSystem from 'node:fs/promises'; for (const fileSystem of values) { fileSystem.rm(value); }\n",
    "import fileSystem from 'node:fs/promises'; switch (kind) { case 'local': let fileSystem = custom; fileSystem.rm(value); break; default: break; }\n",
    "import fileSystem from 'node:fs/promises'; class Worker { static { const fileSystem = custom; fileSystem.rm(value); } }\n",
    "import fileSystem from 'node:fs/promises'; function useLocal(fileSystem) { var fileSystem; fileSystem.rm(value); } useLocal(custom);\n",
    "function load(require) { const fileSystem = require('node:fs/promises'); fileSystem.rm(value); } load(customRequire);\n",
    "function load() { let require = customRequire; const fileSystem = require('node:fs/promises'); fileSystem.rm(value); } load();\n",
    "function load() { const require = customRequire; const fileSystem = require('node:fs/promises'); fileSystem.rm(value); } load();\n",
    "function load() { var require = customRequire; const fileSystem = require('node:fs/promises'); fileSystem.rm(value); } load();\n",
    "function load() { const fileSystem = require('node:fs/promises'); var require = customRequire; fileSystem.rm(value); } load();\n",
    "function load() { const fileSystem = require('node:fs/promises'); function require() { return custom; } fileSystem.rm(value); } load();\n",
    "const tools = { rm: callback }; let wipe; wipe = tools.rm; wipe(value);\n",
    "import fs from 'node:fs/promises'; let wipe = fs.rm; function useLocal() { let wipe; wipe = callback; wipe(value); } useLocal();\n",
    "const tools = { rm: callback }; let wipe; ({ rm: wipe } = tools); wipe(value);\n",
    "const tools = [callback]; let wipe; [wipe] = tools; wipe(value);\n",
    "import { readFile } from 'node:fs/promises'; function read(load = readFile) { load(documentPath); } read();\n",
    "function read({ load = callback } = {}) { load(documentPath); } read();\n",
    "import { readFile } from 'node:fs/promises'; readFile.call(null, documentPath);\n",
    "import { readFile } from 'node:fs/promises'; readFile.apply(null, [documentPath]);\n",
    "import { readFile } from 'node:fs/promises'; const load = readFile.bind(null); load(documentPath);\n",
    "const tools = { wipe: callback, nested: { wipe: callback } }; const { wipe } = tools; wipe(value);\n",
    "let wipe, alias; wipe = alias = callback; wipe(value); alias(value);\n",
    "import { rm } from 'node:fs/promises'; const { wipe } = { ...tools, [name]: rm }; wipe(value);\n",
    "const tools = {}; tools.wipe = callback; tools.wipe(value);\n",
    "import { readFile } from 'node:fs/promises'; const tools = {}; tools.load = readFile; tools.load(documentPath);\n",
    "import { rm } from 'node:fs/promises'; const tools = {}; function local() { const tools = {}; tools.wipe = callback; tools.wipe(value); } local();\n",
    "import { rm } from 'node:fs/promises'; const tools = {}; tools[name] = rm; tools.wipe(value);\n"
  ])("permits structurally shadowed or unrelated filesystem call: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-structural-control-");
    const relativePath = "prd-annotator-skill/scripts/read-only.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  const cleanupIdentityRules = [
    ["prd-annotator-skill/scripts/install-project.mjs", "applyTransaction", "rm", "operation.absolutePath"],
    ["prd-annotator-skill/scripts/merge-annotations.mjs", "atomicWriteAnnotation", "rm", "staging.absolutePath"],
    ["prd-annotator-skill/scripts/refresh-project.mjs", "applyTransaction", "rm", "operation.absolutePath"],
    ["prd-annotator-skill/scripts/remove-project.mjs", "applyRemovalTransaction", "rm", "operation.stagePath"],
    ["prd-annotator-skill/scripts/lib/mutation-lock.mjs", "withProjectMutationLock", "rmdir", "lockPath"],
    ["prd-annotator-skill/scripts/lib/project-transaction.mjs", "removeCreatedDirectories", "rmdir", "directory"]
  ];
  const cleanupIdentityDecoys = cleanupIdentityRules.flatMap(
    ([relativePath, functionName, operation, argument]) => [
      [
        `${relativePath} class method`,
        relativePath,
        `import { ${operation} } from 'node:fs/promises'; class Decoy { async ${functionName}() { await ${operation}(${argument}, { recursive: true, force: true }); } }\n`
      ],
      [
        `${relativePath} object property`,
        relativePath,
        `import { ${operation} } from 'node:fs/promises'; const decoy = { ${functionName}: async () => { await ${operation}(${argument}, { recursive: true, force: true }); } };\n`
      ],
      [
        `${relativePath} nested declaration`,
        relativePath,
        `import { ${operation} } from 'node:fs/promises'; function wrapper() { async function ${functionName}() { await ${operation}(${argument}, { recursive: true, force: true }); } }\n`
      ]
    ]
  );

  it.each(cleanupIdentityDecoys)("does not allow cleanup identity from %s", async (
    _label,
    relativePath,
    source
  ) => {
    const root = temporaryDirectory("prd-repository-cleanup-identity-");
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it.each(cleanupIdentityRules)("permits intended top-level cleanup declaration in %s", async (
    relativePath,
    functionName,
    operation,
    argument
  ) => {
    const root = temporaryDirectory("prd-repository-cleanup-declaration-");
    writeTrackedFile(
      root,
      relativePath,
      `import { ${operation} } from 'node:fs/promises'; async function ${functionName}() { await ${operation}(${argument}, { recursive: true, force: true }); }\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "async function applyTransaction(stagingRoot) { { const stagingRoot = path.join(root, `.prd-annotator-install-${Date.now()}`); void stagingRoot; } await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(stagingRoot) { const decoyRoot = path.join(root, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(root) { const stagingRoot = path.join(root, `.prd-annotator-install-${Date.now()}`); stagingRoot = unknownRoot; await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(root) { const recoveryRoot = path.join(root, `.prd-annotator-install-${Date.now()}`); const stagingRoot = recoveryRoot; await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`, '..'); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`, 'extra'); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}/nested`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, '.prd-annotator-install-safe\\\\nested'); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`, '/tmp'); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`, '.'); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(otherRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const path = { join: callback }; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { projectRoot = otherRoot; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { ({ root: projectRoot } = replacement); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { path.join = (root) => root; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const p = path; p.join = (root) => root; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const p = path; p.join = (root) => root; async function applyTransaction(projectRoot) { const stagingRoot = p.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const holder = { path }; holder.path.join = (root) => root; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const originalJoin = path.join; path.join = (root) => root; path.join = originalJoin; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); path.join = (root) => root; await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { path = customPath; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { for (path.join of [(root) => root]) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "const p = path; async function applyTransaction(projectRoot) { for (p.join of [(root) => root]) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { for (projectRoot of [otherRoot]) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { for (path.join in source) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { for (projectRoot in source) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { ({ join: path.join } = source); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { [path.join] = source; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { ({ nested: [path.join] } = source); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { ({ nested: [projectRoot] } = source); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { for ({ join: path.join } of source) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { for ({ nested: [projectRoot] } of source) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { ({ join: path.join = fallback } = source); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { [...path.join] = source; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { for ([projectRoot = fallback] of source) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { path.join++; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { projectRoot++; const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "Object.setPrototypeOf(path, { join: (root) => root }); delete path.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "delete path.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const p = path; delete p.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const holder = { path }; delete holder.path.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const originalJoin = path.join; delete path.join; path.join = originalJoin; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "delete path?.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { for (const path of values) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }",
    "async function applyTransaction(projectRoot) { for (const projectRoot of values) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); } }"
  ])("rejects cleanup staging decoy or reassignment: %s", async (body) => {
    const root = temporaryDirectory("prd-repository-staging-identity-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      `import path from 'node:path'; import { rm } from 'node:fs/promises'; ${body}\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it.each([
    "Object.defineProperty(path, 'join', { value: (root) => root });",
    "Object.defineProperties(path, { join: { value: (root) => root } });",
    "Object.assign(path, { join: (root) => root });",
    "Reflect.defineProperty(path, 'join', { value: (root) => root });",
    "Reflect.set(path, 'join', (root) => root);",
    "const mutate = Object.defineProperty; mutate(path, 'join', { value: (root) => root });",
    "const mutate = Object.defineProperties; mutate(path, { join: { value: (root) => root } });",
    "const mutate = Object.assign; mutate(path, { join: (root) => root });",
    "const mutate = Reflect.defineProperty; mutate(path, 'join', { value: (root) => root });",
    "const mutate = Reflect.set; mutate(path, 'join', (root) => root);",
    "Object.defineProperty.call(Object, path, 'join', { value: (root) => root });",
    "Reflect.set.apply(Reflect, [path, 'join', (root) => root]);",
    "const mutate = Object.defineProperty.bind(Object); mutate(path, 'join', { value: (root) => root });",
    "const p = path; Object.assign(p, { join: (root) => root });",
    "const holder = { path }; Reflect.set(holder.path, 'join', (root) => root);",
    "Object.assign(path, { resolve: callback }, { join: (root) => root });",
    "Object.defineProperty(path, propertyName, { value: callback });",
    "Object.defineProperties(path, descriptors);",
    "Object.assign(path, source);",
    "Object.assign(path, { [propertyName]: callback });",
    "Reflect.set(path, Symbol.iterator, callback);"
  ])("rejects trusted staging path mutation call: %s", async (mutation) => {
    const root = temporaryDirectory("prd-repository-staging-mutation-call-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      `import path from 'node:path'; import { rm } from 'node:fs/promises'; ${mutation} async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, \`.prd-annotator-install-\${Date.now()}\`); await rm(stagingRoot, { recursive: true, force: true }); }\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("permits cleanup through the exact approved staging binding", async () => {
    const root = temporaryDirectory("prd-repository-staging-binding-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import path from 'node:path'; import { rm } from 'node:fs/promises'; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it("permits an unrelated local join mutation beside a trusted staging initializer", async () => {
    const root = temporaryDirectory("prd-repository-staging-unrelated-join-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import path from 'node:path'; import { rm } from 'node:fs/promises'; const tools = { join: callback }; tools.join = otherCallback; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "const tools = { join: callback }; async function applyTransaction(projectRoot) { for (tools.join of callbacks) {} const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "let item; async function applyTransaction(projectRoot) { for (item of items) {} ({ value: item } = source); const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "async function applyTransaction(projectRoot) { for (const path of values) { void path; } for (const projectRoot of roots) { void projectRoot; } const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "const tools = { join: callback }; delete tools.join; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "delete path.resolve; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }",
    "delete path['join']; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${Date.now()}`); await rm(stagingRoot, { recursive: true, force: true }); }"
  ])("permits unrelated or loop-local staging assignment target: %s", async (body) => {
    const root = temporaryDirectory("prd-repository-staging-unrelated-target-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      `import path from 'node:path'; import { rm } from 'node:fs/promises'; ${body}\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "function local(Object) { Object.defineProperty(path, 'join', descriptor); } local(customObject);",
    "const Reflect = customReflect; Reflect.set(path, 'join', callback);",
    "const tools = {}; Object.defineProperty(tools, 'join', { value: callback });",
    "Object.defineProperty(path, 'resolve', { value: callback });",
    "Object.defineProperties(path, { resolve: { value: callback }, basename: { value: callback } });",
    "Object.assign(path, { resolve: callback }, { basename: callback });"
  ])("permits unrelated or shadowed staging mutation call: %s", async (mutation) => {
    const root = temporaryDirectory("prd-repository-staging-mutation-control-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      `import path from 'node:path'; import { rm } from 'node:fs/promises'; ${mutation} async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, \`.prd-annotator-install-\${Date.now()}\`); await rm(stagingRoot, { recursive: true, force: true }); }\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it.each([
    "import path from 'path';",
    "import * as path from 'node:path';"
  ])("permits an exact approved staging binding through trusted path import: %s", async (pathImport) => {
    const root = temporaryDirectory("prd-repository-staging-path-import-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      `${pathImport} import { rm } from 'node:fs/promises'; async function applyTransaction(projectRoot) { const stagingRoot = path.join(projectRoot, \`.prd-annotator-install-\${Date.now()}\`); await rm(stagingRoot, { recursive: true, force: true }); }\n`
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it("rejects an allowlisted cleanup expression outside its safe function scope", async () => {
    const root = temporaryDirectory("prd-repository-unsafe-cleanup-scope-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import { rm } from 'node:fs/promises'; async function unsafeCleanup(stagingRoot) { await rm(stagingRoot, { recursive: true, force: true }); }\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("does not allow call/apply/bind invocation to borrow a cleanup exemption", async () => {
    const root = temporaryDirectory("prd-repository-cleanup-invoker-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import { rm } from 'node:fs/promises'; async function applyTransaction(operation) { await rm.call(null, operation.absolutePath, { recursive: true, force: true }); }\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("does not derive cleanup ancestry from regex literal text", async () => {
    const root = temporaryDirectory("prd-repository-regex-cleanup-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import { rm } from 'node:fs/promises'; /function applyTransaction() {/; await rm(operation.absolutePath, { recursive: true, force: true }); /}/;\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("permits policy-like text inside regex literals", async () => {
    const root = temporaryDirectory("prd-repository-regex-text-");
    const relativePath = "prd-annotator-skill/scripts/read-only.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "export const patterns = [/XMLHttpRequest()/gi, /fetch(POST)/, /server.listen()/, /rm(projectRoot)/, /deleteProject()/];\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it("does not allow cleanup identity from a top-level variable arrow", async () => {
    const root = temporaryDirectory("prd-repository-arrow-cleanup-");
    const relativePath = "prd-annotator-skill/scripts/install-project.mjs";
    writeTrackedFile(
      root,
      relativePath,
      "import { rm } from 'node:fs/promises'; const applyTransaction = async (operation) => { await rm(operation.absolutePath, { recursive: true, force: true }); };\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("rejects destructive CommonJS runtime scripts", async () => {
    const root = temporaryDirectory("prd-repository-cjs-destructive-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.cjs";
    writeTrackedFile(
      root,
      relativePath,
      "const fileSystem = require('node:fs/promises'); fileSystem.rm(projectRoot, { recursive: true });\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("permits read-only CommonJS runtime scripts", async () => {
    const root = temporaryDirectory("prd-repository-cjs-readonly-");
    const relativePath = "prd-annotator-skill/scripts/read-only.cjs";
    writeTrackedFile(
      root,
      relativePath,
      "const fileSystem = require('node:fs/promises'); fileSystem.readFile(documentPath);\n"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
  });

  it("rejects CommonJS syntax that only parses as a module", async () => {
    const root = temporaryDirectory("prd-repository-cjs-module-syntax-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.cjs";
    writeTrackedFile(root, relativePath, "await Promise.resolve();\n");

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });

  it("permits the HTML-only integration removal helper", async () => {
    const root = temporaryDirectory("prd-repository-html-helper-");
    const relativePath = "prd-annotator-skill/scripts/lib/html.mjs";
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      "export function removeIntegration(html) { return html.replace(/<script[^>]+><\\/script>/, ''); }\n",
      "utf8"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).resolves.toMatchObject({ trackedPaths: 1 });
    expect(existsSync(absolutePath)).toBe(true);
  });

  it("does not exempt destructive project-data calls hidden in the HTML helper", async () => {
    const root = temporaryDirectory("prd-repository-html-destructive-");
    const relativePath = "prd-annotator-skill/scripts/lib/html.mjs";
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      "import { rm } from 'node:fs/promises'; export async function removeIntegration(html) { await rm(projectData, { recursive: true }); return html; }\n",
      "utf8"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });
});
