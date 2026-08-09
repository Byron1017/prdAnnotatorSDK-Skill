import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivePageId, deriveProjectId, walkProject } from "./lib/project.mjs";

function locationEvidence(htmlPath) {
  const directories = htmlPath.toLowerCase().split("/").slice(0, -1);
  if (directories.some((directory) => ["prototype", "prototypes", "mockup", "mockups", "wireframe", "wireframes", "demo", "demos"].includes(directory))) return "prototype-like";
  if (directories.some((directory) => ["src", "app", "pages", "public"].includes(directory))) return "application-like";
  return "unknown";
}

export async function discoverProject({ projectRoot } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const absoluteRoot = path.resolve(projectRoot);
  const htmlPaths = await walkProject(absoluteRoot, { extensions: [".html", ".htm"] });
  const usedIds = new Set();
  const htmlCandidates = htmlPaths.map((htmlPath) => ({
    htmlPath,
    suggestedPageId: derivePageId(htmlPath, usedIds),
    locationEvidence: locationEvidence(htmlPath)
  }));
  const classifications = new Set(htmlCandidates.map((candidate) => candidate.locationEvidence));
  const ambiguityReasons = [];
  if (classifications.has("prototype-like") && classifications.has("application-like")) {
    ambiguityReasons.push("HTML exists in both prototype-like and application-source locations");
  }
  if (htmlCandidates.length && classifications.size === 1 && classifications.has("unknown")) {
    ambiguityReasons.push("HTML exists only in unclassified locations");
  }
  if (!htmlCandidates.length) ambiguityReasons.push("No HTML files found in the project");
  return {
    projectRoot: absoluteRoot.split(path.sep).join("/"),
    suggestedProjectId: deriveProjectId(path.basename(absoluteRoot), absoluteRoot.split(path.sep).join("/")),
    htmlCandidates,
    scopeAmbiguous: ambiguityReasons.length > 0,
    ambiguityReasons
  };
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--project-root" || !argv[1]) {
    throw new Error("Usage: discover-project.mjs --project-root PATH");
  }
  return { projectRoot: argv[1] };
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  try {
    const report = await discoverProject(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
