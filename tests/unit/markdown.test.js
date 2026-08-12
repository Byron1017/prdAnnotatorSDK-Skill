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
