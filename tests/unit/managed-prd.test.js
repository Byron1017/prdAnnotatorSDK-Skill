import { createHash } from "node:crypto";
import { mkdtemp, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import { refreshProject } from "../../prd-annotator-skill/scripts/refresh-project.mjs";
import {
  generateManagedPrd,
  runGeneratePrdCli
} from "../../prd-annotator-skill/scripts/generate-prd.mjs";
import {
  renderManagedPagePrd,
  renderManagedTotalPrd
} from "../../prd-annotator-skill/scripts/lib/managed-prd.mjs";
import { discoverDocuments } from "../../prd-annotator-skill/scripts/lib/documents.mjs";
import {
  applyProjectTransaction,
  makeProjectOperation
} from "../../prd-annotator-skill/scripts/lib/project-transaction.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const temporaryDirectories = [];
const fixedNow = new Date("2026-08-09T04:00:00.000Z");

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
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function copyFixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "managed-prd-test-"));
  temporaryDirectories.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  return projectRoot;
}

async function snapshotProject(projectRoot) {
  const result = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) result[path.relative(projectRoot, absolutePath).split(path.sep).join("/")] = await readFile(absolutePath);
    }
  }
  await visit(projectRoot);
  return result;
}

function expectOnlyExternalSnapshotChange(actual, expected, relativePath, externalBytes) {
  expect(Object.keys(actual).sort()).toEqual([...new Set([...Object.keys(expected), relativePath])].sort());
  for (const filePath of Object.keys(expected)) {
    expect(actual[filePath]).toEqual(filePath === relativePath ? externalBytes : expected[filePath]);
  }
  expect(actual[relativePath]).toEqual(externalBytes);
}

async function seedManagedSource(projectRoot, managedPrd = {
  title: "Equipment Operations",
  sections: [
    { id: "goal", title: "Goal", blocks: ["Keep device operations safe."] },
    { id: "requirements", title: "Requirements", blocks: ["- Batch disable requires confirmation."] }
  ]
}) {
  const annotationPath = projectPath(projectRoot, ".prd-annotator/data/pages/equipment-ops-7c31fa.json");
  const annotation = await readJson(annotationPath);
  annotation.managedPrd = managedPrd;
  await writeJson(annotationPath, annotation);
  return annotation;
}

