import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocuments } from "../../prd-annotator-skill/scripts/lib/documents.mjs";

const temporaryDirectories = [];
const installFixtureRoot = path.resolve("tests/fixtures/install-project");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "prd-documents-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

async function seed(projectRoot, relativePath, content) {
  const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function documentId(relativePath) {
  return `doc-${createHash("sha256").update(relativePath).digest("hex").slice(0, 10)}`;
}

describe("document discovery", () => {
  it("discovers generated field and API fixtures for their Drawer tabs", async () => {
    const documents = await discoverDocuments({ projectRoot: installFixtureRoot });

    expect(documents.find((entry) => entry.path.endsWith("field-spec.md"))?.displayGroups)
      .toContain("field-spec");
    expect(documents.find((entry) => entry.path.endsWith("api-contract.md"))?.displayGroups)
      .toContain("api-doc");
  });

  it("classifies field and API documents into dedicated display groups", async () => {
    const projectRoot = await makeProject();
    await Promise.all([
      seed(projectRoot, "doc/data/fields.md", "# Message Field Specification\n\n| Field | Type |\n| --- | --- |\n"),
      seed(projectRoot, "doc/api/messages.md", "# Message API Contract\n\n## POST /api/messages\n\nRequest and response schema.\n")
    ]);

    const documents = await discoverDocuments({ projectRoot });

    expect(documents.find((entry) => entry.path === "doc/data/fields.md")).toMatchObject({
      kind: "field-spec",
      scope: "unassigned",
      pageIds: [],
      displayGroups: ["field-spec"]
    });
    expect(documents.find((entry) => entry.path === "doc/api/messages.md")).toMatchObject({
      kind: "api-doc",
      scope: "unassigned",
      pageIds: [],
      displayGroups: ["api-doc"]
    });
  });

  it("keeps ambiguous candidates, fingerprints bytes, and preserves manual mappings", async () => {
    const projectRoot = await makeProject();
    const equipmentBytes = Buffer.from("# Equipment rules\r\n\r\nUse approval.\r\n", "utf8");
    await Promise.all([
      seed(projectRoot, "PRD.md", "# Product requirements\n"),
      seed(projectRoot, "docs/product-prd.markdown", "# Product PRD alternative\n"),
      seed(projectRoot, "requirements/equipment.md", equipmentBytes),
      seed(projectRoot, "notes/open-questions.txt", "Which users may approve?\n"),
      seed(projectRoot, "legacy/requirements.pdf", Buffer.from([0, 1, 2, 255])),
      seed(projectRoot, "legacy/rules.docx", Buffer.from([80, 75, 3, 4])),
      seed(projectRoot, ".prd-annotator/data/pages/hidden.json", "{}"),
      seed(projectRoot, ".prd-annotator/view/pages/hidden.js", "generated"),
      seed(projectRoot, "node_modules/package/requirements.md", "# generated"),
      seed(projectRoot, "dist/PRD.md", "# built"),
      seed(projectRoot, "coverage/rules.yaml", "generated: true\n")
    ]);
    const existingDocuments = [{
      id: "doc-manual",
      path: "requirements/equipment.md",
      title: "Equipment rules",
      format: "markdown",
      kind: "page-prd",
      pageIds: ["equipment-ops-7c31fa"],
      associationSource: "manual"
    }];

    const first = await discoverDocuments({ projectRoot, existingDocuments });
    const second = await discoverDocuments({ projectRoot, existingDocuments });

    expect(second).toEqual(first);
    expect(first.map((item) => item.path)).toEqual([
      "PRD.md",
      "docs/product-prd.markdown",
      "legacy/requirements.pdf",
      "legacy/rules.docx",
      "notes/open-questions.txt",
      "requirements/equipment.md"
    ]);
    expect(first.filter((item) => item.kind === "total-prd")).toHaveLength(2);
    expect(first.find((item) => item.path === "PRD.md")).toMatchObject({
      id: documentId("PRD.md"),
      scope: "global",
      format: "markdown",
      missing: false,
      previewStatus: "available"
    });
    expect(first.find((item) => item.path === "requirements/equipment.md")).toMatchObject({
      id: "doc-manual",
      title: "Equipment rules",
      kind: "page-prd",
      scope: "page",
      pageIds: ["equipment-ops-7c31fa"],
      associationSource: "manual",
      fingerprint: sha256(equipmentBytes),
      missing: false
    });
    expect(first.find((item) => item.path === "legacy/requirements.pdf")).toMatchObject({
      format: "pdf",
      fingerprint: sha256(Buffer.from([0, 1, 2, 255])),
      previewStatus: "unavailable"
    });
    expect(first.every((item) => Array.isArray(item.evidence) && item.evidence.length > 0)).toBe(true);
    expect(first.every((item) => !("priority" in item))).toBe(true);
  });

  it("marks missing sources without deleting or rewriting their retained inventory", async () => {
    const projectRoot = await makeProject();
    const missingEntry = {
      id: "doc-retained",
      path: "legacy/missing.pdf",
      title: "Missing legacy requirements",
      format: "pdf",
      kind: "requirement",
      pageIds: ["equipment-ops-7c31fa"],
      associationSource: "manual",
      fingerprint: `sha256:${"a".repeat(64)}`,
      evidence: ["manual association"]
    };

    const documents = await discoverDocuments({ projectRoot, existingDocuments: [missingEntry] });

    expect(documents).toEqual([{
      ...missingEntry,
      scope: "page",
      missing: true,
      previewStatus: "missing"
    }]);
  });

  it("uses deterministic ASCII ids for non-ASCII project-relative paths", async () => {
    const projectRoot = await makeProject();
    await seed(projectRoot, "需求/产品规则.yaml", "title: 产品规则\n");

    const [documentEntry] = await discoverDocuments({ projectRoot, existingDocuments: [] });

    expect(documentEntry.path).toBe("需求/产品规则.yaml");
    expect(documentEntry.id).toBe(documentId("需求/产品规则.yaml"));
    expect(documentEntry.id).toMatch(/^doc-[a-f0-9]{10}$/);
    expect(await readFile(path.join(projectRoot, "需求/产品规则.yaml"), "utf8")).toBe("title: 产品规则\n");
  });

  it("keeps a generic PRD with requirement vocabulary unclassified without globalizing ordinary requirements", async () => {
    const projectRoot = await makeProject();
    await Promise.all([
      seed(projectRoot, "feature-prd.md", "# Checkout PRD\n\n## Requirements\nPayment rules, specification, and acceptance criteria.\n"),
      seed(projectRoot, "requirements/shipping-rules.md", "# Shipping requirements\n\nDelivery rules and acceptance criteria.\n")
    ]);

    const documents = await discoverDocuments({ projectRoot, existingDocuments: [] });
    const documentEntry = documents.find((item) => item.path === "feature-prd.md");

    expect(documentEntry).toMatchObject({
      path: "feature-prd.md",
      kind: "unclassified",
      scope: "unassigned",
      pageIds: [],
      associationSource: "discovered"
    });
    expect(documentEntry.evidence).toContain("path or content contains ambiguous PRD evidence");
    expect(documents.find((item) => item.path === "requirements/shipping-rules.md")).toMatchObject({
      kind: "requirement",
      pageIds: []
    });
  });
});
