# PRD Annotator Collapsible Tool Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add a persistent collapse/expand control that reduces the PRD Annotator launcher to a 24 by 44 pixel right-edge handle without changing annotation mode, open panels, page data, or the public SDK API.

**Architecture:** Keep the preference in a new project-scoped browser UI store and keep DOM-state rendering in a focused launcher helper. The runtime controller reads the preference before attaching the Shadow DOM host, owns user-triggered state changes, and updates the handle when annotation mode changes. Annotation documents, Views, manifests, synchronization prompts, and PRDs remain outside this feature.

**Tech Stack:** JavaScript ES modules, Shadow DOM, browser localStorage, Vitest with jsdom, Playwright, esbuild, Node.js 20.11 or newer.

## Global Constraints

- Preserve exactly two elements with data-role="tool-button"; the collapse control uses data-role="tool-launcher-toggle".
- Expanded desktop position remains right: 20px and bottom: 20px.
- Expanded narrow-screen position remains right: 12px and bottom: 12px.
- The expanded collapse control is 32 by 44 pixels.
- Collapsed mode exposes only a 24 by 44 pixel half-round handle attached to the right viewport edge.
- Persist only {"collapsed": boolean} at prd-annotator:ui:v1:<project-id>:launcher.
- One project preference applies across physical HTML pages, registered Hash routes, and reloads.
- A failed storage read defaults to expanded; failed reads and writes fall back to state held by the current SDK instance.
- Collapsing does not close the Drawer, close the editor, clear a pending target, disable annotation mode, or mutate annotation and document data.
- The collapsed handle uses the existing orange active color and an explicit accessible label while annotation mode is active.
- The persistent native button must support pointer, Enter, and Space operation while retaining focus across state changes.
- No dragging, automatic hiding, global shortcut, new public API, schema change, save service, version bump, Release, push, or global Skill update is part of this implementation.
- Source files and generated SDK output must continue to pass the repository ASCII-path and non-destructive workflow gates.

---

## File Structure

- Create prd-annotator/src/ui/tool-launcher-preference.js: own the project-level key, payload validation, localStorage access, and per-instance memory fallback.
- Create prd-annotator/src/ui/tool-launcher.js: map collapsed and annotation-mode state to launcher DOM attributes, hidden state, and accessible labels.
- Modify prd-annotator/src/ui/shell.js: provide one semantic launcher container, one business-action container, and one persistent native toggle button.
- Modify prd-annotator/src/ui/styles.js: implement expanded and edge-handle geometry, responsive positioning, active state, focus visibility, and reduced motion.
- Modify prd-annotator/src/runtime/controller.js: load, apply, save, and retain launcher state without exposing it through window.PRDAnnotator.
- Create tests/unit/tool-launcher-preference.test.js: verify key scope, payload validation, sharing, isolation, and storage-failure behavior.
- Create tests/unit/tool-launcher.test.js: verify semantic structure and deterministic state rendering.
- Create tests/unit/tool-launcher-runtime.test.js: verify runtime persistence, route retention, open-layer preservation, active state, and data independence.
- Modify tests/unit/lifecycle.test.js: lock exactly two business controls, one independent launcher control, and the unchanged public API.
- Modify tests/e2e/prd-annotator.spec.js: verify reload, multi-HTML, Hash routes, keyboard use, mobile footprint, overflow, and snapshot independence in Chromium.
- Modify README.md: explain how users collapse and restore the launcher and what the preference does not affect.
- Regenerate prd-annotator/prd-annotator.js: include the source changes in the distributable SDK.

### Task 1: Project-scoped launcher preference

**Files:**

- Create: prd-annotator/src/ui/tool-launcher-preference.js
- Test: tests/unit/tool-launcher-preference.test.js

**Interfaces:**

- Produces: makeToolLauncherPreferenceKey(projectId: string) -> string.
- Produces: createToolLauncherPreference({ storage, projectId }) -> frozen object with key: string, load() -> { collapsed: boolean }, and save({ collapsed }) -> { collapsed: boolean }.
- Stores only a JSON object with one collapsed Boolean.
- Later tasks create one preference object per createAnnotator instance and retain it through mount and unmount calls.

- [ ] **Step 1: Write the failing preference tests**

Create tests/unit/tool-launcher-preference.test.js with:

