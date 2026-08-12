# Wide Drawer and Document Reading Design

## Purpose

Give PRD Annotator enough desktop width to show all five primary Drawer Tabs without horizontal scrolling, while presenting Page PRD, Page Field specification, Page API document, and Related documents as a comfortable reading workspace.

## Approved direction

Use a responsive wide Drawer with full-width navigation and a centered document reading measure. Do not add a document outline, split view, or any new interaction.

## Drawer layout

- On desktop, set the Drawer width to `clamp(720px, 56vw, 900px)`.
- Keep the Drawer attached to the right edge and preserve its current full-height behavior.
- When the viewport cannot accommodate the `720px` minimum, let the Drawer occupy the full viewport width.
- Keep the Drawer header, current-page information, and primary Tab bar at the full Drawer width.
- Keep the header and five primary Tabs sticky at their existing vertical positions.
- Keep the Page PRD secondary switch in normal content flow; it must continue to scroll with the document.
- Do not change the close button, Tab order, focus model, keyboard navigation, selection state, or panel switching behavior.

## Primary Tabs

- Show `本页标注`, `页面 PRD`, `页面字段规范`, `页面接口文档`, and `关联文档` on one complete row at common desktop widths.
- At `1280px`, `1440px`, and `1920px` viewports, the Tab bar must have no horizontal overflow and no visible horizontal scrollbar.
- Distribute the Tabs using available width while preserving readable labels and the annotation count.
- Do not wrap the primary Tabs onto a second row.
- Retain horizontal scrolling only as the narrow-screen fallback when the viewport is too small to show the labels without compression.
- Preserve the existing selected, hover, focus-visible, and keyboard states.

## Reading workspace

- Apply the centered reading measure only to the four document panels: Page PRD, Page Field specification, Page API document, and Related documents.
- Use `800px` as the document-panel `max-width` and center it within the wider Drawer.
- Keep the Annotations panel structurally unchanged. It benefits from the wider Drawer but does not receive a redesigned annotation card or changed data layout.
- Keep Page PRD's `页面 PRD / 本页补充资料` switch at the top of the centered reading area.
- Do not alter which documents appear, their order, their content, or their scope.

## Document cards and headers

- Present each document as a white reading panel with a restrained border and without decorative elevation.
- Reduce nested gray surfaces and unnecessary border layering.
- Keep multiple documents as distinct blocks with consistent spacing between them.
- Organize each document header into a clear title, source path, and compact metadata row for format, kind, and preview state.
- Visually separate the metadata header from the rendered document body without adding a heavy container hierarchy.
- Keep the four Related-document entry cards and their current drill-in interaction. Normalize their dimensions, spacing, title hierarchy, and count presentation.

## Markdown typography

- Use `15px` body text with `1.75` line-height for document content.
- Increase paragraph and list spacing enough to distinguish ideas without creating excessive vertical gaps.
- Treat `h1` as the document title.
- Give `h2` a clear section break, including restrained divider treatment.
- Make `h3` visibly subordinate to `h2`; do not give every heading equal visual weight.
- Preserve `h4` through `h6` with progressively quieter hierarchy.
- Improve ordered, unordered, and nested-list indentation and row spacing.
- Keep links, inline code, code blocks, blockquotes, warnings, empty states, and horizontal rules in one consistent visual language.
- Do not rewrite, summarize, reorder, or otherwise transform Markdown source content.

## Tables and technical content

- Give Field specification and API tables clearer headers, larger cell padding, balanced line-height, and subtle alternating rows.
- Wrap prose and table-cell text at word boundaries, allow unbroken paths and identifiers to break with `overflow-wrap: anywhere`, and keep table headers on one line until the table's own horizontal scroller is needed.
- Confine horizontal scrolling to an individual table wrapper when a table is wider than the reading measure.
- A wide table must not create horizontal overflow for the Drawer or prototype page.
- Keep code blocks scrollable within the document panel and preserve existing safe rendering behavior.

## Responsive behavior

- Desktop: use `clamp(720px, 56vw, 900px)` and show all five primary Tabs without horizontal scrolling.
- Intermediate widths: shrink the Drawer safely; when the viewport is narrower than the desktop minimum, use the full viewport width.
- Narrow/mobile widths: keep the full-screen Drawer and horizontal Tab scrolling as a fallback; do not compress Tab labels or wrap them onto multiple lines.
- Preserve the current mobile overflow gate: no Drawer or child may enlarge the prototype page beyond the viewport.
- Annotation cards, action buttons, long paths, headings, tables, code blocks, and document cards must remain usable at `390px`.

## Accessibility and interaction

- Preserve semantic `tablist`, `tab`, and `tabpanel` relationships.
- Preserve arrow-key navigation, focused Tab selection, `aria-selected`, and one-visible-panel behavior.
- Preserve visible focus states and sufficient selected/unselected contrast.
- Keep reduced-motion behavior unchanged.
- Do not introduce hover-only information or new gesture requirements.

## Data and product boundaries

- This is a presentation-only SDK change.
- Do not modify annotations, annotation cards, document inventory, View data, Markdown source, document scope, routes, localStorage, synchronization payloads, or Skill rules.
- Do not create, update, choose, merge, or remove a PRD, Field specification, API document, or related document.
- Keep package and SDK version `2.5.1` during implementation.
- Do not push, publish a Release, or update the installed global Skill without separate authorization.

## Verification

- Add unit style contracts for the responsive Drawer width, full-width desktop Tabs, centered document-panel measure, and table-local overflow.
- Preserve existing unit coverage for semantic Tab order, keyboard behavior, secondary-switch normal flow, Markdown safety, annotation cards, and document hub behavior.
- At `1280px`, `1440px`, and `1920px`, verify all five primary Tabs are visible in one row and the Tab bar has no horizontal overflow.
- At an intermediate viewport below the desktop minimum, verify the Drawer fits the viewport.
- At `390px`, verify the Drawer remains full-screen, primary Tabs retain horizontal-scroll fallback, and the page has no viewport overflow.
- Inspect Page PRD with long prose and multilevel headings, Page Field specification with a wide table, Page API document with tables and code, and Related documents with multiple entries.
- Verify the sticky header and primary Tabs do not cover document content.
- Verify the Page PRD secondary switch still scrolls with the document.
- Run the complete unit, build, browser, repository, project, Skill, ASCII-path, UTF-8-without-BOM, and diff gates before reporting implementation complete.
