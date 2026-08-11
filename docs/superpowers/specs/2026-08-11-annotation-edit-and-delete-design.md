# PRD Annotator Annotation Edit and Delete Design

## Problem

PRD Annotator v2.2.0 can create and display annotations, but it cannot edit or delete them. The Drawer renders annotation cards as read-only content, the editor always creates a new annotation, and both browser-side and Agent-side merge logic deliberately preserve every existing annotation ID. That preservation rule protects annotations from accidental loss, but it also prevents an explicit user deletion from reaching the permanent project JSON.

The product must distinguish two different actions:

- A user explicitly deletes one annotation and expects that annotation to disappear from the active page data after synchronization.
- A user removes the SDK display layer and expects every annotation and PRD asset to remain permanently available.

These actions must never share an implicit “missing item means delete” rule.

## Goals

- Let users edit any active annotation from the `本页标注` tab.
- Let users explicitly delete an active annotation after confirmation.
- Preserve the annotation ID, marker number, target, creation time, PRD linkage, and status during ordinary content edits.
- Persist edits and deletions immediately in the page-specific browser cache.
- Carry explicit deletions through snapshots, copied synchronization prompts, Agent merge, generated Views, and project gates.
- Prevent stale browser caches or permanent-only records from resurrecting a deleted annotation.
- Keep display-layer removal non-destructive.
- Keep annotation synchronization separate from PRD document editing.

## Non-goals

- No bulk editing or bulk deletion.
- No undo history or annotation restore action in this release.
- No editing of the associated DOM target in the edit form.
- No automatic PRD, field-specification, API-document, or related-document edits after an annotation edit or deletion.
- No public destructive method on `window.PRDAnnotator`; edit and delete remain human-facing UI actions.
- No schema-version increment. The new field is a backward-compatible schema-v2 extension.

## Considered approaches

### Hard deletion inferred from a missing annotation

This would compare the incoming annotation list with permanent JSON and delete every missing ID. It is unsafe because an empty, partial, stale, or page-mismatched browser snapshot could erase permanent data. It also contradicts the existing non-destructive synchronization invariant.

### A `deleted` flag on the full annotation record

This preserves explicit intent but leaves deleted annotations mixed into every active annotation consumer. Drawer counts, markers, managed PRDs, validation, and document linkage would all need to remember to filter them. A missed filter could expose deleted content or include it in generated PRDs.

### Separate deletion tombstones

This is the chosen design. Active annotations stay in `annotations`; durable deletion intent stays in a separate `deletedAnnotations` array. The separation keeps active consumers simple and gives synchronization a precise, monotonic signal that cannot be confused with an incomplete list.

## User interaction

### Edit

Each annotation card adds a compact action row containing `编辑` and `删除` buttons. `编辑` opens the existing annotation editor in edit mode with all editable fields prefilled. The heading becomes `编辑本页标注`, and the primary action becomes `保存修改`.

Saving an edit:

- keeps `id`, `createdAt`, `target`, `status`, and the complete `prd` object;
- replaces the editable content fields;
- updates `updatedAt` using the controller clock;
- saves the page cache and rerenders the card, marker, synchronization state, and copied prompt;
- closes the editor and returns focus to the edited card's `编辑` button when possible.

Cancelling changes leaves all data untouched.

### Delete

`删除` opens an accessible confirmation dialog naming the annotation number and title. The dialog explains that:

- the annotation will disappear from this page immediately;
- the user must still synchronize with an AI Agent to update project files;
- PRD and related documents are not changed automatically.

Confirming deletion removes the active annotation, appends or refreshes its tombstone, saves the page cache, removes its marker, rerenders the Drawer, and updates synchronization state. Cancelling leaves all data untouched. Focus returns to the next annotation action, the previous annotation action, or the empty-state container in that order.

## Stable identity and marker numbers

Normal SDK-created IDs remain `A001`, `A002`, and so on. Drawer numbers and marker labels use the numeric portion of this stable ID instead of the current array position. Editing never changes the number. Deleting `A002` therefore leaves `A001` and `A003` as markers `1` and `3`; references in screenshots or conversations do not silently change.