~~~js
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
~~~

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher-preference.test.js
~~~

Expected: FAIL because prd-annotator/src/ui/tool-launcher-preference.js does not exist.

- [ ] **Step 3: Implement the preference module**

Create prd-annotator/src/ui/tool-launcher-preference.js with:

~~~js
export function makeToolLauncherPreferenceKey(projectId) {
  return "prd-annotator:ui:v1:" + String(projectId) + ":launcher";
}

function normalizePreference(value, fallback) {
  return value
    && typeof value === "object"
    && typeof value.collapsed === "boolean"
    ? { collapsed: value.collapsed }
    : { collapsed: fallback.collapsed };
}

export function createToolLauncherPreference({ storage, projectId }) {
  const key = makeToolLauncherPreferenceKey(projectId);
  let memory = { collapsed: false };

  function load() {
    try {
      const raw = storage?.getItem(key);
      if (raw !== null && raw !== undefined) {
        memory = normalizePreference(JSON.parse(raw), memory);
      }
    } catch {
      // Current-instance memory remains authoritative when storage is blocked.
    }
    return { ...memory };
  }

  function save(value) {
    memory = { collapsed: Boolean(value?.collapsed) };
    try {
      storage?.setItem(key, JSON.stringify(memory));
    } catch {
      // The preference remains usable for the lifetime of this SDK instance.
    }
    return { ...memory };
  }

  return Object.freeze({ key, load, save });
}
~~~

- [ ] **Step 4: Run the focused test and verify success**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher-preference.test.js
~~~

Expected: PASS with four tests and no console errors.

- [ ] **Step 5: Commit the preference unit**

Run:

~~~powershell
git add prd-annotator/src/ui/tool-launcher-preference.js tests/unit/tool-launcher-preference.test.js
git commit -m "feat: add project launcher preference"
~~~

Expected: one commit containing only the preference module and its focused tests.

### Task 2: Semantic launcher structure and visual states

**Files:**

- Create: prd-annotator/src/ui/tool-launcher.js
- Modify: prd-annotator/src/ui/shell.js:5-73
- Modify: prd-annotator/src/ui/styles.js:52-104 and the responsive rules near the end
- Create: tests/unit/tool-launcher.test.js
- Modify: tests/unit/lifecycle.test.js:16-33

**Interfaces:**

- Consumes: no product data and no preference storage.
- Produces: applyToolLauncherState({ launcher, actions, toggle, collapsed, annotationModeActive }) -> void.
- Extends createShell(document) with toolLauncher, toolActions, and toolLauncherToggle element references.
- Keeps annotationButton and drawerButton unchanged for the runtime and existing integrations.

- [ ] **Step 1: Write the failing semantic and state-rendering tests**

Create tests/unit/tool-launcher.test.js with:

~~~js
import { beforeEach, describe, expect, it } from "vitest";
import { createShell } from "../../prd-annotator/src/ui/shell.js";
import { applyToolLauncherState } from "../../prd-annotator/src/ui/tool-launcher.js";

describe("tool launcher UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders two business actions and one independent persistent toggle", () => {
    const shell = createShell(document);

    expect(shell.shadow.querySelectorAll("[data-role='tool-button']"))
      .toHaveLength(2);
    expect(shell.shadow.querySelectorAll("[data-role='tool-launcher-toggle']"))
      .toHaveLength(1);
    expect(shell.toolLauncherToggle.tagName).toBe("BUTTON");
    expect(shell.toolLauncherToggle.getAttribute("aria-controls"))
      .toBe(shell.toolActions.id);
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses only the action container and keeps focus on the toggle", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    shell.toolLauncherToggle.focus();

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: true,
      annotationModeActive: false
    });

    expect(shell.toolLauncher.dataset.collapsed).toBe("true");
    expect(shell.toolActions.hidden).toBe(true);
    expect(shell.toolLauncherToggle.hidden).toBe(false);
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("false");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具");
    expect(shell.shadow.activeElement).toBe(shell.toolLauncherToggle);
  });

  it("restores actions and communicates active annotation mode when collapsed", () => {
    const shell = createShell(document);

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: true,
      annotationModeActive: true
    });

    expect(shell.toolLauncherToggle.dataset.annotationActive).toBe("true");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具（标注模式已开启）");

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: false,
      annotationModeActive: true
    });

    expect(shell.toolActions.hidden).toBe(false);
    expect(shell.toolLauncher.dataset.collapsed).toBe("false");
    expect(shell.toolLauncherToggle.dataset.annotationActive).toBe("false");
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("true");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("收起 PRD 标注工具");
  });
});
~~~

