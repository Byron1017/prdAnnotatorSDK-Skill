# PRD Annotator Collapsible Tool Launcher Design

## Problem

PRD Annotator currently keeps two large fixed buttons at the bottom-right corner of every enabled prototype page. On pages that also use a fixed bottom action bar, the SDK buttons can cover the prototype's own actions. Users need to hide the launcher without removing the SDK or losing annotations and PRD data, and they need an obvious way to expand it again.

## Goals

- Let users collapse and expand the `标注模式` and `PRD 标注` launcher.
- Reduce the collapsed footprint to a slim right-edge handle.
- Remember the user's choice across reloads, physical HTML pages, and registered Hash routes in the same project.
- Keep launcher preference independent from annotation, View, manifest, and document data.
- Preserve current annotation-mode, editor, Drawer, route, synchronization, and removal behavior.
- Provide keyboard and screen-reader operability.

## Non-goals

- No dragging or free positioning.
- No automatic hiding based on time, scrolling, or pointer movement.
- No global keyboard shortcut.
- No annotation JSON, manifest, View, PRD, field-specification, or API-document schema changes.
- No implicit SDK upgrade, project installation, release, or global Skill update.

## Chosen interaction

### Expanded state

The launcher remains at its current bottom-right position. It contains:

1. `标注模式`
2. `PRD 标注`
3. A narrow collapse button at the right side of the group

The collapse button is 32 pixels wide and 44 pixels high. Its visible chevron points toward the right edge, and its accessible label is `收起 PRD 标注工具`.

### Collapsed state

The two business action buttons are hidden. The same collapse/expand control becomes a `24 × 44px` half-round handle attached to the right viewport edge. Its chevron points left and its accessible label becomes `展开 PRD 标注工具`.

The handle stays keyboard-focusable. Clicking it, pressing Enter, or pressing Space restores the expanded launcher. When annotation mode is active, the collapsed handle uses the existing orange active color and exposes `展开 PRD 标注工具（标注模式已开启）` as its accessible label so that an active page-capture mode is never visually silent.

Collapsing changes only launcher visibility. It does not close the Drawer, cancel an open annotation editor, turn annotation mode off, alter a pending target, or mutate product data.

## DOM and controller responsibilities

`createShell` owns the semantic launcher structure:

- a launcher container with a collapsed-state attribute;
- an action container holding the two existing business buttons;
- one persistent collapse/expand button with `aria-controls` and `aria-expanded`;
- a decorative chevron hidden from assistive technology.

The runtime controller owns launcher state:

- load the project preference before the host is appended, avoiding an expanded-state flash;
- apply state to the launcher container and toggle button;
- save state after a user-triggered change;
- update the collapsed handle's active annotation indication whenever annotation mode changes;
- retain the state through logical route transitions and mount/unmount cycles.

The toggle does not become part of the public `window.PRDAnnotator` API. Existing integrations continue to see exactly two elements marked as business `tool-button` controls; the new handle has a separate role so existing consumers do not mistake it for a third annotation action.

## Preference storage

Use a dedicated project-level localStorage key such as:

```text
prd-annotator:ui:v1:<project-id>:launcher
```

The stored payload contains only the launcher collapsed Boolean. It is not page-specific, so one choice applies to all physical HTML pages and registered Hash routes sharing the project ID.

This preference must never appear in:

- annotation page JSON;
- `window.PRDAnnotator.getSnapshot()`;
- copied synchronization prompts;
- manifests or generated Views;
- PRD or related document content.

If localStorage read or write throws, the controller falls back to an in-memory preference for the current SDK instance. A failed initial read defaults to expanded. Storage failure must not block SDK mounting, annotation creation, route switching, Drawer use, or synchronization.

## Styling and responsive behavior

- Expanded desktop position remains `right: 20px; bottom: 20px`.
- Expanded narrow-screen position remains `right: 12px; bottom: 12px`.
- The collapsed desktop handle uses `right: 0; bottom: 20px`; at narrow widths it uses `right: 0; bottom: max(12px, env(safe-area-inset-bottom))`.
- The handle keeps a 44-pixel touch height while limiting horizontal obstruction to 24 pixels.
- Shadow, border, focus ring, dark surface, and orange active state reuse existing SDK tokens.
- A `120ms ease` transition animates handle position and chevron direction. Under `prefers-reduced-motion: reduce`, the state change is immediate.
- The launcher must not introduce horizontal document overflow at desktop or 390-pixel mobile widths.

## Accessibility

- The expand/collapse control is a native button.
- `aria-expanded="true"` means the two business actions are visible; `false` means they are hidden.
- `aria-controls` points to the action container.
- Hidden actions are removed from keyboard navigation and the accessibility tree.
- Focus stays on the persistent toggle button through both state changes.
- The collapsed handle draws its focus-visible ring inward so it remains visible when the handle touches the viewport edge.
- Screen-reader labels communicate both the available action and active annotation-mode state.

## Testing strategy

### Unit and integration tests

- Shell markup contains two business tool buttons plus one separate launcher toggle.
- Collapsing hides only the action container and updates `aria-expanded`, labels, and state attributes.
- Expanding restores the action container and focus behavior.
- The project-level preference survives unmount/remount and route transitions.
- A second physical page with the same project ID reads the same preference.
- localStorage read/write failures fall back safely without changing annotation cache records.
- Annotation-mode active state is reflected by the collapsed handle.
- Snapshots and synchronization prompts remain byte-for-byte independent of launcher preference.

### Browser E2E tests

- Collapse the launcher and assert that both business buttons are hidden while the right-edge handle remains visible.
- Reload and verify that the collapsed state remains.
- Switch between a declared Hash route and the base page and verify that the state remains.
- Expand and verify that both existing buttons work unchanged.
- Compare annotation snapshots before and after collapse/expand to prove no data mutation.
- Verify keyboard operation and accessible attributes.
- At a `390 × 844` viewport, verify no horizontal overflow and a handle footprint no wider than 24 pixels.

## Acceptance criteria

1. A user can collapse and expand the launcher without removing the SDK.
2. Collapsed mode exposes only one right-edge handle with a 24-pixel horizontal footprint.
3. The preference persists across reloads, multi-HTML pages, and registered Hash routes in the same project.
4. Annotation, PRD, View, manifest, and synchronization data are unchanged by launcher state.
5. Storage failure does not prevent core SDK use.
6. Keyboard and screen-reader users can identify and operate the control.
7. Existing two-button behavior remains unchanged after expansion.
8. Unit tests, full build, repository gates, and Playwright browser tests pass before implementation is reported complete.
