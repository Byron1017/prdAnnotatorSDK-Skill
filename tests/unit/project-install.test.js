import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertValidViewBundle } from "../../prd-annotator/src/view-data.js";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import { inspectIntegration } from "../../prd-annotator-skill/scripts/lib/html.mjs";
import { resolveLatestRelease } from "../../prd-annotator-skill/scripts/lib/release.mjs";
import { fingerprintValue, validateManifestV2 } from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import * as installerModule from "../../prd-annotator-skill/scripts/install-project.mjs";
import { removeProject } from "../../prd-annotator-skill/scripts/remove-project.mjs";
import { refreshProject } from "../../prd-annotator-skill/scripts/refresh-project.mjs";

const { installProject } = installerModule;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/install-project");
const gateFixtureAnnotation = path.join(
  repositoryRoot,
  "tests/fixtures/project/.prd-annotator/data/pages/equipment-ops-7c31fa.json"
);
const installScript = path.join(repositoryRoot, "prd-annotator-skill/scripts/install-project.mjs");
const fixedNow = new Date("2026-08-09T00:00:00.000Z");
const sdkBuffer = Buffer.from("/*! PRD Annotator SDK v2.0.0 */\nfixture sdk body", "utf8");
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

async function snapshotDirectories(root) {
  const directories = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(directory, entry.name);
      directories.push(path.relative(root, absolutePath).split(path.sep).join("/"));
      await visit(absolutePath);
    }
  }
  await visit(root);
  return directories.sort();
}

async function seedDistinctivePageBytes(manifest) {
  const page = manifest.pages[0];
  const annotationBytes = Buffer.from('{"user":"distinctive annotation bytes"}\n', "utf8");
  const viewBytes = Buffer.from("/* distinctive user view bytes */\n", "utf8");
  await writeFile(path.join(projectRoot, page.annotationFile), annotationBytes);
  await writeFile(path.join(projectRoot, page.viewFile), viewBytes);
  return { page, annotationBytes, viewBytes };
}

function upgradedRelease(version = "2.1.0") {
  const upgradedBuffer = Buffer.from(`/*! PRD Annotator SDK v${version} */\nupgraded sdk body`, "utf8");
  return {
    version,
    releaseUrl: `https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v${version}`,
    sdkBuffer: upgradedBuffer,
    sha256: createHash("sha256").update(upgradedBuffer).digest("hex")
  };
}

function expectSnapshotsEqual(actual, expected) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const filePath of Object.keys(expected)) expect(actual[filePath]).toEqual(expected[filePath]);
}

function omitTransactionRecovery(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([relativePath]) => !relativePath.startsWith(".prd-annotator-transaction-"))
  );
}

function omitTransactionRecoveryDirectories(directories) {
  return directories.filter((relativePath) => !relativePath.startsWith(".prd-annotator-transaction-"));
}

function parseViewFile(source) {
  const prefix = "window.PRDAnnotator.hydrateView(";
  expect(source.startsWith(prefix)).toBe(true);
  expect(source.endsWith(");\n")).toBe(true);
  return JSON.parse(source.slice(prefix.length, -3));
}

async function seedDurableAnnotationAndRefresh(manifest, pageId = manifest.pages[0].id) {
  const pageEntry = manifest.pages.find((page) => page.id === pageId);
  const annotationPath = path.join(projectRoot, pageEntry.annotationFile);
  const document = JSON.parse(await readFile(annotationPath, "utf8"));
  const template = JSON.parse(await readFile(gateFixtureAnnotation, "utf8")).annotations[0];
  document.annotations = [{
    ...structuredClone(template),
    prd: { ...structuredClone(template.prd), linkedDocuments: [] }
  }];
  await writeFile(annotationPath, `${JSON.stringify(document, null, 2)}\n`);
  const refreshed = await refreshProject({ projectRoot, now: () => fixedNow });
  return {
    manifest: refreshed,
    page: refreshed.pages.find((page) => page.id === pageId),
    document: JSON.parse(await readFile(annotationPath, "utf8"))
  };
}