In tests/unit/lifecycle.test.js, extend the first lifecycle test after the existing tool-button assertion:

~~~js
    expect(host.shadowRoot.querySelectorAll(
      "[data-role='tool-launcher-toggle']"
    )).toHaveLength(1);
    expect(host.shadowRoot.querySelectorAll(
      "[data-role='tool-button'], [data-role='tool-launcher-toggle']"
    )).toHaveLength(3);
~~~

- [ ] **Step 2: Run the focused tests and verify the structural failure**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher.test.js tests/unit/lifecycle.test.js
~~~

Expected: FAIL because the state helper and launcher toggle do not exist.

- [ ] **Step 3: Implement deterministic DOM-state rendering**

Create prd-annotator/src/ui/tool-launcher.js with:

~~~js
const COLLAPSE_LABEL = "收起 PRD 标注工具";
const EXPAND_LABEL = "展开 PRD 标注工具";
const EXPAND_ACTIVE_LABEL = "展开 PRD 标注工具（标注模式已开启）";

export function applyToolLauncherState({
  launcher,
  actions,
  toggle,
  collapsed,
  annotationModeActive
}) {
  const isCollapsed = Boolean(collapsed);
  const showActiveState = isCollapsed && Boolean(annotationModeActive);

  launcher.dataset.collapsed = String(isCollapsed);
  actions.hidden = isCollapsed;
  toggle.setAttribute("aria-expanded", String(!isCollapsed));
  toggle.dataset.annotationActive = String(showActiveState);
  toggle.setAttribute(
    "aria-label",
    isCollapsed
      ? (showActiveState ? EXPAND_ACTIVE_LABEL : EXPAND_LABEL)
      : COLLAPSE_LABEL
  );
}
~~~

- [ ] **Step 4: Replace the shell launcher markup and return its references**

In prd-annotator/src/ui/shell.js, replace the current tools div with:

~~~html
    <div class="tools" data-role="tool-launcher" data-collapsed="false" aria-label="PRD 标注工具">
      <div id="prd-annotator-tool-actions" class="tool-actions" data-role="tool-actions">
        <button type="button" data-role="tool-button" data-action="toggle-annotation" aria-pressed="false">标注模式</button>
        <button type="button" data-role="tool-button" data-action="toggle-drawer" aria-expanded="false">PRD 标注</button>
      </div>
      <button
        type="button"
        class="tool-launcher-toggle"
        data-role="tool-launcher-toggle"
        data-action="toggle-tool-launcher"
        data-annotation-active="false"
        aria-controls="prd-annotator-tool-actions"
        aria-expanded="true"
        aria-label="收起 PRD 标注工具"
      ><span class="tool-launcher-chevron" aria-hidden="true">›</span></button>
    </div>
~~~

Add these returned references beside annotationButton and drawerButton:

~~~js
    toolLauncher: shadow.querySelector("[data-role='tool-launcher']"),
    toolActions: shadow.querySelector("[data-role='tool-actions']"),
    toolLauncherToggle: shadow.querySelector(
      "[data-role='tool-launcher-toggle']"
    ),
~~~

Do not change the two existing data-role="tool-button" values or their data-action values.

- [ ] **Step 5: Replace the launcher CSS with exact expanded and collapsed geometry**

In prd-annotator/src/ui/styles.js, replace the current .tools block with:

~~~css
  .tools {
    position: fixed;
    right: 20px;
    bottom: 20px;
    display: flex;
    align-items: stretch;
    pointer-events: auto;
    transition: right 120ms ease, bottom 120ms ease;
  }

  .tool-actions {
    display: flex;
    gap: var(--prd-space-2);
  }

  .tools[data-collapsed="true"] {
    right: 0;
  }
~~~

After the existing generic button active and focus rules, add:

