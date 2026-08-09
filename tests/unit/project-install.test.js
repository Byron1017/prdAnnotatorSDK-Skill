import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertValidViewBundle } from "../../prd-annotator/src/view-data.js";
import { inspectIntegration } from "../../prd-annotator-skill/scripts/lib/html.mjs";
import { resolveLatestRelease } from "../../prd-annotator-skill/scripts/lib/release.mjs";
import { validateManifestV2 } from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import { installProject } from "../../prd-annotator-skill/scripts/install-project.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/install-project");
const installScript = path.join(repositoryRoot, "prd-annotator-skill/scripts/install-project.mjs");
const fixedNow = new Date("2026-08-09T00:00:00.000Z");
const sdkBuffer = Buffer.from("/* PRD Annotator v2.0.0 */", "utf8");
const releaseInfo = {
  version: "2.0.0",
  releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
  sdkBuffer,
  sha256: createHash("sha256").update(sdkBuffer).digest("hex")
};
const temporaryDirectories = [];
let projectRoot;
let releaseClient;

function resolveFromHtml(htmlPath, webPath) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(htmlPath), webPath));
}

async function snapshotProject(root) {
  const snapshot = {};
  async function visit(directory) {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(directory, { withFileTypes: true }));
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) snapshot[path.relative(root, absolutePath).split(path.sep).join("/")] = await readFile(absolutePath);
    }
  }
  await visit(root);
  return snapshot;
}

function expectSnapshotsEqual(actual, expected) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const filePath of Object.keys(expected)) expect(actual[filePath]).toEqual(expected[filePath]);
}

function parseViewFile(source) {
  const prefix = "window.PRDAnnotator.hydrateView(";
  expect(source.startsWith(prefix)).toBe(true);
  expect(source.endsWith(");\n")).toBe(true);
  return JSON.parse(source.slice(prefix.length, -3));
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "prd-install-"));
  temporaryDirectories.push(projectRoot);
  await cp(fixtureRoot, projectRoot, { recursive: true });
  releaseClient = { getLatestRelease: vi.fn(async () => releaseInfo) };
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("formal GitHub Release resolution", () => {
  it("downloads the two official Release assets and verifies the lowercase checksum", async () => {
    const calls = [];
    const assetBase = "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/download/v2.0.0";
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      if (url === "https://api.github.com/repos/Byron1017/prdAnnotatorSDK-Skill/releases/latest") {
        return {
          ok: true,
          json: async () => ({
            tag_name: "v2.0.0",
            html_url: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
            draft: false,
            prerelease: false,
            assets: [
              { name: "prd-annotator.js", browser_download_url: `${assetBase}/prd-annotator.js` },
              { name: "prd-annotator.js.sha256", browser_download_url: `${assetBase}/prd-annotator.js.sha256` }
            ]
          })
        };
      }
      if (url.endsWith("prd-annotator.js.sha256")) return { ok: true, text: async () => `${releaseInfo.sha256}\n` };
      if (url.endsWith("prd-annotator.js")) return { ok: true, arrayBuffer: async () => sdkBuffer };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(resolveLatestRelease({
      fetchImpl,
      repository: "Byron1017/prdAnnotatorSDK-Skill"
    })).resolves.toEqual(releaseInfo);
    expect(calls).toEqual([
      "https://api.github.com/repos/Byron1017/prdAnnotatorSDK-Skill/releases/latest",
      `${assetBase}/prd-annotator.js`,
      `${assetBase}/prd-annotator.js.sha256`
    ]);
  });

  it("rejects missing, duplicate, unofficial, prerelease, malformed, and mismatched assets", async () => {
    const assetBase = "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/download/v2.0.0";
    const baseRelease = {
      tag_name: "v2.0.0",
      html_url: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
      draft: false,
      prerelease: false,
      assets: [
        { name: "prd-annotator.js", browser_download_url: `${assetBase}/prd-annotator.js` },
        { name: "prd-annotator.js.sha256", browser_download_url: `${assetBase}/prd-annotator.js.sha256` }
      ]
    };
    const cases = [
      { release: { ...baseRelease, assets: baseRelease.assets.slice(0, 1) }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, assets: [...baseRelease.assets, baseRelease.assets[0]] }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, prerelease: true }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, draft: undefined }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, prerelease: undefined }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, html_url: "https://example.test/releases/tag/v2.0.0" }, checksum: releaseInfo.sha256 },
      { release: { ...baseRelease, assets: [{ ...baseRelease.assets[0], browser_download_url: "https://raw.githubusercontent.com/Byron1017/prdAnnotatorSDK-Skill/master/prd-annotator.js" }, baseRelease.assets[1]] }, checksum: releaseInfo.sha256 },
      { release: baseRelease, checksum: releaseInfo.sha256.toUpperCase() },
      { release: baseRelease, checksum: ` ${releaseInfo.sha256}` },
      { release: baseRelease, checksum: `${releaseInfo.sha256}\n\n` },
      { release: baseRelease, checksum: "0".repeat(64) }
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn(async (url) => {
        if (url.includes("api.github.com")) return { ok: true, json: async () => testCase.release };
        if (url.endsWith(".sha256")) return { ok: true, text: async () => testCase.checksum };
        return { ok: true, arrayBuffer: async () => sdkBuffer };
      });
      await expect(resolveLatestRelease({ fetchImpl, repository: "Byron1017/prdAnnotatorSDK-Skill" })).rejects.toThrow();
    }
    await expect(resolveLatestRelease({ fetchImpl: vi.fn(), repository: "someone/fork" }))
      .rejects.toThrow("official repository");
  });
});

