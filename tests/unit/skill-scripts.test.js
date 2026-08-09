import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const skillRoot = path.join(repositoryRoot, "prd-annotator-skill");
const checkScript = path.join(skillRoot, "scripts/check-prd.mjs");
const mergeScript = path.join(skillRoot, "scripts/merge-annotations.mjs");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function copyFixture() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "prd-annotator-test-"));
  temporaryDirectories.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  cpSync(fixtureRoot, projectRoot, { recursive: true });
  return projectRoot;
}

function runScript(script, args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function annotation(id, updatedAt = "2026-08-08T02:00:00.000Z") {
  return {
    id,
    comment: `comment-${id}`,
    status: "open",
    createdAt: updatedAt,
    updatedAt,
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Equipment list",
      rect: { x: 0, y: 0, width: 100, height: 40 }
    },
    prd: { linkedSections: [], impactScope: "page", summary: "" }
  };
}

function writeSnapshot(projectRoot, annotations) {
  const snapshotPath = path.join(path.dirname(projectRoot), "snapshot.json");
  writeJson(snapshotPath, {
    schemaVersion: 1,
    projectKey: "fixture-project",
    document: {
      schemaVersion: 1,
      page: {
        id: "equipment-ops",
        title: "Equipment Operations",
        route: "/equipment/ops"
      },
      annotations
    },
    pagePrdMarkdown: "# Equipment Operations"
  });
  return snapshotPath;
}

function expectCheckFailure(projectRoot, expectedMessage) {
  let failure;
  try {
    runScript(checkScript, ["--project-root", projectRoot]);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeTruthy();
  expect(`${failure.stdout || ""}${failure.stderr || ""}`)
    .toContain(expectedMessage);
}

describe("PRD Skill scripts", () => {
  it("passes a complete permanent PRD project", () => {
    const projectRoot = copyFixture();

    expect(runScript(checkScript, ["--project-root", projectRoot]).trim())
      .toBe("PRD gate passed: 1 pages, 1 annotations");
  });

  it("merges incoming annotation ids without dropping permanent ids", () => {
    const projectRoot = copyFixture();
    const snapshotPath = writeSnapshot(projectRoot, [annotation("A002")]);

    runScript(mergeScript, [
      "--project-root",
      projectRoot,
      "--snapshot",
      snapshotPath
    ]);

    const permanent = readJson(path.join(
      projectRoot,
      "doc/prd/data/pages/equipment-ops.json"
    ));
    expect(permanent.annotations.map((item) => item.id))
      .toEqual(["A001", "A002"]);
  });

  it("never reduces permanent annotations when a later snapshot is empty", () => {
    const projectRoot = copyFixture();
    const firstSnapshot = writeSnapshot(projectRoot, [annotation("A002")]);
    runScript(mergeScript, [
      "--project-root",
      projectRoot,
      "--snapshot",
      firstSnapshot
    ]);
    const emptySnapshot = writeSnapshot(projectRoot, []);

    runScript(mergeScript, [
      "--project-root",
      projectRoot,
      "--snapshot",
      emptySnapshot
    ]);

    const permanent = readJson(path.join(
      projectRoot,
      "doc/prd/data/pages/equipment-ops.json"
    ));
    expect(permanent.annotations.map((item) => item.id))
      .toEqual(["A001", "A002"]);
  });

  it("rejects an applied annotation without a linked PRD section", () => {
    const projectRoot = copyFixture();
    const annotationPath = path.join(
      projectRoot,
      "doc/prd/data/pages/equipment-ops.json"
    );
    const permanent = readJson(annotationPath);
    permanent.annotations[0].prd.linkedSections = [];
    writeJson(annotationPath, permanent);

    expectCheckFailure(projectRoot, "applied annotation A001 must link to a PRD section");
  });

  it("rejects a total PRD that omits a manifest page link", () => {
    const projectRoot = copyFixture();
    writeFileSync(
      path.join(projectRoot, "doc/prd/PRD.md"),
      "# Product Requirements\n",
      "utf8"
    );

    expectCheckFailure(
      projectRoot,
      "PRD.md must include [Equipment Operations](pages/equipment-ops.md)"
    );
  });

  it("contains no destructive file or cache operation", () => {
    const source = `${readFileSync(checkScript, "utf8")}\n${readFileSync(mergeScript, "utf8")}`;
    expect(source).not.toMatch(
      /\b(?:rm|unlink|rmdir|removeItem|clearAll|resetData|purge)\b/
    );
  });

  it("codifies semantic Agent workflow and permanent-data gates", () => {
    const source = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const requiredContracts = [
      "doc/prd/manifest.json",
      "[data-prd-annotator-ui]",
      "window.PRDAnnotator.getSnapshot()",
      "merge-annotations.mjs",
      "check-prd.mjs",
      "total PRD",
      "browser cache"
    ];
    for (const contract of requiredContracts) expect(source).toContain(contract);
    expect(source).toMatch(/^description: Use when/m);
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(300);
  });
});
