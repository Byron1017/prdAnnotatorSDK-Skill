import { describe, expect, it } from "vitest";
import {
  normalizeRoute,
  resolvePageId,
  resolveProjectKey
} from "../../prd-annotator/src/identity.js";

describe("page identity", () => {
  it("uses a valid explicit page id", () => {
    expect(resolvePageId({ explicitId: "equipment-ops", pathname: "/ignored" }))
      .toBe("equipment-ops");
  });

  it("reuses the manifest mapping for a normalized route", () => {
    expect(resolvePageId({
      pathname: "/equipment/ops/",
      manifestPages: [{ id: "ops-main", route: "/equipment/ops" }]
    })).toBe("ops-main");
  });

  it("generates a stable short ASCII id for deep routes", () => {
    const input = { pathname: "/company/north/factory/line/equipment/operations/history" };
    const first = resolvePageId(input);
    expect(resolvePageId(input)).toBe(first);
    expect(first).toMatch(/^p-history-[a-f0-9]{6}$/);
    expect(first.length).toBeLessThanOrEqual(40);
  });

  it("uses only a hash when the route has no ASCII slug", () => {
    expect(resolvePageId({ pathname: "/设备/运维" }))
      .toMatch(/^p-[a-f0-9]{10}$/);
  });

  it("normalizes slash, query, and hash variations", () => {
    expect(normalizeRoute("//equipment///ops/?tab=all#top"))
      .toBe("/equipment/ops");
  });

  it("derives a stable project key from the SDK directory", () => {
    const key = resolveProjectKey({
      scriptSrc: "file:///D:/products/alpha/code/prd-annotator/prd-annotator.js"
    });
    expect(key).toMatch(/^project-[a-f0-9]{10}$/);
    expect(resolveProjectKey({
      scriptSrc: "file:///D:/products/alpha/code/prd-annotator/prd-annotator.js"
    })).toBe(key);
  });
});
