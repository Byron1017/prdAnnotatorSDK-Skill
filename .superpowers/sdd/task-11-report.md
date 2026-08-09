# Task 11 Report: Explicit Managed PRDs and Non-destructive Legacy Migration

## Outcome

Implemented deterministic, consent-gated managed PRD generation and explicit, copy-only migration from the legacy `doc/prd/manifest.json` layout. Managed page and total PRDs are generated only under independently explicit PRD-write intent, carry Skill-created provenance, regenerate static views, and pass the complete project gate in the same locked transaction. Legacy migration copies every annotation into schema-v2 canonical data, preserves or deterministically maps page IDs, inventories source PRDs at their original paths, records exact source evidence, and never moves, edits, or deletes any `doc/prd` source.

Commit message: `feat: generate managed PRDs and migrate legacy data`

## Changed Files

- `prd-annotator-skill/scripts/lib/managed-prd.mjs`
  - Validates managed PRD structures without accepting empty or multiline headings.
  - Renders normalized LF Markdown with exactly one trailing newline.
  - Escapes inline Markdown label characters and renders total-PRD links with POSIX-relative paths from the total file's directory.
- `prd-annotator-skill/scripts/lib/project-transaction.mjs`
  - Provides the Task 11 shared safe-path, timestamp, operation, and all-or-nothing transaction primitives used by both new writers.
  - Rejects unsafe/symlinked ancestors, holds exact before-images, detects non-cooperating byte drift immediately before each commit, rolls back committed targets, and retains an explicit `recovery.json` plus backups if rollback itself cannot finish.
  - This file is intentionally in Task 11 scope: generation and migration both require the same multi-file manifest/annotation/view/HTML/gate transaction semantics, while the prior refresh transaction was private and could not atomically enclose either complete workflow.
- `prd-annotator-skill/scripts/generate-prd.mjs`
  - Exports `generateManagedPrd(...)` and a strict repeated-`--page` CLI with optional `--total` and `--document-root`.
  - Requires literal `confirmPrdWrite === true`.
  - Reuses one plausible PRD root, defaults only when none exists, and stops with every sorted candidate when roots are ambiguous.
  - Refuses external-document collisions and trusts an existing managed path only when its inventory entry has `managed: true` provenance.
  - Writes only selected managed page/total Markdown plus refreshed views and manifest metadata, then runs the complete project gate before the transaction can succeed.
- `prd-annotator-skill/scripts/migrate-legacy.mjs`
  - Exports `migrateLegacy(...)` and a CLI requiring `--confirm-migration` plus exactly one of install or upgrade authorization.
  - Reads only the exact legacy manifest and its explicitly referenced annotation/PRD sources for migration authority.
  - Strictly validates schema-v1 fields before normalization so supplied types, identity, targets, dates, statuses, PRD linkage, and optional v2-shaped fields cannot be silently coerced or discarded.
  - Preserves valid unique ASCII page IDs; deterministically maps invalid/colliding IDs and records the complete `pageIdMap`.
  - Verifies every legacy annotation ID exists in canonical output and rejects conflicting same-ID v2 data rather than choosing one silently.
  - Rejects corrupt/missing/symlinked/escaping sources, any writable HTML target under `doc/prd`, orphaned v2 data/views during install, install over an existing v2 manifest, and upgrade without a valid existing v2 manifest.
  - Writes canonical annotations, views, authorized HTML integration, and the v2 manifest in one locked transaction while source `doc/prd` bytes remain read-only.
- `prd-annotator-skill/scripts/check-project.mjs`
  - Uses the shared deterministic renderer for managed byte checks.
  - Applies managed rendering only when explicit managed fields exist and requires the referenced inventory entries to prove `managed: true` Skill provenance.
- `prd-annotator-skill/scripts/lib/documents.mjs`
  - Preserves literal managed provenance across ordinary document refresh so a valid managed installation remains gateable.
- `tests/unit/managed-prd.test.js`
  - Adds 35 deterministic rendering/generation tests.
- `tests/unit/legacy-migration.test.js`
  - Adds 35 non-destructive migration tests.
- `tests/unit/project-gate.test.js`
  - Adds managed page/total byte and provenance integration coverage.

No product documentation, Skill documentation, current user PRD, or fixture source PRD was edited.

## TDD Evidence

### Initial RED

Before production modules existed:

```text
npx vitest run tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js
```

Result:

```text
Test Files 2 failed (2)
Tests 0 collected
```

Both suites failed at import resolution for the missing `generate-prd.mjs` and `migrate-legacy.mjs` modules. This was the expected feature-missing RED.

### Subsequent RED/GREEN regressions

Observed failing tests were added before fixes for:

