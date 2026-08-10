import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import { canonicalJson, fingerprintValue } from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "../../prd-annotator-skill/scripts/lib/view.mjs";
import { refreshProject, runRefreshCli } from "../../prd-annotator-skill/scripts/refresh-project.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gateFixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const refreshScript = path.join(repositoryRoot, "prd-annotator-skill/scripts/refresh-project.mjs");
const temporaryDirectories = [];
const fixedNow = "2026-08-09T12:34:56.000Z";
const linkPermissionErrors = new Set(["EACCES", "EPERM", "ENOTSUP"]);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function page(id = "equipment-ops-7c31fa") {
  return {
    id,
    title: id === "equipment-ops-7c31fa" ? "Equipment Operations" : "Maintenance",
    htmlPath: id === "equipment-ops-7c31fa" ? "prototype/index.html" : "prototype/maintenance.html",
    annotationFile: `.prd-annotator/data/pages/${id}.json`,
    viewFile: `.prd-annotator/view/pages/${id}.js`,
    display: { enabled: true, updatedAt: "2026-08-09T00:00:00.000Z" }
  };
}

function manifest() {
  return {
    schemaVersion: 2,
    project: {
      id: "device-demo-a13f92",
      sdk: {
        version: "2.0.0",
        releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
        sha256: "a".repeat(64),
        installedAt: "2026-08-09T00:00:00.000Z"
      }
    },
    pages: [page(), page("maintenance-4d92b1")],
    documents: [],
    migration: null
  };
}

function annotationDocument(pageEntry = page()) {
  return {
    schemaVersion: 2,
    projectId: "device-demo-a13f92",
    page: {
      id: pageEntry.id,
      title: pageEntry.title,
      htmlPath: pageEntry.htmlPath,
      route: `/${pageEntry.htmlPath}`
    },
    annotations: [],
    managedPrd: null
  };
}

function inventory(overrides = {}) {
  return {
    id: "doc-example",
    title: "Example",
    path: "docs/example.md",
    format: "markdown",
    kind: "unclassified",
    pageIds: [],
    associationSource: "discovered",
    evidence: ["supported extension"],
    fingerprint: `sha256:${"b".repeat(64)}`,
    previewStatus: "available",
    missing: false,
    ...overrides
  };
}

async function makeProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "prd-refresh-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

async function seed(projectRoot, relativePath, content) {
  const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

async function makeLink(target, linkPath, type) {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (linkPermissionErrors.has(error?.code)) return false;
    throw error;
  }
}

async function snapshot(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) result[path.relative(root, absolutePath).split(path.sep).join("/")] = await readFile(absolutePath);
    }
  }
  await visit(root);
  return result;
}

async function transactionRoots(projectRoot) {
  return (await readdir(projectRoot))
    .filter((name) => name.startsWith(".prd-annotator-transaction-"))
    .map((name) => path.join(projectRoot, name));
}

