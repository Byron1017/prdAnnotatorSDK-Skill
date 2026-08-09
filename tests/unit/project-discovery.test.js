import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintValue as browserFingerprintValue } from "../../prd-annotator/src/fingerprint.js";
import { normalizeAnnotationDocument as browserNormalizeAnnotationDocument } from "../../prd-annotator/src/model.js";
import {
  canonicalJson,
  createEmptyAnnotationDocument,
  fingerprintValue as skillFingerprintValue,
  normalizeAnnotationDocument as skillNormalizeAnnotationDocument,
  validateAnnotationDocument,
  validateManifestV2
} from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import {
  assertInsideProject,
  derivePageId,
  deriveProjectId,
  toProjectPath,
  walkProject
} from "../../prd-annotator-skill/scripts/lib/project.mjs";
import { discoverProject } from "../../prd-annotator-skill/scripts/discover-project.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/install-project");
const discoverScript = path.join(repositoryRoot, "prd-annotator-skill/scripts/discover-project.mjs");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function snapshotFiles(root) {
  const result = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) result[relativePath] = await readFile(absolutePath, "utf8");
    }
  }
  await visit(root);
  return result;
}

describe("read-only project discovery", () => {
  it("finds source prototypes and excludes build output", async () => {
    const report = await discoverProject({ projectRoot: fixtureRoot });
    expect(report.htmlCandidates.map((page) => page.htmlPath)).toEqual([
      "prototype/deep/details.html",
      "prototype/index.html",
      "src/app.html"
    ]);
    expect(report.htmlCandidates.every((page) => /^[a-z0-9-]{1,32}$/.test(page.suggestedPageId))).toBe(true);
    expect(report.scopeAmbiguous).toBe(true);
    expect(report.ambiguityReasons).toContain("HTML exists in both prototype-like and application-source locations");
    expect(report.htmlCandidates.map((page) => page.htmlPath)).not.toContain("dist/generated.html");
  });

  it("derives a short ASCII id for a non-ASCII source filename", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "prd-discovery-"));
    temporaryDirectories.push(temporaryRoot);
    await cp(fixtureRoot, temporaryRoot, { recursive: true });
    const chinesePath = path.join(temporaryRoot, "prototype/deep/璇︽儏.html");
    await writeFile(chinesePath, "<!doctype html><title>璇︽儏</title>", "utf8");
    const report = await discoverProject({ projectRoot: temporaryRoot });
    const candidate = report.htmlCandidates.find((page) => page.htmlPath === "prototype/deep/璇︽儏.html");
    expect(candidate.suggestedPageId).toMatch(/^deep-[a-f0-9]{6}$/);
    expect(candidate.suggestedPageId.length).toBeLessThanOrEqual(32);
  });

  it("is read-only and prints the same report through the CLI", async () => {
    const before = await snapshotFiles(fixtureRoot);
    const report = await discoverProject({ projectRoot: fixtureRoot });
    expect(await snapshotFiles(fixtureRoot)).toEqual(before);
    expect(existsSync(path.join(fixtureRoot, ".prd-annotator"))).toBe(false);
    const stdout = execFileSync(process.execPath, [discoverScript, "--project-root", fixtureRoot], { encoding: "utf8" });
    expect(JSON.parse(stdout)).toEqual(report);
    expect(await snapshotFiles(fixtureRoot)).toEqual(before);
  });

  it("uses deterministic safe paths and does not follow symlinks", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "prd-project-"));
    temporaryDirectories.push(temporaryRoot);
    await writeFile(path.join(temporaryRoot, "inside.html"), "<!doctype html>");
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "prd-outside-"));
    temporaryDirectories.push(outsideRoot);
    await writeFile(path.join(outsideRoot, "outside.html"), "<!doctype html>");
    await symlink(outsideRoot, path.join(temporaryRoot, "linked-outside"), "junction");
    expect(toProjectPath(temporaryRoot, path.join(temporaryRoot, "inside.html"))).toBe("inside.html");
    expect(() => assertInsideProject(temporaryRoot, path.join(outsideRoot, "outside.html"), "file")).toThrow("outside project");
    expect(() => assertInsideProject(temporaryRoot, path.join(temporaryRoot, "inside", "..", "..", "outside.html"), "file")).toThrow("outside project");
    expect(await walkProject(temporaryRoot, { extensions: [".html"] })).toEqual(["inside.html"]);
  });

  it("excludes every required and conventional generated artifact directory without excluding source HTML", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "prd-exclusions-"));
    temporaryDirectories.push(temporaryRoot);
    const excludedDirectories = [
      ".git", ".prd-annotator", "node_modules", "dist", "build", "out", "vendor", "coverage",
      ".next", ".nuxt", ".output", ".cache", ".nyc_output", "test-results", "playwright-report"
    ];
    await Promise.all(excludedDirectories.map(async (directory) => {
      await mkdir(path.join(temporaryRoot, directory), { recursive: true });
      await writeFile(path.join(temporaryRoot, directory, "generated.html"), "<!doctype html>");
    }));
    await mkdir(path.join(temporaryRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(path.join(temporaryRoot, "src", "ordinary.html"), "<!doctype html>"),
      writeFile(path.join(temporaryRoot, "Z.html"), "<!doctype html>"),
      writeFile(path.join(temporaryRoot, "a.html"), "<!doctype html>")
    ]);
    expect(await walkProject(temporaryRoot, { extensions: [".html"] })).toEqual([
      "Z.html", "a.html", "src/ordinary.html"
    ]);
  });

  it("matches exact and generated exclusion directory names case-insensitively", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "prd-case-exclusions-"));
    temporaryDirectories.push(temporaryRoot);
    for (const directory of ["Dist", "NODE_MODULES", ".PRD-ANNOTATOR", "Playwright-Report"]) {
      await mkdir(path.join(temporaryRoot, directory));
      await writeFile(path.join(temporaryRoot, directory, "generated.html"), "<!doctype html>");
    }
    await mkdir(path.join(temporaryRoot, "Prototype"));
    await writeFile(path.join(temporaryRoot, "Prototype", "Source.HTML"), "<!doctype html>");

    expect(await walkProject(temporaryRoot, { extensions: [".html"] }))
      .toEqual(["Prototype/Source.HTML"]);
  });

  it("derives deterministic bounded project and collision-safe page ids", () => {
    expect(deriveProjectId("璁惧 Demo", "/tmp/璁惧")).toMatch(/^demo-[a-f0-9]{6}$/);
    const usedIds = new Set();
    const first = derivePageId("prototype/index.html", usedIds);
    const second = derivePageId("src/index.html", usedIds);
    expect(first).toMatch(/^index-[a-f0-9]{6}$/);
    expect(second).not.toBe(first);
    expect(second).toMatch(/^index-[a-f0-9]{6}(?:-[0-9]+)?$/);
    expect([first, second].every((id) => id.length <= 32)).toBe(true);
  });

  it("preserves the complete six-hex path fingerprint after a real page-id collision", () => {
    const pagePath = "prototype/a-very-long-page-name-that-needs-to-be-truncated.html";
    const usedIds = new Set();
    const first = derivePageId(pagePath, usedIds);
    const second = derivePageId(pagePath, usedIds);
    expect(first).toMatch(/-f0b47e$/);
    expect(second).toMatch(/-f0b47e-2$/);
    expect(second.length).toBeLessThanOrEqual(32);
  });

  it("rejects missing, reordered, duplicate, extra, and unknown CLI arguments", () => {
    const invalidArguments = [
      [],
      [fixtureRoot, "--project-root"],
      ["--project-root", fixtureRoot, "--project-root", fixtureRoot],
      ["--project-root", fixtureRoot, "--extra"],
      ["--unknown", fixtureRoot]
    ];
    for (const argumentsList of invalidArguments) {
      const result = spawnSync(process.execPath, [discoverScript, ...argumentsList], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: discover-project.mjs --project-root PATH");
    }
  });
});

