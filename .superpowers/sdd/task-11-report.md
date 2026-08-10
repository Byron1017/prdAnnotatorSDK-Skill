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
  - Rejects unsafe/symlinked ancestors, holds exact before-images, detects non-cooperating byte drift immediately before each commit, atomically quarantines rollback targets before exclusive restoration, and retains an explicit `recovery.json` plus every original/committed/displaced survivor after a committed rollback.
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
  - Preserves unrelated v2 document metadata and persisted previews, allocates collision-safe deterministic IDs for newly explicit legacy PRDs, and rejects duplicate scoped document IDs or paths.
  - Verifies every legacy annotation ID exists in canonical output and rejects conflicting same-ID v2 data rather than choosing one silently.
  - Rejects corrupt/missing/symlinked/escaping sources, any writable HTML target under `doc/prd`, orphaned v2 data/views during install, install over an existing v2 manifest, and upgrade without a valid existing v2 manifest.
  - Writes canonical annotations, views, authorized HTML integration, and the v2 manifest in one locked transaction while source `doc/prd` bytes remain read-only.
- `prd-annotator-skill/scripts/check-project.mjs`
  - Uses the shared deterministic renderer for managed byte checks.
  - Applies managed rendering only when explicit managed fields exist and requires the referenced inventory entries to prove `managed: true` Skill provenance.
- `prd-annotator-skill/scripts/lib/documents.mjs`
  - Preserves literal managed provenance across ordinary document refresh so a valid managed installation remains gateable.
- `tests/unit/managed-prd.test.js`
  - Adds 43 deterministic rendering/generation and rollback-safety tests.
- `tests/unit/legacy-migration.test.js`
  - Adds 51 non-destructive migration tests.
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
Tests 118 passed | 2 skipped (120)
```

Final full unit suite:

```text
npm run test:unit

