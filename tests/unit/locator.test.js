import { beforeEach, describe, expect, it } from "vitest";
import {
  describeTarget,
  isAnnotatable,
  resolveTarget
} from "../../prd-annotator/src/locator.js";

describe("DOM target location", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main><section class="card"><h2>设备列表</h2><button>停用</button></section></main>
      <div data-prd-annotator-ui="host"><button>标注模式</button></div>`;
  });

  it("never annotates SDK UI, script, style, html, or body", () => {
    expect(isAnnotatable(document.querySelector("[data-prd-annotator-ui] button")))
      .toBe(false);
    expect(isAnnotatable(document.body)).toBe(false);
    expect(isAnnotatable(document.querySelector("main .card"))).toBe(true);
  });

  it("records CSS, XPath, text quote, and viewport rectangle", () => {
    const descriptor = describeTarget(document.querySelector("main .card"));

    expect(descriptor.cssPath).toContain("main");
    expect(descriptor.xpath).toContain("/html/body/main");
    expect(descriptor.textQuote).toContain("设备列表");
    expect(descriptor.rect).toEqual(expect.objectContaining({
      x: expect.any(Number),
      width: expect.any(Number)
    }));
  });

  it("resolves by text when the old CSS path is stale", () => {
    const descriptor = describeTarget(document.querySelector("main .card"));
    descriptor.cssPath = "main > article:nth-of-type(9)";
    descriptor.xpath = "/html/body/main/article[9]";

    expect(resolveTarget(document, descriptor).textContent).toContain("设备列表");
  });
});