~~~css
  button.tool-launcher-toggle {
    display: grid;
    width: 32px;
    min-width: 32px;
    height: 44px;
    min-height: 44px;
    place-items: center;
    margin-left: var(--prd-space-2);
    border-color: var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 0;
    background: var(--prd-color-surface-strong);
    color: var(--prd-color-text-inverse);
    transition:
      width 120ms ease,
      min-width 120ms ease,
      margin-left 120ms ease,
      border-radius 120ms ease,
      background-color 120ms ease;
  }

  button.tool-launcher-toggle:hover {
    background: #263647;
  }

  .tool-launcher-chevron {
    display: block;
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle {
    width: 24px;
    min-width: 24px;
    margin-left: 0;
    border-right: 0;
    border-radius: 22px 0 0 22px;
  }

  .tools[data-collapsed="true"] .tool-launcher-chevron {
    transform: rotate(180deg);
  }

  .tools[data-collapsed="true"]
    button.tool-launcher-toggle[data-annotation-active="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle:focus-visible {
    outline-offset: -4px;
  }
~~~

Replace the launcher portion of the existing max-width: 520px rule with:

~~~css
    .tools {
      right: 12px;
      bottom: 12px;
    }

    .tools[data-collapsed="true"] {
      right: 0;
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    .tool-actions {
      gap: 6px;
    }
~~~

Keep the existing prefers-reduced-motion rule so every launcher transition is reduced to an effectively immediate state change.

- [ ] **Step 6: Run the focused tests and repository style checks**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher.test.js tests/unit/lifecycle.test.js
git diff --check
~~~

Expected: both test files PASS, exactly two business tool buttons remain, and git diff --check prints no errors.

- [ ] **Step 7: Commit the semantic launcher unit**

Run:

~~~powershell
git add prd-annotator/src/ui/tool-launcher.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/styles.js tests/unit/tool-launcher.test.js tests/unit/lifecycle.test.js
git commit -m "feat: add collapsible launcher UI"
~~~

Expected: one commit containing the launcher helper, shell semantics, styling, and focused tests.

### Task 3: Runtime persistence and behavior preservation

**Files:**

- Modify: prd-annotator/src/runtime/controller.js:1-37, 122-141, and 414-550
- Create: tests/unit/tool-launcher-runtime.test.js

**Interfaces:**

- Consumes: createToolLauncherPreference({ storage, projectId }) from Task 1.
- Consumes: applyToolLauncherState({ launcher, actions, toggle, collapsed, annotationModeActive }) from Task 2.
- Keeps launcherCollapsed as controller-private state and never adds it to getSnapshot(), getSyncPrompt(), cache records, hydrate input, route identity, or the frozen public API.
- Uses the same persistent toggle DOM node for both states so pointer and native keyboard activation share one click handler.

- [ ] **Step 1: Write the failing runtime tests**

Create tests/unit/tool-launcher-runtime.test.js with:

~~~js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { makeToolLauncherPreferenceKey } from "../../prd-annotator/src/ui/tool-launcher-preference.js";

const basePage = Object.freeze({
  id: "index-base",
  title: "Index",
  htmlPath: "index.html",
  viewSrc: "index.js"
});

const routes = Object.freeze([
  {
    id: "message-list",
    title: "Message List",
    routePattern: "/message/list",
    viewSrc: "list.js"
  },
  {
    id: "message-edit",
    title: "Message Edit",
    routePattern: "/message/edit/:id",
    viewSrc: "edit.js"
  }
]);

function currentShell() {
  const host = document.querySelector("[data-prd-annotator-ui='host']");
  return {
    host,
    shadow: host.shadowRoot,
    get actions() {
      return host.shadowRoot.querySelector("[data-role='tool-actions']");
    },
    get toggle() {
      return host.shadowRoot.querySelector(
        "[data-role='tool-launcher-toggle']"
      );
    }
  };
}

function createProjectAnnotator(pageId = "page-one") {
  return createAnnotator({
    window,
    document,
    explicitProjectId: "project-a",
    explicitPageId: pageId
  });
}

function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

describe("tool launcher runtime", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main>Main target</main>";
    history.replaceState({}, "", "/index.html");
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists one project choice across remounts and physical page instances", () => {
    const first = createProjectAnnotator("page-one");
    first.mount();
    currentShell().toggle.click();

    expect(currentShell().actions.hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem(
      makeToolLauncherPreferenceKey("project-a")
    ))).toEqual({ collapsed: true });

    first.unmount();
    first.mount();
    expect(currentShell().actions.hidden).toBe(true);

    first.unmount();
    const secondPage = createProjectAnnotator("page-two");
    secondPage.mount();
    expect(currentShell().actions.hidden).toBe(true);
    secondPage.unmount();
  });

  it("retains the launcher choice across registered Hash route changes", () => {
    history.replaceState({}, "", "/index.html#/message/edit/7");
    const api = createAnnotator({
      window,
      document,
      explicitProjectId: "project-a",
      explicitPageId: basePage.id,
      basePage,
      routes
    });
    api.mount();
    currentShell().toggle.click();

    navigate("#/message/list");

    expect(api.getPageId()).toBe("message-list");
    expect(currentShell().actions.hidden).toBe(true);
    expect(currentShell().toggle.getAttribute("aria-expanded")).toBe("false");
    api.unmount();
  });

  it("does not close layers, disable annotation mode, or alter sync data", () => {
    const api = createProjectAnnotator();
    api.mount();
    const shell = currentShell();
    const annotationButton = shell.shadow.querySelector(
      "[data-action='toggle-annotation']"
    );
    const drawerButton = shell.shadow.querySelector(
      "[data-action='toggle-drawer']"
    );
    annotationButton.click();
    document.querySelector("main").click();
    drawerButton.click();
    const snapshotBefore = JSON.stringify(api.getSnapshot());
    const promptBefore = api.getSyncPrompt();

    shell.toggle.click();

    expect(shell.actions.hidden).toBe(true);
    expect(annotationButton.getAttribute("aria-pressed")).toBe("true");
    expect(shell.shadow.querySelector("[data-role='editor']").hidden).toBe(false);
    expect(shell.shadow.querySelector("[data-role='drawer']").hidden).toBe(false);
    expect(shell.toggle.dataset.annotationActive).toBe("true");
    expect(shell.toggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具（标注模式已开启）");
    expect(JSON.stringify(api.getSnapshot())).toBe(snapshotBefore);
    expect(api.getSyncPrompt()).toBe(promptBefore);
    api.unmount();
  });

  it("keeps mounting and toggling when localStorage access throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("read blocked");
      });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("write blocked");
      });
    const api = createProjectAnnotator();

    expect(() => api.mount()).not.toThrow();
    expect(() => currentShell().toggle.click()).not.toThrow();
    expect(currentShell().actions.hidden).toBe(true);

    api.unmount();
    api.mount();
    expect(currentShell().actions.hidden).toBe(true);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    api.unmount();
  });
});
~~~

