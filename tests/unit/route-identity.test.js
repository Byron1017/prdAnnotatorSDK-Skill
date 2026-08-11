import { describe, expect, it } from "vitest";
import {
  matchRoutePattern,
  normalizeHashLocation,
  resolveLocationIdentity
} from "../../prd-annotator/src/route-identity.js";

const basePage = Object.freeze({
  id: "index-2d243c",
  title: "Index",
  htmlPath: "code/index.html",
  viewSrc: "../.prd-annotator/view/pages/index-2d243c.js"
});

const routes = Object.freeze([
  {
    id: "message-list",
    title: "Message List",
    routePattern: "/message/list",
    viewSrc: "../.prd-annotator/view/pages/message-list.js"
  },
  {
    id: "message-edit",
    title: "Message Edit",
    routePattern: "/message/edit/:id",
    viewSrc: "../.prd-annotator/view/pages/message-edit.js"
  }
]);

describe("Hash route identity", () => {
  it("ignores query values and maps dynamic values to one route template", () => {
    expect(normalizeHashLocation("#/message/edit/123?tab=base"))
      .toEqual({ kind: "route", path: "/message/edit/123" });
    expect(matchRoutePattern("/message/edit/:id", "/message/edit/123"))
      .toBe(true);

    const first = resolveLocationIdentity({
      pathname: "/code/index.html",
      hash: "#/message/edit/123?tab=base",
      basePage,
      routes
    });
    const second = resolveLocationIdentity({
      pathname: "/code/index.html",
      hash: "#/message/edit/456?tab=advanced",
      basePage,
      routes
    });

    expect(first).toMatchObject({
      pageId: "message-edit",
      route: "/message/edit/123",
      routePattern: "/message/edit/:id",
      mode: "hash-route",
      registered: true
    });
    expect(second.pageId).toBe(first.pageId);
  });

  it("supports hash-bang routes, optional parameters, and catch-all parameters", () => {
    expect(normalizeHashLocation("#!/message/list/"))
      .toEqual({ kind: "route", path: "/message/list" });
    expect(matchRoutePattern("/message/:id?", "/message")).toBe(true);
    expect(matchRoutePattern("/:pathMatch(.*)*", "/message/archive/2026")).toBe(true);
  });

  it("ignores an ordinary document anchor", () => {
    expect(normalizeHashLocation("#section-title"))
      .toEqual({ kind: "anchor", path: "section-title" });
    expect(resolveLocationIdentity({
      pathname: "/code/index.html",
      hash: "#section-title",
      basePage,
      routes
    })).toMatchObject({
      pageId: basePage.id,
      mode: "document",
      registered: true,
      route: "/code/index.html"
    });
  });

  it("isolates an unknown Hash route without loading the document page", () => {
    const unknown = resolveLocationIdentity({
      pathname: "/code/index.html",
      hash: "#/unknown/7?x=1",
      basePage,
      routes
    });

    expect(unknown).toMatchObject({
      title: "/unknown/7",
      mode: "hash-route",
      registered: false,
      route: "/unknown/7",
      routePattern: null,
      viewSrc: ""
    });
    expect(unknown.pageId).toMatch(/^unknown-[a-f0-9]{6}$/);
    expect(unknown.pageId.length).toBeLessThanOrEqual(32);
  });

  it("keeps the same unknown Hash route on different HTML documents isolated", () => {
    const first = resolveLocationIdentity({
      pathname: "/a/index.html",
      hash: "#/unknown",
      basePage: { ...basePage, htmlPath: "a/index.html" },
      routes: []
    });
    const second = resolveLocationIdentity({
      pathname: "/b/index.html",
      hash: "#/unknown",
      basePage: { ...basePage, htmlPath: "b/index.html" },
      routes: []
    });

    expect(first.pageId).not.toBe(second.pageId);
  });

  it("rejects an ambiguous route map instead of choosing a page", () => {
    expect(() => resolveLocationIdentity({
      pathname: "/code/index.html",
      hash: "#/message/123",
      basePage,
      routes: [
        { id: "first", title: "First", routePattern: "/message/:id", viewSrc: "first.js" },
        { id: "second", title: "Second", routePattern: "/message/:value", viewSrc: "second.js" }
      ]
    })).toThrow("Ambiguous PRD Annotator route: /message/123");
  });
});
