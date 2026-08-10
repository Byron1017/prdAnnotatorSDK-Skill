import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const RUNTIME_PATH = /^(?:prd-annotator\/(?:src\/.*\.(?:js|mjs)|prd-annotator\.js)|prd-annotator-skill\/scripts\/.*\.(?:js|mjs))$/;
const SAVE_SERVICE_PATTERNS = [
  { label: "server constructor", expression: /\b(?:createServer|WebSocketServer)\b/ },
  { label: "listening endpoint", expression: /\.listen\s*\(/ },
  { label: "save endpoint", expression: /["'`]\/(?:api\/)?(?:save|sync|annotations?\/save)(?:[-/_?"'`]|$)/i },
  { label: "runtime write request", expression: /\bfetch\s*\([^)]*[\s\S]{0,240}\bmethod\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`]/i }
];
const DESTRUCTIVE_PUBLIC_METHOD = /\b(?:delete|clear|purge|reset)(?:Annotations?|ProjectData|PrdData|Documents?)\b/i;
const DESTRUCTIVE_FS_CALL = /\b(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(\s*([^,\r\n)]+)/g;
const SAFE_CLEANUP_CALLS = new Map(Object.entries({
  "prd-annotator-skill/scripts/install-project.mjs": [
    "rmdir(directory",
    "rm(operation.absolutePath",
    "rm(stagingRoot"
  ],
  "prd-annotator-skill/scripts/merge-annotations.mjs": [
    "rm(staging.absolutePath",
    "rmdir(lockPath"
  ],
  "prd-annotator-skill/scripts/refresh-project.mjs": [
    "rmdir(directory",
    "rm(operation.absolutePath",
    "rm(stagingRoot"
  ],
  "prd-annotator-skill/scripts/remove-project.mjs": [
    "rm(operation.stagePath",
    "rm(stagingRoot"
  ],
  "prd-annotator-skill/scripts/lib/mutation-lock.mjs": [
    "rmdir(lockPath"
  ],
  "prd-annotator-skill/scripts/lib/project-transaction.mjs": [
    "rmdir(directory",
    "rm(stagingRoot"
  ]
}));

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

async function listTrackedPaths(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    windowsHide: true
  });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

export async function checkRepository({ repositoryRoot, trackedPaths } = {}) {
  if (!repositoryRoot) throw new Error("repositoryRoot is required");
  const paths = (trackedPaths || await listTrackedPaths(repositoryRoot))
    .map(normalizePath)
    .sort();
  const failures = [];

  for (const relativePath of paths) {
    if (!/^[\x20-\x7e]+$/.test(relativePath)) {
      failures.push(`Non-ASCII tracked path: ${relativePath}`);
    }
  }

  for (const relativePath of paths.filter((item) => RUNTIME_PATH.test(item))) {
    const source = await readFile(
      path.join(repositoryRoot, ...relativePath.split("/")),
      "utf8"
    );
    for (const { label, expression } of SAVE_SERVICE_PATTERNS) {
      if (expression.test(source)) {
        failures.push(`Runtime save service (${label}): ${relativePath}`);
      }
    }
    const allowedCleanupCalls = new Set(SAFE_CLEANUP_CALLS.get(relativePath) || []);
    const destructiveCalls = [...source.matchAll(DESTRUCTIVE_FS_CALL)]
      .map((match) => `${match[1]}(${match[2]}`.replace(/\s+/g, ""))
      .filter((call) => !allowedCleanupCalls.has(call));
    if (destructiveCalls.length > 0 || DESTRUCTIVE_PUBLIC_METHOD.test(source)) {
      failures.push(`Destructive project-data workflow: ${relativePath}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  return { trackedPaths: paths.length };
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const result = await checkRepository({ repositoryRoot });
  process.stdout.write(
    `Repository check passed: ${result.trackedPaths} ASCII tracked paths; no runtime save service or destructive project-data workflow\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
