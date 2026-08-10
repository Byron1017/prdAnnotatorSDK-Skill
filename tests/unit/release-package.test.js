import { createHash } from "node:crypto";
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
import { fileURLToPath } from "node:url";
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
    "import * as fileSystem from 'node:fs/promises'; await fileSystem.unlink(manifestPath);\n"
  ])("rejects aliased destructive filesystem call: %s", async (source) => {
    const root = temporaryDirectory("prd-repository-destructive-alias-");
    const relativePath = "prd-annotator-skill/scripts/unsafe.mjs";
    writeTrackedFile(root, relativePath, source);

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
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
      "export async function removeIntegration(html) { await rm(projectData, { recursive: true }); return html; }\n",
      "utf8"
    );

    await expect(checkRepository({
      repositoryRoot: root,
      trackedPaths: [relativePath]
    })).rejects.toThrow(`Destructive project-data workflow: ${relativePath}`);
  });
});