When allocating a new ID, the controller examines both active annotation IDs and deleted tombstone IDs. A deleted ID is never reused. Legacy nonstandard IDs remain valid and receive the existing positional display fallback.

## Page-document data model

Schema-v2 page documents add a durable array:

```json
{
  "schemaVersion": 2,
  "projectId": "device-demo-a13f92",
  "page": {
    "id": "equipment-ops-7c31fa",
    "title": "Equipment Operations",
    "htmlPath": "prototype/index.html",
    "route": "/prototype/index.html"
  },
  "annotations": [],
  "deletedAnnotations": [
    {
      "id": "A002",
      "deletedAt": "2026-08-11T09:00:00.000Z"
    }
  ],
  "managedPrd": null
}
```

Rules:

- `deletedAnnotations` is optional when reading an existing v2.0-v2.2 document and normalizes to `[]`.
- Every newly created or rewritten page document emits `deletedAnnotations` explicitly.
- A tombstone contains only a non-empty annotation ID and an ISO timestamp.
- Tombstone IDs are unique.
- An ID cannot be present in both canonical active annotations and canonical tombstones.
- Tombstones are page-scoped and follow the same project/page identity gates as annotations.
- Tombstones are permanent synchronization metadata but are not rendered as annotation cards or markers and are not included in managed PRD content.

## Browser merge and cache behavior

Browser normalization accepts legacy documents without tombstones. Browser merge performs these steps:

1. Merge active annotations by stable ID, preferring the record with the newest `updatedAt`.
2. Merge tombstones by stable ID, retaining the newest `deletedAt`.
3. Remove every active annotation whose ID has a tombstone.
4. Keep all remaining active annotations and all tombstones.

A tombstone always wins over a matching active record. This makes deletion monotonic and prevents a stale localStorage record, old generated View, or permanent-only record from resurrecting the deleted annotation. Restoration would require a future explicit restore operation that removes the tombstone; omission is never restoration.

The synchronization fingerprint covers both active annotations and tombstones. For backward compatibility, a document with no tombstones keeps the historical `fingerprintValue(annotations)` representation; once tombstones exist, the fingerprint input becomes `{ annotations, deletedAnnotations }`. This preserves existing v2.0-v2.2 Views while ensuring that a browser-only annotation created and then deleted cannot falsely return to the `synced` state.

## Agent synchronization

Snapshots and copied prompts include the complete page document, including tombstones. The prompt uses the same compatibility-preserving fingerprint input: the annotation array when tombstones are empty, otherwise a canonical object containing both `annotations` and `deletedAnnotations`.

`merge-annotations.mjs` applies the same merge order as the browser:

1. Validate project, page, paths, snapshot envelope, active annotations, and tombstones.
2. Merge active records by newest `updatedAt` while retaining the existing equal-timestamp conflict gate.
3. Merge tombstones by newest `deletedAt` while rejecting conflicting equal-timestamp tombstones.
4. Remove all matching active IDs.
5. Write the canonical page JSON atomically, regenerate Views, and run `check-project.mjs`.

The former “permanent annotation ID set may never shrink” gate changes to “the permanent active ID set may shrink only when the merged document contains an explicit same-page tombstone for every removed ID.” Empty or partial snapshots without tombstones remain non-destructive.

The CLI success report includes incoming active count, incoming deletion count, resulting active count, and total tombstone count.

## PRD and document boundary

Editing or deleting an annotation authorizes only browser cache changes and, after synchronization, annotation JSON plus generated View changes. It does not authorize editing any page PRD, total PRD, field specification, API document, or related document.

After synchronization, a deleted annotation no longer appears in the Drawer. Existing source documents may still mention its old requirement until the user separately asks the AI Agent to update those documents. The confirmation dialog and Skill workflow state this boundary explicitly.

## Display-layer removal

Snapshot-verified SDK removal continues to preserve all active annotations and all tombstones. The removal workflow may synchronize a previously confirmed deletion because that deletion is explicit in the current snapshot, but removal itself never creates a tombstone and never deletes annotation data by absence.

The `.prd-annotator/` directory, page JSON, generated Views, source documents, and browser cache remain after the HTML display integration is removed.

## Accessibility and styling