- external inventory entries reinterpreted through an untrusted managed path field;
- missing managed provenance in the project gate;
- conflicting same-ID annotations during upgrade;
- malformed v1 fields normalized into valid-looking defaults;
- rollback failure without explicit recovery evidence;
- managed provenance dropped by normal refresh;
- non-cooperating concurrent manifest edits overwritten after transaction preparation;
- orphaned v2 data/views overwritten by install migration;
- a legacy HTML path under `doc/prd` becoming a write target;
- unsupported supplied v1 fields and supplied project/page identity being silently replaced.

Every regression was observed RED for the expected missing behavior and then GREEN after the minimal safety fix.

## Requirement Review

- Managed generation and migration consent accept only primitive Boolean `true`; truthy strings, numbers, objects, boxed Booleans, missing flags, and invalid authorization values are rejected before mutation.
- Page and total Markdown is deterministic LF output with one trailing newline; empty structures and invalid headings/blocks fail closed.
- Total links cover every manifest page and are POSIX-relative to the total PRD file.
- Only Skill-created inventory entries carry `managed: true`; external document entries and bytes remain external and unchanged.
- Root inference reuses exactly one candidate, defaults to `doc/prd` only with no candidate, and reports all sorted candidates on ambiguity.
- Explicit roots and every output/source path are project-relative, ancestor-safe, and symlink/junction guarded.
- Generation, view refresh, manifest update, and the final gate share one project lock and one rollback-capable transaction.
- Transactions compare prepared before-images immediately before replacement, roll back normal partial writes, and retain truthful recovery metadata/backups when rollback is incomplete.
- Migration accepts exactly one install/upgrade authorization, reads `doc/prd/manifest.json`, copies every normalized annotation, preserves exact ID parity, and records `source`, `migratedAt`, 64-hex `sourceSha256`, `pageIdParityVerified`, and `pageIdMap`.
- Valid unique legacy page IDs remain unchanged; invalid or colliding IDs map deterministically without losing their source identity.
- Existing valid v2 installations are never silently overwritten: install refuses them and orphan data/view state; upgrade requires a valid manifest and rejects conflicting annotation IDs.
- Every `doc/prd` source byte remains unchanged on success and failure; no migration transaction target may be within that source root.
- The complete gate compares managed bytes only when managed fields exist and never renders ordinary external entries as managed PRDs.

## Independent Review

The mandatory independent review initially found one Critical and two Important preservation gaps: orphaned v2 artifacts, writable legacy HTML under `doc/prd`, and unsupported supplied v1 values normalized away. After RED/GREEN fixes, follow-up review found one remaining supplied identity replacement path. That path was also fixed with RED/GREEN project/page identity regressions.

Final reviewer verdict:

```text
Ready — no Critical or Important issues remain.
```

## Fresh Verification

Final focused suite:

```text
npx vitest run tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js tests/unit/project-gate.test.js

Test Files 3 passed (3)
Tests 94 passed | 1 skipped (95)
```

Final full unit suite:

```text
npm run test:unit

Test Files 22 passed (22)
Tests 279 passed | 1 skipped (280)
```

The single skip is the existing Windows file-symlink creation-permission case in the project-gate suite. Junction/path containment, Task 11 symlink checks, rollback, recovery, and concurrency tests executed successfully where the platform allowed link creation.

Additional checks:

```text
npm run build
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
node --check <all new/modified Task 11 production modules>
git diff --check
```

Results:

```text
build: exit 0
fixture gate: PRD Annotator gate passed: 1 pages, 1 annotations, 2 documents
syntax checks: exit 0
git diff --check: exit 0, no whitespace errors
```

## Source Preservation and Prohibited-operation Audit

Fixture source PRD Git blob hashes match `HEAD` exactly:

```text
d5342876673686497ef34fe6b8c5f7b7c9d52fcd  tests/fixtures/project/doc/prd/PRD.md
01d19f3862db506f99f4d01c6c5661df42ee7c5a  tests/fixtures/project/doc/prd/pages/equipment-ops.md
```

Protected product/Skill/source-document diff:

```text
PROTECTED_DOC_DIFF=NONE
```

The new public generation and migration modules contain no direct `rm`, `rmdir`, `unlink`, `rename`, or `copyFile` operation. They also contain no network client or request call. The shared transaction helper uses `rename` only for staged Task 11 outputs, `copyFile` only for exact before-image backup/restore, `rm` only for an exact newly created output during rollback and the unique transaction staging directory, and `rmdir` only for newly created empty output parents. Incomplete rollback retains recovery instead of cleaning it.

## Remaining Concern

The cooperative project lock cannot prevent a hostile process from swapping an ancestor junction in the kernel interval between the final path check and a filesystem syscall. Portable Node 20 lacks descriptor-relative no-follow rename primitives to eliminate that race. Fixed symlink/junction ancestors, non-cooperating target-byte drift, and all cooperating Task 6–11 writers are rejected or serialized. This is the same trusted-local-project boundary already documented for the preceding transaction work and is non-blocking.