describe("consent-gated project installation", () => {
  it("refuses to mutate without explicit installation confirmation", async () => {
    const before = await snapshotProject(projectRoot);
    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: false,
      releaseClient,
      now: () => fixedNow
    })).rejects.toThrow("--confirm-install is required");

    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
    expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
  });

  it("leaves the whole project untouched when Release resolution or checksum validation fails", async () => {
    const before = await snapshotProject(projectRoot);
    const failingClients = [
      { getLatestRelease: vi.fn(async () => { throw new Error("Downloaded SDK SHA-256 does not match the Release checksum"); }) },
      { getLatestRelease: vi.fn(async () => ({ ...releaseInfo, sha256: "0".repeat(64) })) }
    ];
    for (const failingReleaseClient of failingClients) {
      await expect(installProject({
        projectRoot,
        pagePaths: ["prototype/index.html"],
        confirmInstall: true,
        releaseClient: failingReleaseClient,
        now: () => fixedNow
      })).rejects.toThrow("Downloaded SDK SHA-256 does not match the Release checksum");
      expectSnapshotsEqual(await snapshotProject(projectRoot), before);
      expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
    }
  });

  it("rolls every file and created directory back when the post-write gate detects corruption", async () => {
    const before = await snapshotProject(projectRoot);

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow,
      onChange: (changedPath) => {
        if (changedPath === "prototype/index.html") {
          writeFileSync(path.join(projectRoot, changedPath), "<body></body>", "utf8");
        }
      }
    })).rejects.toThrow();

    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
    expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
  });

  it("installs only explicit prototype pages with one valid relative integration each", async () => {
    const untouchedDetails = await readFile(path.join(projectRoot, "prototype/deep/details.html"), "utf8");
    const untouchedApp = await readFile(path.join(projectRoot, "src/app.html"), "utf8");
    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });

    expect(validateManifestV2(manifest)).toBe(manifest);
    expect(manifest.pages.map((page) => page.htmlPath)).toEqual(["prototype/index.html"]);
    expect(await readFile(path.join(projectRoot, "prototype/deep/details.html"), "utf8")).toBe(untouchedDetails);
    expect(await readFile(path.join(projectRoot, "src/app.html"), "utf8")).toBe(untouchedApp);
    for (const pageEntry of manifest.pages) {
      const html = readFileSync(path.join(projectRoot, pageEntry.htmlPath), "utf8");
      const [integration] = inspectIntegration(html);
      expect(inspectIntegration(html)).toHaveLength(1);
      expect(integration).toMatchObject({
        projectId: manifest.project.id,
        pageId: pageEntry.id
      });
      expect(resolveFromHtml(pageEntry.htmlPath, integration.src)).toBe(".prd-annotator/sdk/prd-annotator.js");
      expect(resolveFromHtml(pageEntry.htmlPath, integration.viewSrc)).toBe(pageEntry.viewFile);
      const annotation = JSON.parse(await readFile(path.join(projectRoot, pageEntry.annotationFile), "utf8"));
      expect(annotation).toMatchObject({ schemaVersion: 2, projectId: manifest.project.id, page: { id: pageEntry.id, htmlPath: pageEntry.htmlPath }, annotations: [] });
      const view = parseViewFile(await readFile(path.join(projectRoot, pageEntry.viewFile), "utf8"));
      expect(assertValidViewBundle(view, { projectId: manifest.project.id, pageId: pageEntry.id })).toBe(view);
    }
  });

  it("rejects non-prototype, excluded, duplicate, unsafe, missing, and implicit page selections without mutation", async () => {
    const invalidPageLists = [
      [],
      ["prototype/index.html", "prototype/index.html"],
      ["src/app.html"],
      ["dist/generated.html"],
      ["../outside.html"],
      ["prototype\\index.html"],
      ["prototype/missing.html"]
    ];
    for (const pagePaths of invalidPageLists) {
      const before = await snapshotProject(projectRoot);
      await expect(installProject({
        projectRoot,
        pagePaths,
        confirmInstall: true,
        releaseClient,
        now: () => fixedNow
      })).rejects.toThrow();
      expectSnapshotsEqual(await snapshotProject(projectRoot), before);
      expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
    }
  });

  it("injects nested pages with paths that resolve inside the project", async () => {
    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html", "prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });

    expect(manifest.pages).toHaveLength(2);
    for (const pageEntry of manifest.pages) {
      const [integration] = inspectIntegration(await readFile(path.join(projectRoot, pageEntry.htmlPath), "utf8"));
      expect(resolveFromHtml(pageEntry.htmlPath, integration.src)).toBe(".prd-annotator/sdk/prd-annotator.js");
      expect(resolveFromHtml(pageEntry.htmlPath, integration.viewSrc)).toBe(pageEntry.viewFile);
      for (const resolved of [
        resolveFromHtml(pageEntry.htmlPath, integration.src),
        resolveFromHtml(pageEntry.htmlPath, integration.viewSrc)
      ]) {
        expect(resolved.startsWith("../")).toBe(false);
        expect(path.posix.isAbsolute(resolved)).toBe(false);
      }
    }
  });

  it("reuses an installed SDK without checking or applying a newer Release", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const sdkPath = path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js");
    const installedBytes = readFileSync(sdkPath);
    const annotationBefore = readFileSync(path.join(projectRoot, firstManifest.pages[0].annotationFile));
    releaseClient.getLatestRelease.mockClear();

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html", "prototype/deep/details.html"],
      confirmInstall: true,
      confirmUpgrade: false,
      releaseClient,
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });

    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    expect(readFileSync(sdkPath)).toEqual(installedBytes);
    expect(readFileSync(path.join(projectRoot, firstManifest.pages[0].annotationFile))).toEqual(annotationBefore);
    expect(manifest.project.sdk.version).toBe("2.0.0");
    expect(manifest.project.sdk.installedAt).toBe("2026-08-09T00:00:00.000Z");
  });

  it("replaces SDK bytes only with explicit upgrade authorization and returns a valid manifest", async () => {
    await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const upgradedBuffer = Buffer.from("/* PRD Annotator v2.1.0 */", "utf8");
    const upgradeClient = {
      getLatestRelease: vi.fn(async () => ({
        version: "2.1.0",
        releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1.0",
        sdkBuffer: upgradedBuffer,
        sha256: createHash("sha256").update(upgradedBuffer).digest("hex")
      }))
    };
    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient: upgradeClient,
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });

    expect(readFileSync(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"))).toEqual(upgradedBuffer);
    expect(manifest.project.sdk.version).toBe("2.1.0");
    expect(manifest.project.sdk.installedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(validateManifestV2(manifest)).toBe(manifest);
  });

  it("preserves an injected page ID and annotation filename after the page moves", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const originalPage = firstManifest.pages[0];
    const movedDirectory = path.join(projectRoot, "prototype/moved");
    await mkdir(movedDirectory, { recursive: true });
    await rename(path.join(projectRoot, originalPage.htmlPath), path.join(movedDirectory, "home.html"));
    releaseClient.getLatestRelease.mockClear();

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/moved/home.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });
    const movedPage = manifest.pages.find((page) => page.htmlPath === "prototype/moved/home.html");

    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    expect(manifest.pages).toHaveLength(1);
    expect(movedPage.id).toBe(originalPage.id);
    expect(movedPage.annotationFile).toBe(originalPage.annotationFile);
    expect(inspectIntegration(await readFile(path.join(projectRoot, movedPage.htmlPath), "utf8"))[0].pageId)
      .toBe(originalPage.id);
  });

  it("rejects a copied injected page ID while its original manifest page still exists", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const copiedPath = path.join(projectRoot, "prototype/copied.html");
    await cp(path.join(projectRoot, firstManifest.pages[0].htmlPath), copiedPath);
    const before = await snapshotProject(projectRoot);
    releaseClient.getLatestRelease.mockClear();

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/copied.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    })).rejects.toThrow("already belongs");
    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
  });

  it("stops all changes when an existing manifest is corrupt or invalid", async () => {
    await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const manifestPath = path.join(projectRoot, ".prd-annotator/manifest.json");
    for (const invalidManifest of ["{broken", JSON.stringify({ schemaVersion: 2, pages: [] })]) {
      await writeFile(manifestPath, invalidManifest, "utf8");
      const before = await snapshotProject(projectRoot);
      releaseClient.getLatestRelease.mockClear();

      await expect(installProject({
        projectRoot,
        pagePaths: ["prototype/index.html"],
        confirmInstall: true,
        confirmUpgrade: true,
        releaseClient,
        now: () => fixedNow
      })).rejects.toThrow("manifest");
      expectSnapshotsEqual(await snapshotProject(projectRoot), before);
      expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    }
  });

  it("stops before writing when selected HTML already has duplicate integrations", async () => {
    const htmlPath = path.join(projectRoot, "prototype/index.html");
    const script = '<script src="../.prd-annotator/sdk/prd-annotator.js" data-project-id="project-a" data-page-id="page-a" data-view-src="../.prd-annotator/view/pages/page-a.js"></script>';
    await writeFile(htmlPath, `<body>${script}${script}</body>`, "utf8");
    const before = await snapshotProject(projectRoot);

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    })).rejects.toThrow("more than one PRD Annotator script");
    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
  });
});

describe("installer CLI argument gate", () => {
  it("rejects missing, duplicate, reordered, and unknown arguments without installing", () => {
    const invalidArguments = [
      [],
      ["--project-root", projectRoot, "--confirm-install"],
      ["--confirm-install", "--page", "prototype/index.html", "--project-root", projectRoot],
      ["--project-root", projectRoot, "--project-root", projectRoot, "--confirm-install", "--page", "prototype/index.html"],
      ["--project-root", projectRoot, "--confirm-install", "--confirm-install", "--page", "prototype/index.html"],
      ["--project-root", projectRoot, "--confirm-install", "--page", "prototype/index.html", "--unknown"]
    ];
    for (const argumentsList of invalidArguments) {
      const result = spawnSync(process.execPath, [installScript, ...argumentsList], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: install-project.mjs");
      expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
    }
  });

  it("requires confirmation before any CLI installation work", () => {
    const result = spawnSync(process.execPath, [
      installScript,
      "--project-root", projectRoot,
      "--page", "prototype/index.html"
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--confirm-install is required");
    expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
  });
});
