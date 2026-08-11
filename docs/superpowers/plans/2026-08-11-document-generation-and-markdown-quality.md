# Document Generation and Markdown Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PRD Annotator a self-contained, consent-gated writing reference layer for page PRDs, total PRDs, field specifications, and API documents, and render those documents readably and safely in the Drawer.

**Architecture:** Document authoring remains an AI Skill workflow that loads one focused reference per requested document type; no external Skill is installed or called at runtime. The browser SDK gains a safe inline Markdown renderer and a separate GFM table parser, both creating DOM nodes without `innerHTML`. Annotation code and annotation schema remain outside this plan.

**Tech Stack:** Markdown reference files, JavaScript ES2022, Node.js 20.11+, Vitest 3, jsdom 26, Playwright 1.55, esbuild 0.25.

## Global Constraints

- The three external Skill sources influence document generation and formatting only; they never define or mutate annotation fields, annotation synchronization, deletion, page identity, or annotation gates.
- Require separate explicit user intent before creating or editing any page PRD, total PRD, field specification, API document, or related document.
- Keep existing-document and sole-unambiguous-target selection ahead of all built-in fallback structures.
- Never choose or merge ambiguous PRDs, templates, or document roots for the user.
- Do not invent product, backend, security, legal, API, field, or business facts.
- Keep `schemaVersion: 2` and add no runtime service or runtime package dependency.
- Render Markdown only with DOM APIs; never assign source content to `innerHTML` and never render raw HTML.
- Permit only relative links, page fragments, `http:`, `https:`, and `mailto:`; reject dangerous or unknown protocols.
- Keep source paths ASCII-only and internal document links project-relative.
- Do not hand-edit `prd-annotator/prd-annotator.js`; regenerate it with `npm run build`.
- This plan does not bump the package or SDK version and does not publish a Release.
- Approved design: `docs/superpowers/specs/2026-08-11-annotation-and-document-quality-design.md`.

---

## File Map

- `prd-annotator/src/markdown-inline.js`: Safe inline code, emphasis, strong text, and links.
- `prd-annotator/src/markdown-table.js`: GFM table recognition, cell splitting, alignment, and DOM creation.
- `prd-annotator/src/markdown.js`: Block parser orchestration using the two focused helpers.
- `prd-annotator/src/ui/styles.js`: Shared Markdown table, code, and link presentation.
- `prd-annotator-skill/SKILL.md`: Conditional reference routing and document/annotation boundary.
- `prd-annotator-skill/references/prd-workflow.md`: Existing authorization workflow linked to focused writing references.
- `prd-annotator-skill/references/document-writing.md`: Evidence, selection, ambiguity, and quality workflow.
- `prd-annotator-skill/references/markdown-style.md`: Markdown source and readability rules.
- `prd-annotator-skill/references/page-prd.md`: Page-local PRD fallback structure.
- `prd-annotator-skill/references/total-prd.md`: Total PRD and cross-page fallback structure.
- `prd-annotator-skill/references/field-spec.md`: Field specification fallback structure.
- `prd-annotator-skill/references/api-document.md`: Product API document fallback structure.
- `tests/unit/markdown.test.js`: Parser behavior and security.
- `tests/unit/prd-drawer.test.js`: Document-card integration and table container behavior.
- `tests/unit/skill-scripts.test.js`: Skill routing, boundary, and reference contracts.
- `tests/e2e/prd-annotator.spec.js`: Real Drawer document rendering.
- `prd-annotator/prd-annotator.js`: Generated single-file SDK output.

### Task 1: Add a safe inline Markdown renderer

**Files:**
- Create: `tests/unit/markdown.test.js`
- Create: `prd-annotator/src/markdown-inline.js`
- Modify: `prd-annotator/src/markdown.js`

**Interfaces:**
- Produces: `sanitizeMarkdownHref(value): string | null` and `appendInlineMarkdown(document, parent, source): void`.
- Consumed by: `renderMarkdown(document, markdown)` and the table renderer in Task 2.

- [ ] **Step 1: Create focused inline-rendering tests**

