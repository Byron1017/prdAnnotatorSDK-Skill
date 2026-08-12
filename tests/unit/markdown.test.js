import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../prd-annotator/src/markdown.js";
import {
  appendInlineMarkdown,
  sanitizeMarkdownHref
} from "../../prd-annotator/src/markdown-inline.js";

function render(source) {
  const container = document.createElement("div");
  container.append(renderMarkdown(document, source));
  return container;
}

function renderInline(source) {
  const container = document.createElement("div");
  appendInlineMarkdown(document, container, source);
  return container;
}

function childShape(node) {
  return [...node.childNodes].map((child) => child.nodeType === Node.TEXT_NODE
    ? { type: "text", text: child.textContent }
    : { type: child.tagName.toLowerCase(), text: child.textContent });
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
    ["HtTpS://example.test", "HtTpS://example.test"],
    ["MAILTO:owner@example.test", "MAILTO:owner@example.test"],
    ["javascript:alert(1)", null],
    ["JaVaScRiPt:alert(1)", null],
    ["\0javascript:alert(1)", null],
    ["java\tscript:alert(1)", null],
    ["java\rscript:alert(1)", null],
    ["java\nscript:alert(1)", null],
    ["data:text/html,unsafe", null],
    ["DaTa:text/html,unsafe", null],
    ["file:///C:/secret.txt", null],
    ["//evil.example.test/path", null],
    ["\0//evil.example.test/path", null],
    ["\\\\evil.example.test\\path", null],
    ["/\\evil.example.test/path", null],
    ["\\/evil.example.test/path", null]
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

  it("renders mixed-case allowed HTTP links as protected external anchors", () => {
    const container = render("[safe](HtTpS://example.test/path)");
    const link = container.querySelector("a");

    expect(link.getAttribute("href")).toBe("HtTpS://example.test/path");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it.each([
    ["java\tscript:window.hacked=true", render],
    ["java\rscript:window.hacked=true", renderInline],
    ["java\nscript:window.hacked=true", renderInline],
    ["JaVaScRiPt:window.hacked=true", render],
    ["\0javascript:window.hacked=true", render],
    ["//evil.example.test/path", render],
    ["\0//evil.example.test/path", render],
    ["\\\\evil.example.test\\path", render],
    ["/\\evil.example.test/path", render],
    ["\\/evil.example.test/path", render]
  ])("keeps dangerous rendered link %j inert", (href, renderSource) => {
    const label = "dangerous label";
    const container = renderSource(`[${label}](${href})`);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(label);
    expect(window.hacked).toBeUndefined();
  });

  it("supports inline formatting in headings and list items", () => {
    const container = render("## **Fields** and `codes`\n\n- Use *clear* labels");

    expect(container.querySelector("h2 strong").textContent).toBe("Fields");
    expect(container.querySelector("h2 code").textContent).toBe("codes");
    expect(container.querySelector("li em").textContent).toBe("clear");
  });

  it.each([
    ["single", "before `x|y` after"],
    ["multiple", "before ``x|y`` after"]
  ])("renders a matched %s-backtick run as exactly one code node", (_, source) => {
    const container = renderInline(source);

    expect(container.textContent).toBe("before x|y after");
    expect(childShape(container)).toEqual([
      { type: "text", text: "before " },
      { type: "code", text: "x|y" },
      { type: "text", text: " after" }
    ]);
  });

  it("keeps unmatched backtick runs as one inert literal text node", () => {
    const source = "before ``x|y` after";
    const container = renderInline(source);

    expect(container.textContent).toBe(source);
    expect(childShape(container)).toEqual([{ type: "text", text: source }]);
    expect(container.querySelector("code")).toBeNull();
  });
});

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
    expect(childShape(cells[0])).toEqual([{ type: "code", text: "status|code" }]);
    expect(cells[1].textContent).toBe("enabled | disabled");
  });

  it("keeps a terminal escaped pipe as literal cell content", () => {
    const container = render(String.raw`| Left | Right |
|---|---|
| left | right \|`);
    const cells = [...container.querySelectorAll("tbody td")];

    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.textContent)).toEqual(["left", "right |"]);
  });

  it("uses backslash-run parity when deciding whether pipes are structural", () => {
    const even = render(String.raw`| One | Two | Three |
|---|---|---|
| first \\| second | third |`);
    const odd = render(String.raw`| One | Two |
|---|---|
| first \\\| second | third |`);

    expect([...even.querySelectorAll("tbody td")].map((cell) => cell.textContent))
      .toEqual(["first " + "\\", "second", "third"]);
    expect([...odd.querySelectorAll("tbody td")].map((cell) => cell.textContent))
      .toEqual(["first \\| second", "third"]);
  });

  it("keeps pipes inside matched multi-backtick code spans", () => {
    const container = render("| Value | State |\n|---|---|\n| ``x|y`` | ready |");
    const cells = [...container.querySelectorAll("tbody td")];

    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("x|y");
    expect(childShape(cells[0])).toEqual([{ type: "code", text: "x|y" }]);
    expect(cells[1].textContent).toBe("ready");
  });

  it("keeps backslash runs before pipes verbatim inside matched code spans", () => {
    const codeContent = `even${"\\".repeat(2)}|odd${"\\".repeat(3)}|`;
    const single = render(`| Value | State |\n|---|---|\n| \`${codeContent}\` | ready |`);
    const multiple = render(`| Value | State |\n|---|---|\n| \`\`${codeContent}\`\` | ready |`);

    for (const container of [single, multiple]) {
      const cells = [...container.querySelectorAll("tbody td")];
      expect(cells).toHaveLength(2);
      expect(cells[0].querySelector("code").textContent).toBe(codeContent);
      expect(cells[1].textContent).toBe("ready");
    }
  });

  it("does not let unmatched backticks suppress structural pipes", () => {
    const container = render("| One | Two | Three |\n|---|---|---|\n| before ` | middle | after |");
    const cells = [...container.querySelectorAll("tbody td")];

    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.textContent)).toEqual(["before `", "middle", "after"]);
    expect(childShape(cells[0])).toEqual([{ type: "text", text: "before `" }]);
    expect(cells[0].querySelector("code")).toBeNull();
  });

  it("marks a zero-body-row table for clean header-border styling", () => {
    const container = render("| Field | Rule |\n|---|---|");
    const table = container.querySelector("table.markdown-table");

    expect(table.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(table.classList.contains("markdown-table--empty")).toBe(true);
  });

  it("processes a mismatched body row once before adjacent content", () => {
    const container = render([
      "| Key | Value |",
      "|---|---|",
      "| accepted | row |",
      "| mismatched | row | extra |",
      "Adjacent text"
    ].join("\n"));

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p").textContent)
      .toBe("| mismatched | row | extra | Adjacent text");
  });

  it("falls back to readable text when the delimiter row is invalid", () => {
    const container = render("| Field | Rule |\n| one dash | - |\n| id | required |");

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("| Field | Rule |");
  });
});