function recoveryRootFrom(error) {
  return error?.message.includes("recovery retained at ")
    ? error.message.split("recovery retained at ").at(-1)
    : null;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function captureStream() {
  let value = "";
  return { write(chunk) { value += chunk; }, value: () => value };
}

describe("view bundle building", () => {
  it("filters documents per page and orders direct, total/public, then unclassified candidates", () => {
    const documents = [
      inventory({ id: "doc-unclassified-z", path: "z/notes.txt", format: "text" }),
      inventory({ id: "doc-other-page", path: "pages/maintenance.md", kind: "page-prd", pageIds: ["maintenance-4d92b1"] }),
      inventory({ id: "doc-public", path: "rules/public.md", kind: "public-rule" }),
      inventory({ id: "doc-direct-b", path: "requirements/z.md", kind: "requirement", pageIds: [page().id] }),
      inventory({ id: "doc-total", path: "PRD.md", kind: "total-prd" }),
      inventory({ id: "doc-direct-a", path: "requirements/a.md", kind: "page-prd", pageIds: [page().id] }),
      inventory({ id: "doc-global-requirement", path: "requirements/global.md", kind: "requirement", pageIds: [] }),
      inventory({ id: "doc-unclassified-a", path: "a/notes.txt", format: "text" })
    ];

    const bundle = buildViewBundle({
      manifest: manifest(),
      page: page(),
      annotationDocument: annotationDocument(),
      documents,
      previews: Object.fromEntries(documents.map((item) => [item.path, item.path])),
      generatedAt: fixedNow
    });

    expect(bundle.documents.map((item) => item.id)).toEqual([
      "doc-direct-a", "doc-direct-b", "doc-total", "doc-public", "doc-unclassified-a", "doc-unclassified-z"
    ]);
    expect(bundle.documents.map(({ associationSource, evidence, ...item }) => item))
      .toEqual(bundle.documents);
  });

  it("shows an unassociated manually retained page PRD without changing its metadata", () => {
    const manual = inventory({
      id: "doc-manual-unassociated",
      path: "requirements/checkout-prd.md",
      kind: "page-prd",
      pageIds: [],
      associationSource: "manual",
      evidence: ["manual classification retained"]
    });
    const before = structuredClone(manual);

    const bundle = buildViewBundle({
      manifest: manifest(),
      page: page(),
      annotationDocument: annotationDocument(),
      documents: [manual],
      previews: { [manual.path]: "# Checkout PRD" },
      generatedAt: fixedNow
    });

    expect(bundle.documents).toEqual([expect.objectContaining({
      id: manual.id,
      kind: "page-prd",
      pageIds: []
    })]);
    expect(manual).toEqual(before);
    expect(manual).not.toHaveProperty("priority");
  });

  it("creates display-only text, JSON, YAML, malformed-data, and explicit binary previews", () => {
    const documents = [
      inventory({ id: "doc-md", path: "docs/a.md", format: "markdown" }),
      inventory({ id: "doc-json", path: "docs/data.json", format: "json" }),
      inventory({ id: "doc-bad-json", path: "docs/bad.json", format: "json" }),
      inventory({ id: "doc-yaml", path: "docs/data.yaml", format: "yaml" }),
      inventory({ id: "doc-bad-yaml", path: "docs/bad.yml", format: "yaml" }),
      inventory({
        id: "doc-pdf",
        path: "docs/rules.pdf",
        format: "pdf",
        kind: "unclassified",
        previewStatus: "available",
        previewFingerprint: sha256("Extracted PDF rules")
      }),
      inventory({ id: "doc-docx", path: "docs/rules.docx", format: "docx", kind: "unclassified", previewStatus: "unavailable" })
    ];
    const previews = {
      "docs/a.md": "# A\r\n<script>globalThis.pwned = true</script>\r\n",
      "docs/data.json": "{\"script\":\"globalThis.pwned = true\",\"a\":1}",
      "docs/bad.json": "{ definitely: not-json }\r\n",
      "docs/data.yaml": "title: Rules\r\nscript: globalThis.pwned = true\r\n",
      "docs/bad.yml": "broken: [yaml\r\n",
      "docs/rules.pdf": "Extracted PDF rules",
      "docs/rules.docx": 123
    };

    const bundle = buildViewBundle({
      manifest: manifest(), page: page(), annotationDocument: annotationDocument(), documents, previews, generatedAt: fixedNow
    });
    const byId = Object.fromEntries(bundle.documents.map((item) => [item.id, item]));

    expect(globalThis.pwned).toBeUndefined();
    expect(byId["doc-md"].content).toBe("# A\r\n<script>globalThis.pwned = true</script>\r\n");
    expect(byId["doc-json"].content).toBe('{\n  "a": 1,\n  "script": "globalThis.pwned = true"\n}');
    expect(byId["doc-bad-json"].content).toBe("{ definitely: not-json }\r\n");
    expect(byId["doc-yaml"].content).toBe("title: Rules\nscript: globalThis.pwned = true\n");
    expect(byId["doc-bad-yaml"].content).toBe("broken: [yaml\n");
    expect(byId["doc-pdf"]).toMatchObject({
      previewStatus: "available",
      previewFingerprint: sha256("Extracted PDF rules"),
      content: "Extracted PDF rules"
    });
    expect(byId["doc-docx"]).toMatchObject({ previewStatus: "unavailable", previewFingerprint: null, content: "" });
  });

  it("rejects binary available metadata when extracted preview content is absent", () => {
    const binary = inventory({
      id: "doc-pdf",
      path: "docs/rules.pdf",
      format: "pdf",
      kind: "unclassified",
      previewStatus: "available",
      previewFingerprint: sha256("Expected extracted rules")
    });

    expect(() => buildViewBundle({
      manifest: manifest(),
      page: page(),
      annotationDocument: annotationDocument(),
      documents: [binary],
      previews: {},
      generatedAt: fixedNow
    })).toThrow("Binary preview content does not match document metadata: docs/rules.pdf");
  });

  it("keeps missing entries missing and computes the annotation fingerprint", () => {
    const document = annotationDocument();
    document.annotations.push({ id: "A001" });
    const missing = inventory({
      id: "doc-missing", path: "docs/missing.pdf", format: "pdf", previewStatus: "missing", missing: true
    });

    const bundle = buildViewBundle({
      manifest: manifest(), page: page(), annotationDocument: document, documents: [missing], previews: {}, generatedAt: fixedNow
    });

    expect(bundle.persistedAnnotationFingerprint).toBe(fingerprintValue(document.annotations));
    expect(bundle.documents[0]).toMatchObject({ previewStatus: "missing", missing: true, content: "" });
  });

  it("matches a hard-coded browser annotation fingerprint vector with non-ASCII text", () => {
    const document = annotationDocument();
    document.annotations = [{
      id: "A001",
      title: "设备状态",
      description: "需要确认",
      type: "requirement",
      prdContent: "显示正常",
      acceptanceCriteria: "",
      dataFields: "",
      apiPath: "",
      edgeCases: "",
      status: "open",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      target: {
        cssPath: "main",
        xpath: "/html/body/main",
        textQuote: "设备",
        rect: { x: 0, y: 0, width: 100, height: 40 }
      },
      prd: {
        linkedDocuments: [],
        linkedSections: [],
        impactScope: "page",
        summary: ""
      }
    }];

    const bundle = buildViewBundle({
      manifest: manifest(), page: page(), annotationDocument: document,
      documents: [], previews: {}, generatedAt: fixedNow
    });

    expect(bundle.persistedAnnotationFingerprint).toBe("fnv1a32:6cd6e507");
  });

  it("serializes exact canonical executable hydration without fetch", () => {
    const bundle = buildViewBundle({
      manifest: manifest(), page: page(), annotationDocument: annotationDocument(),
      documents: [inventory()], previews: { "docs/example.md": "static source text" }, generatedAt: fixedNow
    });

    const source = serializeViewBundle(bundle);

    expect(source).toBe(`window.PRDAnnotator.hydrateView(${canonicalJson(bundle)});\n`);
    expect(source.startsWith("window.PRDAnnotator.hydrateView(")).toBe(true);
    expect(source).not.toContain("fetch(");
    expect(source.match(/window\.PRDAnnotator\.hydrateView\(/g)).toHaveLength(1);
  });
});

describe("project refresh", () => {
  async function seedInstalledProject(projectRoot) {
    const currentManifest = manifest();
    currentManifest.documents = [{
      ...inventory({
        id: "doc-missing-manual",
        title: "Retained missing source",
        path: "legacy/missing.pdf",
        format: "pdf",
        kind: "page-prd",
        pageIds: [page().id],
        associationSource: "manual",
        fingerprint: `sha256:${"c".repeat(64)}`,
        previewStatus: "unavailable"
      })
    }];
    const sourceBytes = {
      "PRD.md": Buffer.from("# Product requirements\r\n\0literal bytes\r\n", "utf8"),
      "requirements/equipment.md": Buffer.from("# Equipment requirements\r\n", "utf8"),
      "legacy/reference.pdf": Buffer.from([37, 80, 68, 70, 0, 255]),
      "prototype/index.html": Buffer.from("<!doctype html><title>Equipment</title>"),
      "prototype/maintenance.html": Buffer.from("<!doctype html><title>Maintenance</title>"),
      ".prd-annotator/sdk/prd-annotator.js": Buffer.from("sdk bytes")
    };
    await Promise.all(Object.entries(sourceBytes).map(([relativePath, bytes]) => seed(projectRoot, relativePath, bytes)));
    await seed(projectRoot, ".prd-annotator/manifest.json", `${JSON.stringify(currentManifest, null, 2)}\n`);
    for (const pageEntry of currentManifest.pages) {
      await seed(projectRoot, pageEntry.annotationFile, `${JSON.stringify(annotationDocument(pageEntry), null, 2)}\n`);
      await seed(projectRoot, pageEntry.viewFile, "old view bytes\n");
    }
    return { currentManifest, sourceBytes };
  }

  it("requires a valid existing authorized manifest before writing", async () => {
    const projectRoot = await makeProject();
    await seed(projectRoot, "PRD.md", "# Product\n");
    const before = await snapshot(projectRoot);

    await expect(refreshProject({ projectRoot, now: () => fixedNow })).rejects.toThrow("existing manifest");
    expect(await snapshot(projectRoot)).toEqual(before);

    await seed(projectRoot, ".prd-annotator/manifest.json", "{ malformed");
    const malformedBefore = await snapshot(projectRoot);
    await expect(refreshProject({ projectRoot, now: () => fixedNow })).rejects.toThrow("Invalid existing manifest");
    expect(await snapshot(projectRoot)).toEqual(malformedBefore);
  });

  it("rejects unsafe or non-document preview-map paths before writing", async () => {
    const unsafePaths = ["../outside.pdf", "/absolute.pdf", "C:/outside.pdf", "https://example.test/a.pdf", "legacy\\reference.pdf", "legacy/../reference.pdf", "prototype/index.html"];
    for (const unsafePath of unsafePaths) {
      const projectRoot = await makeProject();
      await seedInstalledProject(projectRoot);
      const before = await snapshot(projectRoot);

      await expect(refreshProject({ projectRoot, previewMap: { [unsafePath]: "text" }, now: () => fixedNow }))
        .rejects.toThrow("preview-map");
      expect(await snapshot(projectRoot)).toEqual(before);
    }
  });

  it("rejects empty extracted binary preview text before writing", async () => {
    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    const before = await snapshot(projectRoot);

    await expect(refreshProject({
      projectRoot,
      previewMap: { "legacy/reference.pdf": "" },
      now: () => fixedNow
    })).rejects.toThrow("Invalid preview-map text for legacy/reference.pdf: must be non-empty");

    expect(await snapshot(projectRoot)).toEqual(before);
  });

  it("rejects an annotation file reached through a junction ancestor before reading or writing", async (context) => {
    const projectRoot = await makeProject();
    const outsideRoot = await makeProject();
    const { currentManifest } = await seedInstalledProject(projectRoot);
    for (const pageEntry of currentManifest.pages) {
      const annotationBytes = await readFile(path.join(projectRoot, ...pageEntry.annotationFile.split("/")));
      await seed(outsideRoot, `pages/${pageEntry.id}.json`, annotationBytes);
    }
    const dataRoot = path.join(projectRoot, ".prd-annotator/data");
    await rm(dataRoot, { recursive: true, force: true });
    if (!(await makeLink(outsideRoot, dataRoot, "junction"))) context.skip();
    const beforeProject = await snapshot(projectRoot);
    const beforeOutside = await snapshot(outsideRoot);

    await expect(refreshProject({ projectRoot, now: () => fixedNow }))
      .rejects.toThrow(/Unsafe annotation file ancestor/);

    expect(await snapshot(projectRoot)).toEqual(beforeProject);
    expect(await snapshot(outsideRoot)).toEqual(beforeOutside);
  });

  it("rejects a junctioned view-output ancestor without redirecting writes", async (context) => {
    const projectRoot = await makeProject();
    const outsideRoot = await makeProject();
    const { currentManifest } = await seedInstalledProject(projectRoot);
    for (const pageEntry of currentManifest.pages) {
      const viewBytes = await readFile(path.join(projectRoot, ...pageEntry.viewFile.split("/")));
      await seed(outsideRoot, `pages/${pageEntry.id}.js`, viewBytes);
    }
    const viewRoot = path.join(projectRoot, ".prd-annotator/view");
    await rm(viewRoot, { recursive: true, force: true });
    if (!(await makeLink(outsideRoot, viewRoot, "junction"))) context.skip();
    const beforeProject = await snapshot(projectRoot);
    const beforeOutside = await snapshot(outsideRoot);

    await expect(refreshProject({ projectRoot, now: () => fixedNow }))
      .rejects.toThrow(/Unsafe refresh output ancestor/);

    expect(await snapshot(projectRoot)).toEqual(beforeProject);
    expect(await snapshot(outsideRoot)).toEqual(beforeOutside);
  });

  it("rejects a junctioned view-output target without touching it", async (context) => {
    const projectRoot = await makeProject();
    const outsideRoot = await makeProject();
    const { currentManifest } = await seedInstalledProject(projectRoot);
    const viewPath = path.join(projectRoot, ...currentManifest.pages[0].viewFile.split("/"));
    const outsideViewPath = path.join(outsideRoot, "outside-view-target");
    await mkdir(outsideViewPath);
    await writeFile(path.join(outsideViewPath, "sentinel.txt"), "outside view bytes\n");
    await rm(viewPath, { force: true });
    if (!(await makeLink(outsideViewPath, viewPath, "junction"))) context.skip();
    const beforeProject = await snapshot(projectRoot);
    const beforeOutside = await snapshot(outsideRoot);

    await expect(refreshProject({ projectRoot, now: () => fixedNow }))
      .rejects.toThrow(/Unsafe refresh output target/);

    expect(await snapshot(projectRoot)).toEqual(beforeProject);
    expect(await snapshot(outsideRoot)).toEqual(beforeOutside);
  });

  it.each([
    { label: "view", relativePath: page().viewFile },
    { label: "manifest", relativePath: ".prd-annotator/manifest.json" }
  ])("rejects pre-commit $label drift, preserves its exact bytes, and leaves no partial output", async ({ label, relativePath }) => {
    const projectRoot = await makeProject();
    const { currentManifest } = await seedInstalledProject(projectRoot);
    const before = await snapshot(projectRoot);
    const targetPath = path.join(projectRoot, ...relativePath.split("/"));
    const externalBytes = Buffer.from(`external ${label} bytes before commit\r\n`, "utf8");
    let injected = false;
    let failure;
    try {
      await refreshProject({
        projectRoot,
        now: () => fixedNow,
        transactionHooks: {
          async afterBeforeImagePrepared({ relativePath: candidate }) {
            if (!injected && candidate === relativePath) {
              injected = true;
              await writeFile(targetPath, externalBytes);
            }
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(injected).toBe(true);
    expect(failure?.message).toContain(`Concurrent modification detected: ${relativePath}`);
    expect(await readFile(targetPath)).toEqual(externalBytes);
    for (const pageEntry of currentManifest.pages) {
      if (pageEntry.viewFile !== relativePath) {
        expect(await readFile(path.join(projectRoot, ...pageEntry.viewFile.split("/"))))
          .toEqual(before[pageEntry.viewFile]);
      }
    }
    if (relativePath !== ".prd-annotator/manifest.json") {
      expect(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json")))
        .toEqual(before[".prd-annotator/manifest.json"]);
    }
    const recoveryRoots = await transactionRoots(projectRoot);
    if (relativePath === ".prd-annotator/manifest.json") {
      expect(recoveryRoots).toHaveLength(1);
      expect(recoveryRootFrom(failure)).toBe(recoveryRoots[0]);
    } else {
      expect(recoveryRoots).toEqual([]);
    }
  });

  it("preserves rollback-window external view bytes and retains truthful recovery evidence", async () => {
    const projectRoot = await makeProject();
    const { currentManifest } = await seedInstalledProject(projectRoot);
    const before = await snapshot(projectRoot);
    const firstView = currentManifest.pages[0].viewFile;
    const firstViewPath = path.join(projectRoot, ...firstView.split("/"));
    const externalBytes = Buffer.from("external view bytes during rollback\n", "utf8");
    let failure;
    try {
      await refreshProject({
        projectRoot,
        now: () => fixedNow,
        transactionHooks: {
          afterCommit({ index }) {
            if (index === 0) throw new Error("injected refresh commit failure");
          },
          async beforeRollbackOperation({ relativePath }) {
            if (relativePath === firstView) await writeFile(firstViewPath, externalBytes);
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("injected refresh commit failure");
    expect(failure?.message).toContain(`Concurrent modification detected during rollback: ${firstView}`);
    expect(await readFile(firstViewPath)).toEqual(externalBytes);
    expect(await readFile(path.join(projectRoot, ...currentManifest.pages[1].viewFile.split("/"))))
      .toEqual(before[currentManifest.pages[1].viewFile]);
    expect(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json")))
      .toEqual(before[".prd-annotator/manifest.json"]);
    const recoveryRoot = recoveryRootFrom(failure);
    expect(recoveryRoot).toBeTruthy();
    expect(await transactionRoots(projectRoot)).toEqual([recoveryRoot]);
    const recovery = JSON.parse(await readFile(path.join(recoveryRoot, "recovery.json"), "utf8"));
    expect(recovery.error).toBe("injected refresh commit failure");
    expect(recovery.rollbackError).toContain(`Concurrent modification detected during rollback: ${firstView}`);
    expect(recovery.targets[0]).toMatchObject({
      relativePath: firstView,
      rollback: "preserved-current",
      current: {
        type: "file",
        sha256: sha256(externalBytes).slice("sha256:".length)
      },
      survivingPaths: { target: firstViewPath }
    });
  });

  it("atomically writes only manifest/views, retains mappings and missing sources, and preserves source bytes", async () => {
    const projectRoot = await makeProject();
    const { sourceBytes } = await seedInstalledProject(projectRoot);
    const before = await snapshot(projectRoot);

    const refreshed = await refreshProject({
      projectRoot,
      previewMap: { "legacy/reference.pdf": "Extracted safe PDF text" },
      now: () => fixedNow
    });

    expect(refreshed.documents.find((item) => item.id === "doc-missing-manual")).toMatchObject({
      kind: "page-prd", pageIds: [page().id], associationSource: "manual", missing: true, previewStatus: "missing"
    });
    expect(refreshed.documents.find((item) => item.path === "PRD.md")).toMatchObject({
      fingerprint: sha256(sourceBytes["PRD.md"]), missing: false
    });
    expect(refreshed.documents.find((item) => item.path === "legacy/reference.pdf")).toMatchObject({
      previewStatus: "available",
      previewFingerprint: sha256("Extracted safe PDF text"),
      missing: false
    });
    expect(JSON.parse(await readFile(path.join(projectRoot, ".prd-annotator/manifest.json"), "utf8"))).toEqual(refreshed);
    for (const pageEntry of refreshed.pages) {
      const viewSource = await readFile(path.join(projectRoot, ...pageEntry.viewFile.split("/")), "utf8");
      expect(viewSource).toMatch(/^window\.PRDAnnotator\.hydrateView\(\{/);
      expect(viewSource).not.toContain("fetch(");
      if (pageEntry.id === page().id) expect(viewSource).toContain("Extracted safe PDF text");
    }
    const after = await snapshot(projectRoot);
    const allowedChanges = new Set([".prd-annotator/manifest.json", ...refreshed.pages.map((item) => item.viewFile)]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [relativePath, bytes] of Object.entries(before)) {
      if (!allowedChanges.has(relativePath)) expect(after[relativePath]).toEqual(bytes);
    }
  });

  it("keeps a normal fixture refresh valid through the complete project gate", async () => {
    const projectRoot = await makeProject();
    await cp(gateFixtureRoot, projectRoot, { recursive: true });

    const refreshed = await refreshProject({ projectRoot, now: () => fixedNow });

    expect(refreshed.schemaVersion).toBe(2);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 1, documents: 2 });
  });

  it("shows a generic PRD with requirement vocabulary on every page without globalizing ordinary requirements", async () => {
    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    await Promise.all([
      seed(projectRoot, "feature-prd.md", "# Checkout PRD\n\n## Requirements\nPayment rules, specification, and acceptance criteria.\n"),
      seed(projectRoot, "requirements/shipping-rules.md", "# Shipping requirements\n\nDelivery rules and acceptance criteria.\n")
    ]);

    const refreshed = await refreshProject({ projectRoot, now: () => fixedNow });
    const ambiguous = refreshed.documents.find((item) => item.path === "feature-prd.md");
    const ordinaryRequirement = refreshed.documents.find((item) => item.path === "requirements/shipping-rules.md");

    expect(ambiguous.kind).toBe("unclassified");
    expect(ordinaryRequirement.kind).toBe("requirement");
    for (const pageEntry of refreshed.pages) {
      const source = await readFile(path.join(projectRoot, ...pageEntry.viewFile.split("/")), "utf8");
      expect(source).toContain(`\"id\":\"${ambiguous.id}\"`);
      expect(source).not.toContain(`\"id\":\"${ordinaryRequirement.id}\"`);
    }
  });

  it("rolls back the manifest and every existing view byte after an injected first-output failure", async () => {
    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    const before = await snapshot(projectRoot);

    let failure;
    try {
      await refreshProject({
        projectRoot,
        now: () => fixedNow,
        transactionHooks: {
          afterCommit: ({ index }) => {
            if (index === 0) throw new Error("injected post-first-output failure");
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("injected post-first-output failure");
    expect(failure?.message).toContain("rollback completed; recovery retained at");
    const after = await snapshot(projectRoot);
    for (const [relativePath, bytes] of Object.entries(before)) expect(after[relativePath]).toEqual(bytes);
    const recoveryRoot = recoveryRootFrom(failure);
    expect(await transactionRoots(projectRoot)).toEqual([recoveryRoot]);
    const recovery = JSON.parse(await readFile(path.join(recoveryRoot, "recovery.json"), "utf8"));
    expect(recovery.targets[0]).toMatchObject({ rollback: "restored-original" });
    expect((await readdir(projectRoot)).some((name) => name.startsWith(".prd-annotator-refresh-"))).toBe(false);
  });

  it("removes new view files, directories, and staging after an injected first-output failure", async () => {
    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    const viewRoot = path.join(projectRoot, ".prd-annotator/view");
    await rm(viewRoot, { recursive: true, force: true });
    const before = await snapshot(projectRoot);

    let failure;
    try {
      await refreshProject({
        projectRoot,
        now: () => fixedNow,
        transactionHooks: {
          afterCommit: ({ index }) => {
            if (index === 0) throw new Error("injected post-first-output failure");
          }
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain("injected post-first-output failure");
    expect(failure?.message).toContain("rollback completed; recovery retained at");
    const after = await snapshot(projectRoot);
    for (const [relativePath, bytes] of Object.entries(before)) expect(after[relativePath]).toEqual(bytes);
    expect(existsSync(viewRoot)).toBe(false);
    const recoveryRoot = recoveryRootFrom(failure);
    expect(await transactionRoots(projectRoot)).toEqual([recoveryRoot]);
    const recovery = JSON.parse(await readFile(path.join(recoveryRoot, "recovery.json"), "utf8"));
    expect(recovery.targets[0]).toMatchObject({ rollback: "removed-committed" });
    expect((await readdir(projectRoot)).some((name) => name.startsWith(".prd-annotator-refresh-"))).toBe(false);
  });

  it("validates CLI shape and accepts a safe external preview-map file", async () => {
    const invalidArguments = [
      [],
      ["--preview-map", "map.json", "--project-root", "project"],
      ["--project-root", "project", "--project-root", "project"],
      ["--project-root", "project", "--preview-map"],
      ["--project-root", "project", "--unknown", "value"]
    ];
    for (const argumentsList of invalidArguments) {
      const result = spawnSync(process.execPath, [refreshScript, ...argumentsList], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: refresh-project.mjs --project-root PATH [--preview-map PATH]");
    }

    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    const previewDirectory = await makeProject();
    const previewPath = path.join(previewDirectory, "previews.json");
    await writeFile(previewPath, JSON.stringify({ "legacy/reference.pdf": "CLI extracted preview" }));
    const result = spawnSync(process.execPath, [
      refreshScript, "--project-root", projectRoot, "--preview-map", previewPath
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).documents.some((item) => item.path === "legacy/reference.pdf")).toBe(true);
    expect(await readFile(path.join(projectRoot, ".prd-annotator/view/pages/equipment-ops-7c31fa.js"), "utf8"))
      .toContain("CLI extracted preview");
  });

  it("prints a warning but keeps CLI success when the completed refresh lock cannot be released", async () => {
    const projectRoot = await makeProject();
    await seedInstalledProject(projectRoot);
    const stdout = captureStream();
    const stderr = captureStream();

    expect(await runRefreshCli({
      argv: ["--project-root", projectRoot],
      now: () => fixedNow,
      transactionHooks: {
        async afterCommit({ index }) {
          if (index === 0) await writeFile(path.join(projectRoot, ".prd-annotator-project-write.lock/retained"), "busy\n");
        }
      },
      projectLockOptions: { releaseAttempts: 1 },
      stdout,
      stderr
    })).toBe(0);
    expect(JSON.parse(stdout.value()).schemaVersion).toBe(2);
    expect(stderr.value()).toMatch(/^Warning: Failed to release project mutation lock after 1 attempts:/);
  });
});
