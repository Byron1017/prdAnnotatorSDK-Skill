import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectIntegration,
  relativeWebPath,
  removeIntegration,
  upsertIntegration
} from "../../prd-annotator-skill/scripts/lib/html.mjs";

const attrs = {
  src: "../../.prd-annotator/sdk/prd-annotator.js",
  projectId: "device-demo-a13f92",
  pageId: "equipment-ops-7c31fa",
  viewSrc: "../../.prd-annotator/view/pages/equipment-ops-7c31fa.js"
};

describe("HTML integration paths", () => {
  it("calculates forward-slash web paths from shallow and nested HTML", () => {
    expect(relativeWebPath("prototype/index.html", ".prd-annotator/sdk/prd-annotator.js"))
      .toBe("../.prd-annotator/sdk/prd-annotator.js");
    expect(relativeWebPath("prototype/deep/details.html", ".prd-annotator/view/pages/details-a1b2c3.js"))
      .toBe("../../.prd-annotator/view/pages/details-a1b2c3.js");
  });

  it("rejects absolute, URL-like, backslash, and escaping project paths", () => {
    for (const value of [
      "/absolute.html",
      "C:/absolute.html",
      "https://example.test/page.html",
      "file:///C:/page.html",
      "//server/share/page.html",
      "prototype\\page.html",
      "prototype/../outside.html"
    ]) {
      expect(() => relativeWebPath(value, ".prd-annotator/sdk/prd-annotator.js")).toThrow();
      expect(() => relativeWebPath("prototype/index.html", value)).toThrow();
    }
  });
});

