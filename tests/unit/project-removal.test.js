import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import {
  inspectIntegration,
  relativeWebPath,
  removeIntegration,
  upsertIntegration
} from "../../prd-annotator-skill/scripts/lib/html.mjs";
import { fingerprintValue } from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import { mergeSnapshot } from "../../prd-annotator-skill/scripts/merge-annotations.mjs";
import {
  removeProject,
  runRemoveProjectCli
} from "../../prd-annotator-skill/scripts/remove-project.mjs";
import { refreshProject } from "../../prd-annotator-skill/scripts/refresh-project.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const manifestRelativePath = ".prd-annotator/manifest.json";
const fixedNow = new Date("2026-08-10T00:00:00.000Z");
const temporaryDirectories = [];

function projectPath(projectRoot, relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function readDurableRecoveryJournal(filePath) {
  const module = await import("../../prd-annotator-skill/scripts/remove-project.mjs");
  expect(typeof module.readRecoveryJournal).toBe("function");
  return module.readRecoveryJournal(filePath);
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "prd-annotator-remove-"));
  temporaryDirectories.push(root);
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function snapshotFiles(root) {
  const result = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) {
        result.set(path.relative(root, absolutePath).split(path.sep).join("/"), readFileSync(absolutePath));
      }
    }
  }
  visit(root);
  return result;
}

function pageContext(projectRoot, pageId) {
  const manifest = readJson(projectPath(projectRoot, manifestRelativePath));
  const page = manifest.pages.find((entry) => entry.id === pageId) || manifest.pages[0];
  const document = readJson(projectPath(projectRoot, page.annotationFile));
  return { manifest, page, document };
}

function rawSnapshot(manifest, document, overrides = {}) {
  return {
    schemaVersion: 2,
    projectId: manifest.project.id,
    annotationFingerprint: fingerprintValue(document.annotations),
    document,
    ...overrides
  };
}

function promptSnapshot(manifest, page, document, overrides = {}) {
  return {
    annotationPath: page.annotationFile,
    document,
    fingerprint: fingerprintValue(document.annotations),
    htmlPath: page.htmlPath,
    manifestPath: manifestRelativePath,
    pageId: page.id,
    projectId: manifest.project.id,
    viewPath: page.viewFile,
    ...overrides
  };
}

function newAnnotation(template, overrides = {}) {
  return {
    ...structuredClone(template),
    id: "A002",
    title: "Confirm batch disable",
    description: "The live browser contains a second annotation.",
    prdContent: "Batch disable shall require confirmation.",
    status: "open",
    createdAt: "2026-08-09T01:00:00.000Z",
    updatedAt: "2026-08-09T01:00:00.000Z",
    prd: {
      ...structuredClone(template.prd),
      linkedSections: []
    },
    ...overrides
  };
}

function memoryStream() {
  let value = "";
  return {
    stream: { write: (chunk) => { value += String(chunk); } },
    read: () => value
  };
}

async function addSecondPage(projectRoot) {
  const manifestPath = projectPath(projectRoot, manifestRelativePath);
  const manifest = readJson(manifestPath);
  const firstPage = manifest.pages[0];
  const firstDocument = readJson(projectPath(projectRoot, firstPage.annotationFile));
  const secondPage = {
    id: "maintenance-ops-52c2a1",
    title: "Maintenance Operations",
    htmlPath: "prototype/maintenance.html",
    annotationFile: ".prd-annotator/data/pages/maintenance-ops-52c2a1.json",
    viewFile: ".prd-annotator/view/pages/maintenance-ops-52c2a1.js",
    display: {
      enabled: true,
      updatedAt: "2026-08-09T00:00:00.000Z"
    }
  };
  const secondDocument = {
    ...structuredClone(firstDocument),
    page: {
      id: secondPage.id,
      title: secondPage.title,
      htmlPath: secondPage.htmlPath,
      route: `/${secondPage.htmlPath}`
    },
    annotations: [newAnnotation(firstDocument.annotations[0], {
      id: "B001",
      title: "Maintenance reminder",
      description: "Show maintenance reminders.",
      prdContent: "Maintenance reminders are visible.",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z"
    })]
  };
  manifest.pages.push(secondPage);
  writeJson(manifestPath, manifest);
  writeJson(projectPath(projectRoot, secondPage.annotationFile), secondDocument);
  const html = upsertIntegration("<!doctype html>\n<body><main>Maintenance</main></body>\n", {
    src: relativeWebPath(secondPage.htmlPath, ".prd-annotator/sdk/prd-annotator.js"),
    projectId: manifest.project.id,
    pageId: secondPage.id,
    viewSrc: relativeWebPath(secondPage.htmlPath, secondPage.viewFile)
  });
  writeFileSync(projectPath(projectRoot, secondPage.htmlPath), html);
  writeFileSync(projectPath(projectRoot, secondPage.viewFile), "placeholder\n");
  await refreshProject({ projectRoot, now: fixedNow });
  return { manifest: readJson(manifestPath), secondPage, secondDocument };
}