Create `tests/unit/markdown.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../prd-annotator/src/markdown.js";
import {
  sanitizeMarkdownHref
} from "../../prd-annotator/src/markdown-inline.js";

function render(source) {
  const container = document.createElement("div");
  container.append(renderMarkdown(document, source));
  return container;
}

describe("safe Markdown rendering", () => {
  it("renders inline code, strong text, emphasis, and safe links", () => {
    const container = render([
      "Use `deviceId`, **confirm the action**, and *show feedback*.",
      "Read [field rules](../data/fields.md) or [the API](https://example.test/api)."
    ].join("\n"));

    expect(container.querySelector("code").textContent).toBe("deviceId");
    expect(container.querySelector("strong").textContent).toBe("confirm the action");
    expect(container.querySelector("em").textContent).toBe("show feedback");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href")))
      .toEqual(["../data/fields.md", "https://example.test/api"]);
    expect(links[1].target).toBe("_blank");
    expect(links[1].rel).toBe("noopener noreferrer");
  });

  it.each([
    ["#section", "#section"],
    ["docs/page.md", "docs/page.md"],
    ["../fields.md", "../fields.md"],
    ["mailto:owner@example.test", "mailto:owner@example.test"],
    ["https://example.test", "https://example.test"],
    ["javascript:alert(1)", null],
    ["data:text/html,unsafe", null],
    ["file:///C:/secret.txt", null],
    ["//evil.example.test/path", null],
    ["\\\\evil.example.test\\path", null]
  ])("sanitizes Markdown href %s", (source, expected) => {
    expect(sanitizeMarkdownHref(source)).toBe(expected);
  });

  it("renders rejected links and raw HTML as inert text", () => {
    const container = render([
      "[unsafe](javascript:window.hacked=true)",
      "<img src=x onerror=window.hacked=true>"
    ].join("\n\n"));

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("unsafe");
    expect(container.textContent).toContain("<img");
    expect(window.hacked).toBeUndefined();
  });

  it("supports inline formatting in headings and list items", () => {
    const container = render("## **Fields** and `codes`\n\n- Use *clear* labels");

    expect(container.querySelector("h2 strong").textContent).toBe("Fields");
    expect(container.querySelector("h2 code").textContent).toBe("codes");
    expect(container.querySelector("li em").textContent).toBe("clear");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npx vitest run tests/unit/markdown.test.js
```

Expected: FAIL because `markdown-inline.js` does not exist and current block nodes use plain `textContent`.

- [ ] **Step 3: Implement the inline renderer**

Create `prd-annotator/src/markdown-inline.js` with:

```js
const INLINE_PATTERN = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\n]+)\)|\*([^*\n]+)\*|_([^_\n]+)_/g;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEME = /^(?:https?:|mailto:)/i;

export function sanitizeMarkdownHref(value) {
  const href = String(value || "").trim();
  if (!href || href.startsWith("//") || href.startsWith("\\\\")) return null;
  if (href.startsWith("#")) return href;
  if (EXPLICIT_SCHEME.test(href)) return ALLOWED_SCHEME.test(href) ? href : null;
  return href;
}

function appendText(document, parent, value) {
  if (value) parent.append(document.createTextNode(value));
}

export function appendInlineMarkdown(document, parent, source) {
  const text = String(source || "");
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    appendText(document, parent, text.slice(cursor, match.index));
    const [token, codeText, starStrong, underscoreStrong, linkLabel,
      linkHref, starEmphasis, underscoreEmphasis] = match;
    if (codeText !== undefined) {
      const code = document.createElement("code");
      code.className = "markdown-inline-code";
      code.textContent = codeText;
      parent.append(code);
    } else if (starStrong !== undefined || underscoreStrong !== undefined) {
      const strong = document.createElement("strong");
      appendInlineMarkdown(document, strong, starStrong ?? underscoreStrong);
      parent.append(strong);
    } else if (linkLabel !== undefined) {
      const href = sanitizeMarkdownHref(linkHref);
      if (!href) {
        appendInlineMarkdown(document, parent, linkLabel);
      } else {
        const link = document.createElement("a");
        link.setAttribute("href", href);
        if (/^https?:/i.test(href)) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        appendInlineMarkdown(document, link, linkLabel);
        parent.append(link);
      }
    } else {
      const emphasis = document.createElement("em");
      appendInlineMarkdown(document, emphasis, starEmphasis ?? underscoreEmphasis);
      parent.append(emphasis);
    }
    cursor = match.index + token.length;
  }
  appendText(document, parent, text.slice(cursor));
}
```

- [ ] **Step 4: Route block text through the inline renderer**

In `prd-annotator/src/markdown.js`, import `appendInlineMarkdown`. Replace `textContent` assignments for headings, list items, blockquotes, and paragraphs with calls of this form:

