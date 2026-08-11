# Installation and Release policy

## Contents

1. Install the global Skill
2. Resolve scripts
3. Discover a project
4. Authorize and install the SDK
5. Upgrade policy
6. Discover and register logical Hash routes
7. Relative-path gate

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

## 6. Discover and register logical Hash routes

Treat route-source inspection as read-only. After the user authorizes installation or asks to refresh logical routes, inspect the selected physical HTML and its Vue Router or equivalent route declarations. If no router exists, keep that HTML as one document page. If several physical HTML files exist, resolve each one independently.

For Hash routes:

1. Read declared router source rather than inferring templates from a live URL.
2. Preserve declared `:parameters`, optional parameters, and catch-all syntax in `routePattern`.
3. Exclude query parameters from identity and treat an ordinary `#section` as the base document page.
4. Create an Agent-controlled JSON file containing only `{ "title", "routePattern" }` entries.
5. Run `set-routes.mjs --confirm-route-write`, then regenerate route registries and Views.
6. If source evidence cannot distinguish a dynamic template, keep the visited route in the SDK's unregistered-route isolation cache and ask the user. Never infer `:id` from a numeric or UUID-looking segment.

```powershell
node (Join-Path $skillDir "scripts/set-routes.mjs") `
  --project-root $projectRoot `
  --html "prototype/index.html" `
  --routes "<agent-controlled-routes.json>" `
  --confirm-route-write

node (Join-Path $skillDir "scripts/refresh-project.mjs") --project-root $projectRoot
node (Join-Path $skillDir "scripts/check-project.mjs") --project-root $projectRoot
```

Route registration may create logical-page annotation JSON, View, and route-registry assets. It does not authorize creating or editing a PRD, field specification, API document, or other source document. A direct deep link such as `#/message/edit/123` resolves through the registered template before its page View is displayed.

## 7. Relative-path gate

Require each enabled page to contain exactly one local script with:

```html
<script src="../.prd-annotator/sdk/prd-annotator.js" data-project-id="project-a13f92" data-page-id="index-7c31fa" data-view-src="../.prd-annotator/view/pages/index-7c31fa.js" data-route-src="../.prd-annotator/view/routes/index-7c31fa.js"></script>
```

Calculate `src`, `data-view-src`, and optional `data-route-src` separately from each HTML directory. Use forward slashes. Reject absolute, `file://`, HTTP/CDN, or escaping paths. Require resolved files to exist inside the project and match manifest identity. One physical HTML keeps one SDK tag even when its route registry declares several logical pages.

Finish installation with:

```powershell
node (Join-Path $skillDir "scripts/refresh-project.mjs") --project-root $projectRoot
node (Join-Path $skillDir "scripts/check-project.mjs") --project-root $projectRoot
```