- [ ] **Step 2: Run the runtime test and verify the controller is not wired**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher-runtime.test.js
~~~

Expected: FAIL because clicking data-role="tool-launcher-toggle" does not yet change or persist state.

- [ ] **Step 3: Create controller-private preference state**

In prd-annotator/src/runtime/controller.js, add these imports:

~~~js
import { applyToolLauncherState } from "../ui/tool-launcher.js";
import {
  createToolLauncherPreference
} from "../ui/tool-launcher-preference.js";
~~~

Immediately after resolving projectKey in createAnnotator, add:

~~~js
  const launcherPreference = createToolLauncherPreference({
    storage: window.localStorage,
    projectId: projectKey
  });
  let launcherCollapsed = launcherPreference.load().collapsed;
~~~

Do not add launcherCollapsed to currentPage, cache records, snapshots, prompts, view bundles, or api.

- [ ] **Step 4: Apply state before attaching the Shadow DOM host**

Add this private renderer beside renderAll:

~~~js
  function renderToolLauncher() {
    if (!shell) return;
    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: launcherCollapsed,
      annotationModeActive
    });
  }
~~~

In mount(), immediately after shell = createShell(document), call:

~~~js
    renderToolLauncher();
~~~

This call occurs while the host is detached. Keep document.body.append(mountedShell.host) as the final mount action so a stored collapsed preference never flashes the expanded launcher.

- [ ] **Step 5: Wire one persistent native toggle and active-mode updates**

Inside mount(), add this handler beside the existing button handlers:

~~~js
    const toggleToolLauncher = () => {
      launcherCollapsed = !launcherCollapsed;
      launcherPreference.save({ collapsed: launcherCollapsed });
      renderToolLauncher();
      mountedShell.toolLauncherToggle.focus();
    };
