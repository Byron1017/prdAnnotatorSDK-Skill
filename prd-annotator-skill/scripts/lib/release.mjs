import { createHash } from "node:crypto";

export const OFFICIAL_REPOSITORY = "Byron1017/prdAnnotatorSDK-Skill";
const SDK_ASSET = "prd-annotator.js";
const CHECKSUM_ASSET = "prd-annotator.js.sha256";
const SDK_BANNER_PATTERN = /^\/\*! PRD Annotator SDK v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) \*\/(?:\r?\n|$)/;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function readSdkVersion(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("Invalid PRD Annotator SDK version banner");
  const match = SDK_BANNER_PATTERN.exec(buffer.toString("utf8"));
  if (!match) throw new Error("Invalid PRD Annotator SDK version banner");
  return match[1];
}

export function validateReleaseInfo(releaseInfo) {
  const version = releaseInfo?.version;
  const expectedUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${version}`;
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version || "") || releaseInfo?.releaseUrl !== expectedUrl) {
    throw new Error("Release metadata is not an official formal Release");
  }
  if (!Buffer.isBuffer(releaseInfo.sdkBuffer)) throw new Error("Release SDK asset must be a Buffer");
  if (!/^[a-f0-9]{64}$/.test(releaseInfo.sha256 || "") || sha256(releaseInfo.sdkBuffer) !== releaseInfo.sha256) {
    throw new Error("Downloaded SDK SHA-256 does not match the Release checksum");
  }
  if (readSdkVersion(releaseInfo.sdkBuffer) !== version) {
    throw new Error("SDK version banner does not match Release metadata");
  }
  return releaseInfo;
}

function assertResponse(response, label) {
  if (!response?.ok) throw new Error(`${label} request failed${response?.status ? ` (${response.status})` : ""}`);
  return response;
}

function requireSingleAsset(assets, name) {
  const matches = assets.filter((asset) => asset?.name === name);
  if (matches.length !== 1) throw new Error(`Release must contain exactly one ${name} asset`);
  return matches[0];
}

function assertOfficialAsset(asset, tag, name) {
  const expected = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/${tag}/${name}`;
  if (asset.browser_download_url !== expected) throw new Error(`Release ${name} must be an official formal Release asset`);
  return expected;
}

export async function resolveLatestRelease({ fetchImpl, repository = OFFICIAL_REPOSITORY } = {}) {
  if (repository !== OFFICIAL_REPOSITORY) throw new Error("SDK Releases must come from the official repository");
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");

  const apiUrl = `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/latest`;
  const releaseResponse = assertResponse(await fetchImpl(apiUrl, {
    headers: { Accept: "application/vnd.github+json" }
  }), "Latest Release");
  const release = await releaseResponse.json();
  if (release?.draft !== false || release?.prerelease !== false) throw new Error("Latest GitHub entry is not a formal Release");
  const versionMatch = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(release?.tag_name || "");
  if (!versionMatch) throw new Error("Release tag must be v<major>.<minor>.<patch>");
  const version = versionMatch[1];
  const releaseUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${version}`;
  if (release.html_url !== releaseUrl) throw new Error("Release URL must be the official repository tag URL");
  if (!Array.isArray(release.assets)) throw new Error("Release assets are missing");

  const sdkAsset = requireSingleAsset(release.assets, SDK_ASSET);
  const checksumAsset = requireSingleAsset(release.assets, CHECKSUM_ASSET);
  const sdkUrl = assertOfficialAsset(sdkAsset, release.tag_name, SDK_ASSET);
  const checksumUrl = assertOfficialAsset(checksumAsset, release.tag_name, CHECKSUM_ASSET);

  const sdkResponse = assertResponse(await fetchImpl(sdkUrl), "SDK asset");
  const checksumResponse = assertResponse(await fetchImpl(checksumUrl), "SDK checksum asset");
  const sdkBuffer = Buffer.from(await sdkResponse.arrayBuffer());
  const checksumText = String(await checksumResponse.text());
  const expectedSha256 = checksumText.endsWith("\r\n")
    ? checksumText.slice(0, -2)
    : checksumText.endsWith("\n")
      ? checksumText.slice(0, -1)
      : checksumText;
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("Release checksum must be exactly 64 lowercase hexadecimal characters");
  }
  if (sha256(sdkBuffer) !== expectedSha256) {
    throw new Error("Downloaded SDK SHA-256 does not match the Release checksum");
  }
  if (readSdkVersion(sdkBuffer) !== version) {
    throw new Error("SDK version banner does not match Release version");
  }
  return validateReleaseInfo({ version, releaseUrl, sdkBuffer, sha256: expectedSha256 });
}