Test Files 22 passed (22)
Tests 303 passed | 2 skipped (305)
```

The two skips are explicit Windows file-symlink creation-permission cases in the rollback and project-gate suites. Junction/path containment, rollback, recovery, and concurrency tests executed successfully where the platform allowed link creation.

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

The new public generation and migration modules contain no direct `rm`, `rmdir`, `unlink`, `rename`, or `copyFile` operation. They also contain no network client or request call. The shared transaction helper uses `rename` for staged commits and atomic rollback quarantine, `copyFile` for committed-state backup and exclusive original/displaced restoration, `rm` only for the unique uncommitted transaction staging directory, and `rmdir` only for newly created empty output parents. Every transaction with a committed target retains recovery staging instead of deleting rollback evidence.

## Formal-review follow-up (2026-08-10)

The initial formal review identified six regressions or preservation gaps after the original Task 11 commit. Each behavioral fix below was driven by an observed failing regression before production code changed. A subsequent independent review then found two rollback race gaps, three migration integrity gaps, and two minor coverage gaps; those follow-ups are recorded below as well.

### Findings addressed

1. **Rollback drift and partial recovery:** the shared transaction helper now records exact committed file states, compares type/size/SHA-256 immediately before every reversal, preserves any non-cooperating current target, and continues best-effort rollback of the remaining targets. Retained recovery schema v2 records original, committed, and actual current states plus the surviving target, original-backup, and committed-backup paths.
2. **Migration inventory scope:** migration no longer calls project-wide document discovery. It reads and inventories only the page PRDs explicitly named by the legacy manifest and the defined `doc/prd/PRD.md` total PRD. Unsupported explicit extensions receive deterministic text inventory metadata. During upgrade, unrelated v2 document entries are cloned field-for-field and their already persisted view previews are reused rather than rereading or reclassifying unrelated source files.
3. **Legacy identity:** install accepts valid legacy `projectId` or `projectKey` identity and preserves supplied page title and route. Upgrade compares supplied project, page title, HTML path, and route identity against existing v2 state and rejects conflicts before transaction preparation. The project gate continues to require a non-empty route and exact annotation/view document equality, but no longer incorrectly requires the route to equal `/${page.htmlPath}`.
4. **Root-level document roots:** `.` is a real root candidate. A sole root-level candidate generates `pages/<page-id>.md` and `PRD.md`; multiple candidates including `.` fail with the sorted ambiguity list. Root-relative joins never emit `./` or leading-slash paths, and existing external root files are rejected without overwrite.
5. **Prototype-safe page mapping:** migration builds the page ID map with `Map` and serializes a sorted `Object.fromEntries(...)` result. Keys such as `__proto__`, `constructor`, and `toString` remain own serialized properties with deterministic mapped IDs.
6. **Managed gate regression quality:** the permissive false-positive test was replaced with a project produced by the real managed generator. The complete project first passes `checkProject`; page-byte drift, total-byte drift, and managed-provenance removal are then introduced and rejected independently.

### Independent-review follow-up

- Rollback now atomically renames the live target to a transaction-local displaced path, compares that quarantined state with the committed state, and restores the exact original or displaced file only with exclusive creation. A late file replacement remains recoverable, and a late symlink is quarantined without following or modifying its referent.
- The original backup is written from the exact byte buffer used to define `originalState`; it can no longer diverge through a second live-path read. The focused `A -> B -> A` preparation race confirms exact before-image consistency.
- Scoped post-write verification compares each installed annotation document canonically against the exact planned document, not only its annotation IDs.
- Upgrade preview reuse accepts every persisted string, including the empty string, and does not reread unrelated source bytes.
- New explicit legacy PRDs allocate deterministic collision-free IDs against every preserved v2 document ID (`<hash-id>-2`, then increasing suffixes), and the scoped inventory rejects duplicate IDs or paths before any transaction write.
- Successful supplied legacy `projectId` preservation and upgrade `htmlPath` conflict/no-write behavior now have direct regressions; the latter snapshots the complete project tree.

### Observed RED and GREEN evidence

- Rollback regressions initially showed the external edit being overwritten with no recovery record and showed an exception on the middle reversal leaving an earlier target committed. The eight focused rollback/concurrency cases now pass.
- Inventory regressions initially included legacy JSON, unreferenced `doc/prd` Markdown, and unrelated project Markdown; an unrelated v2 entry also lost custom metadata. The three focused inventory/preservation cases now pass.
- Identity regressions initially ignored `projectKey`, silently accepted upgrade project/title/route conflicts, and replaced a custom route with the HTML-derived route. The focused migration and gate identity cases now pass, including no-write snapshots and five invalid-route inputs.
- Root inference initially defaulted to `doc/prd`, omitted `.` from ambiguity, and selected the wrong collision target. All five root/default/ambiguity cases now pass with exact output and link assertions.
- The prototype regression initially omitted `__proto__` from `Object.keys(pageIdMap)`. Both the existing deterministic-ID case and the prototype-name case now pass.
- The rewritten gate test first proves a valid generated managed project passes, then verifies three independent rejection paths.

### Migration-scoped integrity boundary

Migration cannot invoke the global project gate without violating its explicit inventory boundary: the global gate intentionally performs project-wide discovery and completeness checks. The migration transaction therefore performs scoped post-write integrity verification of the exact manifest, exact planned canonical annotations plus legacy ID parity, generated view bytes, and integrated HTML bytes. A later explicit `refresh-project` followed by the full gate remains the workflow that opts into project-wide discovery. The global gate itself was not weakened for document inventory, source fingerprints, managed provenance, integration identity, path containment, or view equality.

### Fresh formal-review verification

```text
npx vitest run tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js tests/unit/project-gate.test.js
Test Files 3 passed (3)
Tests 118 passed | 2 skipped (120)

npm run test:unit
Test Files 22 passed (22)
Tests 303 passed | 2 skipped (305)

npm run build
exit 0

node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
PRD Annotator gate passed: 1 pages, 1 annotations, 2 documents
```

All four modified production modules pass `node --check`; `git diff --check` reports no whitespace errors. The two fixture source PRD Git blob hashes still match `HEAD` exactly:

```text
d5342876673686497ef34fe6b8c5f7b7c9d52fcd  tests/fixtures/project/doc/prd/PRD.md
01d19f3862db506f99f4d01c6c5661df42ee7c5a  tests/fixtures/project/doc/prd/pages/equipment-ops.md
```

No product documentation, current user PRD, fixture source PRD, or Skill workflow documentation changed. The public generation and migration modules still contain no destructive filesystem primitive or network client call.

### Final formal-review verdict

The independent follow-up review found no Critical or Important issues and approved Task 11 as Ready. Its two Minor notes (truthful Windows symlink skipping and exact planned-annotation wording in this report) were addressed before commit.

## Remaining Concern

The cooperative project lock cannot prevent a hostile process from swapping an ancestor junction in the kernel interval between the final path check and a filesystem syscall. Portable Node 20 lacks descriptor-relative no-follow rename primitives to eliminate that race. Fixed symlink/junction ancestors, non-cooperating target-byte drift, and all cooperating Task 6–11 writers are rejected or serialized. This is the same trusted-local-project boundary already documented for the preceding transaction work and is non-blocking.
