# Installation and Release policy

## Contents

1. Install the global Skill
2. Resolve scripts
3. Discover a project
4. Authorize and install the SDK
5. Upgrade policy
6. Relative-path gate

## 1. Install the global Skill

Use the official source repository:

```text
https://github.com/Byron1017/prdAnnotatorSDK-Skill
```

Install the complete `prd-annotator-skill` directory as:

```text
$HOME/.agents/skills/prd-annotator/
```

Use a formal Release source archive or an explicitly chosen repository checkout, and preserve `SKILL.md`, `agents/`, `references/`, and `scripts/` together. Codex user skills live under `$HOME/.agents/skills`. Invoke this Skill as `$prd-annotator`.

Treat global Skill installation and target-project SDK installation as separate actions. Skill discovery or implicit matching never authorizes project mutation and does not automatically install the SDK.

## 2. Resolve scripts

Resolve the installed directory once:

```powershell
$skillDir = (Resolve-Path "$HOME/.agents/skills/prd-annotator").Path
$projectRoot = (Resolve-Path "<target-project>").Path
```

Run every command with `Join-Path $skillDir "scripts/<name>.mjs"`. Never run `prd-annotator-skill/scripts/...` relative to the target project.

## 3. Discover a project

Run read-only discovery before installation:

```powershell
node (Join-Path $skillDir "scripts/discover-project.mjs") `
  --project-root $projectRoot
```

Review prototype HTML candidates, existing integrations, `.prd-annotator/manifest.json`, and documents. When mixed source/application HTML or several plausible prototype scopes exist, show the candidates and ask. Pass no guessed pages to the installer.

## 4. Authorize and install the SDK

Accept a direct request to install, enable, add, or use PRD Annotator as explicit authorization. Treat a feasibility question as read-only inspection and wait for confirmation after describing exact changes.

After authorization, install selected project-relative pages:

```powershell
node (Join-Path $skillDir "scripts/install-project.mjs") `
  --project-root $projectRoot `
  --confirm-install `
  --page "prototype/index.html" `
  --page "prototype/settings.html"
```

On first installation, obtain the SDK only from the latest formal GitHub Release. Require `prd-annotator.js` and `prd-annotator.js.sha256`, verify lowercase SHA-256 before writing, and record version, Release URL, checksum, and installation time. Never use raw `master`.

If GitHub or checksum validation fails, stop without injecting broken references.

## 5. Upgrade policy

Reuse an existing valid SDK without contacting GitHub. Never overwrite or upgrade it implicitly. After a separate explicit upgrade request, run:

```powershell
node (Join-Path $skillDir "scripts/install-project.mjs") `
  --project-root $projectRoot `
  --confirm-install `
  --confirm-upgrade `
  --page "prototype/index.html"
```

Validate the new Release before replacing installed bytes. Preserve project/page identities and permanent data.

## 6. Relative-path gate

Require each enabled page to contain exactly one local script with:

```html
<script src="../.prd-annotator/sdk/prd-annotator.js" data-project-id="project-a13f92" data-page-id="index-7c31fa" data-view-src="../.prd-annotator/view/pages/index-7c31fa.js"></script>
```

Calculate `src` and `data-view-src` separately from each HTML directory. Use forward slashes. Reject absolute, `file://`, HTTP/CDN, or escaping paths. Require resolved files to exist inside the project and match manifest identity.

Finish installation with:

```powershell
node (Join-Path $skillDir "scripts/refresh-project.mjs") --project-root $projectRoot
node (Join-Path $skillDir "scripts/check-project.mjs") --project-root $projectRoot
```