~~~

Update setAnnotationMode so the launcher is rerendered immediately after annotationModeActive changes:

~~~js
    const setAnnotationMode = (active) => {
      if (annotationModeActive === active) return;
      annotationModeActive = active;
      mountedShell.annotationButton.setAttribute("aria-pressed", String(active));
      renderToolLauncher();
      if (active) {
        document.addEventListener("pointermove", handlePointerMove, true);
        document.addEventListener("click", handleTargetClick, true);
      } else {
        document.removeEventListener("pointermove", handlePointerMove, true);
        document.removeEventListener("click", handleTargetClick, true);
        overlayController?.hideHover();
        pendingTarget = null;
      }
    };
~~~

Register and dispose the toggle listener with the existing controls:

~~~js
    mountedShell.toolLauncherToggle.addEventListener(
      "click",
      toggleToolLauncher
    );
~~~

~~~js
      () => mountedShell.toolLauncherToggle.removeEventListener(
        "click",
        toggleToolLauncher
      ),
~~~

Do not call closeDrawer, closeCurrentEditor, setAnnotationMode(false), tabController.reset, persistCache, or renderAll from toggleToolLauncher.

- [ ] **Step 6: Run runtime and related regression tests**

Run:

~~~powershell
npx vitest run tests/unit/tool-launcher-runtime.test.js tests/unit/lifecycle.test.js tests/unit/route-switching.test.js tests/unit/annotation-flow.test.js tests/unit/sync-prompt.test.js
~~~

Expected: all selected tests PASS; the exact public keys and existing Hash-route behavior remain unchanged.

- [ ] **Step 7: Commit the runtime integration**

Run:

~~~powershell
git add prd-annotator/src/runtime/controller.js tests/unit/tool-launcher-runtime.test.js
git commit -m "feat: persist launcher collapsed state"
~~~

Expected: one commit containing private runtime wiring and its focused regression tests.

### Task 4: Browser regression, documentation, build, and complete gates

**Files:**

- Modify: tests/e2e/prd-annotator.spec.js
- Modify: README.md:48-57
- Regenerate: prd-annotator/prd-annotator.js

**Interfaces:**

