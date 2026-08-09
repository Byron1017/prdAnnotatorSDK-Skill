import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocuments } from "../../prd-annotator-skill/scripts/lib/documents.mjs";

const temporaryDirectories = [];

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
      format: "markdown",
      missing: false,
      previewStatus: "available"
    });
    expect(first.find((item) => item.path === "requirements/equipment.md")).toMatchObject({
      id: "doc-manual",
      title: "Equipment rules",
      kind: "page-prd",
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

  it("keeps a generic PRD without page or total evidence unclassified", async () => {
    const projectRoot = await makeProject();
    await seed(projectRoot, "feature-prd.md", "# Checkout PRD\n\nPayment behavior.\n");

    const [documentEntry] = await discoverDocuments({ projectRoot, existingDocuments: [] });

    expect(documentEntry).toMatchObject({
      path: "feature-prd.md",
      kind: "unclassified",
      pageIds: [],
      associationSource: "discovered"
    });
    expect(documentEntry.evidence).toContain("path or content contains ambiguous PRD evidence");
  });
});