```js
appendInlineMarkdown(document, node, heading[2].trim());
appendInlineMarkdown(document, item, itemMatch[1].trim());
appendInlineMarkdown(document, blockquote, quoteLines.join("\n"));
appendInlineMarkdown(document, paragraph, paragraphLines.join(" "));
```

Keep fenced code blocks on `code.textContent`; code block contents must never be parsed as inline Markdown.

- [ ] **Step 5: Run inline and existing Drawer security tests**

Run:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Expected: PASS, including the pre-existing raw-script inertness test.

- [ ] **Step 6: Commit safe inline Markdown**

```powershell
git add prd-annotator/src/markdown-inline.js prd-annotator/src/markdown.js tests/unit/markdown.test.js
git commit -m "feat: render safe inline markdown"
```

### Task 2: Add GFM table parsing and readable Drawer styles

**Files:**
- Create: `prd-annotator/src/markdown-table.js`
- Modify: `prd-annotator/src/markdown.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `tests/unit/markdown.test.js`
- Modify: `tests/unit/prd-drawer.test.js`

**Interfaces:**
- Produces: `parseMarkdownTable(lines, startIndex)` and `renderMarkdownTable(document, table)`.
- Consumes: `appendInlineMarkdown(document, parent, source)` from Task 1.

- [ ] **Step 1: Add table parsing, alignment, escaping, and fallback tests**

Append to `tests/unit/markdown.test.js`:

```js
describe("GFM tables", () => {
  it("renders a semantic table inside a horizontal scroller", () => {
    const container = render([
      "| Method | Path | Purpose |",
      "|:---|:---:|---:|",
      "| `GET` | `/messages` | List messages |",
      "| `POST` | `/messages` | Create a message |"
    ].join("\n"));

    const wrapper = container.querySelector(".markdown-table-scroll");
    const table = wrapper.querySelector("table.markdown-table");
    expect([...table.querySelectorAll("thead th")].map((node) => node.textContent))
      .toEqual(["Method", "Path", "Purpose"]);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.querySelector("tbody code").textContent).toBe("GET");
    expect([...table.querySelectorAll("thead th")].map((node) => node.dataset.align))
      .toEqual(["left", "center", "right"]);
  });

  it("keeps escaped and inline-code pipes inside one cell", () => {
    const container = render([
      "| Field | Rule |",
      "|---|---|",
      "| `status|code` | enabled \\| disabled |"
    ].join("\n"));

    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("status|code");
    expect(cells[1].textContent).toBe("enabled | disabled");
  });

  it("falls back to readable text when the delimiter row is invalid", () => {
    const container = render("| Field | Rule |\n| one dash | - |\n| id | required |");

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("| Field | Rule |");
  });
});
```

In `tests/unit/prd-drawer.test.js`, change one field-spec document content to a real table and assert its `.document-card` contains `.markdown-table-scroll > .markdown-table`.

- [ ] **Step 2: Run table tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Expected: FAIL because table source is still rendered as one paragraph.

- [ ] **Step 3: Implement the table parser and renderer**

Create `prd-annotator/src/markdown-table.js` with:

```js
import { appendInlineMarkdown } from "./markdown-inline.js";

const DELIMITER_CELL = /^:?-{3,}:?$/;

function splitTableRow(line) {
  let source = String(line || "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      inCode = !inCode;
      cell += character;
    } else if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignmentFor(delimiter) {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

export function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length || !lines[startIndex].includes("|")) return null;
  const headers = splitTableRow(lines[startIndex]);
  const delimiters = splitTableRow(lines[startIndex + 1]);
  if (
    headers.length < 2
    || delimiters.length !== headers.length
    || delimiters.some((cell) => !DELIMITER_CELL.test(cell))
  ) return null;

  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim()) {
    if (!lines[nextIndex].includes("|")) break;
    const cells = splitTableRow(lines[nextIndex]);
    if (cells.length !== headers.length) break;
    rows.push(cells);
    nextIndex += 1;
  }
  return {
    headers,
    alignments: delimiters.map(alignmentFor),
    rows,
    nextIndex
  };
}

function appendCell(document, row, tagName, value, alignment) {
  const cell = document.createElement(tagName);
  cell.dataset.align = alignment;
  if (tagName === "th") cell.scope = "col";
  appendInlineMarkdown(document, cell, value);
  row.append(cell);
}