async function setPermanentRoute(manifest, pageId, route) {
  const pageEntry = manifest.pages.find((page) => page.id === pageId);
  const annotationPath = path.join(projectRoot, pageEntry.annotationFile);
  const document = JSON.parse(await readFile(annotationPath, "utf8"));
  document.page.route = route;
  await writeFile(annotationPath, `${JSON.stringify(document, null, 2)}\n`);
  const refreshed = await refreshProject({ projectRoot, now: () => fixedNow });
  return {
    manifest: refreshed,
    page: refreshed.pages.find((page) => page.id === pageId),
    document: JSON.parse(await readFile(annotationPath, "utf8"))
  };
}

async function removeDisplay(pageId, now = new Date("2026-08-10T00:00:00.000Z")) {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));
  const pageEntry = manifest.pages.find((page) => page.id === pageId);
  const document = JSON.parse(await readFile(path.join(projectRoot, pageEntry.annotationFile), "utf8"));
  await removeProject({
    projectRoot,
    pageIds: [pageId],
    snapshots: [{
      schemaVersion: 2,
      projectId: manifest.project.id,
      annotationFingerprint: fingerprintValue(document.annotations),
      document
    }],
    confirmRemove: true,
    now: () => now
  });
  return { page: pageEntry, document };
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

  it("binds the exact first-line SDK banner to the formal Release version", async () => {
    const assetBase = "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/download/v2.1.0";
    const release = {
      tag_name: "v2.1.0",
      html_url: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1.0",
      draft: false,
      prerelease: false,
      assets: [
        { name: "prd-annotator.js", browser_download_url: `${assetBase}/prd-annotator.js` },
        { name: "prd-annotator.js.sha256", browser_download_url: `${assetBase}/prd-annotator.js.sha256` }
      ]
    };
    for (const bytes of [
      Buffer.from("/*! PRD Annotator SDK v2.0.0 */\nunchanged old bytes"),
      Buffer.from("console.log('body');\n/*! PRD Annotator SDK v2.1.0 */\n")
    ]) {
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const fetchImpl = vi.fn(async (url) => {
        if (url.includes("api.github.com")) return { ok: true, json: async () => release };
        if (url.endsWith(".sha256")) return { ok: true, text: async () => `${checksum}\n` };
        return { ok: true, arrayBuffer: async () => bytes };
      });
      await expect(resolveLatestRelease({ fetchImpl, repository: "Byron1017/prdAnnotatorSDK-Skill" }))
        .rejects.toThrow(/SDK version banner/);
    }
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

  it("requires literal true for public installation consent", async () => {
    const before = await snapshotProject(projectRoot);
    for (const confirmInstall of ["true", 1, {}, []]) {
      await expect(installProject({
        projectRoot,
        pagePaths: ["prototype/index.html"],
        confirmInstall,
        releaseClient,
        now: () => fixedNow
      })).rejects.toThrow("--confirm-install is required");
      expectSnapshotsEqual(await snapshotProject(projectRoot), before);
      expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
      expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    }
  });

  it("requires explicit upgrade recovery for an exact orphan SDK and otherwise preserves every byte", async () => {
    const orphanBytes = Buffer.from("/*! PRD Annotator SDK v1.9.0 */\norphan sdk bytes\n");
    await mkdir(path.join(projectRoot, ".prd-annotator/sdk"), { recursive: true });
    await writeFile(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"), orphanBytes);
    const before = await snapshotProject(projectRoot);

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    })).rejects.toThrow(/orphan SDK.*--confirm-upgrade/i);

    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
  });

  it("atomically replaces an explicitly recovered orphan SDK with formal Release bytes and metadata", async () => {
    await mkdir(path.join(projectRoot, ".prd-annotator/sdk"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"),
      "/*! PRD Annotator SDK v1.9.0 */\norphan sdk bytes\n"
    );

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient,
      now: () => fixedNow
    });

    expect(await readFile(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"))).toEqual(releaseInfo.sdkBuffer);
    expect(manifest.project.sdk).toEqual({
      version: releaseInfo.version,
      releaseUrl: releaseInfo.releaseUrl,
      sha256: releaseInfo.sha256,
      installedAt: fixedNow.toISOString()
    });
    expect(validateManifestV2(manifest)).toBe(manifest);
  });

  it("leaves an orphan SDK recovery byte-identical when formal Release resolution fails", async () => {
    await mkdir(path.join(projectRoot, ".prd-annotator/sdk"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"),
      "/*! PRD Annotator SDK v1.9.0 */\norphan sdk bytes\n"
    );
    const before = await snapshotProject(projectRoot);
    const failingReleaseClient = { getLatestRelease: vi.fn(async () => { throw new Error("Release unavailable"); }) };

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient: failingReleaseClient,
      now: () => fixedNow
    })).rejects.toThrow("Release unavailable");

    expectSnapshotsEqual(await snapshotProject(projectRoot), before);
  });

  it("leaves the whole project untouched when Release resolution or checksum validation fails", async () => {
    const before = await snapshotProject(projectRoot);
    const failingClients = [
      { getLatestRelease: vi.fn(async () => { throw new Error("Downloaded SDK SHA-256 does not match the Release checksum"); }) },
      { getLatestRelease: vi.fn(async () => ({ ...releaseInfo, sha256: "0".repeat(64) })) },
      { getLatestRelease: vi.fn(async () => {
        const mismatchedBytes = Buffer.from("/*! PRD Annotator SDK v2.1.0 */\nmismatched metadata");
        return {
          ...releaseInfo,
          sdkBuffer: mismatchedBytes,
          sha256: createHash("sha256").update(mismatchedBytes).digest("hex")
        };
      }) }
    ];
    for (const failingReleaseClient of failingClients) {
      await expect(installProject({
        projectRoot,
        pagePaths: ["prototype/index.html"],
        confirmInstall: true,
        releaseClient: failingReleaseClient,
        now: () => fixedNow
      })).rejects.toThrow(/Downloaded SDK SHA-256 does not match the Release checksum|SDK version banner/);
      expectSnapshotsEqual(await snapshotProject(projectRoot), before);
      expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
    }
  });

  it("rolls every file and created directory back when a post-write hook fails", async () => {
    const before = await snapshotProject(projectRoot);

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow,
      onChange: (changedPath) => {
        if (changedPath === "prototype/index.html") throw new Error("injected post-write failure");
      }
    })).rejects.toThrow("injected post-write failure");

    expectSnapshotsEqual(omitTransactionRecovery(await snapshotProject(projectRoot)), before);
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

  it("ignores a commented integration and leaves exactly one executable script after the post-write gate", async () => {
    const htmlPath = path.join(projectRoot, "prototype/index.html");
    const commentedScript = '<script src="../.prd-annotator/sdk/prd-annotator.js" data-project-id="comment-project" data-page-id="comment-page" data-view-src="../.prd-annotator/view/pages/comment-page.js"></script>';
    const comment = `<!-- ${commentedScript} -->`;
    await writeFile(htmlPath, `<body>${comment}</body>`, "utf8");

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain(comment);
    expect(inspectIntegration(html)).toHaveLength(1);
    expect(inspectIntegration(html)[0].pageId).toBe(manifest.pages[0].id);
    expect(html.indexOf(comment)).toBeLessThan(html.indexOf(inspectIntegration(html)[0].raw));
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

  it("serializes two simultaneous installs before either can resolve stale project state", async () => {
    let releaseFirst;
    let firstPrepared;
    const blocker = new Promise((resolve) => { releaseFirst = resolve; });
    const prepared = new Promise((resolve) => { firstPrepared = resolve; });
    const secondReleaseClient = { getLatestRelease: vi.fn(async () => releaseInfo) };
    const first = installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow,
      transactionHooks: {
        async afterOriginalRead({ index }) {
          if (index === 0) {
            firstPrepared();
            await blocker;
          }
        }
      }
    });
    await Promise.race([
      prepared,
      first.then(() => { throw new Error("installer committed before reaching the transaction barrier"); })
    ]);
    const second = installProject({
      projectRoot,
      pagePaths: ["prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient: secondReleaseClient,
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(secondReleaseClient.getLatestRelease).not.toHaveBeenCalled();
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));
    expect(manifest.pages.map((page) => page.htmlPath).sort()).toEqual([
      "prototype/deep/details.html",
      "prototype/index.html"
    ]);
    expect(manifest.documents).toEqual([]);
    expect(manifest.pages.every((page) => page.display.enabled === true)).toBe(true);
    expect(secondReleaseClient.getLatestRelease).not.toHaveBeenCalled();
    expect((await readdir(path.join(projectRoot, ".prd-annotator/data/pages"))).sort())
      .toEqual(manifest.pages.map((page) => path.posix.basename(page.annotationFile)).sort());
    expect((await readdir(path.join(projectRoot, ".prd-annotator/view/pages"))).sort())
      .toEqual(manifest.pages.map((page) => path.posix.basename(page.viewFile)).sort());
  });

  it("serializes installation with refresh so mappings and generated files stay registered", async () => {
    await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    let releaseInstall;
    let installPrepared;
    let refreshPrepared = false;
    const blocker = new Promise((resolve) => { releaseInstall = resolve; });
    const prepared = new Promise((resolve) => { installPrepared = resolve; });
    const install = installProject({
      projectRoot,
      pagePaths: ["prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      transactionHooks: {
        async afterOriginalRead({ index }) {
          if (index === 0) {
            installPrepared();
            await blocker;
          }
        }
      }
    });
    await Promise.race([
      prepared,
      install.then(() => { throw new Error("installer committed before reaching the transaction barrier"); })
    ]);
    const refresh = refreshProject({
      projectRoot,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      transactionHooks: { afterOriginalRead() { refreshPrepared = true; } }
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(refreshPrepared).toBe(false);
    releaseInstall();
    await expect(Promise.all([install, refresh])).resolves.toHaveLength(2);

    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));
    expect(validateManifestV2(manifest)).toBe(manifest);
    expect(manifest.pages.map((page) => page.htmlPath).sort()).toEqual([
      "prototype/deep/details.html",
      "prototype/index.html"
    ]);
    for (const pageEntry of manifest.pages) {
      const [integration] = inspectIntegration(await readFile(path.join(projectRoot, pageEntry.htmlPath), "utf8"));
      expect(integration).toMatchObject({ projectId: manifest.project.id, pageId: pageEntry.id });
      expect(await readFile(path.join(projectRoot, pageEntry.annotationFile))).toBeInstanceOf(Buffer);
      expect(await readFile(path.join(projectRoot, pageEntry.viewFile))).toBeInstanceOf(Buffer);
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
    const distinctive = await seedDistinctivePageBytes(firstManifest);
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
    expect(readFileSync(path.join(projectRoot, distinctive.page.annotationFile))).toEqual(distinctive.annotationBytes);
    expect(readFileSync(path.join(projectRoot, distinctive.page.viewFile))).toEqual(distinctive.viewBytes);
    expect(manifest.project.sdk.version).toBe("2.0.0");
    expect(manifest.project.sdk.installedAt).toBe("2026-08-09T00:00:00.000Z");
  });

  it("does not treat truthy non-booleans as upgrade authorization", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const sdkPath = path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js");
    const installedBytes = readFileSync(sdkPath);
    const distinctive = await seedDistinctivePageBytes(firstManifest);
    const upgradeClient = { getLatestRelease: vi.fn(async () => upgradedRelease()) };

    for (const confirmUpgrade of ["true", 1, {}, []]) {
      const manifest = await installProject({
        projectRoot,
        pagePaths: ["prototype/index.html"],
        confirmInstall: true,
        confirmUpgrade,
        releaseClient: upgradeClient,
        now: () => new Date("2026-08-10T00:00:00.000Z")
      });
      expect(manifest.project.sdk.version).toBe("2.0.0");
      expect(readFileSync(sdkPath)).toEqual(installedBytes);
      expect(readFileSync(path.join(projectRoot, distinctive.page.annotationFile))).toEqual(distinctive.annotationBytes);
      expect(readFileSync(path.join(projectRoot, distinctive.page.viewFile))).toEqual(distinctive.viewBytes);
    }
    expect(upgradeClient.getLatestRelease).not.toHaveBeenCalled();
  });

  it("replaces SDK bytes only with explicit upgrade authorization and returns a valid manifest", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const distinctive = await seedDistinctivePageBytes(firstManifest);
    const upgrade = upgradedRelease();
    const upgradeClient = {
      getLatestRelease: vi.fn(async () => upgrade)
    };
    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient: upgradeClient,
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });

    expect(readFileSync(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js"))).toEqual(upgrade.sdkBuffer);
    expect(readFileSync(path.join(projectRoot, distinctive.page.annotationFile))).toEqual(distinctive.annotationBytes);
    expect(readFileSync(path.join(projectRoot, distinctive.page.viewFile))).toEqual(distinctive.viewBytes);
    expect(manifest.project.sdk.version).toBe("2.1.0");
    expect(manifest.project.sdk.installedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(validateManifestV2(manifest)).toBe(manifest);
  });

  it("restores an existing installation byte-for-byte when an explicit upgrade fails during commit", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const distinctive = await seedDistinctivePageBytes(firstManifest);
    const beforeFiles = await snapshotProject(projectRoot);
    const beforeDirectories = await snapshotDirectories(projectRoot);
    const upgradeClient = { getLatestRelease: vi.fn(async () => upgradedRelease()) };

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient: upgradeClient,
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      onChange: (changedPath) => {
        if (changedPath === "prototype/index.html") throw new Error("forced explicit-upgrade failure");
      }
    })).rejects.toThrow("forced explicit-upgrade failure");

    expectSnapshotsEqual(omitTransactionRecovery(await snapshotProject(projectRoot)), beforeFiles);
    expect(omitTransactionRecoveryDirectories(await snapshotDirectories(projectRoot))).toEqual(beforeDirectories);
    expect(readFileSync(path.join(projectRoot, distinctive.page.annotationFile))).toEqual(distinctive.annotationBytes);
    expect(readFileSync(path.join(projectRoot, distinctive.page.viewFile))).toEqual(distinctive.viewBytes);
    expect((await readdir(projectRoot)).filter((name) => name.startsWith(".prd-annotator-install-"))).toEqual([]);
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

  it("updates moved-page annotation and view identity while preserving every annotation", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const annotationBefore = structuredClone(seeded.document.annotations);
    const fingerprintBefore = fingerprintValue(annotationBefore);
    const movedDirectory = path.join(projectRoot, "prototype/moved");
    await mkdir(movedDirectory, { recursive: true });
    await rename(path.join(projectRoot, seeded.page.htmlPath), path.join(movedDirectory, "home.html"));

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/moved/home.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });
    const movedPage = manifest.pages.find((page) => page.id === seeded.page.id);
    const annotation = JSON.parse(await readFile(path.join(projectRoot, movedPage.annotationFile), "utf8"));
    const view = parseViewFile(await readFile(path.join(projectRoot, movedPage.viewFile), "utf8"));

    expect(movedPage.annotationFile).toBe(seeded.page.annotationFile);
    expect(movedPage.viewFile).toBe(seeded.page.viewFile);
    expect(annotation.page).toEqual({
      id: movedPage.id,
      title: movedPage.title,
      htmlPath: movedPage.htmlPath,
      route: `/${movedPage.htmlPath}`
    });
    expect(annotation.annotations).toEqual(annotationBefore);
    expect(fingerprintValue(annotation.annotations)).toBe(fingerprintBefore);
    expect(view.document).toEqual(annotation);
    expect(view.persistedAnnotationFingerprint).toBe(fingerprintBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1 });
  });

  it("updates title-only annotation and view identity while preserving every annotation", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const annotationBefore = structuredClone(seeded.document.annotations);
    const htmlPath = path.join(projectRoot, seeded.page.htmlPath);
    const html = await readFile(htmlPath, "utf8");
    await writeFile(htmlPath, html.replace("<title>Prototype Home</title>", "<title>Renamed Prototype</title>"));

    const manifest = await installProject({
      projectRoot,
      pagePaths: [seeded.page.htmlPath],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });
    const renamedPage = manifest.pages.find((page) => page.id === seeded.page.id);
    const annotation = JSON.parse(await readFile(path.join(projectRoot, renamedPage.annotationFile), "utf8"));
    const view = parseViewFile(await readFile(path.join(projectRoot, renamedPage.viewFile), "utf8"));

    expect(renamedPage.title).toBe("Renamed Prototype");
    expect(annotation.page).toEqual({
      id: renamedPage.id,
      title: "Renamed Prototype",
      htmlPath: renamedPage.htmlPath,
      route: `/${renamedPage.htmlPath}`
    });
    expect(annotation.annotations).toEqual(annotationBefore);
    expect(view.document).toEqual(annotation);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1 });
  });

  it("preserves a custom route through a title-only identity update", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const routed = await setPermanentRoute(seeded.manifest, seeded.page.id, "/custom/product-home");
    const annotationsBefore = structuredClone(routed.document.annotations);
    const htmlPath = path.join(projectRoot, routed.page.htmlPath);
    const html = await readFile(htmlPath, "utf8");
    await writeFile(htmlPath, html.replace("<title>Prototype Home</title>", "<title>Renamed Prototype</title>"));

    const manifest = await installProject({
      projectRoot,
      pagePaths: [routed.page.htmlPath],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });
    const renamedPage = manifest.pages.find((page) => page.id === routed.page.id);
    const annotation = JSON.parse(await readFile(path.join(projectRoot, renamedPage.annotationFile), "utf8"));
    const view = parseViewFile(await readFile(path.join(projectRoot, renamedPage.viewFile), "utf8"));

    expect(renamedPage.annotationFile).toBe(routed.page.annotationFile);
    expect(renamedPage.viewFile).toBe(routed.page.viewFile);
    expect(annotation.page).toEqual({
      id: renamedPage.id,
      title: "Renamed Prototype",
      htmlPath: renamedPage.htmlPath,
      route: "/custom/product-home"
    });
    expect(annotation.annotations).toEqual(annotationsBefore);
    expect(view.document.page).toEqual(annotation.page);
    expect(view.document.annotations).toEqual(annotationsBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1 });
  });

  it("preserves a custom route when its page moves", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const routed = await setPermanentRoute(seeded.manifest, seeded.page.id, "/custom/product-home");
    const annotationsBefore = structuredClone(routed.document.annotations);
    const movedDirectory = path.join(projectRoot, "prototype/moved");
    await mkdir(movedDirectory, { recursive: true });
    await rename(path.join(projectRoot, routed.page.htmlPath), path.join(movedDirectory, "home.html"));

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/moved/home.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });
    const movedPage = manifest.pages.find((page) => page.id === routed.page.id);
    const annotation = JSON.parse(await readFile(path.join(projectRoot, movedPage.annotationFile), "utf8"));
    const view = parseViewFile(await readFile(path.join(projectRoot, movedPage.viewFile), "utf8"));

    expect(movedPage.annotationFile).toBe(routed.page.annotationFile);
    expect(movedPage.viewFile).toBe(routed.page.viewFile);
    expect(annotation.page).toEqual({
      id: movedPage.id,
      title: movedPage.title,
      htmlPath: "prototype/moved/home.html",
      route: "/custom/product-home"
    });
    expect(annotation.annotations).toEqual(annotationsBefore);
    expect(view.document.page).toEqual(annotation.page);
    expect(view.document.annotations).toEqual(annotationsBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1 });
  });

  it("updates an old default route to the new default when its page moves", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const annotationsBefore = structuredClone(seeded.document.annotations);
    expect(seeded.document.page.route).toBe(`/${seeded.page.htmlPath}`);
    const movedDirectory = path.join(projectRoot, "prototype/moved");
    await mkdir(movedDirectory, { recursive: true });
    await rename(path.join(projectRoot, seeded.page.htmlPath), path.join(movedDirectory, "home.html"));

    const manifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/moved/home.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });
    const movedPage = manifest.pages.find((page) => page.id === seeded.page.id);
    const annotation = JSON.parse(await readFile(path.join(projectRoot, movedPage.annotationFile), "utf8"));
    const view = parseViewFile(await readFile(path.join(projectRoot, movedPage.viewFile), "utf8"));

    expect(annotation.page.route).toBe("/prototype/moved/home.html");
    expect(annotation.annotations).toEqual(annotationsBefore);
    expect(view.document.page).toEqual(annotation.page);
    expect(view.document.annotations).toEqual(annotationsBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1 });
  });

  it("upgrades an enabled page without reinjecting or reducing a disabled page", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html", "prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed, installed.pages[0].id);
    const disabled = await removeDisplay(seeded.page.id);
    const disabledViewBefore = await readFile(path.join(projectRoot, disabled.page.viewFile));
    const upgrade = upgradedRelease();

    await installProject({
      projectRoot,
      pagePaths: ["prototype/deep/details.html"],
      confirmInstall: true,
      confirmUpgrade: true,
      releaseClient: { getLatestRelease: vi.fn(async () => upgrade) },
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });

    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));
    const disabledPage = manifest.pages.find((page) => page.id === disabled.page.id);
    const disabledDocument = JSON.parse(await readFile(path.join(projectRoot, disabledPage.annotationFile), "utf8"));
    expect(disabledPage.display.enabled).toBe(false);
    expect(inspectIntegration(await readFile(path.join(projectRoot, disabledPage.htmlPath), "utf8"))).toHaveLength(0);
    expect(disabledDocument.annotations).toEqual(disabled.document.annotations);
    expect(await readFile(path.join(projectRoot, disabledPage.viewFile))).toEqual(disabledViewBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 2, annotations: 1 });
  });

  it("adds a new page without reinjecting or reducing a disabled page", async () => {
    const installed = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const seeded = await seedDurableAnnotationAndRefresh(installed);
    const disabled = await removeDisplay(seeded.page.id);
    const disabledViewBefore = await readFile(path.join(projectRoot, disabled.page.viewFile));

    await installProject({
      projectRoot,
      pagePaths: ["prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    });

    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));
    const disabledPage = manifest.pages.find((page) => page.id === disabled.page.id);
    const disabledDocument = JSON.parse(await readFile(path.join(projectRoot, disabledPage.annotationFile), "utf8"));
    expect(manifest.pages).toHaveLength(2);
    expect(disabledPage.display.enabled).toBe(false);
    expect(inspectIntegration(await readFile(path.join(projectRoot, disabledPage.htmlPath), "utf8"))).toHaveLength(0);
    expect(disabledDocument.annotations).toEqual(disabled.document.annotations);
    expect(await readFile(path.join(projectRoot, disabledPage.viewFile))).toEqual(disabledViewBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 2, annotations: 1 });
  });

  it.each([
    {
      label: "only its unregistered annotation path exists",
      sentinelPaths: [".prd-annotator/data/pages/details-d7d2b5.json"]
    },
    {
      label: "only its unregistered view path exists",
      sentinelPaths: [".prd-annotator/view/pages/details-d7d2b5.js"]
    },
    {
      label: "both unregistered permanent paths exist",
      sentinelPaths: [
        ".prd-annotator/data/pages/details-d7d2b5.json",
        ".prd-annotator/view/pages/details-d7d2b5.js"
      ]
    }
  ])("rejects a new page without partial writes when $label", async ({ sentinelPaths }) => {
    await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    for (const sentinelPath of sentinelPaths) {
      const absolutePath = path.join(projectRoot, sentinelPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `sentinel:${sentinelPath}\n`, "utf8");
    }
    const beforeFiles = await snapshotProject(projectRoot);
    const beforeDirectories = await snapshotDirectories(projectRoot);
    releaseClient.getLatestRelease.mockClear();

    await expect(installProject({
      projectRoot,
      pagePaths: ["prototype/deep/details.html"],
      confirmInstall: true,
      releaseClient,
      now: () => new Date("2026-08-11T00:00:00.000Z")
    })).rejects.toThrow(/permanent annotation or view path already exists/);

    expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
    expectSnapshotsEqual(await snapshotProject(projectRoot), beforeFiles);
    expect(await snapshotDirectories(projectRoot)).toEqual(beforeDirectories);
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
  it("installs repeated explicit pages and reports the installed version and every changed path", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await installerModule.runInstallerCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-install",
        "--page", "prototype/index.html",
        "--page", "prototype/deep/details.html"
      ],
      releaseClient,
      now: () => fixedNow,
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    const report = JSON.parse(stdout);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(report.installedVersion).toBe("2.0.0");
    expect(new Set(report.changedPaths)).toEqual(new Set([
      ".prd-annotator/sdk/prd-annotator.js",
      ".prd-annotator/data/pages/index-2d243c.json",
      ".prd-annotator/view/pages/index-2d243c.js",
      ".prd-annotator/data/pages/details-d7d2b5.json",
      ".prd-annotator/view/pages/details-d7d2b5.js",
      ".prd-annotator/manifest.json",
      "prototype/index.html",
      "prototype/deep/details.html"
    ]));
  });

  it("accepts a valid confirm-upgrade CLI flow without contacting GitHub", async () => {
    const firstManifest = await installProject({
      projectRoot,
      pagePaths: ["prototype/index.html"],
      confirmInstall: true,
      releaseClient,
      now: () => fixedNow
    });
    const distinctive = await seedDistinctivePageBytes(firstManifest);
    const upgrade = upgradedRelease();
    const upgradeClient = { getLatestRelease: vi.fn(async () => upgrade) };
    let stdout = "";
    let stderr = "";

    const exitCode = await installerModule.runInstallerCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-install",
        "--confirm-upgrade",
        "--page", "prototype/index.html"
      ],
      releaseClient: upgradeClient,
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    const report = JSON.parse(stdout);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(report.installedVersion).toBe("2.1.0");
    expect(new Set(report.changedPaths)).toEqual(new Set([
      ".prd-annotator/sdk/prd-annotator.js",
      ".prd-annotator/manifest.json",
      "prototype/index.html"
    ]));
    expect(readFileSync(path.join(projectRoot, distinctive.page.annotationFile))).toEqual(distinctive.annotationBytes);
    expect(readFileSync(path.join(projectRoot, distinctive.page.viewFile))).toEqual(distinctive.viewBytes);
  });

  it("prints a warning but keeps CLI success when the completed installation lock cannot be released", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await installerModule.runInstallerCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-install",
        "--page", "prototype/index.html"
      ],
      releaseClient,
      now: () => fixedNow,
      transactionHooks: {
        async afterCommit({ index }) {
          if (index === 0) await writeFile(path.join(projectRoot, ".prd-annotator-project-write.lock/retained"), "busy\n");
        }
      },
      projectLockOptions: { releaseAttempts: 1 },
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    const report = JSON.parse(stdout);
    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"));

    expect(exitCode).toBe(0);
    expect(report.installedVersion).toBe("2.0.0");
    expect(report.changedPaths).toContain("prototype/index.html");
    expect(stderr).toMatch(/^Warning: Failed to release project mutation lock after 1 attempts:/);
    expect(validateManifestV2(manifest)).toBe(manifest);
    expect(await readFile(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js")))
      .toEqual(releaseInfo.sdkBuffer);
    expect(await readFile(path.join(projectRoot, manifest.pages[0].annotationFile))).toBeInstanceOf(Buffer);
    expect(await readFile(path.join(projectRoot, manifest.pages[0].viewFile))).toBeInstanceOf(Buffer);
  });

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
