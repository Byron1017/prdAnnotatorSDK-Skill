import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export const EXCLUDED_DIRECTORIES = Object.freeze([
  ".git",
  ".prd-annotator",
  "node_modules",
  "dist",
  "build",
  "out",
  "vendor",
  "coverage"
]);

function normalizePath(value) {
  return path.resolve(String(value));
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function cleanAscii(value, maxLength) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
}

function fnvHex(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function assertInsideProject(root, candidate, label = "path") {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    if (relative === "" || relative === ".") return normalizedCandidate;
    throw new Error(`${label} is outside project`);
  }
  return normalizedCandidate;
}

export function toProjectPath(root, absolutePath) {
  const normalizedRoot = normalizePath(root);
  const normalizedAbsolutePath = assertInsideProject(normalizedRoot, absolutePath, "path");
  const relative = path.relative(normalizedRoot, normalizedAbsolutePath);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path is outside project");
  }
  return slash(relative);
}

export async function walkProject(root, { extensions = [], excludedDirectories = EXCLUDED_DIRECTORIES } = {}) {
  const normalizedRoot = normalizePath(root);
  const rootStatus = await lstat(normalizedRoot);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new Error("projectRoot must be a non-symlink directory");
  const extensionSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  const exclusions = new Set([...EXCLUDED_DIRECTORIES, ...excludedDirectories]);
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!exclusions.has(entry.name)) await visit(candidate);
      } else if (entry.isFile() && (!extensionSet.size || extensionSet.has(path.extname(entry.name).toLowerCase()))) {
        files.push(toProjectPath(normalizedRoot, candidate));
      }
    }
  }

  await visit(normalizedRoot);
  return files;
}

export function deriveProjectId(rootName, normalizedProjectRoot) {
  const slug = cleanAscii(rootName, 25) || "project";
  return `${slug}-${fnvHex(slash(String(normalizedProjectRoot))).slice(0, 6)}`.slice(0, 32);
}

export function derivePageId(relativeHtmlPath, usedIds = new Set()) {
  const normalizedPath = slash(String(relativeHtmlPath)).replace(/^\.\//, "");
  const parts = normalizedPath.split("/").filter(Boolean);
  const fileName = parts.pop() || "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  const candidates = [stem, ...parts.reverse()];
  const slug = candidates.map((value) => cleanAscii(value, 25)).find(Boolean) || "page";
  const suffix = fnvHex(normalizedPath).slice(0, 6);
  const base = `${slug.slice(0, 25)}-${suffix}`;
  let result = base.slice(0, 32);
  let attempt = 2;
  while (usedIds.has(result)) {
    const collisionSuffix = `-${attempt}`;
    result = `${base.slice(0, 32 - collisionSuffix.length)}${collisionSuffix}`;
    attempt += 1;
  }
  usedIds.add(result);
  return result;
}