export function renderMarkdownTable(document, table) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-table-scroll";
  const element = document.createElement("table");
  element.className = "markdown-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  table.headers.forEach((header, index) => {
    appendCell(document, headRow, "th", header, table.alignments[index]);
  });
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const sourceRow of table.rows) {
    const row = document.createElement("tr");
    sourceRow.forEach((value, index) => {
      appendCell(document, row, "td", value, table.alignments[index]);
    });
    body.append(row);
  }
  element.append(head, body);
  wrapper.append(element);
  return wrapper;
}
```

- [ ] **Step 4: Integrate tables into the block parser**

In `prd-annotator/src/markdown.js`, import `parseMarkdownTable` and `renderMarkdownTable`. At the start of each non-empty block iteration, before fenced code and headings, use:

```js
const table = parseMarkdownTable(lines, index);
if (table) {
  fragment.append(renderMarkdownTable(document, table));
  index = table.nextIndex;
  continue;
}
```

Change paragraph continuation so it stops when `parseMarkdownTable(lines, index)` returns a table. Keep invalid delimiter rows as ordinary paragraph text.

- [ ] **Step 5: Add shared Markdown presentation styles**

In `prd-annotator/src/ui/styles.js`, add:

```css
  .markdown-table-scroll {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    border: 1px solid var(--prd-color-border);
    border-radius: 8px;
    background: #ffffff;
  }

  .markdown-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    color: #334155;
    font-size: 12px;
    line-height: 1.5;
  }

  .markdown-table th,
  .markdown-table td {
    min-width: 96px;
    max-width: 320px;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 10px;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  .markdown-table th {
    background: #f1f5f9;
    color: #17212b;
    font-weight: 700;
    white-space: nowrap;
  }

  .markdown-table tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  .markdown-table [data-align="center"] { text-align: center; }
  .markdown-table [data-align="right"] { text-align: right; }

  .markdown-inline-code {
    border-radius: 4px;
    padding: 1px 4px;
    background: #e2e8f0;
    color: #9a3412;
    font: 0.92em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    white-space: nowrap;
  }

  [data-role="prd-content"] a,
  .document-content a {
    color: #b45309;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
```

Remove the right border from the last column and bottom border from the last row with focused `:last-child` rules.

- [ ] **Step 6: Run parser and Drawer tests**

Run:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit tables and styles**

```powershell
git add prd-annotator/src/markdown-table.js prd-annotator/src/markdown.js prd-annotator/src/ui/styles.js tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
git commit -m "feat: render readable markdown tables"
```

### Task 3: Add the document workflow and Markdown writing references

**Files:**
- Create: `prd-annotator-skill/references/document-writing.md`
- Create: `prd-annotator-skill/references/markdown-style.md`
- Modify: `prd-annotator-skill/SKILL.md`
- Modify: `prd-annotator-skill/references/prd-workflow.md`
- Modify: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: an explicit natural-language document request, logical-page JSON, and Manifest document inventory.
- Produces: conditional routing to one core writing reference, one style reference, and one document-type reference.

- [ ] **Step 1: Add a failing Skill boundary and routing test**

Append to the `global Skill contract` describe block in `tests/unit/skill-scripts.test.js`:

```js
it("loads document writing references only for explicit document work", () => {
  const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const workflow = readFileSync(
    path.join(skillRoot, "references/document-writing.md"),
    "utf8"
  );
  const style = readFileSync(
    path.join(skillRoot, "references/markdown-style.md"),
    "utf8"
  );

  for (const reference of [
    "document-writing.md",
    "markdown-style.md",
    "page-prd.md",
    "total-prd.md",
    "field-spec.md",
    "api-document.md"
  ]) expect(skillSource).toContain(reference);

  expect(skillSource).toContain("only when the user has separately authorized document work");
  expect(workflow).toContain("Never create or edit a document from annotation synchronization alone");
  expect(workflow).toContain("read-only evidence");
  expect(workflow).toContain("must not modify annotation JSON");
  expect(style).toContain("three to six columns");
  expect(style).toContain("Do not emit empty placeholder tables");
});
```

- [ ] **Step 2: Run the Skill contract test and verify failure**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "loads document writing references"
```

Expected: FAIL because the new references and routing text do not exist.

- [ ] **Step 3: Create the core document-writing reference**

Create `prd-annotator-skill/references/document-writing.md` with this complete contract:

```markdown
# Document writing workflow

## Boundary

Use this workflow only after the user separately authorizes creating, organizing, generating, supplementing, or updating a document. Never create or edit a document from annotation synchronization alone. The three external reference approaches influence document writing only; they do not define annotation fields, storage, merge, deletion, identity, fingerprinting, or gates.

Synchronized page annotations are read-only evidence for an authorized document task. Document work must not modify annotation JSON. After writing documents, refresh generated Views only so the Drawer can display the current source documents.

## Select the target

1. Use the exact document named by the user.
2. Otherwise use a sole unambiguous same-kind target and existing structure.
3. When several documents, roots, or templates are plausible, list title, project-relative path, kind, and evidence, then ask.
4. Never choose, merge, move, delete, or demote unselected candidates.
5. Use a built-in fallback reference only when the project has no unambiguous same-kind convention.

## Establish facts

Read evidence in this order:

1. Current explicit user decisions.
2. Confirmed prototype page, logical route, and observable behavior.
3. Permanently synchronized logical-page annotations.
4. The selected existing document and its linked documents.
5. Verifiable project code and configuration.

Do not treat unsynchronized browser content as a permanent project fact. Do not invent business, backend, API, field, security, legal, owner, metric, date, or release facts. Mark an unresolved fact as an open question. Stop and ask when a conflict materially changes scope or behavior.

## Write and validate

1. Identify document audience, purpose, kind, target, and scope.
2. Preserve the selected project's headings, terminology, filenames, links, and concise table style.
3. Separate facts, assumptions, decisions, and open questions.
4. Keep product requirements implementation-neutral; describe observable behavior, rules, ownership boundaries, states, and contracts.
5. Check gaps, contradictions, redundancy, dangling dependencies, overreach, and unowned cross-page behavior.
6. Write only the authorized document type.
7. For page-only impact, update only the selected page PRD. Update an already identified total PRD only for an authorized public-rule, cross-page-flow, or total-scope change. Ask if the total target is ambiguous.
8. Validate Markdown using `markdown-style.md` and the selected type reference.
9. Run `refresh-project.mjs`, then `check-project.mjs`.
10. Report changed files, content summary, total-PRD linkage, and remaining open questions.
```

- [ ] **Step 4: Create the Markdown style reference**

Create `prd-annotator-skill/references/markdown-style.md` with:

```markdown
# Markdown document style

## Structure

- Start with one descriptive `#` title and increase heading depth one level at a time.
- Omit empty optional sections. Do not emit empty placeholder tables or template instructions.
- Keep terminology and capitalization consistent with selected project documents.
- Separate confirmed facts, assumptions, decisions, risks, and open questions.

## Tables

- Use one table for one repeated mapping and keep tables to three to six columns when practical.
- Keep cells concise. Move paragraphs, multi-rule constraints, and long examples below the table.
- Use inline code for field names, enum values, HTTP methods, API paths, file paths, and route patterns.
- Escape literal pipes as `\|`. Do not place multiline prose in a table cell.
- Prefer bullets or per-item subsections when a table would be wider than the Drawer.

## Code and links

- Use fenced blocks with a language label for JSON, YAML, requests, responses, and longer examples.
- Use project-relative Markdown links for internal documents. Never emit `file://` links or paths outside the project root.
- Use descriptive link text rather than a raw local absolute path.
- Do not embed raw HTML for layout.

## Readability gate

- Every heading must contain useful content before the next heading.
- Tables must have a delimiter row and the same number of columns on every row.
- Long requirements must be atomic and testable instead of joined by unrelated `and` clauses.
- Unknown facts must say `待确认` or appear under an open-question section; never fabricate a value to complete a table.
```

- [ ] **Step 5: Add conditional reference routing to `SKILL.md`**

Under `Read these references when their subject applies`, add:

```markdown
- Read [references/document-writing.md](references/document-writing.md) and [references/markdown-style.md](references/markdown-style.md) only when the user has separately authorized document work.
- For an authorized page PRD, also read [references/page-prd.md](references/page-prd.md).
- For an authorized total PRD, also read [references/total-prd.md](references/total-prd.md).
- For an authorized Field specification, also read [references/field-spec.md](references/field-spec.md).
- For an authorized API document, also read [references/api-document.md](references/api-document.md).
```

In `Handle document intent separately`, explicitly state that these writing references never apply to installation, annotation creation, annotation synchronization, annotation edit/delete, route refresh, View refresh, or display-layer removal.

- [ ] **Step 6: Link the focused references from `prd-workflow.md`**

In section 4 of `prd-annotator-skill/references/prd-workflow.md`, add one paragraph directing authorized document work to `document-writing.md`, `markdown-style.md`, and exactly one type-specific reference. Preserve all existing ambiguity, managed/external PRD, refresh, and gate rules.

- [ ] **Step 7: Run Skill contract tests**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit the document control plane**

```powershell
git add prd-annotator-skill/SKILL.md prd-annotator-skill/references/prd-workflow.md prd-annotator-skill/references/document-writing.md prd-annotator-skill/references/markdown-style.md tests/unit/skill-scripts.test.js
git commit -m "docs: add consent-gated document workflow"
```

### Task 4: Add focused page and total PRD references

**Files:**
- Create: `prd-annotator-skill/references/page-prd.md`
- Create: `prd-annotator-skill/references/total-prd.md`
- Modify: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: authorized PRD intent plus `document-writing.md`.
- Produces: a page-local fallback and a cross-page/total fallback; neither is an automatic template override.

- [ ] **Step 1: Add focused PRD reference tests**

Append to `tests/unit/skill-scripts.test.js`:

```js
it("defines separate page and total PRD fallback contracts", () => {
  const pagePrd = readFileSync(
    path.join(skillRoot, "references/page-prd.md"),
    "utf8"
  );
  const totalPrd = readFileSync(
    path.join(skillRoot, "references/total-prd.md"),
    "utf8"
  );

  expect(pagePrd).toContain("Page-local scope");
  expect(pagePrd).toContain("Normal, branch, reverse, and error flows");
  expect(pagePrd).toContain("Do not require product-wide metrics");
  expect(totalPrd).toContain("complete page index");
  expect(totalPrd).toContain("cross-page flow");
  expect(totalPrd).toContain("A page-only annotation does not authorize a total PRD update");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "separate page and total PRD"
```

Expected: FAIL because both files are absent.

- [ ] **Step 3: Create `page-prd.md`**

Create `prd-annotator-skill/references/page-prd.md` with:

```markdown
# Page PRD fallback

Use this fallback only when authorized page-PRD work has no unambiguous project template. Existing project structure always wins.

## Page-local scope

Describe one physical HTML page or one registered logical route. For a local adjustment, record current behavior, requested behavior, affected area, and explicitly unaffected behavior. Do not require product-wide metrics, pricing, roadmap, launch dates, or business claims without evidence.

## Recommended sections

1. Page purpose and in-scope/out-of-scope boundary.
2. Entry point, route pattern, roles, and permission visibility.
3. Page regions, information hierarchy, and primary actions.
4. Normal, branch, reverse, and error flows with observable outcomes.
5. Loading, empty, error, success, disabled, and permission states when applicable.
6. Page business rules and state transitions.
7. Traceability from synchronized page annotations to the affected sections.
8. Relative links to selected field specifications and API documents.
9. Dependencies, risks, decisions, and open questions with owners when known.

## Quality gate

- Keep every rule within this page unless a documented cross-page dependency is required.
- Do not convert implementation ideas into product facts.
- Do not copy retired annotation fields into the PRD merely because historical JSON contains them.
- Keep fields and APIs in their dedicated documents when those documents exist; summarize and link instead of duplicating them.
```

- [ ] **Step 4: Create `total-prd.md`**

Create `prd-annotator-skill/references/total-prd.md` with:

```markdown
# Total PRD fallback

Use this fallback only for separately authorized total-PRD work with no unambiguous project template or structure.

## Recommended sections

1. Product objective, overall scope, and explicit non-goals.
2. A complete page index covering every intended Manifest page, using valid relative links.
3. Roles, responsibilities, and public permission rules.
4. Main cross-page flow, branch flow, and terminal outcomes.
5. Shared business rules, state vocabulary, terminology, and constraints.
6. Indexes for page PRDs, field specifications, API documents, and other selected requirement assets.
7. Dependencies, risks, decisions, and open questions.
8. A concise change summary when the current request changes public rules or total scope.

## Update boundary

A page-only annotation does not authorize a total PRD update. Update an already identified total PRD only when the user authorized document work and the change clearly affects a public rule, cross-page flow, or total scope. Stop and ask when several total PRD candidates are plausible.

## Quality gate

- Keep the page index complete and free of broken or absolute local links.
- Do not duplicate full page specifications; summarize and link.
- Give every unresolved cross-page dependency an owner when evidence identifies one; otherwise mark the owner as `待确认`.
- Preserve all unselected total PRD candidates.
```

- [ ] **Step 5: Run Skill contract tests**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit PRD references**

```powershell
git add prd-annotator-skill/references/page-prd.md prd-annotator-skill/references/total-prd.md tests/unit/skill-scripts.test.js
git commit -m "docs: define page and total PRD fallbacks"
```

### Task 5: Add focused field and API document references

**Files:**
- Create: `prd-annotator-skill/references/field-spec.md`
- Create: `prd-annotator-skill/references/api-document.md`
- Modify: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: authorized field-spec or API-document intent plus the core writing/style references.
- Produces: concise domain-specific fallbacks that do not fabricate implementation details.

- [ ] **Step 1: Add field/API reference contract tests**

Append to `tests/unit/skill-scripts.test.js`:

```js
it("defines readable field and product API document contracts", () => {
  const fields = readFileSync(
    path.join(skillRoot, "references/field-spec.md"),
    "utf8"
  );
  const api = readFileSync(
    path.join(skillRoot, "references/api-document.md"),
    "utf8"
  );

  expect(fields).toContain("Field | Type | Required | Source | Constraints | Description");
  expect(fields).toContain("Do not guess database columns");
  expect(api).toContain("product API requirement document");
  expect(api).toContain("Method | Path | Purpose");
  expect(api).toContain("Do not present this fallback as OpenAPI");
  expect(api).toContain("Do not invent paths, authentication, status codes, fields, or error structures");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "readable field and product API"
```

Expected: FAIL because both references are absent.

- [ ] **Step 3: Create `field-spec.md`**

Create `prd-annotator-skill/references/field-spec.md` with:

```markdown
# Field specification fallback

Use this fallback only for authorized Field specification work with no unambiguous project structure. Group fields by business object, form, or page region.

## Compact field table

Use this six-column table for simple fields:

| Field | Type | Required | Source | Constraints | Description |
|---|---|---|---|---|---|

Use inline code for field names and enum values. Keep each cell short. Move long validation, visibility, editability, empty-value, default-value, permission, and cross-field rules into a subsection below the table.

## Evidence and boundaries

- Distinguish business field names from transport fields and database columns.
- Do not guess database columns, lengths, types, enums, defaults, or source systems.
- Record only values proven by the prototype, selected documents, code, configuration, or explicit user decisions.
- Mark unknown values as `待确认`; do not complete a row with invented data.
- Link to the owning page PRD and API document with project-relative links.

## Quality gate

- One field per row and one meaning per field.
- No multiline prose or nested tables in a cell.
- Complex objects and conditional groups receive their own subsection.
- Terms, required markers, enum spelling, and empty-value behavior remain consistent across all groups.
```

- [ ] **Step 4: Create `api-document.md`**

Create `prd-annotator-skill/references/api-document.md` with:

```markdown
# Product API document fallback

Use this fallback only for authorized API-document work with no unambiguous project structure. This is a product API requirement document for capability, business behavior, and integration boundaries. Do not present this fallback as OpenAPI or as an engineering implementation specification.

## Recommended sections

1. Purpose, scope, caller, provider, base path, version, and authentication when known.
2. A compact capability catalog:

| Method | Path | Purpose |
|---|---|---|

3. One subsection per interface containing use cases and business preconditions.
4. Request parameters with location, required state, type, business meaning, and validation.
5. Response fields with type, presence rule, and business meaning.
6. Fenced JSON request and response examples when verified examples exist.
7. Business failures, user-visible outcomes, error codes, retry behavior, and recovery when known.
8. Permission, sensitive-data, audit, rate-limit, idempotency, webhook, and dependency rules when applicable.
9. Explicit non-goals, risks, decisions, and open questions.

## Evidence and boundaries

- Do not invent paths, authentication, status codes, fields, or error structures.
- Separate product API intent from low-level algorithms, database layout, queue choice, or framework design.
- Use a selected OpenAPI source as engineering truth when it exists; summarize and link rather than silently rewriting it.
- Generate or edit OpenAPI only when the user explicitly requests OpenAPI work.

## Quality gate

- Every catalog row links conceptually to one detailed interface subsection.
- Methods and paths use inline code and stay consistent across catalog, prose, and examples.
- Request/response tables remain concise; nested schemas use separate subsections or fenced examples.
- Every documented failure states the business meaning and expected consumer behavior when evidence supports it.
```

- [ ] **Step 5: Run Skill contract tests**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit field and API references**

```powershell
git add prd-annotator-skill/references/field-spec.md prd-annotator-skill/references/api-document.md tests/unit/skill-scripts.test.js
git commit -m "docs: define field and API document fallbacks"
```

### Task 6: Verify real Drawer documents, validate the Skill, and rebuild the SDK

**Files:**
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `prd-annotator/prd-annotator.js` through the build only

**Interfaces:**
- Consumes: safe Markdown parser, document View bundle, and all Skill references.
- Produces: browser-verified document tabs and a validated distributable source tree.

- [ ] **Step 1: Add an end-to-end document readability and security case**

Append this Playwright test to `tests/e2e/prd-annotator.spec.js`:

```js
test("renders readable field and API Markdown without executing source HTML", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await page.evaluate(() => {
    const snapshot = window.PRDAnnotator.getSnapshot();
    const documentEntry = (id, title, kind, displayGroups, content) => ({
      id,
      title,
      path: `doc/${id}.md`,
      format: "markdown",
      kind,
      displayGroups,
      pageIds: [snapshot.document.page.id],
      fingerprint: `sha256:${"a".repeat(64)}`,
      previewStatus: "available",
      missing: false,
      content
    });
    window.PRDAnnotator.hydrateView({
      schemaVersion: 2,
      generatedAt: "2026-08-11T10:00:00.000Z",
      projectId: snapshot.document.projectId,
      page: snapshot.document.page,
      persistedAnnotationFingerprint: snapshot.annotationFingerprint,
      document: snapshot.document,
      documents: [
        documentEntry(
          "field-spec-test",
          "Message Fields",
          "field-spec",
          ["field-spec"],
          "# Fields\n\n| Field | Type | Required |\n|---|---|---|\n| `id` | `string` | Yes |"
        ),
        documentEntry(
          "api-doc-test",
          "Message API",
          "api-doc",
          ["api-doc"],
          "# API\n\n| Method | Path | Purpose |\n|---|---|---|\n| `GET` | `/messages` | List messages |\n\n[unsafe](javascript:window.hacked=true)\n\n<script>window.hacked=true</script>"
        )
      ]
    });
  });

  await host.locator("[data-action='toggle-drawer']").click();
  await host.locator("[data-tab='field-spec']").click();
  const fieldCard = host.locator("[data-document-id='field-spec-test']");
  await expect(fieldCard.locator(".markdown-table-scroll table")).toHaveCount(1);
  await expect(fieldCard.locator("code").first()).toHaveText("id");

  await host.locator("[data-tab='api-doc']").click();
  const apiCard = host.locator("[data-document-id='api-doc-test']");
  await expect(apiCard.locator("tbody tr")).toHaveCount(1);
  await expect(apiCard.locator("script")).toHaveCount(0);
  await expect(apiCard.locator("a")).toHaveCount(0);
  await expect(apiCard).toContainText("<script>");
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused end-to-end case**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "readable field and API Markdown"
```

Expected: PASS.

- [ ] **Step 3: Validate the Skill folder**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" prd-annotator-skill
```

Expected: the validator reports that `prd-annotator-skill` is valid. If the machine exposes Python only as `py`, run the same file with `py` and require the same successful validation output; do not modify the Skill to work around a missing interpreter.

- [ ] **Step 4: Run complete unit tests**

Run:

```powershell
npm run test:unit
```

Expected: all Vitest files PASS.

- [ ] **Step 5: Rebuild the single-file SDK**

Run:

```powershell
npm run build
```

Expected: exit code 0; `prd-annotator/prd-annotator.js` contains `markdown-table-scroll`, `markdown-inline-code`, and the safe protocol checks.

- [ ] **Step 6: Run full browser and repository verification**

Run:

```powershell
npm run test:e2e
npm run check:repo
git diff --check
```

Expected: all Playwright tests PASS, repository policy check exits 0, and `git diff --check` prints no errors.

- [ ] **Step 7: Commit the verified integration**

```powershell
git add tests/e2e/prd-annotator.spec.js prd-annotator/prd-annotator.js
git commit -m "test: verify document rendering integration"
```

- [ ] **Step 8: Confirm the worktree contains no unintended changes**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: no uncommitted files from this plan; recent history contains inline Markdown, tables, document control plane, PRD references, field/API references, and integration verification commits.
