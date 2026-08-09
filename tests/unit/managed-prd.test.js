import { mkdtemp, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
});
