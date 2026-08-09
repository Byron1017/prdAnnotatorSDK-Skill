import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import { migrateLegacy, runMigrateLegacyCli } from "../../prd-annotator-skill/scripts/migrate-legacy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const temporaryDirectories = [];
const now = new Date("2026-08-09T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function projectPath(projectRoot, relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

async function readJson(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function writeJson(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function legacyAnnotation(pageId, ids = ["A001", "A002"]) {
  return {
    schemaVersion: 1,
    page: { id: pageId, title: `Legacy ${pageId}`, route: "/prototype/index.html" },
    annotations: ids.map((id, index) => ({
      id,
      comment: `Legacy annotation ${id}`,
      status: index ? "open" : "applied",
      createdAt: `2026-08-08T0${index}:00:00.000Z`,
      updatedAt: `2026-08-08T0${index + 1}:00:00.000Z`,
      target: {
        cssPath: "main",
        xpath: "/html/body/main",
        textQuote: `Target ${id}`,
        rect: { x: 0, y: index, width: 100, height: 40 }
      },
      prd: {
        linkedSections: index ? [] : ["3.2 Batch operations"],
        impactScope: "page",
        summary: `Summary ${id}`
      }
    }))
  };
}

async function snapshotTree(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) result[path.relative(root, absolutePath).split(path.sep).join("/")] = await readFile(absolutePath);
    }
  }
  await visit(root);
  return result;
}

function blobHash(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

async function seedLegacy({ keepV2 = false, pageIds = ["equipment-ops-7c31fa"] } = {}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "legacy-migration-test-"));
  temporaryDirectories.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const pages = [];
  for (let index = 0; index < pageIds.length; index += 1) {
    const pageId = pageIds[index];
    const annotationFile = `data/pages/legacy-${index}.json`;
    const prdFile = index === 0 ? "pages/equipment-ops.md" : `pages/legacy-${index}.md`;
    const htmlPath = index === 0 ? "prototype/index.html" : `prototype/legacy-${index}.html`;
    if (index > 0) {
      await writeFile(projectPath(projectRoot, `doc/prd/${prdFile}`), `# Legacy ${index}\n`, "utf8");
      await writeFile(projectPath(projectRoot, htmlPath), "<!doctype html><html><body><main>Legacy</main></body></html>\n", "utf8");
    }
    const annotation = legacyAnnotation(pageId, [`A${index}01`, `A${index}02`]);
    annotation.page.title = `Legacy ${pageId}`;
    annotation.page.route = `/${htmlPath}`;
    await writeJson(projectPath(projectRoot, `doc/prd/${annotationFile}`), annotation);
    pages.push({
      id: pageId,
      title: `Legacy ${pageId}`,
      route: `/${htmlPath}`,
      htmlPath,
      annotationFile,
      prdFile
    });
  }
  await writeJson(projectPath(projectRoot, "doc/prd/manifest.json"), { schemaVersion: 1, pages });
  if (!keepV2) {
    await rm(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    await rm(projectPath(projectRoot, ".prd-annotator/data"), { recursive: true });
    await rm(projectPath(projectRoot, ".prd-annotator/view"), { recursive: true });
  }
  return projectRoot;
}

function captureStream() {
  let value = "";
  return { write(chunk) { value += chunk; }, value: () => value };
}