describe("HTML integration inspection and mutation", () => {
  it("inserts one single-line integration immediately before body close", () => {
    const html = "<!doctype html>\n<body><script src=\"app.js\"></script>\n</body>";
    const result = upsertIntegration(html, attrs);
    const [integration] = inspectIntegration(result);

    expect(inspectIntegration(result)).toHaveLength(1);
    expect(integration).toMatchObject({
      src: attrs.src,
      projectId: attrs.projectId,
      pageId: attrs.pageId,
      viewSrc: attrs.viewSrc
    });
    expect(result).toContain(
      `<script src="${attrs.src}" data-project-id="${attrs.projectId}" data-page-id="${attrs.pageId}" data-view-src="${attrs.viewSrc}"></script>\n</body>`
    );
    expect(result).toContain('<script src="app.js"></script>');
  });

  it("updates one existing integration without adding a duplicate", () => {
    const original = upsertIntegration("<body></body>", attrs);
    const result = upsertIntegration(original, {
      ...attrs,
      pageId: "renamed-page-123abc",
      viewSrc: "../.prd-annotator/view/pages/renamed-page-123abc.js"
    });

    expect(inspectIntegration(result)).toEqual([expect.objectContaining({
      pageId: "renamed-page-123abc",
      viewSrc: "../.prd-annotator/view/pages/renamed-page-123abc.js"
    })]);
  });

  it("ignores commented and inert script-like text and mutates only executable integrations", () => {
    const script = `<script src="${attrs.src}" data-project-id="${attrs.projectId}" data-page-id="${attrs.pageId}" data-view-src="${attrs.viewSrc}"></script>`;
    const inertHtml = `<!-- ${script} --><template>${script}</template><script type="application/json" src="${attrs.src}" data-project-id="${attrs.projectId}" data-page-id="${attrs.pageId}" data-view-src="${attrs.viewSrc}"></script>`;

    expect(inspectIntegration(inertHtml)).toHaveLength(0);
    const integrated = upsertIntegration(`<body>${inertHtml}</body>`, attrs);
    expect(inspectIntegration(integrated)).toHaveLength(1);
    expect(integrated).toContain(inertHtml);
    expect(removeIntegration(integrated)).toBe(`<body>${inertHtml}\n</body>`);
  });

  it("treats HTML raw-text and RCDATA bodies as opaque script-like text", () => {
    const script = `<script src="${attrs.src}" data-project-id="${attrs.projectId}" data-page-id="${attrs.pageId}" data-view-src="${attrs.viewSrc}"></script>`;
    const opaqueHtml = [
      `<style>.example::after { content: '${script}'; }</style>`,
      `<title>${script}</title>`,
      `<textarea>${script}</textarea>`,
      `<xmp>${script}</xmp>`,
      `<iframe>${script}</iframe>`,
      `<noembed>${script}</noembed>`,
      `<noframes>${script}</noframes>`,
      `<noscript>${script}</noscript>`
    ].join("");

    expect(inspectIntegration(opaqueHtml)).toHaveLength(0);
    expect(inspectIntegration(`<plaintext>${script}</plaintext>`)).toHaveLength(0);
    const integrated = upsertIntegration(`<body>${opaqueHtml}</body>`, attrs);
    expect(inspectIntegration(integrated)).toHaveLength(1);
    expect(integrated).toContain(opaqueHtml);
    expect(removeIntegration(integrated)).toBe(`<body>${opaqueHtml}\n</body>`);
  });

  it.each([
    ["comment", "<!-- fake </body> close -->"],
    ["JavaScript body", '<script>const fakeClose = "</body>";</script>'],
    ["template", "<template><div>fake </body> close</div></template>"],
    ["textarea", "<textarea>fake </body> close</textarea>"],
    ["title", "<title>fake </body> close</title>"],
    ["style", '<style>.example::after { content: "</body>"; }</style>']
  ])("inserts before the true body close when %s contains a fake close", (_name, inertContent) => {
    const html = `<html><body>${inertContent}<main>Prototype</main></body></html>`;
    const result = upsertIntegration(html, attrs);
    const [integration] = inspectIntegration(result);
    const trueBodyClose = result.lastIndexOf("</body>");

    expect(inspectIntegration(result)).toHaveLength(1);
    expect(result).toContain(inertContent);
    expect(integration.end).toBeLessThan(trueBodyClose);
    expect(result.slice(integration.end, trueBodyClose)).toBe("\n");
    expect(removeIntegration(result)).toBe(`<html><body>${inertContent}<main>Prototype</main>\n</body></html>`);
  });

  it("rejects duplicate integrations and unsafe web references", () => {
    const script = `<script src="${attrs.src}" data-project-id="${attrs.projectId}" data-page-id="${attrs.pageId}" data-view-src="${attrs.viewSrc}"></script>`;
    expect(() => upsertIntegration(`<body>${script}${script}</body>`, attrs))
      .toThrow("more than one PRD Annotator script");
    for (const unsafe of [
      "https://raw.githubusercontent.com/Byron1017/prdAnnotatorSDK-Skill/master/prd-annotator.js",
      "https://cdn.example.test/prd-annotator.js",
      "file:///C:/prd-annotator.js",
      "/absolute/prd-annotator.js",
      "C:\\absolute\\prd-annotator.js",
      "//server/share/prd-annotator.js"
    ]) {
      expect(() => upsertIntegration("<body></body>", { ...attrs, src: unsafe })).toThrow("relative");
      expect(() => upsertIntegration("<body></body>", { ...attrs, viewSrc: unsafe })).toThrow("relative");
    }
  });

  it("escapes attribute values and decodes them while inspecting", () => {
    const result = upsertIntegration("<body></body>", {
      ...attrs,
      projectId: 'project&\"value',
      pageId: "page'value"
    });

    expect(result).toContain('data-project-id="project&amp;&quot;value"');
    expect(result).toContain('data-page-id="page&#39;value"');
    expect(inspectIntegration(result)[0]).toMatchObject({
      projectId: 'project&\"value',
      pageId: "page'value"
    });
  });

  it("removes only the PRD Annotator script", () => {
    const otherScript = '<script src="app.js" data-page-id="app-page"></script>';
    const integrated = upsertIntegration(`<body>${otherScript}</body>`, attrs);
    const result = removeIntegration(integrated);

    expect(inspectIntegration(result)).toHaveLength(0);
    expect(result).toContain(otherScript);
  });
});
