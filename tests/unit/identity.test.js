import { describe, expect, it } from "vitest";
import {
  normalizeRoute,
  resolvePageId,
  resolveProjectKey
} from "../../prd-annotator/src/identity.js";
import { canonicalJson, fingerprintValue } from "../../prd-annotator/src/fingerprint.js";

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
    expect(first).toMatch(/^history-[a-f0-9]{6}$/);
    expect(first.length).toBeLessThanOrEqual(32);
  });

  it("uses only a hash when the route has no ASCII slug", () => {
    expect(resolvePageId({ pathname: "/设备/运维" }))
      .toMatch(/^page-[a-f0-9]{6}$/);
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

  it("fingerprints objects independently of key insertion order", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(fingerprintValue({ b: 2, a: 1 }))
      .toBe(fingerprintValue({ a: 1, b: 2 }));
  });

  it("generates an ASCII page id no longer than 32 characters", () => {
    const value = resolvePageId({
      pathname: "/很深/的/页面/路径/index.html"
    });
    expect(value).toMatch(/^index-[a-f0-9]{6}$|^page-[a-f0-9]{6}$/);
    expect(value.length).toBeLessThanOrEqual(32);
  });
});
