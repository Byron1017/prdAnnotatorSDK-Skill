import { describe, expect, it } from "vitest";
import {
  createToolLauncherPreference,
  makeToolLauncherPreferenceKey
} from "../../prd-annotator/src/ui/tool-launcher-preference.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

describe("tool launcher preference", () => {
  it("uses one short versioned key per project and stores only collapsed", () => {
    const storage = createMemoryStorage();
    const preference = createToolLauncherPreference({
      storage,
      projectId: "device-demo-a13f92"
    });

    expect(preference.key).toBe(
      "prd-annotator:ui:v1:device-demo-a13f92:launcher"
    );
    expect(makeToolLauncherPreferenceKey("device-demo-a13f92"))
      .toBe(preference.key);
    expect(preference.load()).toEqual({ collapsed: false });
    expect(preference.save({ collapsed: true, ignored: "not persisted" }))
      .toEqual({ collapsed: true });
    expect(JSON.parse(storage.getItem(preference.key)))
      .toEqual({ collapsed: true });
  });

  it("shares one value within a project and isolates another project", () => {
    const storage = createMemoryStorage();
    const first = createToolLauncherPreference({
      storage,
      projectId: "project-a"
    });
    const sameProject = createToolLauncherPreference({
      storage,
      projectId: "project-a"
    });
    const otherProject = createToolLauncherPreference({
      storage,
      projectId: "project-b"
    });

    first.save({ collapsed: true });

    expect(sameProject.load()).toEqual({ collapsed: true });
    expect(otherProject.load()).toEqual({ collapsed: false });
  });

  it("ignores malformed payloads instead of treating them as collapsed", () => {
    const storage = createMemoryStorage();
    const preference = createToolLauncherPreference({
      storage,
      projectId: "project-a"
    });

    storage.setItem(preference.key, JSON.stringify({ collapsed: "yes" }));

    expect(preference.load()).toEqual({ collapsed: false });
  });

  it("uses current-instance memory when storage reads and writes throw", () => {
    const storage = {
      getItem() {
        throw new Error("read blocked");
      },
      setItem() {
        throw new Error("write blocked");
      }
    };
    const preference = createToolLauncherPreference({
      storage,
      projectId: "project-a"
    });

    expect(preference.load()).toEqual({ collapsed: false });
    expect(preference.save({ collapsed: true })).toEqual({ collapsed: true });
    expect(preference.load()).toEqual({ collapsed: true });
  });
});
