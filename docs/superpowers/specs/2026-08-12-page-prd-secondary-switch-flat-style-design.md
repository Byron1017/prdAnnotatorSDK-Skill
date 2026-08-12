# Page PRD secondary switch flat-style design

## Purpose

Make the `页面 PRD / 本页补充资料` secondary switch read as an ordinary inline control instead of a floating layer.

## Approved behavior

- Remove `position: sticky` and its `top`/stacking behavior from `.page-document-switcher`.
- Remove any shadow, raised appearance, hover translation, or floating animation from this secondary switch and its buttons.
- Keep the existing border, selected background, text contrast, count, and click/keyboard behavior.
- Let the switch scroll normally with the page PRD panel content.
- Keep the five top-level Drawer Tabs and their sticky horizontal navigation unchanged.

## Boundaries

- Change SDK presentation styles only.
- Do not change annotations, documents, View data, synchronization, localStorage, routing, or authorization rules.
- Keep SDK and package version `2.5.0`; do not publish or update the installed global Skill without separate authorization.

## Verification

- Unit coverage rejects sticky, shadowed, translated, or animated secondary-switch styles.
- Existing Tab order, secondary selection, keyboard interaction, and route-reset tests continue to pass.
- Rebuild the single-file SDK and inspect the control in a narrow Drawer.