function captureStream() {
  let value = "";
  return { write(chunk) { value += chunk; }, value: () => value };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function replaceWithDiscoveredDocuments(projectRoot, sources) {
  await rm(projectPath(projectRoot, "doc/prd"), { recursive: true, force: true });
  for (const [relativePath, source] of Object.entries(sources)) {
    const absolutePath = projectPath(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source, "utf8");
  }
  const documents = await discoverDocuments({ projectRoot, existingDocuments: [] });
  const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.documents = documents;
  await writeJson(manifestPath, manifest);
  const annotationPath = projectPath(projectRoot, manifest.pages[0].annotationFile);
  const annotation = await readJson(annotationPath);
  annotation.annotations[0].prd.linkedDocuments = [];
  await writeJson(annotationPath, annotation);
  return documents;
}

describe("deterministic managed PRD rendering", () => {
  it("regenerates page Markdown byte-for-byte from page JSON with LF and one trailing newline", () => {
    const markdown = renderManagedPagePrd({
      managedPrd: {
        title: "Equipment Operations",
        sections: [
          { id: "goal", title: "Goal", blocks: ["Keep device operations safe.\r\nAlways confirm."] },
          { id: "requirements", title: "Requirements", blocks: ["- Batch disable requires confirmation.\r\n"] }
        ]
      }
    });
    expect(markdown).toBe(
      "# Equipment Operations\n\n"
      + "## Goal\n\nKeep device operations safe.\nAlways confirm.\n\n"
      + "## Requirements\n\n- Batch disable requires confirmation.\n"
    );
  });

  it("renders empty section collections without extra trailing blank lines", () => {
    expect(renderManagedPagePrd({ managedPrd: { title: "Empty", sections: [] } })).toBe("# Empty\n");
    expect(renderManagedTotalPrd({ pages: [] }, "doc/prd/PRD.md"))
      .toBe("# Product Requirements\n\n## Page index\n");
  });

  it("escapes Markdown labels and normalizes every page link relative to the total file", () => {
    const manifest = {
      pages: [
        { id: "a", title: "A [primary] *fast*", managedPrdFile: "requirements/pages/a.md" },
        { id: "b", title: "B \\ backup", managedPrdFile: "doc/prd/pages/b.md" }
      ]
    };
    expect(renderManagedTotalPrd(manifest, "requirements/index/PRD.md")).toBe(
      "# Product Requirements\n\n## Page index\n\n"
      + "- [A \\[primary\\] \\*fast\\*](../pages/a.md)\n"
      + "- [B \\\\ backup](../../doc/prd/pages/b.md)\n"
    );
    expect(renderManagedPagePrd({
      managedPrd: { title: "Ops *critical*", sections: [{ id: "goal", title: "Goal _one_", blocks: [] }] }
    })).toBe("# Ops \\*critical\\*\n\n## Goal \\_one\\_\n");
  });

  it.each([
    [null, "managedPrd must be an object"],
    [{ managedPrd: null }, "managedPrd must be an object"],
    [{ managedPrd: { title: "", sections: [] } }, "managedPrd.title must be a non-empty string"],
    [{ managedPrd: { title: "Bad\nHeading", sections: [] } }, "managedPrd.title must be a single line"],
    [{ managedPrd: { title: "T", sections: [{ id: "x", title: "X", blocks: [""] }] } }, "blocks must contain non-empty strings"],
    [{ managedPrd: { title: "T", sections: [{ id: "x", title: "X", blocks: [] }, { id: "x", title: "Y", blocks: [] }] } }, "duplicate section id x"]
  ])("rejects invalid managed structures %#", (document, message) => {
    expect(() => renderManagedPagePrd(document)).toThrow(message);
  });

  it("requires a managed path for every page in a total PRD", () => {
    expect(() => renderManagedTotalPrd({ pages: [{ id: "a", title: "A" }] }, "doc/prd/PRD.md"))
      .toThrow("page a must define managedPrdFile");
  });
});

describe("explicit managed PRD generation", () => {
  it.each([false, null, undefined, 1, "true", new Boolean(true)])("requires literal Boolean consent for %#", async (confirmPrdWrite) => {
    const projectRoot = await copyFixture();
    const before = await readFile(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    await expect(generateManagedPrd({ projectRoot, pageIds: ["equipment-ops-7c31fa"], confirmPrdWrite }))
      .rejects.toThrow("--confirm-prd-write is required");
    expect(await readFile(projectPath(projectRoot, ".prd-annotator/manifest.json"))).toEqual(before);
  });

  it("creates only new managed page paths, keeps external documents unchanged, refreshes views, and passes the gate", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const beforeManifest = await readJson(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    const externalDocuments = structuredClone(beforeManifest.documents);
    const externalPageBytes = await readFile(projectPath(projectRoot, "doc/prd/pages/equipment-ops.md"));
    const changed = await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    });

    expect(changed).toEqual(["doc/prd/pages/equipment-ops-7c31fa.md"]);
    const manifest = await readJson(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    expect(manifest.pages[0].managedPrdFile).toBe("doc/prd/pages/equipment-ops-7c31fa.md");
    expect(manifest.documents.slice(0, externalDocuments.length)).toEqual(externalDocuments);
    expect(manifest.documents.find((entry) => entry.path === "doc/prd/pages/equipment-ops-7c31fa.md"))
      .toMatchObject({ kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], managed: true });
    expect(await readFile(projectPath(projectRoot, "doc/prd/pages/equipment-ops.md"))).toEqual(externalPageBytes);
    expect(await readFile(projectPath(projectRoot, manifest.pages[0].managedPrdFile), "utf8"))
      .toBe(renderManagedPagePrd(await readJson(projectPath(projectRoot, manifest.pages[0].annotationFile))));
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1 });
  });

  it("creates a managed page and total under an explicit root and gates every relative page link", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const changed = await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      documentRoot: "managed/specs",
      confirmPrdWrite: true,
      now: fixedNow
    });
    expect(changed).toEqual([
      "managed/specs/PRD.md",
      "managed/specs/pages/equipment-ops-7c31fa.md"
    ]);
    const manifest = await readJson(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    expect(manifest.managedTotalPrdFile).toBe("managed/specs/PRD.md");
    expect(await readFile(projectPath(projectRoot, manifest.managedTotalPrdFile), "utf8"))
      .toBe("# Product Requirements\n\n## Page index\n\n- [Equipment Operations](pages/equipment-ops-7c31fa.md)\n");
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, documents: 4 });
  });

  it("preserves managed provenance through a normal document refresh", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    });
    const refreshed = await refreshProject({
      projectRoot,
      now: new Date("2026-08-09T05:00:00.000Z")
    });
    expect(refreshed.documents.find((entry) => entry.path === "doc/prd/pages/equipment-ops-7c31fa.md").managed)
      .toBe(true);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, documents: 3 });
  });

  it("never overwrites an external total PRD when the inferred target collides", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const externalPath = projectPath(projectRoot, "doc/prd/PRD.md");
    const before = await readFile(externalPath);
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      confirmPrdWrite: true
    })).rejects.toThrow("Refusing to overwrite external document: doc/prd/PRD.md");
    expect(await readFile(externalPath)).toEqual(before);
  });

  it("does not trust a managed path field that points at an external inventory entry", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.pages[0].managedPrdFile = "doc/prd/pages/equipment-ops.md";
    await writeJson(manifestPath, manifest);
    const externalPath = projectPath(projectRoot, "doc/prd/pages/equipment-ops.md");
    const before = await readFile(externalPath);
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    })).rejects.toThrow("Refusing to overwrite external document: doc/prd/pages/equipment-ops.md");
    expect(await readFile(externalPath)).toEqual(before);
  });

  it("defaults to doc/prd when no plausible document root exists", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.documents = [];
    await writeJson(manifestPath, manifest);
    const annotationPath = projectPath(projectRoot, ".prd-annotator/data/pages/equipment-ops-7c31fa.json");
    const annotation = await readJson(annotationPath);
    annotation.annotations[0].prd.linkedDocuments = [];
    await writeJson(annotationPath, annotation);
    await rm(projectPath(projectRoot, "doc/prd"), { recursive: true });
    expect(await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    })).toEqual(["doc/prd/pages/equipment-ops-7c31fa.md"]);
  });

  it("rejects multiple roots backed by explicit ambiguous-PRD evidence", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const documents = await replaceWithDiscoveredDocuments(projectRoot, {
      "docs/foo-prd.md": "# Foo PRD\n\nFeature requirements.\n",
      "requirements/bar-prd.md": "# Bar PRD\n\nAcceptance criteria.\n"
    });
    expect(documents.map(({ kind, evidence }) => ({ kind, evidence }))).toEqual([
      { kind: "unclassified", evidence: expect.arrayContaining(["path or content contains ambiguous PRD evidence"]) },
      { kind: "unclassified", evidence: expect.arrayContaining(["path or content contains ambiguous PRD evidence"]) }
    ]);

    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    })).rejects.toThrow("Multiple document roots are plausible: docs, requirements");
  });

  it("uses the sole root backed by explicit ambiguous-PRD evidence", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    await replaceWithDiscoveredDocuments(projectRoot, {
      "docs/foo-prd.md": "# Foo PRD\n\nFeature requirements.\n"
    });

    expect(await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    })).toEqual(["docs/pages/equipment-ops-7c31fa.md"]);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, documents: 2 });
  });

  it("does not infer a PRD root from ordinary requirement evidence", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const [document] = await replaceWithDiscoveredDocuments(projectRoot, {
      "requirements/shipping-rules.md": "# Shipping requirements\n\nDelivery rules and acceptance criteria.\n"
    });
    expect(document).toMatchObject({ kind: "requirement" });
    expect(document.evidence).toContain("path or content contains requirement/rule evidence");

    expect(await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      now: fixedNow
    })).toEqual(["doc/prd/pages/equipment-ops-7c31fa.md"]);
  });

  it("honors an explicit document root when ambiguous PRDs span several roots", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    await replaceWithDiscoveredDocuments(projectRoot, {
      "docs/foo-prd.md": "# Foo PRD\n\nFeature requirements.\n",
      "requirements/bar-prd.md": "# Bar PRD\n\nAcceptance criteria.\n"
    });

    expect(await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      documentRoot: "chosen",
      confirmPrdWrite: true,
      now: fixedNow
    })).toEqual(["chosen/pages/equipment-ops-7c31fa.md"]);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, documents: 3 });
  });

  it("uses a sole root-level PRD candidate as document root with exact page and total links", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const rootSource = "# Existing root page PRD\n";
    await writeFile(projectPath(projectRoot, "legacy-page.md"), rootSource, "utf8");
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    const rootEntry = {
      ...manifest.documents.find((entry) => entry.kind === "page-prd"),
      path: "legacy-page.md",
      fingerprint: `sha256:${sha256(rootSource)}`,
      pageIds: ["equipment-ops-7c31fa"]
    };
    manifest.documents = [rootEntry];
    await writeJson(manifestPath, manifest);
    const annotationPath = projectPath(projectRoot, manifest.pages[0].annotationFile);
    const annotation = await readJson(annotationPath);
    annotation.annotations[0].prd.linkedDocuments = [rootEntry.id];
    await writeJson(annotationPath, annotation);
    await rm(projectPath(projectRoot, "doc/prd"), { recursive: true });
    const rootBefore = await readFile(projectPath(projectRoot, "legacy-page.md"));

    const changed = await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      confirmPrdWrite: true,
      now: fixedNow
    });

    expect(changed).toEqual(["PRD.md", "pages/equipment-ops-7c31fa.md"]);
    const generatedManifest = await readJson(manifestPath);
    expect(generatedManifest.pages[0].managedPrdFile).toBe("pages/equipment-ops-7c31fa.md");
    expect(generatedManifest.managedTotalPrdFile).toBe("PRD.md");
    expect(await readFile(projectPath(projectRoot, "PRD.md"), "utf8")).toBe(
      "# Product Requirements\n\n## Page index\n\n- [Equipment Operations](pages/equipment-ops-7c31fa.md)\n"
    );
    expect(await readFile(projectPath(projectRoot, "legacy-page.md"))).toEqual(rootBefore);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, documents: 3 });
  });

  it("treats multiple roots including the project root as ambiguous", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const rootSource = "# Root PRD\n";
    await writeFile(projectPath(projectRoot, "root-prd.md"), rootSource, "utf8");
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.documents.push({
      ...manifest.documents[0],
      id: "doc-root-prd",
      path: "root-prd.md",
      fingerprint: `sha256:${sha256(rootSource)}`
    });
    await writeJson(manifestPath, manifest);

    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true
    })).rejects.toThrow("Multiple document roots are plausible: ., doc/prd");
  });

  it("refuses an external collision at an inferred root-level total path", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const externalSource = "# External root PRD\n";
    await writeFile(projectPath(projectRoot, "PRD.md"), externalSource, "utf8");
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.documents = [{
      ...manifest.documents[0],
      path: "PRD.md",
      fingerprint: `sha256:${sha256(externalSource)}`
    }];
    await writeJson(manifestPath, manifest);

    await expect(generateManagedPrd({
      projectRoot,
      total: true,
      confirmPrdWrite: true
    })).rejects.toThrow("Refusing to overwrite external document: PRD.md");
    expect(await readFile(projectPath(projectRoot, "PRD.md"), "utf8")).toBe(externalSource);
  });

  it("stops on multiple plausible roots and lists every sorted candidate", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.documents.push({ ...manifest.documents[0], id: "doc-other-total", path: "requirements/PRD.md" });
    await writeJson(manifestPath, manifest);
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true
    })).rejects.toThrow("Multiple document roots are plausible: doc/prd, requirements");
  });

  it.each(["../outside", "/absolute", "C:/outside", "https://example.test/prd", "doc\\prd", "doc/../prd"])(
    "rejects unsafe explicit document root %s",
    async (documentRoot) => {
      const projectRoot = await copyFixture();
      await seedManagedSource(projectRoot);
      await expect(generateManagedPrd({
        projectRoot,
        pageIds: ["equipment-ops-7c31fa"],
        documentRoot,
        confirmPrdWrite: true
      })).rejects.toThrow("Invalid documentRoot");
    }
  );

  it("rejects a symlink ancestor for an explicit document root", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const outside = await mkdtemp(path.join(tmpdir(), "managed-prd-outside-"));
    temporaryDirectories.push(outside);
    try {
      await symlink(outside, projectPath(projectRoot, "linked-docs"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return;
      throw error;
    }
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      documentRoot: "linked-docs/prd",
      confirmPrdWrite: true
    })).rejects.toThrow("Unsafe documentRoot ancestor: linked-docs");
  });

  it("rolls back every target when a partial commit fails", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    const beforeManifest = await readFile(manifestPath);
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      transactionHooks: { afterCommit({ index }) { if (index === 1) throw new Error("injected write failure"); } }
    })).rejects.toThrow("injected write failure");
    expect(await readFile(manifestPath)).toEqual(beforeManifest);
    await expect(readFile(projectPath(projectRoot, "doc/prd/pages/equipment-ops-7c31fa.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a later new managed target created after planning proved it missing", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const firstRelativePath = "managed/specs/pages/equipment-ops-7c31fa.md";
    const externalRelativePath = "managed/specs/PRD.md";
    const externalPath = projectPath(projectRoot, externalRelativePath);
    const externalBytes = Buffer.from("# External total created before preparation\n");
    const before = await snapshotProject(projectRoot);

    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      documentRoot: "managed/specs",
      confirmPrdWrite: true,
      now: fixedNow,
      transactionHooks: {
        async afterOriginalRead({ relativePath }) {
          if (relativePath !== firstRelativePath) return;
          await mkdir(path.dirname(externalPath), { recursive: true });
          await writeFile(externalPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Expected before image mismatch: ${externalRelativePath}`);

    expectOnlyExternalSnapshotChange(await snapshotProject(projectRoot), before, externalRelativePath, externalBytes);
  });

  it("rejects existing managed-PRD drift between regeneration planning and later target preparation", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    await generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      documentRoot: "managed/specs",
      confirmPrdWrite: true,
      now: fixedNow
    });
    const firstRelativePath = "managed/specs/pages/equipment-ops-7c31fa.md";
    const externalRelativePath = "managed/specs/PRD.md";
    const externalPath = projectPath(projectRoot, externalRelativePath);
    const externalBytes = Buffer.from("# External managed total drift\r\n");
    const before = await snapshotProject(projectRoot);

    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      total: true,
      documentRoot: "managed/specs",
      confirmPrdWrite: true,
      now: new Date("2026-08-10T04:00:00.000Z"),
      transactionHooks: {
        async afterOriginalRead({ relativePath }) {
          if (relativePath === firstRelativePath) await writeFile(externalPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Expected before image mismatch: ${externalRelativePath}`);

    expectOnlyExternalSnapshotChange(await snapshotProject(projectRoot), before, externalRelativePath, externalBytes);
  });

  it.each(["view", "manifest"])("rejects %s drift after managed-PRD planning but before later target preparation", async (label) => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifest = await readJson(projectPath(projectRoot, ".prd-annotator/manifest.json"));
    const firstRelativePath = "managed/specs/pages/equipment-ops-7c31fa.md";
    const relativePath = label === "view" ? manifest.pages[0].viewFile : ".prd-annotator/manifest.json";
    const targetPath = projectPath(projectRoot, relativePath);
    const externalBytes = Buffer.from(`external managed ${label} drift\r\n`);
    const before = await snapshotProject(projectRoot);

    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      documentRoot: "managed/specs",
      confirmPrdWrite: true,
      now: fixedNow,
      transactionHooks: {
        async afterOriginalRead({ relativePath: preparedPath }) {
          if (preparedPath === firstRelativePath) await writeFile(targetPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Expected before image mismatch: ${relativePath}`);

    expectOnlyExternalSnapshotChange(await snapshotProject(projectRoot), before, relativePath, externalBytes);
  });

  it("retains truthful recovery metadata when rollback itself cannot finish", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    let failure;
    try {
      await generateManagedPrd({
        projectRoot,
        pageIds: ["equipment-ops-7c31fa"],
        confirmPrdWrite: true,
        transactionHooks: {
          afterCommit({ index }) { if (index === 1) throw new Error("injected commit failure"); },
          beforeRollbackOperation() { throw new Error("injected rollback failure"); }
        }
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toContain("recovery retained at");
    const recoveryRoot = failure.message.split("recovery retained at ")[1];
    const recovery = await readJson(path.join(recoveryRoot, "recovery.json"));
    expect(recovery).toMatchObject({
      error: "injected commit failure",
      rollbackError: "injected rollback failure"
    });
    expect(recovery.targets.length).toBeGreaterThan(0);
  });

  it("preserves a non-cooperating edit made during rollback and records every surviving state", async () => {
    const projectRoot = await copyFixture();
    const firstPath = projectPath(projectRoot, "rollback/first.txt");
    const secondPath = projectPath(projectRoot, "rollback/second.txt");
    await mkdir(path.dirname(firstPath), { recursive: true });
    await writeFile(firstPath, "original first\n", "utf8");
    await writeFile(secondPath, "original second\n", "utf8");
    let failure;
    try {
      await applyProjectTransaction({
        projectRoot,
        operations: [
          makeProjectOperation(projectRoot, "rollback/first.txt", "committed first\n"),
          makeProjectOperation(projectRoot, "rollback/second.txt", "committed second\n")
        ],
        verify: async () => { throw new Error("injected verification failure"); },
        transactionHooks: {
          async beforeRollbackOperation({ relativePath }) {
            if (relativePath === "rollback/first.txt") {
              await writeFile(firstPath, "external first\n", "utf8");
            }
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("recovery retained at");
    expect(await readFile(firstPath, "utf8")).toBe("external first\n");
    expect(await readFile(secondPath, "utf8")).toBe("original second\n");
    const recoveryRoot = failure.message.split("recovery retained at ")[1];
    const recovery = await readJson(path.join(recoveryRoot, "recovery.json"));
    const first = recovery.targets.find((target) => target.relativePath === "rollback/first.txt");
    const second = recovery.targets.find((target) => target.relativePath === "rollback/second.txt");
    expect(first).toMatchObject({
      rollback: "preserved-current",
      original: { type: "file", sha256: sha256("original first\n") },
      committed: { type: "file", sha256: sha256("committed first\n") },
      current: { type: "file", sha256: sha256("external first\n") },
      survivingPaths: {
        target: firstPath,
        original: path.join(recoveryRoot, "backup-0"),
        committed: path.join(recoveryRoot, "committed-0")
      }
    });
    expect(second).toMatchObject({
      rollback: "restored-original",
      original: { type: "file", sha256: sha256("original second\n") },
      committed: { type: "file", sha256: sha256("committed second\n") },
      current: { type: "file", sha256: sha256("original second\n") },
      survivingPaths: { target: secondPath }
    });
  });

  it("preserves an edit swapped in after the rollback state check without following or overwriting it", async () => {
    const projectRoot = await copyFixture();
    const targetPath = projectPath(projectRoot, "rollback-race/target.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "original bytes\n", "utf8");
    let failure;
    try {
      await applyProjectTransaction({
        projectRoot,
        operations: [makeProjectOperation(projectRoot, "rollback-race/target.txt", "committed bytes\n")],
        verify: async () => { throw new Error("injected verification failure"); },
        transactionHooks: {
          async beforeRollbackCommit() {
            await writeFile(targetPath, "late external bytes\n", "utf8");
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("recovery retained at");
    expect(await readFile(targetPath, "utf8")).toBe("late external bytes\n");
    const recoveryRoot = failure.message.split("recovery retained at ")[1];
    const recovery = await readJson(path.join(recoveryRoot, "recovery.json"));
    expect(recovery.targets[0]).toMatchObject({
      relativePath: "rollback-race/target.txt",
      rollback: "preserved-current",
      original: { type: "file", sha256: sha256("original bytes\n") },
      committed: { type: "file", sha256: sha256("committed bytes\n") },
      current: { type: "file", sha256: sha256("late external bytes\n") },
      displaced: { type: "file", sha256: sha256("late external bytes\n") },
      survivingPaths: {
        target: targetPath,
        displaced: path.join(recoveryRoot, "rollback-current-0")
      }
    });
    expect(await readFile(recovery.targets[0].survivingPaths.displaced, "utf8")).toBe("late external bytes\n");
  });

  it("quarantines a symlink swapped in after the rollback state check without touching its referent", async (context) => {
    const projectRoot = await copyFixture();
    const targetPath = projectPath(projectRoot, "rollback-symlink-race/target.txt");
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "rollback-symlink-outside-"));
    temporaryDirectories.push(outsideRoot);
    const outsidePath = path.join(outsideRoot, "external.txt");
    const probePath = projectPath(projectRoot, "rollback-symlink-race/probe.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "original bytes\n", "utf8");
    await writeFile(outsidePath, "external bytes\n", "utf8");
    try {
      await symlink(outsidePath, probePath, "file");
      await rm(probePath);
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
        context.skip();
        return;
      }
      throw error;
    }

    let failure;
    try {
      await applyProjectTransaction({
        projectRoot,
        operations: [makeProjectOperation(projectRoot, "rollback-symlink-race/target.txt", "committed bytes\n")],
        verify: async () => { throw new Error("injected verification failure"); },
        transactionHooks: {
          async beforeRollbackCommit() {
            await rm(targetPath);
            await symlink(outsidePath, targetPath, "file");
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("Concurrent modification detected during rollback commit");
    expect(await readFile(outsidePath, "utf8")).toBe("external bytes\n");
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    const recoveryRoot = failure.message.split("recovery retained at ")[1];
    const recovery = await readJson(path.join(recoveryRoot, "recovery.json"));
    expect(recovery.targets[0]).toMatchObject({
      relativePath: "rollback-symlink-race/target.txt",
      rollback: "preserved-current",
      current: { type: "missing" },
      displaced: { type: "symlink" },
      survivingPaths: {
        target: null,
        displaced: path.join(recoveryRoot, "rollback-current-0")
      }
    });
    expect((await lstat(recovery.targets[0].survivingPaths.displaced)).isSymbolicLink()).toBe(true);
    expect(await readlink(recovery.targets[0].survivingPaths.displaced)).toBe(outsidePath);
  });

  it("persists the backup from the exact original bytes even if the live target changes during preparation", async () => {
    const projectRoot = await copyFixture();
    const targetPath = projectPath(projectRoot, "before-image/target.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "original A\n", "utf8");
    let afterOriginalRead = false;
    let afterBeforeImagePrepared = false;
    await expect(applyProjectTransaction({
      projectRoot,
      operations: [makeProjectOperation(projectRoot, "before-image/target.txt", "committed C\n")],
      verify: async () => { throw new Error("injected verification failure"); },
      transactionHooks: {
        async afterOriginalRead() {
          afterOriginalRead = true;
          await writeFile(targetPath, "intermediate B\n", "utf8");
        },
        async afterBeforeImagePrepared() {
          afterBeforeImagePrepared = true;
          await writeFile(targetPath, "original A\n", "utf8");
        }
      }
    })).rejects.toThrow("injected verification failure");

    expect(afterOriginalRead).toBe(true);
    expect(afterBeforeImagePrepared).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe("original A\n");
  });

  it.each([
    {
      label: "missing",
      expectedBeforeImage: null,
      actualBytes: "unexpected existing bytes\n"
    },
    {
      label: "exact file bytes",
      expectedBeforeImage: Buffer.from("expected original bytes\n"),
      actualBytes: "different original bytes\n"
    }
  ])("rejects an explicit expected-$label mismatch during preparation", async ({ expectedBeforeImage, actualBytes }) => {
    const projectRoot = await copyFixture();
    const relativePath = "expected-before/preparation.txt";
    const targetPath = projectPath(projectRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, actualBytes, "utf8");
    const before = await readFile(targetPath);

    await expect(applyProjectTransaction({
      projectRoot,
      operations: [makeProjectOperation(projectRoot, relativePath, "committed bytes\n", { expectedBeforeImage })],
      verify: async () => {}
    })).rejects.toThrow(`Expected before image mismatch: ${relativePath}`);

    expect(await readFile(targetPath)).toEqual(before);
    expect((await readdir(projectRoot)).some((name) => name.startsWith(".prd-annotator-transaction-"))).toBe(false);
  });

  it("rechecks exact expected bytes after the before-commit hook and preserves external drift", async () => {
    const projectRoot = await copyFixture();
    const relativePath = "expected-before/commit.txt";
    const targetPath = projectPath(projectRoot, relativePath);
    const originalBytes = Buffer.from("exact original bytes\n");
    const externalBytes = Buffer.from("external bytes before commit\n");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, originalBytes);

    await expect(applyProjectTransaction({
      projectRoot,
      operations: [makeProjectOperation(projectRoot, relativePath, "committed bytes\n", {
        expectedBeforeImage: originalBytes
      })],
      verify: async () => {},
      transactionHooks: {
        async beforeCommit({ relativePath: candidate }) {
          if (candidate === relativePath) await writeFile(targetPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Concurrent modification detected: ${relativePath}`);

    expect(await readFile(targetPath)).toEqual(externalBytes);
    expect((await readdir(projectRoot)).some((name) => name.startsWith(".prd-annotator-transaction-"))).toBe(false);
  });

  it("commits when an explicit exact before image still matches", async () => {
    const projectRoot = await copyFixture();
    const relativePath = "expected-before/success.txt";
    const targetPath = projectPath(projectRoot, relativePath);
    const originalBytes = Buffer.from("exact original bytes\n");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, originalBytes);

    await applyProjectTransaction({
      projectRoot,
      operations: [makeProjectOperation(projectRoot, relativePath, "committed bytes\n", {
        expectedBeforeImage: originalBytes
      })],
      verify: async () => {
        expect(await readFile(targetPath, "utf8")).toBe("committed bytes\n");
      }
    });

    expect(await readFile(targetPath, "utf8")).toBe("committed bytes\n");
  });

  it("continues a partial rollback after one reversal fails and reports the actual survivors", async () => {
    const projectRoot = await copyFixture();
    const rollbackRoot = projectPath(projectRoot, "partial-rollback");
    await mkdir(rollbackRoot, { recursive: true });
    for (const name of ["first", "second", "third"]) {
      await writeFile(path.join(rollbackRoot, `${name}.txt`), `original ${name}\n`, "utf8");
    }
    let failure;
    try {
      await applyProjectTransaction({
        projectRoot,
        operations: ["first", "second", "third"].map((name) => makeProjectOperation(
          projectRoot,
          `partial-rollback/${name}.txt`,
          `committed ${name}\n`
        )),
        verify: async () => { throw new Error("injected verification failure"); },
        transactionHooks: {
          beforeRollbackOperation({ relativePath }) {
            if (relativePath === "partial-rollback/second.txt") throw new Error("injected middle rollback failure");
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("rollback failed: injected middle rollback failure");
    expect(await readFile(path.join(rollbackRoot, "first.txt"), "utf8")).toBe("original first\n");
    expect(await readFile(path.join(rollbackRoot, "second.txt"), "utf8")).toBe("committed second\n");
    expect(await readFile(path.join(rollbackRoot, "third.txt"), "utf8")).toBe("original third\n");
    const recoveryRoot = failure.message.split("recovery retained at ")[1];
    const recovery = await readJson(path.join(recoveryRoot, "recovery.json"));
    expect(recovery.targets.map(({ relativePath, rollback }) => ({ relativePath, rollback }))).toEqual([
      { relativePath: "partial-rollback/first.txt", rollback: "restored-original" },
      { relativePath: "partial-rollback/second.txt", rollback: "failed" },
      { relativePath: "partial-rollback/third.txt", rollback: "restored-original" }
    ]);
    expect(recovery.targets.find((target) => target.relativePath === "partial-rollback/second.txt").current)
      .toMatchObject({ type: "file", sha256: sha256("committed second\n") });
  });

  it("serializes concurrent project mutations with the shared project lock", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    let releaseFirst;
    let firstCommitted;
    const committed = new Promise((resolve) => { firstCommitted = resolve; });
    const blocker = new Promise((resolve) => { releaseFirst = resolve; });
    const first = generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      transactionHooks: { async afterCommit({ index }) { if (index === 0) { firstCommitted(); await blocker; } } }
    });
    await committed;
    const second = generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      projectLockOptions: { timeoutMs: 0 }
    });
    await expect(second).rejects.toThrow("Timed out waiting for project mutation lock");
    releaseFirst();
    await expect(first).resolves.toEqual(["doc/prd/pages/equipment-ops-7c31fa.md"]);
  });

  it("does not overwrite a concurrent manifest edit made outside the cooperative lock", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const manifestPath = projectPath(projectRoot, ".prd-annotator/manifest.json");
    await expect(generateManagedPrd({
      projectRoot,
      pageIds: ["equipment-ops-7c31fa"],
      confirmPrdWrite: true,
      transactionHooks: {
        async afterCommit({ index }) {
          if (index !== 0) return;
          const concurrent = await readJson(manifestPath);
          concurrent.migration = { source: "concurrent-external-edit" };
          await writeJson(manifestPath, concurrent);
        }
      }
    })).rejects.toThrow("Concurrent modification detected: .prd-annotator/manifest.json");
    expect((await readJson(manifestPath)).migration).toEqual({ source: "concurrent-external-edit" });
    await expect(readFile(projectPath(projectRoot, "doc/prd/pages/equipment-ops-7c31fa.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("parses repeated page, total, document-root, and literal confirmation CLI arguments", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const stdout = captureStream();
    const stderr = captureStream();
    await expect(runGeneratePrdCli({
      argv: ["--project-root", projectRoot, "--page", "equipment-ops-7c31fa", "--document-root", "managed/specs", "--confirm-prd-write"],
      now: fixedNow,
      stdout,
      stderr
    })).resolves.toBe(0);
    expect(stdout.value()).toBe("Generated managed PRDs:\nmanaged/specs/pages/equipment-ops-7c31fa.md\n");
    expect(stderr.value()).toBe("");

    const badError = captureStream();
    expect(await runGeneratePrdCli({ argv: ["--project-root", projectRoot, "--page", "equipment-ops-7c31fa"], stdout: captureStream(), stderr: badError }))
      .toBe(1);
    expect(badError.value()).toContain("--confirm-prd-write is required");
  });

  it("prints a warning but keeps CLI success when the completed generation lock cannot be released", async () => {
    const projectRoot = await copyFixture();
    await seedManagedSource(projectRoot);
    const stdout = captureStream();
    const stderr = captureStream();

    expect(await runGeneratePrdCli({
      argv: ["--project-root", projectRoot, "--page", "equipment-ops-7c31fa", "--confirm-prd-write"],
      now: fixedNow,
      transactionHooks: {
        async afterCommit({ index }) {
          if (index === 0) await writeFile(projectPath(projectRoot, ".prd-annotator-project-write.lock/retained"), "busy\n");
        }
      },
      projectLockOptions: { releaseAttempts: 1 },
      stdout,
      stderr
    })).toBe(0);
    expect(stdout.value()).toBe("Generated managed PRDs:\ndoc/prd/pages/equipment-ops-7c31fa.md\n");
    expect(stderr.value()).toMatch(/^Warning: Failed to release project mutation lock after 1 attempts:/);
  });
});