describe("Skill schema-v2 parity and validation", () => {
  const defaults = { projectId: "project-123", page: { id: "equipment-ops", title: "Equipment Ops", htmlPath: "prototype/index.html", route: "/equipment" } };
  const v1Document = {
    schemaVersion: 1,
    projectId: "project-123",
    page: { id: "equipment-ops", title: "Equipment Ops", route: "/equipment" },
    annotations: [{ id: "A001", comment: "Need a status", target: { cssPath: "main", xpath: "", textQuote: "", rect: { x: 0, y: 0, width: 0, height: 0 } }, prd: {} }]
  };

  it("matches browser fingerprints and normalized annotation fields exactly", () => {
    expect(canonicalJson({ title: "璁惧", id: "A001" })).toBe('{"id":"A001","title":"璁惧"}');
    expect(skillFingerprintValue([{ title: "璁惧", id: "A001" }])).toBe(browserFingerprintValue([{ id: "A001", title: "璁惧" }]));
    expect(skillNormalizeAnnotationDocument(v1Document, defaults)).toEqual(browserNormalizeAnnotationDocument(v1Document, defaults));
  });

  it("creates and validates schema-v2 annotation documents", () => {
    const document = createEmptyAnnotationDocument(defaults);
    expect(document).toEqual({ schemaVersion: 2, projectId: "project-123", page: defaults.page, annotations: [], managedPrd: null });
    expect(validateAnnotationDocument(document)).toBe(document);
    expect(() => validateAnnotationDocument({ ...document, page: { ...document.page, id: "Bad ID" } })).toThrow("Invalid page.id");
  });

  it("validates the v2 manifest contract and rejects unsafe page paths", () => {
    const manifest = {
      schemaVersion: 2,
      project: { id: "device-demo-a13f92", sdk: { version: "2.0.0", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0", sha256: "a".repeat(64), installedAt: "2026-08-09T00:00:00.000Z" } },
      pages: [{ id: "equipment-ops-7c31fa", title: "Equipment Operations", htmlPath: "prototype/index.html", annotationFile: ".prd-annotator/data/pages/equipment-ops-7c31fa.json", viewFile: ".prd-annotator/view/pages/equipment-ops-7c31fa.js", display: { enabled: true, updatedAt: "2026-08-09T00:00:00.000Z" } }],
      documents: [], migration: null
    };
    expect(validateManifestV2(manifest)).toBe(manifest);
    expect(() => validateManifestV2({ ...manifest, pages: [{ ...manifest.pages[0], htmlPath: "../outside.html" }] })).toThrow("Invalid page.htmlPath");
  });

  it("rejects non-literal SDK release metadata and noncanonical timestamps", () => {
    const manifest = {
      schemaVersion: 2,
      project: { id: "device-demo-a13f92", sdk: { version: "2.0.0", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0", sha256: "a".repeat(64), installedAt: "2026-08-09T00:00:00.000Z" } },
      pages: [{ id: "equipment-ops-7c31fa", title: "Equipment Operations", htmlPath: "prototype/index.html", annotationFile: ".prd-annotator/data/pages/equipment-ops-7c31fa.json", viewFile: ".prd-annotator/view/pages/equipment-ops-7c31fa.js", display: { enabled: true, updatedAt: "2026-08-09T00:00:00.000Z" } }],
      documents: [], migration: null
    };
    const invalidSdk = [
      { ...manifest.project.sdk, version: "2.0.1" },
      { ...manifest.project.sdk, releaseUrl: "https://example.test/releases/v2.0.0" },
      { ...manifest.project.sdk, sha256: "A".repeat(64) },
      { ...manifest.project.sdk, installedAt: "2026-08-09T00:00:00Z" }
    ];
    for (const sdk of invalidSdk) {
      expect(() => validateManifestV2({ ...manifest, project: { ...manifest.project, sdk } })).toThrow();
    }
    for (const updatedAt of ["2026-08-09T00:00:00Z", "not-a-timestamp"]) {
      expect(() => validateManifestV2({ ...manifest, pages: [{ ...manifest.pages[0], display: { ...manifest.pages[0].display, updatedAt } }] })).toThrow();
    }
  });

  it("accepts major-2 SDK upgrades only when semantic version and official tag URL match", () => {
    const manifest = {
      schemaVersion: 2,
      project: { id: "device-demo-a13f92", sdk: { version: "2.1.0", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1.0", sha256: "a".repeat(64), installedAt: "2026-08-09T00:00:00.000Z" } },
      pages: [{ id: "equipment-ops-7c31fa", title: "Equipment Operations", htmlPath: "prototype/index.html", annotationFile: ".prd-annotator/data/pages/equipment-ops-7c31fa.json", viewFile: ".prd-annotator/view/pages/equipment-ops-7c31fa.js", display: { enabled: true, updatedAt: "2026-08-09T00:00:00.000Z" } }],
      documents: [], migration: null
    };

    expect(validateManifestV2(manifest)).toBe(manifest);
    for (const sdk of [
      { ...manifest.project.sdk, version: "3.0.0", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v3.0.0" },
      { ...manifest.project.sdk, version: "2.1", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1" },
      { ...manifest.project.sdk, version: "2.1.0-beta", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1.0-beta" },
      { ...manifest.project.sdk, releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0" },
      { ...manifest.project.sdk, releaseUrl: "https://github.com/someone/fork/releases/tag/v2.1.0" }
    ]) {
      expect(() => validateManifestV2({ ...manifest, project: { ...manifest.project, sdk } }))
        .toThrow("Invalid project.sdk");
    }
  });

  it("rejects URL-like, absolute, drive, UNC, backslash, and normalized traversal manifest paths", () => {
    const manifest = {
      schemaVersion: 2,
      project: { id: "device-demo-a13f92", sdk: { version: "2.0.0", releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0", sha256: "a".repeat(64), installedAt: "2026-08-09T00:00:00.000Z" } },
      pages: [{ id: "equipment-ops-7c31fa", title: "Equipment Operations", htmlPath: "prototype/index.html", annotationFile: ".prd-annotator/data/pages/equipment-ops-7c31fa.json", viewFile: ".prd-annotator/view/pages/equipment-ops-7c31fa.js", display: { enabled: true, updatedAt: "2026-08-09T00:00:00.000Z" } }],
      documents: [], migration: null
    };
    for (const htmlPath of ["https://example.test/page.html", "/absolute.html", "C:/drive.html", "\\\\server\\share\\page.html", "prototype\\page.html", "prototype/../page.html"]) {
      expect(() => validateManifestV2({ ...manifest, pages: [{ ...manifest.pages[0], htmlPath }] })).toThrow("Invalid page.htmlPath");
    }
  });
});