- Consumes: the built SDK through examples/device-ops/*.html.
- Verifies: same project ID device-demo-a13f92 across index.html, second-page.html, and hash-router.html.
- Produces no Release package, version change, Tag, push, or global Skill installation.

- [ ] **Step 1: Add one complete browser acceptance test**

Add this test after the existing "keeps two pages isolated" test in tests/e2e/prd-annotator.spec.js:

~~~js
test("collapses the launcher across project pages without changing data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/device-ops/index.html");
  let host = annotatorHost(page);
  const actions = host.locator("[data-role='tool-actions']");
  const toggle = host.locator("[data-role='tool-launcher-toggle']");
  const annotationButton = host.locator("[data-action='toggle-annotation']");
  const snapshotBefore = await page.evaluate(
    () => JSON.stringify(window.PRDAnnotator.getSnapshot())
  );
  const promptBefore = await page.evaluate(
    () => window.PRDAnnotator.getSyncPrompt()
  );

  await annotationButton.click();
  await toggle.click();

  await expect(actions).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute(
    "aria-label",
    "展开 PRD 标注工具（标注模式已开启）"
  );
  await expect(annotationButton).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(
    () => JSON.stringify(window.PRDAnnotator.getSnapshot())
  )).toBe(snapshotBefore);
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSyncPrompt()
  )).toBe(promptBefore);

  const handleBox = await toggle.boundingBox();
  expect(handleBox.width).toBeLessThanOrEqual(24);
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);

  await page.reload();
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  await page.goto("/examples/device-ops/second-page.html");
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  await page.goto(
    "/examples/device-ops/hash-router.html#/message/edit/123?tab=base"
  );
  await page.evaluate(() => window.PRDAnnotatorReady);
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();
  await page.evaluate(() => {
    window.location.hash = "#/message/list?page=2";
  });
  await expect.poll(() => page.evaluate(
    () => window.PRDAnnotator.getPageId()
  )).toBe("message-list");
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  const routeToggle = host.locator("[data-role='tool-launcher-toggle']");
  await routeToggle.focus();
  await page.keyboard.press("Space");
  await expect(host.locator("[data-role='tool-actions']")).toBeVisible();
  await expect(routeToggle).toHaveAttribute("aria-expanded", "true");
  await expect(routeToggle).toBeFocused();
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);

  await routeToggle.press("Enter");
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();
  await expect(routeToggle).toHaveAttribute("aria-expanded", "false");
});
~~~

- [ ] **Step 2: Run the new browser test against the stale build**

Run:

~~~powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "collapses the launcher"
~~~

Expected: FAIL because examples still load the previously built prd-annotator/prd-annotator.js without the toggle.

- [ ] **Step 3: Rebuild the distributable SDK and rerun the browser test**

Run:

~~~powershell
npm run build
npx playwright test tests/e2e/prd-annotator.spec.js --grep "collapses the launcher"
~~~

Expected: the build succeeds and the focused Chromium test PASSes with no page or console errors.

- [ ] **Step 4: Document the interaction and data boundary**

In README.md, replace the opening sentence of Browser workflow and insert the launcher explanation before the localStorage paragraph:

~~~markdown
Every enabled prototype page has one floating launcher containing exactly two business buttons:

- 标注模式 selects a business-page target and records a complete annotation.
- PRD 标注 opens the Drawer with page identity, sync status, and five fixed Tabs: 本页标注, 页面 PRD, 关联文档, 字段规范, and 接口文档.

Use the narrow right-side control to collapse the two buttons when they cover prototype content. Collapsed mode leaves a 24 by 44 pixel handle at the right viewport edge; activate that handle by pointer, Enter, or Space to expand the launcher. The choice is remembered for every physical HTML page and registered Hash route that shares the same project ID.

Collapsing changes only the launcher display. It does not disable an active annotation mode, close the Drawer or annotation editor, alter annotations or PRDs, enter snapshots or synchronization prompts, or remove the SDK.
~~~

Keep the existing five-Tab explanation and browser localStorage recovery-cache explanation immediately after this new text.

- [ ] **Step 5: Run all unit, build, and browser tests**

Run:

~~~powershell
npm test
~~~

Expected: Vitest PASSes, npm run build succeeds, and the complete Playwright suite PASSes.

- [ ] **Step 6: Run repository and fixture project gates**

Run:

~~~powershell
npm run check:repo
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
git diff --check
~~~

Expected:

- npm run check:repo exits 0.
- The fixture command prints a line beginning PRD Annotator gate passed.
- git diff --check prints no whitespace errors.
- No manifest, annotation JSON, View, PRD, field specification, API document, version, Release, or installed global Skill file changed.

- [ ] **Step 7: Inspect the final diff and commit the browser-facing unit**

Run:

~~~powershell
git status --short
git diff --stat
git diff -- README.md tests/e2e/prd-annotator.spec.js
git add README.md tests/e2e/prd-annotator.spec.js prd-annotator/prd-annotator.js
git commit -m "docs: explain collapsible annotator launcher"
~~~

Expected: the final feature commit contains the E2E acceptance test, README interaction description, and regenerated SDK; no release artifacts are staged.

## Final Acceptance Review

- [ ] Confirm expanded state shows exactly 标注模式, PRD 标注, and one 32 by 44 pixel collapse button.
- [ ] Confirm collapsed state shows only one 24 by 44 pixel right-edge handle.
- [ ] Confirm the same project preference survives reload, physical-page navigation, Hash-route changes, and mount/unmount.
- [ ] Confirm active annotation mode is visible and announced on the collapsed handle.
- [ ] Confirm the Drawer, editor, pending target, and annotation mode are not closed by collapsing.
- [ ] Confirm snapshots and synchronization prompts are byte-equal before and after launcher-only state changes.
- [ ] Confirm localStorage errors do not prevent mounting, toggling, annotation, Drawer, or synchronization behavior.
- [ ] Confirm pointer, Enter, Space, focus-visible, reduced-motion, and 390 by 844 mobile behavior.
- [ ] Confirm no horizontal overflow and no collapsed horizontal footprint above 24 pixels.
- [ ] Confirm window.PRDAnnotator retains its exact existing key list.
- [ ] Confirm npm test, npm run check:repo, the fixture project gate, and git diff --check all pass before reporting completion.
