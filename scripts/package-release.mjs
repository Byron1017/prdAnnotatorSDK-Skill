import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_VERSION = "2.0.0";
const RELEASE_ASSETS = Object.freeze([
  "prd-annotator.js",
  "prd-annotator.js.sha256",
  "release-manifest.json"
]);

export async function packageRelease({
  repositoryRoot,
  outputRoot = path.join(repositoryRoot, "dist/release")
}) {
  const sdkSource = path.join(repositoryRoot, "prd-annotator/prd-annotator.js");
  const sdk = await readFile(sdkSource);
  const firstLine = sdk.toString("utf8").split(/\r?\n/, 1)[0];
  if (firstLine !== "/*! PRD Annotator SDK v2.0.0 */") {
    throw new Error(`Unexpected SDK Release header: ${firstLine}`);
  }

  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8")
  );
  if (packageMetadata.version !== RELEASE_VERSION) {
    throw new Error(
      `Package version ${packageMetadata.version} does not match Release ${RELEASE_VERSION}`
    );
  }

  await mkdir(outputRoot, { recursive: true });
  for (const asset of RELEASE_ASSETS) {
    await rm(path.join(outputRoot, asset), { recursive: true, force: true });
  }

  const checksum = createHash("sha256").update(sdk).digest("hex");
  const manifest = {
    version: RELEASE_VERSION,
    assets: {
      sdk: RELEASE_ASSETS[0],
      checksum: RELEASE_ASSETS[1]
    },
    sha256: checksum
  };

  await writeFile(path.join(outputRoot, RELEASE_ASSETS[0]), sdk);
  await writeFile(path.join(outputRoot, RELEASE_ASSETS[1]), `${checksum}\n`, "utf8");
  await writeFile(
    path.join(outputRoot, RELEASE_ASSETS[2]),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return manifest;
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const outputRoot = path.join(repositoryRoot, "dist/release");
  await packageRelease({ repositoryRoot, outputRoot });
  process.stdout.write(
    `Packaged PRD Annotator SDK v${RELEASE_VERSION}: ${outputRoot}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