beforeEach(() => {
  temporaryDirectories.length = 0;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("snapshot-verified display removal", () => {
  it("directs future Agents through the removal orchestrator instead of manual integration edits", () => {
    const skillSource = readFileSync(path.join(repositoryRoot, "prd-annotator-skill/SKILL.md"), "utf8");
    const removalSection = /## Remove the display layer safely([\s\S]*?)(?=\n## )/.exec(skillSource)?.[1] || "";

    expect(removalSection).toContain('node "<skill-dir>/scripts/remove-project.mjs"');
    expect(removalSection).toContain('--project-root "<project-root>"');
    expect(removalSection).toContain("--confirm-remove");
    expect(removalSection).toContain('--page "<page-id>"');
    expect(removalSection).toContain('--snapshot "<current-snapshot.json>"');
    expect(removalSection).toMatch(/one current .*snapshot per target page/i);
    expect(removalSection).toContain("page.display.enabled");
    expect(removalSection).toMatch(/post-removal gate/i);
    expect(removalSection).toMatch(/never manually delete/i);
    expect(removalSection).not.toContain("Remove only the SDK script tag, import, or mount call");
    expect(removalSection).not.toContain("Keep annotation JSON, page PRDs, total PRD, manifest, and browser cache unchanged.");
    expect(removalSection).toMatch(/cooperating AI and CLI writers/i);
    expect(removalSection).toMatch(/trusted local project environment/i);
    expect(removalSection).toMatch(/cannot guarantee hostile-process junction swaps/i);
  });

  it("requires literal Boolean authorization and a unique explicit page list", async () => {
    const projectRoot = copyFixture();
    const pageId = pageContext(projectRoot).page.id;

    for (const confirmRemove of [false, "true", 1, null, undefined]) {
      await expect(removeProject({ projectRoot, pageIds: [pageId], snapshots: [], confirmRemove, now: fixedNow }))
        .rejects.toThrow("--confirm-remove is required");
    }
    await expect(removeProject({ projectRoot, pageIds: [], snapshots: [], confirmRemove: true, now: fixedNow }))
      .rejects.toThrow("At least one explicit --page is required");
    await expect(removeProject({
      projectRoot,
      pageIds: [pageId, pageId],
      snapshots: [],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("Each --page selection must be unique");
    await expect(removeProject({
      projectRoot: "",
      pageIds: [pageId],
      snapshots: [],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("projectRoot is required");
    await expect(removeProject({
      projectRoot,
      pageIds: [pageId],
      snapshots: {},
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("snapshots must be an array");
  });

  it("requires exactly one current identity-matching snapshot per page", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);

    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow(/Current annotation snapshot is required for equipment-ops-7c31fa[\s\S]*1\.[\s\S]*5\./);

    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document), rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("Exactly one current annotation snapshot is required for equipment-ops-7c31fa");

    const otherPage = structuredClone(document);
    otherPage.page.id = "unselected-page-a1b2c3";
    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document), rawSnapshot(manifest, otherPage)],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("Snapshot project/page identity does not match the removal target");
  });

  it("rejects project, page, raw-envelope, and prompt-envelope identity mismatches before writes", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const before = snapshotFiles(projectRoot);
    const mismatches = [
      rawSnapshot(manifest, document, { projectId: "another-project-a1b2c3" }),
      rawSnapshot(manifest, { ...document, page: { ...document.page, id: "another-page-a1b2c3" } }),
      promptSnapshot(manifest, page, document, { projectId: "another-project-a1b2c3" }),
      promptSnapshot(manifest, page, document, { pageId: "another-page-a1b2c3" })
    ];

    for (const snapshot of mismatches) {
      await expect(removeProject({
        projectRoot,
        pageIds: [page.id],
        snapshots: [snapshot],
        confirmRemove: true,
        now: fixedNow
      })).rejects.toThrow("Snapshot project/page identity does not match the removal target");
    }
    expect(snapshotFiles(projectRoot)).toEqual(before);
  });

  it("matches repeated direct and prompt snapshots by embedded identity rather than argument order", async () => {
    const projectRoot = copyFixture();
    await addSecondPage(projectRoot);
    const manifest = readJson(projectPath(projectRoot, manifestRelativePath));
    const [firstPage, secondPage] = manifest.pages;
    const firstDocument = readJson(projectPath(projectRoot, firstPage.annotationFile));
    const secondDocument = readJson(projectPath(projectRoot, secondPage.annotationFile));

    const result = await removeProject({
      projectRoot,
      pageIds: [firstPage.id, secondPage.id],
      snapshots: [
        promptSnapshot(manifest, secondPage, secondDocument),
        rawSnapshot(manifest, firstDocument)
      ],
      confirmRemove: true,
      now: fixedNow
    });

    expect(result.removedPages).toEqual([firstPage.id, secondPage.id]);
    const installed = readJson(projectPath(projectRoot, manifestRelativePath));
    expect(installed.pages.map((page) => page.display.enabled)).toEqual([false, false]);
    for (const page of installed.pages) {
      expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8"))).toHaveLength(0);
    }
  });

  it("persists live annotations, regenerates views, and changes only retained project assets plus HTML flags", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const annotationPath = projectPath(projectRoot, page.annotationFile);
    const htmlPath = projectPath(projectRoot, page.htmlPath);
    const prdPaths = ["doc/prd/PRD.md", "doc/prd/pages/equipment-ops.md"];
    const prdBefore = new Map(prdPaths.map((relativePath) => [relativePath, readFileSync(projectPath(projectRoot, relativePath))]));
    const sdkBefore = readFileSync(projectPath(projectRoot, ".prd-annotator/sdk/prd-annotator.js"));
    const assetPathsBefore = [...snapshotFiles(projectRoot).keys()].filter((relativePath) => relativePath.startsWith(".prd-annotator/"));
    const incoming = newAnnotation(document.annotations[0]);
    const liveDocument = { ...document, annotations: [...document.annotations, incoming] };

    const result = await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, liveDocument)],
      confirmRemove: true,
      now: fixedNow
    });

    expect(result).toEqual({
      removedPages: [page.id],
      changedFiles: [
        ".prd-annotator/data/pages/equipment-ops-7c31fa.json",
        ".prd-annotator/manifest.json",
        ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
        "prototype/index.html"
      ]
    });
    expect(inspectIntegration(readFileSync(htmlPath, "utf8"))).toHaveLength(0);
    expect(readJson(annotationPath).annotations.map((item) => item.id)).toEqual(["A001", "A002"]);
    expect(readJson(projectPath(projectRoot, manifestRelativePath)).pages[0].display)
      .toEqual({ enabled: false, updatedAt: fixedNow.toISOString() });
    expect(readFileSync(projectPath(projectRoot, ".prd-annotator/sdk/prd-annotator.js"))).toEqual(sdkBefore);
    expect([...snapshotFiles(projectRoot).keys()].filter((relativePath) => relativePath.startsWith(".prd-annotator/")))
      .toEqual(assetPathsBefore);
    for (const [relativePath, bytes] of prdBefore) {
      expect(readFileSync(projectPath(projectRoot, relativePath))).toEqual(bytes);
    }
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 2 });
  });

  it("never lets zero, older, or partial live state clear or downgrade permanent annotations", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const permanentOnly = newAnnotation(document.annotations[0], {
      id: "A003",
      title: "Permanent-only requirement",
      description: "This record exists only in permanent JSON.",
      prdContent: "Retain permanent-only history.",
      createdAt: "2026-08-08T02:00:00.000Z",
      updatedAt: "2026-08-08T03:00:00.000Z"
    });
    const permanent = { ...document, annotations: [...document.annotations, permanentOnly] };
    writeJson(projectPath(projectRoot, page.annotationFile), permanent);
    await refreshProject({ projectRoot, now: fixedNow });
    const older = {
      ...structuredClone(document.annotations[0]),
      title: "Stale browser title",
      updatedAt: "2026-08-08T00:30:00.000Z"
    };

    await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, { ...document, annotations: [older] })],
      confirmRemove: true,
      now: fixedNow
    });

    const after = readJson(projectPath(projectRoot, page.annotationFile));
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(["A001", "A003"]);
    expect(after.annotations[0]).toEqual(document.annotations[0]);
    expect(after.annotations[1]).toEqual(permanentOnly);

    const zeroProject = copyFixture();
    const zeroContext = pageContext(zeroProject);
    await removeProject({
      projectRoot: zeroProject,
      pageIds: [zeroContext.page.id],
      snapshots: [rawSnapshot(zeroContext.manifest, { ...zeroContext.document, annotations: [] })],
      confirmRemove: true,
      now: fixedNow
    });
    expect(readJson(projectPath(zeroProject, zeroContext.page.annotationFile)).annotations.map((item) => item.id))
      .toEqual(["A001"]);
  });

  it("accepts a strictly newer live record and proves permanent timestamps are equal or newer", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const newer = {
      ...structuredClone(document.annotations[0]),
      title: "Newer browser title",
      updatedAt: "2026-08-09T02:00:00.000Z"
    };

    await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [promptSnapshot(manifest, page, { ...document, annotations: [newer] })],
      confirmRemove: true,
      now: fixedNow
    });

    expect(readJson(projectPath(projectRoot, page.annotationFile)).annotations[0]).toEqual(newer);
  });

  it("stops before removal when refresh or the enabled pre-removal gate fails", async () => {
    const refreshProjectRoot = copyFixture();
    const refreshContext = pageContext(refreshProjectRoot);
    const refreshHtmlBefore = readFileSync(projectPath(refreshProjectRoot, refreshContext.page.htmlPath));
    const refreshManifestBefore = readFileSync(projectPath(refreshProjectRoot, manifestRelativePath));
    await expect(removeProject({
      projectRoot: refreshProjectRoot,
      pageIds: [refreshContext.page.id],
      snapshots: [rawSnapshot(refreshContext.manifest, refreshContext.document)],
      confirmRemove: true,
      now: "not-a-date"
    })).rejects.toThrow("now must produce a valid date");
    expect(readFileSync(projectPath(refreshProjectRoot, refreshContext.page.htmlPath))).toEqual(refreshHtmlBefore);
    expect(readFileSync(projectPath(refreshProjectRoot, manifestRelativePath))).toEqual(refreshManifestBefore);

    const gateProjectRoot = copyFixture();
    const gateContext = pageContext(gateProjectRoot);
    const gateHtmlBefore = readFileSync(projectPath(gateProjectRoot, gateContext.page.htmlPath));
    writeFileSync(projectPath(gateProjectRoot, ".prd-annotator/sdk/prd-annotator.js"), "corrupt sdk bytes");
    await expect(removeProject({
      projectRoot: gateProjectRoot,
      pageIds: [gateContext.page.id],
      snapshots: [rawSnapshot(gateContext.manifest, gateContext.document)],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow("SDK SHA-256 does not match manifest");
    expect(readFileSync(projectPath(gateProjectRoot, gateContext.page.htmlPath))).toEqual(gateHtmlBefore);
    expect(readJson(projectPath(gateProjectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(true);
  });

  it("rolls back HTML and display flags when the post-removal project gate fails", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const htmlPath = projectPath(projectRoot, page.htmlPath);
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const htmlBefore = readFileSync(htmlPath, "utf8");

    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        afterCommit({ relativePath }) {
          if (relativePath === manifestRelativePath) writeFileSync(htmlPath, htmlBefore);
        }
      }
    })).rejects.toThrow("disabled page equipment-ops-7c31fa must have zero PRD Annotator integrations");

    expect(readFileSync(htmlPath, "utf8")).toBe(htmlBefore);
    expect(readJson(manifestPath).pages[0].display.enabled).toBe(true);
  });

  it("makes multi-page removal all-or-nothing when a write fails mid-transaction", async () => {
    const projectRoot = copyFixture();
    await addSecondPage(projectRoot);
    const manifest = readJson(projectPath(projectRoot, manifestRelativePath));
    const snapshots = manifest.pages.map((page) => rawSnapshot(
      manifest,
      readJson(projectPath(projectRoot, page.annotationFile))
    ));
    const htmlBefore = new Map(manifest.pages.map((page) => [page.id, readFileSync(projectPath(projectRoot, page.htmlPath))]));

    await expect(removeProject({
      projectRoot,
      pageIds: manifest.pages.map((page) => page.id),
      snapshots,
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        afterCommit({ index }) {
          if (index === 0) throw new Error("injected removal write failure");
        }
      }
    })).rejects.toThrow("injected removal write failure");

    const installed = readJson(projectPath(projectRoot, manifestRelativePath));
    expect(installed.pages.map((page) => page.display.enabled)).toEqual([true, true]);
    for (const page of installed.pages) {
      expect(readFileSync(projectPath(projectRoot, page.htmlPath))).toEqual(htmlBefore.get(page.id));
      expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8"))).toHaveLength(1);
    }
  });

  it("persists a durable recovery journal for every target before the first destructive commit", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    let observedJournal;

    await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        async beforeCommit({ index }) {
          if (index !== 0) return;
          const recoveryDirectories = readdirSync(projectRoot)
            .filter((entry) => entry.startsWith(".prd-annotator-remove-"));
          expect(recoveryDirectories).toHaveLength(1);
          observedJournal = await readDurableRecoveryJournal(
            path.join(projectRoot, recoveryDirectories[0], "transaction.journal")
          );
        }
      }
    });

    expect(observedJournal).toMatchObject({
      schemaVersion: 1,
      generation: expect.any(Number),
      phase: "staged",
      parentDirectorySync: {
        status: expect.stringMatching(/^(?:synced|unsupported)$/)
      },
      targets: [
        {
          targetPath: page.htmlPath,
          backupPath: expect.stringMatching(/\/backup-0$/),
          newPath: expect.stringMatching(/\/new-0$/),
          expectedOriginal: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
          expectedReplacement: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }
        },
        {
          targetPath: manifestRelativePath,
          backupPath: expect.stringMatching(/\/backup-1$/),
          newPath: expect.stringMatching(/\/new-1$/),
          expectedOriginal: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
          expectedReplacement: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }
        }
      ]
    });
    if (observedJournal.parentDirectorySync.status === "unsupported") {
      expect(observedJournal.parentDirectorySync).toMatchObject({
        platform: process.platform,
        code: expect.any(String)
      });
    }
  });

  it("reads the last complete journal generation and rejects invalid complete generations", async () => {
    const projectRoot = copyFixture();
    const journalPath = path.join(projectRoot, "reader-test.journal");
    const first = { schemaVersion: 1, generation: 1, phase: "prepared", targets: [{ targetPath: "one" }] };
    const second = { schemaVersion: 1, generation: 2, phase: "staged", targets: [{ targetPath: "two" }] };
    writeFileSync(
      journalPath,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n{"schemaVersion":1,"generation":3`
    );

    await expect(readDurableRecoveryJournal(journalPath)).resolves.toEqual(second);

    writeFileSync(journalPath, `${JSON.stringify(first)}\nnot-json\n`);
    await expect(readDurableRecoveryJournal(journalPath))
      .rejects.toThrow("Invalid complete recovery journal generation 2");
  });

  it("retains a complete pre-commit recovery generation across every later journal fault boundary", async () => {
    const baselineRoot = copyFixture();
    const baseline = pageContext(baselineRoot);
    const boundaries = [];
    await removeProject({
      projectRoot: baselineRoot,
      pageIds: [baseline.page.id],
      snapshots: [rawSnapshot(baseline.manifest, baseline.document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        beforeJournalAppend({ generation, phase }) {
          boundaries.push({ generation, phase });
        }
      }
    });
    expect(boundaries[0]).toMatchObject({ generation: 1, phase: "prepared" });
    expect(boundaries.length).toBeGreaterThan(2);

    for (const mode of ["before-append", "torn-before-sync"]) {
      for (const boundary of boundaries.slice(1)) {
        const projectRoot = copyFixture();
        const { manifest, page, document } = pageContext(projectRoot);
        let caught;
        try {
          await removeProject({
            projectRoot,
            pageIds: [page.id],
            snapshots: [rawSnapshot(manifest, document)],
            confirmRemove: true,
            now: fixedNow,
            transactionHooks: {
              beforeJournalAppend({ generation }) {
                if (mode === "before-append" && generation === boundary.generation) {
                  throw new Error(`injected journal append crash ${generation}`);
                }
              },
              beforeJournalSync({ generation, journalPath, lineStart, lineLength }) {
                if (mode === "torn-before-sync" && generation === boundary.generation) {
                  truncateSync(journalPath, lineStart + Math.max(1, Math.floor(lineLength / 2)));
                  throw new Error(`injected torn journal write ${generation}`);
                }
              }
            }
          });
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        expect(caught.message).toContain("transaction journal update failed");
        expect(caught.recovery).toMatchObject({
          status: "retained",
          inventoryStatus: "known",
          journalPath: expect.stringMatching(/\/transaction\.journal$/)
        });
        const absoluteJournalPath = projectPath(projectRoot, caught.recovery.journalPath);
        const readable = await readDurableRecoveryJournal(absoluteJournalPath);
        expect(readable.generation, `${mode} at generation ${boundary.generation}`)
          .toBeLessThan(boundary.generation);
        expect(readable.targets).toHaveLength(2);
        for (const target of readable.targets) {
          expect(target).toMatchObject({
            targetPath: expect.any(String),
            backupPath: expect.any(String),
            newPath: expect.any(String),
            expectedOriginal: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
            expectedReplacement: { status: "file", sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }
          });
        }
        if (mode === "torn-before-sync") {
          expect(readFileSync(absoluteJournalPath, "utf8").endsWith("\n")).toBe(false);
        }
        for (const relativePath of caught.recovery.paths) {
          expect(lstatSync(projectPath(projectRoot, relativePath))).toBeTruthy();
        }
        expect(readJson(projectPath(projectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(true);
        expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8"))).toHaveLength(1);
      }
    }
  }, 30_000);

  it("retries rollback restoration and verifies every target after all writes were committed", async () => {
    const projectRoot = copyFixture();
    await addSecondPage(projectRoot);
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const manifest = readJson(manifestPath);
    const snapshots = manifest.pages.map((page) => rawSnapshot(
      manifest,
      readJson(projectPath(projectRoot, page.annotationFile))
    ));
    const htmlBefore = new Map(manifest.pages.map((page) => [page.id, readFileSync(projectPath(projectRoot, page.htmlPath))]));
    let injectedRollbackFailure = false;

    await expect(removeProject({
      projectRoot,
      pageIds: manifest.pages.map((page) => page.id),
      snapshots,
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        afterCommit({ relativePath }) {
          if (relativePath === manifestRelativePath) throw new Error("injected post-commit failure");
        },
        beforeRollback({ attempt, relativePath }) {
          if (!injectedRollbackFailure && attempt === 1 && relativePath === manifest.pages[0].htmlPath) {
            injectedRollbackFailure = true;
            throw new Error("injected transient rollback failure");
          }
        }
      }
    })).rejects.toThrow("injected post-commit failure");

    expect(injectedRollbackFailure).toBe(true);
    const installed = readJson(manifestPath);
    expect(installed.pages.map((page) => page.display.enabled)).toEqual([true, true]);
    for (const page of installed.pages) {
      expect(readFileSync(projectPath(projectRoot, page.htmlPath))).toEqual(htmlBefore.get(page.id));
      expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8"))).toHaveLength(1);
    }
    expect(readdirSync(projectRoot).filter((entry) => entry.startsWith(".prd-annotator-remove-"))).toEqual([]);
  });

  it("retains truthful recovery when an earlier restored target drifts while later rollback continues", async () => {
    const projectRoot = copyFixture();
    await addSecondPage(projectRoot);
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const manifest = readJson(manifestPath);
    const snapshots = manifest.pages.map((page) => rawSnapshot(
      manifest,
      readJson(projectPath(projectRoot, page.annotationFile))
    ));
    const htmlBefore = new Map(manifest.pages.map((page) => [
      page.id,
      readFileSync(projectPath(projectRoot, page.htmlPath))
    ]));
    let redrifted = false;
    let caught;

    try {
      await removeProject({
        projectRoot,
        pageIds: manifest.pages.map((page) => page.id),
        snapshots,
        confirmRemove: true,
        now: fixedNow,
        transactionHooks: {
          afterCommit({ relativePath }) {
            if (relativePath === manifestRelativePath) throw new Error("injected post-commit failure");
          },
          beforeRollback({ attempt, relativePath }) {
            if (!redrifted && attempt === 1 && relativePath === manifest.pages[1].htmlPath) {
              const restoredThenMutated = readJson(manifestPath);
              restoredThenMutated.nonCooperatingWriter = "mutated after earlier rollback";
              writeJson(manifestPath, restoredThenMutated);
              redrifted = true;
            }
          }
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(redrifted).toBe(true);
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/rollback incomplete; recovery retained/);
    expect(caught.recovery).toMatchObject({
      status: "retained",
      inventoryStatus: "known",
      journalPath: expect.stringMatching(/\.prd-annotator-remove-[^/]+\/transaction\.journal$/),
      paths: expect.arrayContaining([
        expect.stringMatching(/\/transaction\.journal$/),
        expect.stringMatching(/\/backup-2$/)
      ])
    });
    expect(readJson(manifestPath).nonCooperatingWriter).toBe("mutated after earlier rollback");
    for (const page of manifest.pages) {
      expect(readFileSync(projectPath(projectRoot, page.htmlPath))).toEqual(htmlBefore.get(page.id));
    }
    for (const relativePath of caught.recovery.paths) {
      expect(lstatSync(projectPath(projectRoot, relativePath)).isFile()).toBe(true);
    }
    const journal = await readDurableRecoveryJournal(projectPath(projectRoot, caught.recovery.journalPath));
    expect(Object.fromEntries(journal.targets.map((target) => [target.targetPath, target.transactionStatus])))
      .toEqual({
        [manifest.pages[0].htmlPath]: "original-verified",
        [manifest.pages[1].htmlPath]: "original-verified",
        [manifestRelativePath]: "drift-detected"
      });
  });

  it("refuses to overwrite concurrent HTML or manifest changes and rolls back prior target writes", async () => {
    const htmlProjectRoot = copyFixture();
    const htmlContext = pageContext(htmlProjectRoot);
    const htmlPath = projectPath(htmlProjectRoot, htmlContext.page.htmlPath);
    const concurrentHtml = readFileSync(htmlPath, "utf8").replace("<main>", "<meta name=\"concurrent-edit\">\n<main>");
    await expect(removeProject({
      projectRoot: htmlProjectRoot,
      pageIds: [htmlContext.page.id],
      snapshots: [rawSnapshot(htmlContext.manifest, htmlContext.document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        beforeCommit({ relativePath }) {
          if (relativePath === htmlContext.page.htmlPath) writeFileSync(htmlPath, concurrentHtml);
        }
      }
    })).rejects.toThrow(`${htmlContext.page.htmlPath} changed during display removal`);
    expect(readFileSync(htmlPath, "utf8")).toBe(concurrentHtml);
    expect(readJson(projectPath(htmlProjectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(true);

    const manifestProjectRoot = copyFixture();
    const manifestContext = pageContext(manifestProjectRoot);
    const manifestPath = projectPath(manifestProjectRoot, manifestRelativePath);
    const manifestHtmlBefore = readFileSync(projectPath(manifestProjectRoot, manifestContext.page.htmlPath));
    await expect(removeProject({
      projectRoot: manifestProjectRoot,
      pageIds: [manifestContext.page.id],
      snapshots: [rawSnapshot(manifestContext.manifest, manifestContext.document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        beforeCommit({ relativePath }) {
          if (relativePath !== manifestRelativePath) return;
          const concurrentManifest = readJson(manifestPath);
          concurrentManifest.migration = { source: "concurrent-edit" };
          writeJson(manifestPath, concurrentManifest);
        }
      }
    })).rejects.toThrow(`${manifestRelativePath} changed during display removal`);
    expect(readJson(manifestPath).migration).toEqual({ source: "concurrent-edit" });
    expect(readJson(manifestPath).pages[0].display.enabled).toBe(true);
    expect(readFileSync(projectPath(manifestProjectRoot, manifestContext.page.htmlPath))).toEqual(manifestHtmlBefore);
  });

  it("never clobbers a target recreated after its original was moved to backup", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const htmlPath = projectPath(projectRoot, page.htmlPath);
    const concurrentHtml = readFileSync(htmlPath, "utf8").replace("<main>", "<meta name=\"after-backup-edit\">\n<main>");

    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        afterBackup({ relativePath }) {
          if (relativePath === page.htmlPath) writeFileSync(htmlPath, concurrentHtml);
        }
      }
    })).rejects.toThrow(/rollback incomplete; recovery retained at/);

    expect(readFileSync(htmlPath, "utf8")).toBe(concurrentHtml);
    expect(readJson(projectPath(projectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(true);
    const recoveryDirectories = readdirSync(projectRoot).filter((entry) => entry.startsWith(".prd-annotator-remove-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(readdirSync(path.join(projectRoot, recoveryDirectories[0]))).toContain("backup-0");
    expect(readdirSync(path.join(projectRoot, recoveryDirectories[0]))).toContain("transaction.journal");
  });

  it("holds the project mutation lock through the post-removal gate", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const laterAnnotation = newAnnotation(document.annotations[0]);
    const laterDocument = { ...document, annotations: [...document.annotations, laterAnnotation] };
    let releaseCommit;
    let enteredCommit;
    const commitEntered = new Promise((resolve) => { enteredCommit = resolve; });
    const commitRelease = new Promise((resolve) => { releaseCommit = resolve; });
    let paused = false;
    const removalPromise = removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        async beforeCommit() {
          if (paused) return;
          paused = true;
          enteredCommit();
          await commitRelease;
        }
      }
    });
    await commitEntered;

    let mergeSettled = false;
    const mergePromise = mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot(manifest, laterDocument)
    }).finally(() => { mergeSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mergeSettled).toBe(false);

    releaseCommit();
    await expect(removalPromise).resolves.toMatchObject({ removedPages: [page.id] });
    await expect(mergePromise).resolves.toMatchObject({ annotations: expect.arrayContaining([
      expect.objectContaining({ id: "A002" })
    ]) });
    await refreshProject({ projectRoot, now: fixedNow });
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 2 });
  });

  it("rolls removal back when coordinated annotation and view bytes drift during the final gate", async () => {
    const donorRoot = copyFixture();
    const donorContext = pageContext(donorRoot);
    const donorDocument = {
      ...donorContext.document,
      annotations: [
        ...donorContext.document.annotations,
        newAnnotation(donorContext.document.annotations[0])
      ]
    };
    writeJson(projectPath(donorRoot, donorContext.page.annotationFile), donorDocument);
    await refreshProject({ projectRoot: donorRoot, now: fixedNow });
    const donorAnnotationBytes = readFileSync(projectPath(donorRoot, donorContext.page.annotationFile));
    const donorViewBytes = readFileSync(projectPath(donorRoot, donorContext.page.viewFile));

    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const htmlBefore = readFileSync(projectPath(projectRoot, page.htmlPath));
    await expect(removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        afterCommit({ relativePath }) {
          if (relativePath !== manifestRelativePath) return;
          writeFileSync(projectPath(projectRoot, page.annotationFile), donorAnnotationBytes);
          writeFileSync(projectPath(projectRoot, page.viewFile), donorViewBytes);
        }
      }
    })).rejects.toThrow(`${page.annotationFile} changed during final removal gate`);

    expect(readFileSync(projectPath(projectRoot, page.htmlPath))).toEqual(htmlBefore);
    expect(readJson(projectPath(projectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(true);
    expect(readJson(projectPath(projectRoot, page.annotationFile)).annotations.map((annotation) => annotation.id))
      .toEqual(["A001", "A002"]);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 2 });
  });

  it("inventories only actual surviving recovery paths after partial cleanup", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    let removedOneBackup = false;

    const result = await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      transactionHooks: {
        beforeCleanup({ stagingRoot }) {
          if (!removedOneBackup) {
            rmSync(path.join(stagingRoot, "backup-0"), { force: true });
            removedOneBackup = true;
          }
          throw new Error("injected partial cleanup failure");
        }
      }
    });

    expect(removedOneBackup).toBe(true);
    expect(result.recovery).toMatchObject({
      status: "retained",
      inventoryStatus: "known",
      journalPath: expect.stringMatching(/\/transaction\.journal$/),
      paths: expect.arrayContaining([
        expect.stringMatching(/\/transaction\.journal$/),
        expect.stringMatching(/\/backup-1$/)
      ])
    });
    expect(result.recovery.paths).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/backup-0$/)
    ]));
    for (const relativePath of result.recovery.paths) {
      expect(lstatSync(projectPath(projectRoot, relativePath)).isFile()).toBe(true);
    }
    const retainedChangedFiles = result.changedFiles.filter((relativePath) => relativePath.startsWith(".prd-annotator-remove-"));
    expect(retainedChangedFiles).toEqual(result.recovery.paths);
    const journal = await readDurableRecoveryJournal(projectPath(projectRoot, result.recovery.journalPath));
    expect(journal.phase).toBe("cleanup-incomplete");
  });

  it("reports inventory unknown with an actual journal instead of fabricating recovery paths", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const warnings = [];

    const result = await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow,
      onWarning: (warning) => warnings.push(warning),
      transactionHooks: {
        beforeCleanup() {
          throw new Error("injected cleanup failure");
        },
        beforeRecoveryInventory() {
          throw new Error("injected recovery inventory failure");
        }
      }
    });

    expect(result.removedPages).toEqual([page.id]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/Failed to clean removal staging directory: .*\.prd-annotator-remove-/);
    expect(warnings[1]).toMatch(/Recovery inventory unknown: .*injected recovery inventory failure/);
    expect(result.recovery).toMatchObject({
      status: "retained",
      inventoryStatus: "unknown",
      journalPath: expect.stringMatching(/\/transaction\.journal$/),
      paths: [expect.stringMatching(/\/transaction\.journal$/)],
      inventoryError: expect.stringContaining("injected recovery inventory failure")
    });
    const retainedFiles = result.changedFiles.filter((relativePath) => relativePath.startsWith(".prd-annotator-remove-"));
    expect(retainedFiles).toEqual(result.recovery.paths);
    for (const relativePath of retainedFiles) {
      expect(lstatSync(projectPath(projectRoot, relativePath)).isFile()).toBe(true);
    }
    const journal = await readDurableRecoveryJournal(projectPath(projectRoot, result.recovery.journalPath));
    expect(journal.phase).toBe("cleanup-incomplete");
    expect(journal.recoveryInventory).toMatchObject({
      status: "unknown",
      error: expect.stringContaining("injected recovery inventory failure")
    });
    expect(readJson(projectPath(projectRoot, manifestRelativePath)).pages[0].display.enabled).toBe(false);
    expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8"))).toHaveLength(0);
  });

  it("removes only the real integration while preserving inert-context script text byte-for-byte", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const htmlPath = projectPath(projectRoot, page.htmlPath);
    const original = readFileSync(htmlPath, "utf8");
    const [integration] = inspectIntegration(original);
    const inert = [
      `<!-- ${integration.raw} -->`,
      `<template>${integration.raw}</template>`,
      `<textarea>${integration.raw}</textarea>`,
      `<script type="application/json">${integration.raw}</script>`
    ].join("\n");
    writeFileSync(htmlPath, original.replace("<main>", `${inert}\n<main>`));

    await removeProject({
      projectRoot,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow
    });

    const after = readFileSync(htmlPath, "utf8");
    expect(inspectIntegration(after)).toHaveLength(0);
    expect(after).toContain(inert);
    expect(after).toBe(removeIntegration(original.replace("<main>", `${inert}\n<main>`)));
  });

  it("rejects project-root and target paths that traverse symlinks", async () => {
    const projectRoot = copyFixture();
    const aliasParent = mkdtempSync(path.join(os.tmpdir(), "prd-annotator-remove-link-"));
    temporaryDirectories.push(aliasParent);
    const alias = path.join(aliasParent, "project-link");
    try {
      symlinkSync(projectRoot, alias, "junction");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    expect(lstatSync(alias).isSymbolicLink()).toBe(true);
    const { manifest, page, document } = pageContext(projectRoot);

    await expect(removeProject({
      projectRoot: alias,
      pageIds: [page.id],
      snapshots: [rawSnapshot(manifest, document)],
      confirmRemove: true,
      now: fixedNow
    })).rejects.toThrow(/Unsafe manifest ancestor: project root|projectRoot must be a non-symlink directory/);
  });
});

describe("display removal CLI", () => {
  it("uses strict arguments and literal confirmation with exact stdout/stderr ownership", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const snapshotPath = path.join(projectRoot, "snapshot.json");
    writeJson(snapshotPath, rawSnapshot(manifest, document));

    for (const argv of [
      [],
      ["--project-root", projectRoot, "--confirm-remove=true", "--page", page.id, "--snapshot", snapshotPath],
      ["--project-root", projectRoot, "--confirm-remove", "--unknown", "value"],
      ["--project-root", projectRoot, "--project-root", projectRoot, "--confirm-remove", "--page", page.id]
    ]) {
      const stdout = memoryStream();
      const stderr = memoryStream();
      expect(await runRemoveProjectCli({ argv, stdout: stdout.stream, stderr: stderr.stream, now: fixedNow })).toBe(1);
      expect(stdout.read()).toBe("");
      expect(stderr.read()).toMatch(/^Usage: remove-project\.mjs/);
    }

    const stdout = memoryStream();
    const stderr = memoryStream();
    expect(await runRemoveProjectCli({
      argv: ["--project-root", projectRoot, "--page", page.id, "--snapshot", snapshotPath],
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: fixedNow
    })).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe("--confirm-remove is required\n");
  });

  it("prints the actionable five-step copy/paste flow when a current snapshot is missing", async () => {
    const projectRoot = copyFixture();
    const { page } = pageContext(projectRoot);
    const stdout = memoryStream();
    const stderr = memoryStream();

    expect(await runRemoveProjectCli({
      argv: ["--project-root", projectRoot, "--confirm-remove", "--page", page.id],
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: fixedNow
    })).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain(`Current annotation snapshot is required for ${page.id}`);
    expect(stderr.read()).toMatch(/1\.[\s\S]*2\.[\s\S]*3\.[\s\S]*4\.[\s\S]*5\./);
    expect(stderr.read()).toContain("window.PRDAnnotator.getSnapshot()");
    expect(stderr.read()).toContain("--snapshot PATH");
  });

  it("prints deterministic structured recovery JSON after a human-readable CLI failure", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const snapshotPath = path.join(projectRoot, "failure-snapshot.json");
    writeJson(snapshotPath, rawSnapshot(manifest, document));
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const stdout = memoryStream();
    const stderr = memoryStream();
    let stagingRoot;
    let redrifted = false;

    expect(await runRemoveProjectCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-remove",
        "--page", page.id,
        "--snapshot", snapshotPath
      ],
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: fixedNow,
      transactionHooks: {
        afterCommit({ relativePath }) {
          if (relativePath === manifestRelativePath) throw new Error("injected CLI recovery failure");
        },
        beforeRollback({ attempt, relativePath }) {
          if (!redrifted && attempt === 1 && relativePath === page.htmlPath) {
            const restoredThenMutated = readJson(manifestPath);
            restoredThenMutated.nonCooperatingWriter = "CLI redrift";
            writeJson(manifestPath, restoredThenMutated);
            redrifted = true;
          }
        },
        beforeRecoveryInventory(context) {
          stagingRoot = context.stagingRoot;
        }
      }
    })).toBe(1);

    expect(stdout.read()).toBe("");
    expect(redrifted).toBe(true);
    const stagingRelative = path.relative(projectRoot, stagingRoot).split(path.sep).join("/");
    const recovery = {
      status: "retained",
      inventoryStatus: "known",
      journalPath: `${stagingRelative}/transaction.journal`,
      paths: [
        `${stagingRelative}/backup-0`,
        `${stagingRelative}/backup-0.failed-new-1`,
        `${stagingRelative}/backup-1`,
        `${stagingRelative}/backup-1.failed-new-1`,
        `${stagingRelative}/transaction.journal`
      ]
    };
    expect(stderr.read()).toBe([
      `injected CLI recovery failure; rollback incomplete; recovery retained at ${stagingRoot}: ${manifestRelativePath}: original bytes drifted`,
      JSON.stringify(recovery, null, 2),
      ""
    ].join("\n"));
  });

  it("reads repeated snapshot files, matches identities rather than order, and emits only result JSON", async () => {
    const projectRoot = copyFixture();
    await addSecondPage(projectRoot);
    const manifest = readJson(projectPath(projectRoot, manifestRelativePath));
    const [firstPage, secondPage] = manifest.pages;
    const firstSnapshotPath = path.join(projectRoot, "first-snapshot.json");
    const secondSnapshotPath = path.join(projectRoot, "second-snapshot.json");
    writeJson(firstSnapshotPath, rawSnapshot(manifest, readJson(projectPath(projectRoot, firstPage.annotationFile))));
    writeJson(secondSnapshotPath, promptSnapshot(
      manifest,
      secondPage,
      readJson(projectPath(projectRoot, secondPage.annotationFile))
    ));
    const stdout = memoryStream();
    const stderr = memoryStream();

    expect(await runRemoveProjectCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-remove",
        "--page", firstPage.id,
        "--page", secondPage.id,
        "--snapshot", secondSnapshotPath,
        "--snapshot", firstSnapshotPath
      ],
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: fixedNow
    })).toBe(0);
    expect(stderr.read()).toBe("");
    expect(JSON.parse(stdout.read())).toMatchObject({ removedPages: [firstPage.id, secondPage.id] });
  });

  it("rejects symbolic-link snapshot files without writing the project", async () => {
    const projectRoot = copyFixture();
    const { manifest, page, document } = pageContext(projectRoot);
    const realSnapshot = path.join(projectRoot, "snapshot-real.json");
    const linkedSnapshot = path.join(projectRoot, "snapshot-link.json");
    writeJson(realSnapshot, rawSnapshot(manifest, document));
    try {
      symlinkSync(realSnapshot, linkedSnapshot, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    const before = snapshotFiles(projectRoot);
    const stdout = memoryStream();
    const stderr = memoryStream();

    expect(await runRemoveProjectCli({
      argv: [
        "--project-root", projectRoot,
        "--confirm-remove",
        "--page", page.id,
        "--snapshot", linkedSnapshot
      ],
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: fixedNow
    })).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toBe("Invalid snapshot file\n");
    expect(snapshotFiles(projectRoot)).toEqual(before);
    expect(existsSync(linkedSnapshot)).toBe(true);
  });
});