- Card actions use native buttons with annotation-specific accessible labels.
- Edit and delete controls meet the existing 44-pixel touch-target behavior at narrow widths without making cards excessively tall on desktop.
- Delete uses the existing danger color only for the destructive action and confirmation button.
- The confirmation surface uses `role="dialog"`, `aria-modal="true"`, a labelled heading, a described consequence message, initial focus on `取消`, focus trapping, Escape-to-cancel, and focus restoration.
- Editor headings and primary-action labels distinguish create and edit modes.
- Action rows wrap without horizontal overflow at a 390-pixel viewport.
- Reduced-motion preferences continue to disable nonessential transitions.

## Error and conflict handling

- Missing annotation IDs, invalid tombstone timestamps, duplicate tombstones, or active/tombstone overlap fail validation.
- A requested edit or delete for an annotation that is no longer active is ignored safely and rerenders current state.
- A cache write failure keeps the current in-memory edit or tombstone and exposes the existing memory-only synchronization warning.
- Same-ID, same-`updatedAt` active records with different bytes remain a merge conflict.
- Same-ID, same-`deletedAt` tombstones with different bytes remain a merge conflict, although canonical tombstones currently contain no optional fields.
- A copied prompt with a fingerprint that excludes or alters tombstones is rejected.
- Agent merge and project transactions retain their existing lock, drift, rollback, and recovery guarantees.

## Testing strategy

### Browser model and storage tests

- Legacy documents normalize with an empty tombstone array.
- Tombstones survive cache save/load and hydration.
- Browser merge applies edits by `updatedAt` and prevents tombstoned IDs from returning.
- Empty snapshots without tombstones cannot reduce active annotations.
- Tombstones participate in synchronization fingerprints.
- New IDs skip deleted IDs.

### UI and controller tests

- Every active card exposes edit and delete actions.
- Edit prepopulates all editable fields and preserves stable identity, target, PRD linkage, status, and creation time.
- Invalid edit fields use the existing validation behavior.
- Delete confirmation can be cancelled with its button or Escape.
- Confirmed deletion removes the card and marker, adds one tombstone, and sets unsynchronized state.
- Repeated deletion cannot duplicate tombstones.
- Marker labels remain stable after deleting a middle annotation.
- Focus is restored after edit, cancel, and delete.

### Agent and gate tests

- Snapshot and prompt validation covers tombstones in the fingerprint.
- Agent merge edits newer records without duplicating IDs.
- Agent merge deletes only IDs with explicit tombstones.
- Permanent-only IDs remain when the incoming snapshot merely omits them.
- Stale active data cannot resurrect a tombstoned ID.
- View generation and project gates compare fingerprints over active annotations plus tombstones.
- Display-layer removal retains tombstones and does not invent deletions.
- Legacy projects without `deletedAnnotations` still install, refresh, upgrade, and gate successfully.

### Browser E2E tests

- Create an annotation, edit it, reload, and observe the edited content with the same marker number.
- Delete a middle annotation, cancel once, confirm once, and verify the other marker numbers do not change.
- Copy a synchronization prompt and verify it contains the tombstone and matching fingerprint.
- Refresh a generated View containing a tombstone and verify the deleted annotation does not return.
- Switch physical HTML pages and registered Hash routes to verify edits and deletions remain page-isolated.

## Acceptance criteria

1. Users can edit and explicitly delete active annotations from the `本页标注` tab.
2. Edits preserve stable annotation identity, target, creation time, status, PRD linkage, and marker number.
3. Confirmed deletions immediately remove the card and marker and create a durable same-page tombstone.
4. Deleted IDs cannot reappear through stale cache, old View data, permanent-only data, or repeated synchronization.
5. Missing IDs without tombstones never authorize deletion.
6. Synchronization fingerprints, prompts, Agent merge, Views, and gates all cover tombstones.
7. Annotation edit/delete never implicitly edits PRD or related source documents.
8. Removing the SDK display layer preserves active annotations, tombstones, PRDs, documents, Views, and browser cache.
9. Existing schema-v2 projects without tombstones remain readable and upgrade safely.
10. Unit tests, Agent workflow tests, repository gates, and Playwright E2E tests pass before release.