describe("non-destructive legacy migration", () => {
  it.each([false, null, undefined, 1, "true", new Boolean(true)])("requires literal migration consent for %#", async (confirmMigration) => {
    const projectRoot = await seedLegacy();
    const before = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration, now }))
      .rejects.toThrow("--confirm-migration is required");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(before);
  });

  it.each([null, undefined, "", "INSTALL", "both", ["install"], true])("requires exactly one install or upgrade authorization for %#", async (authorization) => {
    const projectRoot = await seedLegacy();
    await expect(migrateLegacy({ projectRoot, authorization, confirmMigration: true, now }))
      .rejects.toThrow("authorized install or upgrade is required");
  });

  it("copies every annotation with exact ID parity, inventories original PRDs, records exact source evidence, and never changes legacy bytes", async () => {
    const projectRoot = await seedLegacy();
    const legacyRoot = projectPath(projectRoot, "doc/prd");
    const before = await snapshotTree(legacyRoot);
    const sourceBytes = before["manifest.json"];
    const sourceGitHashes = Object.fromEntries(Object.entries(before).map(([name, bytes]) => [name, blobHash(bytes)]));

    const manifest = await migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now });

    expect(await snapshotTree(legacyRoot)).toEqual(before);
    expect(Object.fromEntries(Object.entries(await snapshotTree(legacyRoot)).map(([name, bytes]) => [name, blobHash(bytes)])))
      .toEqual(sourceGitHashes);
    expect(manifest.migration).toMatchObject({
      source: "doc/prd/manifest.json",
      migratedAt: now.toISOString(),
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      pageIdParityVerified: true
    });
    const page = manifest.pages[0];
    expect(page.id).toBe("equipment-ops-7c31fa");
    expect((await readJson(projectPath(projectRoot, page.annotationFile))).annotations.map((entry) => entry.id))
      .toEqual((await readJson(projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json"))).annotations.map((entry) => entry.id));
    expect(manifest.documents.filter((entry) => ["page-prd", "total-prd"].includes(entry.kind)).map((entry) => entry.path))
      .toEqual(expect.arrayContaining(["doc/prd/pages/equipment-ops.md", "doc/prd/PRD.md"]));
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1 });
  });

  it("keeps valid ASCII IDs and deterministically maps invalid or colliding legacy IDs without loss", async () => {
    const firstRoot = await seedLegacy({ pageIds: ["设备运维", "设备 运维", "valid-page"] });
    const secondRoot = await seedLegacy({ pageIds: ["设备运维", "设备 运维", "valid-page"] });
    const first = await migrateLegacy({ projectRoot: firstRoot, authorization: "install", confirmMigration: true, now });
    const second = await migrateLegacy({ projectRoot: secondRoot, authorization: "install", confirmMigration: true, now });
    expect(first.pages.map((page) => page.id)).toEqual(second.pages.map((page) => page.id));
    expect(first.pages.map((page) => page.id)).toHaveLength(new Set(first.pages.map((page) => page.id)).size);
    expect(first.pages.map((page) => page.id)).toContain("valid-page");
    expect(first.pages.every((page) => /^[a-z0-9-]{1,32}$/.test(page.id))).toBe(true);
    expect(first.migration.pageIdMap).toEqual({
      "设备 运维": expect.stringMatching(/^[a-z0-9-]{1,32}$/),
      "设备运维": expect.stringMatching(/^[a-z0-9-]{1,32}$/),
      "valid-page": "valid-page"
    });
    for (const page of first.pages) {
      expect((await readJson(projectPath(firstRoot, page.annotationFile))).annotations).toHaveLength(2);
    }
  });

  it("rejects missing annotations and corrupt legacy source before any v2 write", async () => {
    const missingRoot = await seedLegacy();
    await rm(projectPath(missingRoot, "doc/prd/data/pages/legacy-0.json"));
    const sdkBefore = await readFile(projectPath(missingRoot, ".prd-annotator/sdk/prd-annotator.js"));
    await expect(migrateLegacy({ projectRoot: missingRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Legacy annotation file does not exist");
    expect(await readFile(projectPath(missingRoot, ".prd-annotator/sdk/prd-annotator.js"))).toEqual(sdkBefore);
    await expect(lstat(projectPath(missingRoot, ".prd-annotator/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const corruptRoot = await seedLegacy();
    await writeFile(projectPath(corruptRoot, "doc/prd/manifest.json"), "{ broken\n", "utf8");
    await expect(migrateLegacy({ projectRoot: corruptRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Invalid legacy manifest JSON");
    await expect(lstat(projectPath(corruptRoot, ".prd-annotator/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed v1 annotation fields before normalization can replace them with defaults", async () => {
    const projectRoot = await seedLegacy();
    const annotationPath = projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json");
    const malformed = await readJson(annotationPath);
    delete malformed.annotations[0].target;
    malformed.annotations[1].status = "invented";
    await writeJson(annotationPath, malformed);
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Invalid legacy annotation A001.target");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    await expect(lstat(projectPath(projectRoot, ".prd-annotator/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported supplied v1 fields instead of silently normalizing them away", async () => {
    const projectRoot = await seedLegacy();
    const annotationPath = projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json");
    const legacy = await readJson(annotationPath);
    legacy.annotations[0].type = "invented";
    await writeJson(annotationPath, legacy);
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Invalid legacy annotation A001.type");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    await expect(lstat(projectPath(projectRoot, ".prd-annotator/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects conflicting supplied legacy project identity instead of replacing it", async () => {
    const projectRoot = await seedLegacy();
    const manifestPath = projectPath(projectRoot, "doc/prd/manifest.json");
    const legacyManifest = await readJson(manifestPath);
    legacyManifest.projectId = "authoritative-project";
    await writeJson(manifestPath, legacyManifest);
    const annotationPath = projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json");
    const legacy = await readJson(annotationPath);
    legacy.projectId = "conflicting-project";
    await writeJson(annotationPath, legacy);
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Legacy annotation projectId mismatch: equipment-ops-7c31fa");
  });

  it("rejects conflicting supplied legacy page metadata instead of replacing it", async () => {
    const projectRoot = await seedLegacy();
    const annotationPath = projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json");
    const legacy = await readJson(annotationPath);
    legacy.page.title = "Conflicting title";
    await writeJson(annotationPath, legacy);
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Legacy annotation page title mismatch: equipment-ops-7c31fa");
  });

  it("rejects orphaned v2 data or views instead of silently overwriting them during install", async () => {
    const projectRoot = await seedLegacy();
    const orphanPath = projectPath(projectRoot, ".prd-annotator/data/pages/equipment-ops-7c31fa.json");
    await writeJson(orphanPath, { orphaned: true });
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    const v2Before = await snapshotTree(projectPath(projectRoot, ".prd-annotator"));
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Existing v2 artifacts require upgrade or recovery");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    expect(await snapshotTree(projectPath(projectRoot, ".prd-annotator"))).toEqual(v2Before);
  });

  it("never treats an HTML file inside doc/prd as a writable integration target", async () => {
    const projectRoot = await seedLegacy();
    await writeFile(projectPath(projectRoot, "doc/prd/legacy.html"), "<!doctype html><html><body>Legacy source</body></html>\n", "utf8");
    const manifestPath = projectPath(projectRoot, "doc/prd/manifest.json");
    const legacyManifest = await readJson(manifestPath);
    legacyManifest.pages[0].htmlPath = "doc/prd/legacy.html";
    legacyManifest.pages[0].route = "/doc/prd/legacy.html";
    await writeJson(manifestPath, legacyManifest);
    const annotationPath = projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json");
    const legacyAnnotationDocument = await readJson(annotationPath);
    legacyAnnotationDocument.page.route = "/doc/prd/legacy.html";
    await writeJson(annotationPath, legacyAnnotationDocument);
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Legacy htmlPath cannot be inside doc/prd");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    await expect(lstat(projectPath(projectRoot, ".prd-annotator/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["../outside.json", "/outside.json", "C:/outside.json", "data\\page.json", "data/../page.json"])(
    "rejects unsafe legacy annotation path %s",
    async (annotationFile) => {
      const projectRoot = await seedLegacy();
      const legacyManifestPath = projectPath(projectRoot, "doc/prd/manifest.json");
      const legacy = await readJson(legacyManifestPath);
      legacy.pages[0].annotationFile = annotationFile;
      await writeJson(legacyManifestPath, legacy);
      await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
        .rejects.toThrow("Invalid legacy annotationFile");
    }
  );

  it("rejects a symlinked legacy source ancestor", async () => {
    const projectRoot = await seedLegacy();
    const outside = await mkdtemp(path.join(tmpdir(), "legacy-source-outside-"));
    temporaryDirectories.push(outside);
    await writeJson(path.join(outside, "page.json"), legacyAnnotation("equipment-ops-7c31fa"));
    await rm(projectPath(projectRoot, "doc/prd/data"), { recursive: true });
    try {
      await symlink(outside, projectPath(projectRoot, "doc/prd/data"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    const legacyManifestPath = projectPath(projectRoot, "doc/prd/manifest.json");
    const legacy = await readJson(legacyManifestPath);
    legacy.pages[0].annotationFile = "data/page.json";
    await writeJson(legacyManifestPath, legacy);
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("Unsafe legacy annotationFile ancestor: doc/prd/data");
  });

  it("never silently overwrites a valid v2 install and requires upgrade for existing data", async () => {
    const projectRoot = await seedLegacy({ keepV2: true });
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const before = await readFile(manifestPath);
    await expect(migrateLegacy({ projectRoot, authorization: "install", confirmMigration: true, now }))
      .rejects.toThrow("existing v2 installation requires upgrade authorization");
    expect(await readFile(manifestPath)).toEqual(before);

    await writeJson(
      projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json"),
      legacyAnnotation("equipment-ops-7c31fa", ["A101", "A102"])
    );

    const upgraded = await migrateLegacy({ projectRoot, authorization: "upgrade", confirmMigration: true, now });
    expect(upgraded.pages.some((page) => page.id === "equipment-ops-7c31fa")).toBe(true);
    expect((await readJson(projectPath(projectRoot, upgraded.pages[0].annotationFile))).annotations.map((entry) => entry.id))
      .toEqual(expect.arrayContaining(["A001", "A101", "A102"]));
  });

  it("rejects a conflicting same-ID annotation during upgrade without changing either source", async () => {
    const projectRoot = await seedLegacy({ keepV2: true });
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    const v2Before = await snapshotTree(projectPath(projectRoot, ".prd-annotator"));
    await expect(migrateLegacy({ projectRoot, authorization: "upgrade", confirmMigration: true, now }))
      .rejects.toThrow("Legacy annotation ID collides with existing v2 annotation: A001");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    expect(await snapshotTree(projectPath(projectRoot, ".prd-annotator"))).toEqual(v2Before);
  });

  it("rejects upgrade without v2 and preserves corrupt existing v2 bytes", async () => {
    const noV2Root = await seedLegacy();
    await expect(migrateLegacy({ projectRoot: noV2Root, authorization: "upgrade", confirmMigration: true, now }))
      .rejects.toThrow("upgrade authorization requires an existing valid v2 installation");

    const corruptRoot = await seedLegacy({ keepV2: true });
    const manifestPath = projectPath(corruptRoot, ".prd-annotator/manifest.json");
    await writeFile(manifestPath, "{ corrupt v2\n", "utf8");
    const before = await readFile(manifestPath);
    await expect(migrateLegacy({ projectRoot: corruptRoot, authorization: "upgrade", confirmMigration: true, now }))
      .rejects.toThrow("Existing v2 manifest is invalid");
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("rolls back a partial migration and keeps every legacy and previous v2 byte unchanged", async () => {
    const projectRoot = await seedLegacy({ keepV2: true });
    await writeJson(
      projectPath(projectRoot, "doc/prd/data/pages/legacy-0.json"),
      legacyAnnotation("equipment-ops-7c31fa", ["A101", "A102"])
    );
    const legacyBefore = await snapshotTree(projectPath(projectRoot, "doc/prd"));
    const v2Before = await snapshotTree(projectPath(projectRoot, ".prd-annotator"));
    await expect(migrateLegacy({
      projectRoot,
      authorization: "upgrade",
      confirmMigration: true,
      now,
      transactionHooks: { afterCommit({ index }) { if (index === 1) throw new Error("injected migration failure"); } }
    })).rejects.toThrow("injected migration failure");
    expect(await snapshotTree(projectPath(projectRoot, "doc/prd"))).toEqual(legacyBefore);
    expect(await snapshotTree(projectPath(projectRoot, ".prd-annotator"))).toEqual(v2Before);
  });

  it("serializes concurrent migration attempts with the project lock", async () => {
    const projectRoot = await seedLegacy();
    let releaseFirst;
    let firstCommitted;
    const committed = new Promise((resolve) => { firstCommitted = resolve; });
    const blocker = new Promise((resolve) => { releaseFirst = resolve; });
    const first = migrateLegacy({
      projectRoot,
      authorization: "install",
      confirmMigration: true,
      now,
      transactionHooks: { async afterCommit({ index }) { if (index === 0) { firstCommitted(); await blocker; } } }
    });
    await committed;
    const second = migrateLegacy({
      projectRoot,
      authorization: "install",
      confirmMigration: true,
      now,
      projectLockOptions: { timeoutMs: 0 }
    });
    await expect(second).rejects.toThrow("Timed out waiting for project mutation lock");
    releaseFirst();
    await expect(first).resolves.toMatchObject({ schemaVersion: 2 });
  });

  it("requires exactly one CLI authorization flag and prints deterministic success JSON", async () => {
    const projectRoot = await seedLegacy();
    const stdout = captureStream();
    const stderr = captureStream();
    expect(await runMigrateLegacyCli({
      argv: ["--project-root", projectRoot, "--confirm-install", "--confirm-migration"],
      now,
      stdout,
      stderr
    })).toBe(0);
    expect(JSON.parse(stdout.value()).migration.migratedAt).toBe(now.toISOString());
    expect(stderr.value()).toBe("");

    const anotherRoot = await seedLegacy();
    const badError = captureStream();
    expect(await runMigrateLegacyCli({
      argv: ["--project-root", anotherRoot, "--confirm-install", "--confirm-upgrade", "--confirm-migration"],
      stdout: captureStream(),
      stderr: badError
    })).toBe(1);
    expect(badError.value()).toContain("exactly one of --confirm-install or --confirm-upgrade is required");
  });

  it("contains no destructive legacy-source operation or broad source-tree mover", async () => {
    const source = await readFile(path.join(repositoryRoot, "prd-annotator-skill/scripts/migrate-legacy.mjs"), "utf8");
    expect(source).not.toMatch(/\b(?:unlink|rename|copyFile|rm)\s*\([^)]*doc\/prd/);
    expect(source).not.toMatch(/walkProject\([^)]*doc\/prd/);
  });
});
