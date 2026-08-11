# PRD Annotator Route Isolation, Drawer Tabs, and Document Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让多 HTML 与 Vue Hash Router 原型按逻辑页面隔离标注和 PRD，把 Drawer 改为五个 Tab，并让全局 Skill 在用户明确要求时按项目既有结构生成和展示对应文档。

**Architecture:** 保留 Manifest schema v2 的向后兼容读取，在页面条目上增加可选 `identity`，并为每个物理 HTML 生成一个离线路由注册脚本。SDK 启动时先解析物理路径与 Hash 路由模板，再选择页面专属缓存和 View；文档仍由 Skill 写入项目并经 Manifest、View 和门禁进入对应 Tab。

**Tech Stack:** Node.js >=20.11、原生 ES modules、Vitest 3.2.4、jsdom 26.1.0、Playwright 1.55.0、esbuild 0.25.9、静态 HTML、Shadow DOM、localStorage。

## Global Constraints

- 浏览器运行时不得启动 Python、Node、本地 HTTP 保存端点或任何常驻保存服务。
- 每个逻辑页面必须拥有独立的 `.prd-annotator/data/pages/<page-id>.json` 和 `.prd-annotator/view/pages/<page-id>.js`。
- 页面 ID 只能使用小写 ASCII 字母、数字和连字符，最长 32 个字符。
- 页面身份为 `projectId + normalizedHtmlPath + optionalRoutePattern`。
- Hash 查询参数不参与页面身份；动态值不进入页面 ID、文件名或 localStorage 键。
- 普通 `#section` 锚点不得触发页面切换。
- 未登记的 `#/...` 必须进入隔离缓存，绝不加载其他页面的标注或 PRD。
- 旧标注必须保留，且不得自动分配到新路由的“本页标注”。
- Drawer 必须保持恰好两个悬浮按钮和五个固定 Tab。
- 标注同步不得创建或修改 PRD、字段规范或接口文档。
- 文档写入只在用户明确要求时发生；多目标或多模板不明确时必须询问。
- 所有 SDK、路由注册、View、标注和文档路径必须是项目内安全相对路径。
- 修改直接提交到已授权的 `master`，每个任务独立提交。

---

## File Structure Map

### SDK responsibilities

- Create `prd-annotator/src/route-identity.js`: Hash 规范化、路由模板匹配和组合页面身份解析。
- Create `prd-annotator/src/runtime/route-registry.js`: 验证并加载离线路由注册脚本，管理 View 加载令牌。
- Modify `prd-annotator/src/runtime/navigation.js`: 统一发布 pathname/hash 导航快照。
- Modify `prd-annotator/src/runtime/controller.js`: 页面切换、缓存隔离、旧数据提示和竞态防护。
- Modify `prd-annotator/src/index.js`: 路由注册优先启动和当前 View 加载。
- Modify `prd-annotator/src/view-data.js`: 注册式 View、文档显示分组和严格验证。
- Modify `prd-annotator/src/ui/shell.js`: 五 Tab 的语义化 DOM。
- Create `prd-annotator/src/ui/tabs.js`: Tab 键盘交互和 Panel 切换。
- Modify `prd-annotator/src/ui/drawer.js`: 文档分组进入指定 Tab。
- Modify `prd-annotator/src/ui/styles.js`: 吸顶 Tab、窄屏滚动和单 Panel 布局。

### Skill responsibilities

- Create `prd-annotator-skill/scripts/lib/route-registry.mjs`: Manifest 路由条目验证、注册 Bundle 构建与序列化。
- Create `prd-annotator-skill/scripts/set-routes.mjs`: 在项目事务和锁内登记 Agent 已确认的路由映射。
- Modify `prd-annotator-skill/scripts/lib/schema.mjs`: 向后兼容 `document` / `hash-route` 身份与文档显示分组。
- Modify `prd-annotator-skill/scripts/lib/html.mjs`: 安装和检查 `data-route-src`。
- Modify `install-project.mjs`, `refresh-project.mjs`, `check-project.mjs`, `remove-project.mjs`, `migrate-legacy.mjs`: 按物理 HTML 分组处理逻辑页面并保留旧数据。
- Modify `prd-annotator-skill/scripts/lib/documents.mjs`: 字段规范和接口文档证据分类。
- Modify `prd-annotator-skill/scripts/lib/view.mjs`: 输出页面 PRD、关联文档、字段规范和接口文档显示分组。
- Modify `prd-annotator-skill/SKILL.md` and relevant references: 路由发现、文档生成授权、结构选择和生成后展示流程。

### Test and fixture responsibilities

- Create focused Vitest files for route identity, route registry, route project lifecycle and Drawer Tabs.
- Extend existing lifecycle, Skill, View and removal tests for compatibility and no-data-loss gates.
- Add a Vue-style offline Hash Router example and Playwright coverage for route isolation and five Tabs.

---

### Task 1: Pure Route Identity Resolution

**Files:**
- Create: `prd-annotator/src/route-identity.js`
- Modify: `prd-annotator/src/identity.js`
- Create: `tests/unit/route-identity.test.js`
- Modify: `tests/unit/identity.test.js`

**Interfaces:**
- Consumes: existing `normalizeRoute(pathname)` and stable short-ID hashing behavior.
- Produces: `resolvePageIdFromSeed({ slug, seed })`, `normalizeHashLocation(hash)`, `matchRoutePattern(pattern, path)`, and `resolveLocationIdentity({ pathname, hash, basePage, routes })`.
- `resolveLocationIdentity` returns `{ pageId, title, htmlPath, route, routePattern, mode, registered, viewSrc }`.

- [ ] **Step 1: Write failing normalization and matching tests**

```js
import { describe, expect, it } from "vitest";
import {
  matchRoutePattern,
  normalizeHashLocation,
  resolveLocationIdentity
} from "../../prd-annotator/src/route-identity.js";

const basePage = {
  id: "index-2d243c",
  title: "Index",
  htmlPath: "code/index.html",
  viewSrc: "../.prd-annotator/view/pages/index-2d243c.js"
};
const routes = [{
  id: "message-edit-31ab92",
  title: "Message Edit",
  routePattern: "/message/edit/:id",
  viewSrc: "../.prd-annotator/view/pages/message-edit-31ab92.js"
}];

describe("Hash route identity", () => {
  it("ignores query values and maps dynamic values to one route template", () => {
    expect(normalizeHashLocation("#/message/edit/123?tab=base"))
      .toEqual({ kind: "route", path: "/message/edit/123" });
    expect(matchRoutePattern("/message/edit/:id", "/message/edit/123")).toBe(true);
    expect(resolveLocationIdentity({ pathname: "/code/index.html", hash: "#/message/edit/123", basePage, routes }).pageId)
      .toBe("message-edit-31ab92");
    expect(resolveLocationIdentity({ pathname: "/code/index.html", hash: "#/message/edit/456", basePage, routes }).pageId)
      .toBe("message-edit-31ab92");
  });

  it("ignores ordinary anchors and isolates unknown Hash routes", () => {
    expect(resolveLocationIdentity({ pathname: "/code/index.html", hash: "#section", basePage, routes }).pageId)
      .toBe(basePage.id);
    const unknown = resolveLocationIdentity({ pathname: "/code/index.html", hash: "#/unknown/7?x=1", basePage, routes });
    expect(unknown).toMatchObject({ mode: "hash-route", registered: false, route: "/unknown/7" });
    expect(unknown.pageId).toMatch(/^unknown-[a-f0-9]{6}$/);
  });

  it("keeps identical Hash routes on different HTML documents isolated", () => {
    const first = resolveLocationIdentity({ pathname: "/a/index.html", hash: "#/unknown", basePage, routes: [] });
    const second = resolveLocationIdentity({ pathname: "/b/index.html", hash: "#/unknown", basePage: { ...basePage, htmlPath: "b/index.html" }, routes: [] });
    expect(first.pageId).not.toBe(second.pageId);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/route-identity.test.js tests/unit/identity.test.js`

Expected: FAIL because `prd-annotator/src/route-identity.js` does not exist.

- [ ] **Step 3: Implement the pure resolver**

```js
// prd-annotator/src/route-identity.js
import { normalizeRoute, resolvePageIdFromSeed } from "./identity.js";

export function normalizeHashLocation(hash = "") {
  const raw = String(hash || "");
  if (!raw || raw === "#") return { kind: "none", path: "" };
  const body = raw.startsWith("#!") ? raw.slice(2) : raw.slice(1);
  if (!body.startsWith("/")) return { kind: "anchor", path: body };
  return { kind: "route", path: normalizeRoute(body) };
}

function patternSegments(pattern) {
  return normalizeRoute(pattern).split("/").filter(Boolean);
}

export function matchRoutePattern(pattern, candidate) {
  const expected = patternSegments(pattern);
  const actual = patternSegments(candidate);
  let actualIndex = 0;
  for (const segment of expected) {
    if (/^:[a-zA-Z_][\w]*(?:\(\.\*\))?\*$/.test(segment)) return true;
    const optional = /^:[a-zA-Z_][\w]*\?$/.test(segment);
    if (optional && actualIndex >= actual.length) continue;
    if (actualIndex >= actual.length) return false;
    if (!segment.startsWith(":") && segment !== actual[actualIndex]) return false;
    actualIndex += 1;
  }
  return actualIndex === actual.length;
}

export function resolveLocationIdentity({ pathname = "/", hash = "", basePage, routes = [] }) {
  const hashLocation = normalizeHashLocation(hash);
  if (hashLocation.kind !== "route") {
    return { ...basePage, pageId: basePage.id, route: normalizeRoute(pathname), routePattern: null, mode: "document", registered: true };
  }
  const matches = routes.filter((entry) => matchRoutePattern(entry.routePattern, hashLocation.path));
  if (matches.length > 1) throw new Error(`Ambiguous PRD Annotator route: ${hashLocation.path}`);
  if (matches.length === 1) {
    const page = matches[0];
    return { ...page, pageId: page.id, htmlPath: basePage.htmlPath, route: hashLocation.path, mode: "hash-route", registered: true };
  }
  const pageId = resolvePageIdFromSeed({
    slug: "unknown",
    seed: `${normalizeRoute(pathname)}#${hashLocation.path}`
  });
  return { pageId, title: hashLocation.path, htmlPath: basePage.htmlPath, route: hashLocation.path, routePattern: null, mode: "hash-route", registered: false, viewSrc: "" };
}
```

Export `resolvePageIdFromSeed` from `identity.js` using the existing private `cleanAscii` and `stableHex` helpers:

```js
export function resolvePageIdFromSeed({ slug = "page", seed = "" } = {}) {
  const cleanSlug = cleanAscii(slug, 25) || "page";
  return `${cleanSlug}-${stableHex(String(seed), 6)}`.slice(0, 32);
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/route-identity.test.js tests/unit/identity.test.js`

Expected: both test files pass; generated IDs remain ASCII and at most 32 characters.

- [ ] **Step 5: Commit the identity unit**

```powershell
git add prd-annotator/src/route-identity.js prd-annotator/src/identity.js tests/unit/route-identity.test.js tests/unit/identity.test.js
git commit -m "feat: resolve physical and hash route page identity"
```

### Task 2: Navigation Events and Page-Scoped Runtime State

**Files:**
- Modify: `prd-annotator/src/runtime/navigation.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `prd-annotator/src/storage.js`
- Modify: `tests/unit/navigation.test.js`
- Create: `tests/unit/route-switching.test.js`

**Interfaces:**
- Consumes: `resolveLocationIdentity` from Task 1.
- Produces: `observeNavigation(window, listener)` where `listener` receives `{ pathname, hash }`.
- `createAnnotator` gains `basePage`, `routes`, and `requestView` inputs; `getSnapshot()` gains `locationIdentity`.

- [ ] **Step 1: Write failing navigation and cache-isolation tests**

```js
const routes = [
  { id: "message-list", title: "List", routePattern: "/message/list", viewSrc: "list.js" },
  { id: "message-edit", title: "Edit", routePattern: "/message/edit/:id", viewSrc: "edit.js" }
];
const basePage = { id: "index-base", title: "Index", htmlPath: "index.html", viewSrc: "index.js" };

function annotation(id) {
  return {
    id,
    title: id,
    description: id,
    type: "requirement",
    prdContent: id,
    acceptanceCriteria: "",
    dataFields: "",
    apiPath: "",
    edgeCases: "",
    status: "open",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: { cssPath: "main", xpath: "/html/body/main", textQuote: "Main", rect: { x: 0, y: 0, width: 1, height: 1 } },
    prd: { linkedDocuments: [], linkedSections: [], impactScope: "page", summary: "" }
  };
}

function withAnnotation(api, id) {
  const current = api.getSnapshot().document;
  return { ...current, annotations: [annotation(id)] };
}

it("observes Hash changes with the complete location snapshot", () => {
  const listener = vi.fn();
  const stop = observeNavigation(window, listener);
  window.location.hash = "#/message/manage";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(listener).toHaveBeenLastCalledWith({ pathname: "/page-one", hash: "#/message/manage" });
  stop();
});

it("switches annotations and cache by logical Hash page", () => {
  const api = createAnnotator({
    window,
    document,
    explicitProjectId: "project-a",
    explicitPageId: "index-base",
    basePage,
    routes
  });
  api.mount();
  window.location.hash = "#/message/edit/7";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  api.hydrate({ document: withAnnotation(api, "A001") });
  window.location.hash = "#/message/list";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(api.getPageId()).toBe("message-list");
  expect(api.getSnapshot().document.annotations).toEqual([]);
});

it("recovers an unregistered-route cache after the route becomes registered", () => {
  const fallbackId = resolvePageIdFromSeed({ slug: "unknown", seed: "/index.html#/message/edit/7" });
  const fallbackDocument = createEmptyDocument({
    projectId: "project-a",
    page: { id: fallbackId, title: "/message/edit/7", htmlPath: "index.html", route: "/message/edit/7" }
  });
  localStorage.setItem(makeStorageKey("project-a", fallbackId), JSON.stringify({
    schemaVersion: 2,
    document: { ...fallbackDocument, annotations: [annotation("A009")] },
    pagePrdMarkdown: "",
    viewDocuments: [],
    persistedAnnotationFingerprint: "",
    viewGeneratedAt: ""
  }));
  history.replaceState({}, "", "/index.html#/message/edit/7");
  const api = createAnnotator({
    window,
    document,
    explicitProjectId: "project-a",
    explicitPageId: basePage.id,
    basePage,
    routes
  });
  expect(api.getSnapshot().document.annotations.map((item) => item.id)).toEqual(["A009"]);
  expect(localStorage.getItem(makeStorageKey("project-a", fallbackId))).not.toBeNull();
});
```

- [ ] **Step 2: Run the runtime tests and verify RED**

Run: `npx vitest run tests/unit/navigation.test.js tests/unit/route-switching.test.js`

Expected: FAIL because navigation publishes only pathname and the controller ignores Hash identity.

- [ ] **Step 3: Publish complete navigation snapshots**

```js
// prd-annotator/src/runtime/navigation.js
export function observeNavigation(window, onRouteChange) {
  const { history } = window;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const notify = () => onRouteChange({
    pathname: window.location.pathname,
    hash: window.location.hash
  });
  history.pushState = function (...args) { const result = originalPush.apply(this, args); notify(); return result; };
  history.replaceState = function (...args) { const result = originalReplace.apply(this, args); notify(); return result; };
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
  };
}
```

- [ ] **Step 4: Move controller state through one identity transition function**

```js
function resolveActiveIdentity(location = window.location) {
  return resolveLocationIdentity({
    pathname: location.pathname,
    hash: location.hash,
    basePage,
    routes
  });
}

function switchPage(nextIdentity) {
  if (nextIdentity.pageId === currentIdentity.pageId) return false;
  persistCache();
  currentIdentity = nextIdentity;
  currentPageId = nextIdentity.pageId;
  currentRoute = nextIdentity.routePattern || nextIdentity.route;
  cache = createPageCache();
  loadCurrentPage();
  closeCurrentEditor();
  setAnnotationMode(false);
  closeDrawer();
  activeTab = "annotations";
  renderAll();
  requestView?.(clone(nextIdentity));
  return true;
}
```

Update `currentPage()`, `currentDocumentDefaults()`, `getSnapshot()`, `getSyncPrompt()` and legacy-cache matching to use `currentIdentity.pageId`, `currentIdentity.htmlPath`, the route template, and the actual Hash route separately. Never pass `explicitPageId` to a Hash-route fallback ID calculation. A registered route also checks the unknown-route key derived from the current physical path and actual Hash as a read-only fallback; a successful migration writes the registered key but never deletes the unknown key.

- [ ] **Step 5: Run runtime, storage and sync tests**

Run: `npx vitest run tests/unit/navigation.test.js tests/unit/route-switching.test.js tests/unit/model-storage.test.js tests/unit/sync-prompt.test.js`

Expected: all listed tests pass; switching to `/message/list` yields no `/message/edit/:id` annotations.

- [ ] **Step 6: Commit runtime isolation**

```powershell
git add prd-annotator/src/runtime/navigation.js prd-annotator/src/runtime/controller.js prd-annotator/src/storage.js tests/unit/navigation.test.js tests/unit/route-switching.test.js
git commit -m "fix: isolate runtime state across hash routes"
```

### Task 3: Offline Route Registry and Race-Safe View Loading

**Files:**
- Create: `prd-annotator/src/runtime/route-registry.js`
- Modify: `prd-annotator/src/index.js`
- Modify: `prd-annotator/src/view-data.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `tests/unit/view-loader.test.js`
- Create: `tests/unit/route-registry.test.js`
- Modify: `tests/unit/view-data.test.js`

**Interfaces:**
- Consumes: route registry bundle `{ schemaVersion, projectId, htmlPath, basePage, routes }`.
- Produces: `loadRouteRegistryScript({ window, document, src })`, `assertValidRouteRegistry(bundle, expected)`, and race-safe `api.registerView(bundle)`.
- View scripts call `window.PRDAnnotator.registerView(bundle)`; `hydrateView(bundle)` remains for v2.0.0 compatibility.

- [ ] **Step 1: Write failing deep-link, missing-registry and stale-View tests**

```js
const registryFixture = {
  schemaVersion: 2,
  projectId: "project-a",
  htmlPath: "code/index.html",
  basePage: { id: "index-base", title: "Index", htmlPath: "code/index.html", viewSrc: "index-view.js" },
  routes: [
    { id: "message-list", title: "List", routePattern: "/message/list", viewSrc: "list-view.js" },
    { id: "message-edit", title: "Edit", routePattern: "/message/edit/:id", viewSrc: "edit-view.js" }
  ]
};
const basePage = registryFixture.basePage;
const routes = registryFixture.routes;

it("loads and validates a registry from a relative script", async () => {
  const loading = loadRouteRegistryScript({
    window,
    document,
    src: "hash-router-registry.js",
    expected: { projectId: "project-a", htmlPath: "code/index.html" }
  });
  window.__PRD_ANNOTATOR_ROUTE_REGISTRY__ = registryFixture;
  document.querySelector("script[data-prd-annotator-route-loader]")
    .dispatchEvent(new Event("load"));
  await expect(loading).resolves.toEqual(registryFixture);
});

it("does not apply a late View from the previous route", async () => {
  history.replaceState({}, "", "/code/index.html#/message/edit/7");
  const api = createAnnotator({ window, document, explicitProjectId: "project-a", basePage, routes });
  const bundleFor = (id) => {
    const page = { id, title: id, htmlPath: "code/index.html", route: id === "message-list" ? "/message/list" : "/message/edit/:id" };
    const documentValue = createEmptyDocument({ projectId: "project-a", page });
    return {
      schemaVersion: 2,
      generatedAt: "2026-08-11T00:00:00.000Z",
      projectId: "project-a",
      page,
      persistedAnnotationFingerprint: fingerprintValue([]),
      document: documentValue,
      documents: []
    };
  };
  const listBundle = bundleFor("message-list");
  const editBundle = bundleFor("message-edit");
  api.mount();
  api.registerView(editBundle);
  window.location.hash = "#/message/list";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  api.registerView(editBundle);
  expect(api.getPageId()).toBe("message-list");
  expect(api.getSnapshot().document.page.id).toBe("message-list");
  api.registerView(listBundle);
  expect(api.getSnapshot().document.page.id).toBe("message-list");
});
```

- [ ] **Step 2: Run focused View tests and verify RED**

Run: `npx vitest run tests/unit/route-registry.test.js tests/unit/view-loader.test.js tests/unit/view-data.test.js`

Expected: FAIL because route-registry loading and `registerView` do not exist.

- [ ] **Step 3: Implement strict registry validation and loading**

```js
// prd-annotator/src/runtime/route-registry.js
import { loadViewScript } from "../view-data.js";

export function assertValidRouteRegistry(value, expected = {}) {
  if (value?.schemaVersion !== 2) throw new Error("Unsupported route registry schemaVersion");
  if (value.projectId !== expected.projectId) throw new Error("Route registry projectId mismatch");
  if (value.htmlPath !== expected.htmlPath) throw new Error("Route registry htmlPath mismatch");
  if (!value.basePage || !Array.isArray(value.routes)) throw new Error("Invalid route registry");
  const ids = new Set([value.basePage.id]);
  for (const route of value.routes) {
    if (!/^[a-z0-9-]{1,32}$/.test(route.id) || ids.has(route.id)) throw new Error("Invalid route registry page id");
    if (!route.routePattern?.startsWith("/") || !route.viewSrc) throw new Error("Invalid route registry route");
    ids.add(route.id);
  }
  return value;
}

export async function loadRouteRegistryScript({ window, document, src, expected }) {
  delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  await loadViewScript({ document, src, loaderDataset: "prdAnnotatorRouteLoader" });
  const registry = assertValidRouteRegistry(window.__PRD_ANNOTATOR_ROUTE_REGISTRY__, expected);
  delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  return registry;
}
```

- [ ] **Step 4: Register Views by page ID and guard active identity**

```js
const registeredViews = new Map();

function registerView(bundle) {
  const validated = assertValidViewBundle(bundle, { projectId: projectKey });
  registeredViews.set(validated.page.id, clone(validated));
  if (validated.page.id === currentPageId) hydrateView(validated);
  return getSnapshot();
}

async function requestCurrentView(identity) {
  const token = ++viewRequestToken;
  if (!identity.registered || !identity.viewSrc) {
    reportViewLoadError(new Error("Unregistered Hash route; ask the AI Agent to refresh the route map"));
    return;
  }
  if (registeredViews.has(identity.pageId)) {
    if (token === viewRequestToken) hydrateView(registeredViews.get(identity.pageId));
    return;
  }
  await loadViewScript({ document, src: identity.viewSrc });
  if (token !== viewRequestToken || currentPageId !== identity.pageId) return;
  if (!registeredViews.has(identity.pageId)) reportViewLoadError(new Error("View script did not register this page"));
}
```

- [ ] **Step 5: Make boot wait for the route registry only when configured**

For pages without `data-route-src`, keep the current synchronous boot path. For pages with it, set `window.PRDAnnotatorReady` to the registry-loading promise, create and mount the annotator only after the registry is validated, then request only the resolved deep-route View. If loading fails, mount with `routes: []`, preserve the unknown Hash isolation identity, and report the registry error.

- [ ] **Step 6: Run View and runtime suites**

Run: `npx vitest run tests/unit/route-registry.test.js tests/unit/view-loader.test.js tests/unit/view-data.test.js tests/unit/prd-drawer.test.js tests/unit/navigation.test.js tests/unit/route-switching.test.js`

Expected: all listed tests pass; a stale View is cached by its own page ID but never hydrated into the active page.

- [ ] **Step 7: Commit offline registry loading**

```powershell
git add prd-annotator/src/runtime/route-registry.js prd-annotator/src/index.js prd-annotator/src/view-data.js prd-annotator/src/runtime/controller.js tests/unit/route-registry.test.js tests/unit/view-loader.test.js tests/unit/view-data.test.js
git commit -m "feat: load route-specific views without a service"
```

### Task 4: Manifest Route Model and Route Registration Command

**Files:**
- Modify: `prd-annotator-skill/scripts/lib/schema.mjs`
- Modify: `prd-annotator-skill/scripts/lib/route.mjs`
- Create: `prd-annotator-skill/scripts/lib/route-registry.mjs`
- Create: `prd-annotator-skill/scripts/set-routes.mjs`
- Modify: `tests/unit/project-install.test.js`
- Modify: `tests/unit/project-gate.test.js`

**Interfaces:**
- Consumes: existing schema-v2 Manifest and Agent-prepared route JSON.
- Produces: optional page `identity`, base-page `routeRegistryFile`, and `setProjectRoutes({ projectRoot, htmlPath, routes, confirmRouteWrite })`.
- Route input is `{ title, routePattern }[]`; the orchestrator derives stable IDs and all file paths.

- [ ] **Step 1: Write failing schema and route-command tests**

```js
it("registers logical routes in schema v2 without overwriting base annotations", async () => {
  const installed = await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    releaseClient,
    now: () => fixedNow
  });
  const basePage = installed.pages[0];
  const annotationPath = path.join(projectRoot, ...basePage.annotationFile.split("/"));
  const before = await readFile(annotationPath);
  const result = await setProjectRoutes({
    projectRoot,
    htmlPath: "prototype/index.html",
    routes: [
      { title: "Message List", routePattern: "/message/list" },
      { title: "Message Edit", routePattern: "/message/edit/:id" }
    ],
    confirmRouteWrite: true
  });
  expect(validateManifestV2(result)).toBe(result);
  expect(result.pages.filter((page) => page.htmlPath === "prototype/index.html")).toHaveLength(3);
  expect(result.pages.find((page) => page.id === basePage.id).identity).toEqual({ mode: "document" });
  expect(result.pages.find((page) => page.identity.routePattern === "/message/edit/:id").identity.mode)
    .toBe("hash-route");
  expect(await readFile(annotationPath)).toEqual(before);
});
```

- [ ] **Step 2: Run route project tests and verify RED**

Run: `npx vitest run tests/unit/project-install.test.js tests/unit/project-gate.test.js`

Expected: FAIL because `identity`, `routeRegistryFile`, and `setProjectRoutes` are unsupported.

- [ ] **Step 3: Extend schema-v2 validation without rewriting old manifests**

```js
export function normalizePageIdentity(page) {
  if (page.identity === undefined) return { mode: "document" };
  if (page.identity?.mode === "document" && Object.keys(page.identity).length === 1) return page.identity;
  if (page.identity?.mode === "hash-route") {
    assertValidRoute(page.identity.routePattern, "page.identity.routePattern");
    return { mode: "hash-route", routePattern: page.identity.routePattern };
  }
  throw new Error("Invalid page.identity");
}
```

Validate that exactly one `document` page exists for each enabled `htmlPath`, every route pattern is unique within that HTML, and `routeRegistryFile` equals `.prd-annotator/view/routes/<base-page-id>.js` when Hash routes exist.

- [ ] **Step 4: Build deterministic route registry assets**

```js
function pageReference(page, basePage) {
  return {
    id: page.id,
    title: page.title,
    htmlPath: page.htmlPath,
    viewSrc: relativeWebPath(basePage.htmlPath, page.viewFile)
  };
}

export function buildRouteRegistry({ manifest, basePage }) {
  const logicalPages = manifest.pages.filter((page) =>
    page.htmlPath === basePage.htmlPath && page.identity?.mode === "hash-route");
  return {
    schemaVersion: 2,
    projectId: manifest.project.id,
    htmlPath: basePage.htmlPath,
    basePage: pageReference(basePage, basePage),
    routes: logicalPages
      .map((page) => ({ ...pageReference(page, basePage), routePattern: page.identity.routePattern }))
      .sort((left, right) => left.routePattern.localeCompare(right.routePattern))
  };
}

export function serializeRouteRegistry(bundle) {
  return `window.__PRD_ANNOTATOR_ROUTE_REGISTRY__=${canonicalJson(bundle)};\n`;
}
```

`pageReference` must emit HTML-relative `viewSrc`, not a project-root path.

- [ ] **Step 5: Implement transactional `set-routes.mjs`**

The command must require `--confirm-route-write`, preserve existing page IDs by `(htmlPath, routePattern)`, create only new route page JSON/View assets, mark removed routes as `display.enabled = false` without deleting bytes, and regenerate the base route registry in the same transaction.

CLI contract:

```powershell
node "<skill-dir>/scripts/set-routes.mjs" `
  --project-root "<project-root>" `
  --html "code/index.html" `
  --routes "<agent-controlled-routes.json>" `
  --confirm-route-write
```

The route JSON schema is exactly:

```json
[
  { "title": "Message List", "routePattern": "/message/list" },
  { "title": "Message Edit", "routePattern": "/message/edit/:id" }
]
```

- [ ] **Step 6: Run schema, route and transaction tests**

Run: `npx vitest run tests/unit/project-install.test.js tests/unit/project-gate.test.js`

Expected: all listed tests pass; repeated route registration is byte-stable and base annotations are unchanged.

- [ ] **Step 7: Commit route registration control plane**

```powershell
git add prd-annotator-skill/scripts/lib/schema.mjs prd-annotator-skill/scripts/lib/route.mjs prd-annotator-skill/scripts/lib/route-registry.mjs prd-annotator-skill/scripts/set-routes.mjs tests/unit/project-install.test.js tests/unit/project-gate.test.js
git commit -m "feat: register logical hash pages in project manifests"
```

### Task 5: Project Lifecycle, HTML Integration, and Legacy Preservation

**Files:**
- Modify: `prd-annotator-skill/scripts/lib/html.mjs`
- Modify: `prd-annotator-skill/scripts/install-project.mjs`
- Modify: `prd-annotator-skill/scripts/refresh-project.mjs`
- Modify: `prd-annotator-skill/scripts/check-project.mjs`
- Modify: `prd-annotator-skill/scripts/remove-project.mjs`
- Modify: `prd-annotator-skill/scripts/migrate-legacy.mjs`
- Modify: `tests/unit/html-injection.test.js`
- Modify: `tests/unit/project-install.test.js`
- Modify: `tests/unit/view-builder.test.js`
- Modify: `tests/unit/project-removal.test.js`
- Modify: `tests/unit/legacy-migration.test.js`

**Interfaces:**
- Consumes: base-page `routeRegistryFile` and logical pages from Task 4.
- Produces: one HTML integration per physical HTML with optional `data-route-src`; lifecycle commands operate on unique HTML entries and all logical data pages.

- [ ] **Step 1: Write failing integration and lifecycle tests**

```js
it("injects one SDK tag for three logical pages sharing one HTML", async () => {
  await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    releaseClient,
    now: () => fixedNow
  });
  const manifest = await setProjectRoutes({
    projectRoot,
    htmlPath: "prototype/index.html",
    routes: [
      { title: "Message List", routePattern: "/message/list" },
      { title: "Message Edit", routePattern: "/message/edit/:id" }
    ],
    confirmRouteWrite: true
  });
  const html = await readFile(path.join(projectRoot, "prototype/index.html"), "utf8");
  const integrations = inspectIntegration(html);
  expect(integrations).toHaveLength(1);
  expect(integrations[0]).toMatchObject({
    pageId: manifest.pages.find((page) => page.identity.mode === "document").id,
    routeSrc: `../.prd-annotator/view/routes/${manifest.pages.find((page) => page.identity.mode === "document").id}.js`
  });
});

it("removes display integration once while retaining every logical page file", async () => {
  const manifest = await setProjectRoutes({
    projectRoot,
    htmlPath: "prototype/index.html",
    routes: [{ title: "Message List", routePattern: "/message/list" }],
    confirmRouteWrite: true
  });
  const retainedPaths = [
    ...manifest.pages.flatMap((page) => [page.annotationFile, page.viewFile]),
    manifest.pages.find((page) => page.identity.mode === "document").routeRegistryFile
  ];
  const before = new Map(retainedPaths.map((relativePath) => [relativePath, readFileSync(projectPath(projectRoot, relativePath))]));
  const snapshots = manifest.pages.map((page) => rawSnapshot(
    manifest,
    readJson(projectPath(projectRoot, page.annotationFile))
  ));
  await removeProject({ projectRoot, pageIds: manifest.pages.map((page) => page.id), snapshots, confirmRemove: true });
  expect(inspectIntegration(readFileSync(projectPath(projectRoot, "prototype/index.html"), "utf8"))).toHaveLength(0);
  for (const [relativePath, bytes] of before) {
    expect(readFileSync(projectPath(projectRoot, relativePath))).toEqual(bytes);
  }
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npx vitest run tests/unit/html-injection.test.js tests/unit/project-install.test.js tests/unit/view-builder.test.js tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js`

Expected: FAIL because the integration record has no `routeSrc` and lifecycle loops assume one HTML per page.

- [ ] **Step 3: Extend the HTML integration record**

```js
function integrationScript(attrs) {
  assertRelativeWebReference(attrs.src, "src");
  assertRelativeWebReference(attrs.viewSrc, "data-view-src");
  if (attrs.routeSrc) assertRelativeWebReference(attrs.routeSrc, "data-route-src");
  const routeAttribute = attrs.routeSrc
    ? ` data-route-src="${escapeAttribute(attrs.routeSrc)}"`
    : "";
  return `<script src="${escapeAttribute(attrs.src)}" data-project-id="${escapeAttribute(attrs.projectId)}" data-page-id="${escapeAttribute(attrs.pageId)}" data-view-src="${escapeAttribute(attrs.viewSrc)}"${routeAttribute}></script>`;
}
```

Return `routeSrc` from `inspectIntegration` and keep it optional for existing nonrouter projects.

- [ ] **Step 4: Group lifecycle operations by physical HTML**

Introduce a local helper in each lifecycle script:

```js
function physicalEntries(manifest) {
  return manifest.pages
    .filter((page) => (page.identity?.mode || "document") === "document")
    .sort((left, right) => left.htmlPath.localeCompare(right.htmlPath));
}
```

Use this list for HTML injection/removal checks. Continue using `manifest.pages` for annotation files, View files, document associations, managed PRD indexes and permanent data gates.

- [ ] **Step 5: Generate route registries during refresh and preserve old data**

`refresh-project.mjs` writes route registry files and all page View files in one project transaction. When routes are first added to a base page that already has annotations, set migration metadata containing the base page ID, annotation fingerprint and `classification: "legacy-unassigned"`; do not copy its annotations into any route page.

- [ ] **Step 6: Strengthen `check-project.mjs`**

The gate must fail for duplicate route patterns, route pages without a base document page, a route registry outside the project, mismatched route bundle identity, missing logical page files, dynamic values in page IDs, or one HTML containing more than one SDK tag. It must accept existing schema-v2 projects without `identity` as document pages.

- [ ] **Step 7: Run all lifecycle tests**

Run: `npx vitest run tests/unit/html-injection.test.js tests/unit/project-install.test.js tests/unit/view-builder.test.js tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js tests/unit/project-gate.test.js`

Expected: all listed tests pass; removal leaves every route JSON/View/registry byte intact, except the intended regenerated display metadata.

- [ ] **Step 8: Commit lifecycle compatibility**

```powershell
git add prd-annotator-skill/scripts/lib/html.mjs prd-annotator-skill/scripts/install-project.mjs prd-annotator-skill/scripts/refresh-project.mjs prd-annotator-skill/scripts/check-project.mjs prd-annotator-skill/scripts/remove-project.mjs prd-annotator-skill/scripts/migrate-legacy.mjs tests/unit/html-injection.test.js tests/unit/project-install.test.js tests/unit/view-builder.test.js tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js
git commit -m "fix: preserve logical pages through project lifecycle"
```

### Task 6: Five Drawer Tabs and Document Display Groups

**Files:**
- Modify: `prd-annotator-skill/scripts/lib/documents.mjs`
- Modify: `prd-annotator-skill/scripts/lib/view.mjs`
- Modify: `prd-annotator/src/view-data.js`
- Modify: `prd-annotator/src/ui/shell.js`
- Create: `prd-annotator/src/ui/tabs.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Create: `tests/unit/drawer-tabs.test.js`
- Modify: `tests/unit/document-discovery.test.js`
- Modify: `tests/unit/view-builder.test.js`
- Modify: `tests/unit/prd-drawer.test.js`

**Interfaces:**
- Consumes: View document inventory.
- Produces: optional `displayGroups` values from `page-prd`, `related`, `field-spec`, `api-doc`; `createTabController({ tabs, panels, initialId })`.
- Existing `kind` remains the document classification; `displayGroups` only controls display and may contain several values.

- [ ] **Step 1: Write failing classification and Tab tests**

```js
it("classifies field and API documents into dedicated display groups", async () => {
  const documents = await discoverDocuments({ projectRoot });
  expect(documents.find((entry) => entry.path === "doc/data/fields.md")).toMatchObject({
    kind: "field-spec",
    displayGroups: ["field-spec"]
  });
  expect(documents.find((entry) => entry.path === "doc/api/messages.md")).toMatchObject({
    kind: "api-doc",
    displayGroups: ["api-doc"]
  });
});

it("shows only the selected panel and resets to annotations", () => {
  const shell = createShell(document);
  document.body.append(shell.host);
  const visiblePanelIds = () => [...shell.shadow.querySelectorAll("[role='tabpanel']:not([hidden])")]
    .map((panel) => panel.dataset.panel);
  const controller = createTabController({
    tabs: shell.shadow.querySelectorAll("[role='tab']"),
    panels: shell.shadow.querySelectorAll("[role='tabpanel']")
  });
  expect(visiblePanelIds()).toEqual(["annotations"]);
  shell.shadow.querySelector("[data-tab='api-doc']").click();
  expect(visiblePanelIds()).toEqual(["api-doc"]);
  controller.reset();
  expect(visiblePanelIds()).toEqual(["annotations"]);
});

it("supports arrow-key navigation across all five tabs", () => {
  const shell = createShell(document);
  document.body.append(shell.host);
  createTabController({
    tabs: shell.shadow.querySelectorAll("[role='tab']"),
    panels: shell.shadow.querySelectorAll("[role='tabpanel']")
  });
  const tabs = [...shell.shadow.querySelectorAll("[role='tab']")];
  tabs[0].focus();
  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(shell.shadow.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
});
```

- [ ] **Step 2: Run Drawer tests and verify RED**

Run: `npx vitest run tests/unit/drawer-tabs.test.js tests/unit/document-discovery.test.js tests/unit/view-builder.test.js tests/unit/prd-drawer.test.js`

Expected: FAIL because `displayGroups` and Tab markup do not exist.

- [ ] **Step 3: Extend document discovery and View data**

Add deterministic evidence rules for filenames/headings containing field, data dictionary, data model, schema, API, interface, endpoint, request, response or error code signals. Preserve manually assigned `kind`, `pageIds` and `displayGroups`. Default existing kinds as follows:

```js
export function documentDisplayGroups(entry) {
  if (Array.isArray(entry.displayGroups) && entry.displayGroups.length) return [...new Set(entry.displayGroups)];
  if (entry.kind === "page-prd") return ["page-prd"];
  if (entry.kind === "field-spec") return ["field-spec"];
  if (entry.kind === "api-doc") return ["api-doc"];
  return ["related"];
}
```

Copy `displayGroups` into each View document and validate every value. Do not discard documents whose groups overlap.

- [ ] **Step 4: Build semantic Tab markup**

```html
<div class="drawer-tabs" role="tablist" aria-label="页面资料">
  <button role="tab" data-tab="annotations" aria-selected="true" aria-controls="panel-annotations">本页标注 <span data-role="annotation-count">0</span></button>
  <button role="tab" data-tab="page-prd" aria-selected="false" aria-controls="panel-page-prd">页面 PRD</button>
  <button role="tab" data-tab="related" aria-selected="false" aria-controls="panel-related">关联文档</button>
  <button role="tab" data-tab="field-spec" aria-selected="false" aria-controls="panel-field-spec">字段规范</button>
  <button role="tab" data-tab="api-doc" aria-selected="false" aria-controls="panel-api-doc">接口文档</button>
</div>
```

Create five matching `role="tabpanel"` sections. Put sync help below the annotation list inside the annotations panel. Keep page identity and sync status above the Tab bar.

- [ ] **Step 5: Implement keyboard and selection behavior**

```js
export function createTabController({ tabs, panels, initialId = "annotations" }) {
  const ordered = [...tabs];
  function select(id, { focus = false } = {}) {
    for (const tab of ordered) {
      const active = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== id;
  }
  function onKeyDown(event) {
    const index = ordered.indexOf(event.currentTarget);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    select(ordered[(index + delta + ordered.length) % ordered.length].dataset.tab, { focus: true });
  }
  for (const tab of ordered) {
    tab.addEventListener("click", () => select(tab.dataset.tab));
    tab.addEventListener("keydown", onKeyDown);
  }
  select(initialId);
  return { select, reset: () => select(initialId) };
}
```

- [ ] **Step 6: Render each document into every declared group**

`renderDocumentGroups` becomes `renderDocumentsByGroup(containers, documents, pageId)`. Page PRDs associated with the current page render in the page-PRD panel; field/API groups render in their named panels; all other candidates render under related. Every empty panel receives its own empty-state text and every card retains source path, kind, preview and missing/stale state.

- [ ] **Step 7: Add sticky and narrow-screen styles**

Use `position: sticky`, `top: 84px`, horizontal `overflow-x: auto`, nonshrinking Tab buttons, and Panel-local content spacing. Remove the old `.drawer-body > section + section` stacked-divider rule so hidden panels do not leave gaps.

- [ ] **Step 8: Run Drawer and accessibility-focused tests**

Run: `npx vitest run tests/unit/drawer-tabs.test.js tests/unit/document-discovery.test.js tests/unit/view-builder.test.js tests/unit/prd-drawer.test.js tests/unit/lifecycle.test.js`

Expected: all listed tests pass; exactly one Panel is visible and exactly five `role=tab` elements exist.

- [ ] **Step 9: Commit Drawer Tabs**

```powershell
git add prd-annotator-skill/scripts/lib/documents.mjs prd-annotator-skill/scripts/lib/view.mjs prd-annotator/src/view-data.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/tabs.js prd-annotator/src/ui/drawer.js prd-annotator/src/ui/styles.js prd-annotator/src/runtime/controller.js tests/unit/drawer-tabs.test.js tests/unit/document-discovery.test.js tests/unit/view-builder.test.js tests/unit/prd-drawer.test.js
git commit -m "feat: organize page assets into drawer tabs"
```

### Task 7: Skill Route Discovery and User-Authorized Document Generation Workflow

**Files:**
- Modify: `prd-annotator-skill/SKILL.md`
- Modify: `prd-annotator-skill/references/installation.md`
- Modify: `prd-annotator-skill/references/data-schema.md`
- Modify: `prd-annotator-skill/references/prd-workflow.md`
- Modify: `tests/unit/skill-scripts.test.js`
- Modify: `tests/unit/document-discovery.test.js`
- Create: `tests/fixtures/install-project/docs/field-spec.md`
- Create: `tests/fixtures/install-project/docs/api-contract.md`

**Interfaces:**
- Consumes: `set-routes.mjs`, document discovery, existing `generate-prd.mjs`, `refresh-project.mjs`, and `check-project.mjs`.
- Produces: semantic Skill rules for route discovery and explicit document work; no magic phrase.

- [ ] **Step 1: Write failing Skill contract tests**

```js
it("requires explicit document intent and keeps annotation sync document-free", async () => {
  const skill = await readFile("prd-annotator-skill/SKILL.md", "utf8");
  const workflow = await readFile("prd-annotator-skill/references/prd-workflow.md", "utf8");
  expect(skill).toContain("annotation synchronization alone must never create or edit a document");
  expect(workflow).toContain("Field specification");
  expect(workflow).toContain("API document");
  expect(workflow).toContain("existing directory, naming, format, and section structure");
});

it("discovers generated field and API documents for their Drawer tabs", async () => {
  const documents = await discoverDocuments({ projectRoot: fixtureRoot });
  expect(documents.find((entry) => entry.path.endsWith("field-spec.md")).displayGroups).toContain("field-spec");
  expect(documents.find((entry) => entry.path.endsWith("api-contract.md")).displayGroups).toContain("api-doc");
});
```

- [ ] **Step 2: Run Skill tests and verify RED**

Run: `npx vitest run tests/unit/skill-scripts.test.js tests/unit/document-discovery.test.js`

Expected: FAIL because the Skill does not yet define these exact route/document workflows and fixtures are absent.

- [ ] **Step 3: Document the route-discovery control flow**

Add rules requiring the Agent to inspect Vue Router source, preserve declared `:parameters`, create an Agent-controlled route JSON file, run `set-routes.mjs --confirm-route-write`, then run `refresh-project.mjs` and `check-project.mjs`. If source evidence cannot distinguish a dynamic template, the Skill must keep the route isolated and ask rather than infer from numeric URL segments.

- [ ] **Step 4: Document the user-authorized document workflow**

The reference must prescribe this exact sequence:

1. Infer explicit create/update intent from natural language.
2. Read current logical page JSON and Manifest-linked assets.
3. Discover same-kind document roots, filenames, formats, headings, tables and terminology.
4. Use a user-selected target; use a sole unambiguous structure; ask when several are plausible.
5. Write only the requested page PRD, total PRD, field specification, API document or related document.
6. Preserve every other candidate and manual mapping.
7. Refresh Manifest/View, run `check-project.mjs`, and report changed files plus a content summary.

State explicitly that installation, annotation creation, annotation synchronization, route refresh and View refresh do not authorize document writes.

- [ ] **Step 5: Add the document fixtures and run the Skill fixture gate**

Create the field fixture with this exact content:

```markdown
# Message Field Specification

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageId` | string | yes | Stable message identifier. |
```

Create the API fixture with this exact content:

```markdown
# Message API Contract

## `POST /api/messages`

- Request: `{ "title": "string" }`
- Response: `{ "messageId": "string" }`
- Error code: `MESSAGE_TITLE_REQUIRED`
```

Run: `npx vitest run tests/unit/skill-scripts.test.js tests/unit/document-discovery.test.js tests/unit/view-builder.test.js`

Expected: all listed tests pass; the generated View includes both new document groups and unchanged ambiguous candidates.

- [ ] **Step 6: Validate the distributable Skill**

Run: `& "C:/Users/28920/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe" "C:/Users/28920/.codex/skills/.system/skill-creator/scripts/quick_validate.py" "prd-annotator-skill"`

Expected: validation reports the Skill as valid.

- [ ] **Step 7: Commit Skill workflow rules**

```powershell
git add prd-annotator-skill/SKILL.md prd-annotator-skill/references/installation.md prd-annotator-skill/references/data-schema.md prd-annotator-skill/references/prd-workflow.md tests/unit/skill-scripts.test.js tests/unit/document-discovery.test.js tests/fixtures/install-project/docs/field-spec.md tests/fixtures/install-project/docs/api-contract.md
git commit -m "docs: gate route discovery and document generation"
```

### Task 8: Browser E2E for Hash Routes, Tabs, and Compatibility

**Files:**
- Create: `examples/device-ops/hash-router.html`
- Create: `examples/device-ops/hash-router-registry.js`
- Create: `examples/device-ops/message-list-view.js`
- Create: `examples/device-ops/message-edit-view.js`
- Modify: `tests/e2e/prd-annotator.spec.js`

**Interfaces:**
- Consumes: built `prd-annotator.js`, route registry and page View contracts.
- Produces: browser evidence for route isolation, dynamic routes, queries, anchors, deep links, Tabs, multi-HTML and unknown-route quarantine.

- [ ] **Step 1: Add the failing Vue-style Hash Router E2E test**

```js
async function createAnnotation(page, title) {
  const host = page.locator("[data-prd-annotator-ui='host']");
  await host.locator("[data-action='toggle-annotation']").click();
  await page.locator("main").click();
  await host.locator("[data-field='title']").fill(title);
  await host.locator("[data-field='description']").fill(title);
  await host.locator("[data-field='prdContent']").fill(title);
  await host.locator("[data-action='save-annotation']").click();
}

function drawer(page) {
  return page.locator("[data-prd-annotator-ui='host']");
}

async function openDrawer(page) {
  const host = drawer(page);
  const button = host.locator("[data-action='toggle-drawer']");
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}

test("isolates one physical HTML across Vue-style Hash routes", async ({ page }) => {
  await page.goto("/examples/device-ops/hash-router.html#/message/edit/123?tab=base");
  await page.evaluate(() => window.PRDAnnotatorReady);
  await createAnnotation(page, "Edit only");
  await openDrawer(page);
  await expect(drawer(page).getByText("Edit only")).toBeVisible();

  await page.evaluate(() => { window.location.hash = "#/message/list?page=2"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId())).toBe("message-list");
  await openDrawer(page);
  await expect(drawer(page).getByText("Edit only")).toHaveCount(0);

  await page.evaluate(() => { window.location.hash = "#/message/edit/456"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId())).toBe("message-edit");
  await openDrawer(page);
  await expect(drawer(page).getByText("Edit only")).toBeVisible();
});
```

- [ ] **Step 2: Add E2E cases for the remaining identity rules**

Add independent tests that assert:

- `?query` changes do not change the page ID.
- `#section` keeps the base document page ID.
- direct navigation to `#/message/edit/123` loads edit View before Drawer content appears.
- `#/unregistered/7` shows no list/edit annotation and displays the unregistered-route warning.
- existing `index.html` and `second-page.html` remain isolated.
- five Tabs exist, only one Panel is visible, and field/API documents appear in their own Tabs.
- narrow viewport `390x844` keeps the Tab list horizontally operable.

- [ ] **Step 3: Run the E2E test and verify RED before rebuilding**

Run: `npm run test:e2e -- --grep "Hash routes|Drawer tabs|unregistered route"`

Expected: FAIL because the current built SDK has no route registry or Tabs.

- [ ] **Step 4: Build the SDK and rerun focused E2E**

Run: `npm run build`

Expected: build completes and writes the single-file SDK.

Run: `npm run test:e2e -- --grep "Hash routes|Drawer tabs|unregistered route"`

Expected: focused Hash and Tab E2E tests pass.

- [ ] **Step 5: Run the entire Playwright suite**

Run: `npm run test:e2e`

Expected: all existing and new E2E tests pass with exactly two floating tool buttons on every example.

- [ ] **Step 6: Commit browser fixtures and E2E coverage**

```powershell
git add examples/device-ops/hash-router.html examples/device-ops/hash-router-registry.js examples/device-ops/message-list-view.js examples/device-ops/message-edit-view.js tests/e2e/prd-annotator.spec.js
git commit -m "test: cover hash route isolation and drawer tabs"
```

### Task 9: Versioning, Documentation, and Full Verification

**Files:**
- Modify: `package.json`
- Modify: `prd-annotator/src/constants.js`
- Modify: `README.md`
- Create: `docs/route-and-document-workflow.md`
- Modify: `prd-annotator-skill/references/data-schema.md`
- Modify: `prd-annotator-skill/references/installation.md`
- Modify: `tests/unit/release-package.test.js`
- Modify: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: version `2.1.0` source artifacts, user documentation, validated Release package and a clean master worktree.

- [ ] **Step 1: Write failing version and documentation assertions**

```js
import { readFileSync } from "node:fs";
import { SDK_VERSION } from "../../prd-annotator/src/constants.js";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

it("packages the route-aware SDK as version 2.1.0", async () => {
  expect(packageJson.version).toBe("2.1.0");
  expect(SDK_VERSION).toBe("2.1.0");
  expect(readme).toContain("data-route-src");
  expect(readme).toContain("本页标注");
  expect(readme).toContain("接口文档");
});
```

- [ ] **Step 2: Run release tests and verify RED**

Run: `npx vitest run tests/unit/release-package.test.js tests/unit/skill-scripts.test.js`

Expected: FAIL while the source version remains `2.0.0` and route-aware documentation is absent.

- [ ] **Step 3: Update version and user documentation**

Set `package.json` and `SDK_VERSION` to `2.1.0`. Document:

- physical HTML plus Hash route identity.
- the five Drawer Tabs.
- unknown-route warnings and AI route refresh.
- old unclassified annotation retention.
- explicit user authorization before SDK upgrade or document writes.
- the exact Skill workflow for page PRD, field specification and API documentation.

- [ ] **Step 4: Run all unit tests**

Run: `npm run test:unit`

Expected: all unit tests pass; only the existing permission-dependent tests may report their documented skips.

- [ ] **Step 5: Build and package the Release assets**

Run: `npm run release:package`

Expected: build and package succeed, producing `prd-annotator.js`, `prd-annotator.js.sha256` and `release-manifest.json` for version `2.1.0`.

- [ ] **Step 6: Run repository and Skill gates**

Run: `npm run check:repo`

Expected: repository scan passes with ASCII tracked paths and no save-service or destructive-data workflow.

Run: `node "prd-annotator-skill/scripts/check-project.mjs" --project-root "tests/fixtures/project"`

Expected: fixture gate passes and reports all logical pages, annotations and documents.

- [ ] **Step 7: Run the complete verification command**

Run: `npm test`

Expected: unit tests, build and all Playwright tests pass.

- [ ] **Step 8: Inspect the final diff and commit**

Run: `git diff --check`

Expected: no whitespace errors.

```powershell
git add package.json prd-annotator/src/constants.js README.md docs/route-and-document-workflow.md prd-annotator-skill/references/data-schema.md prd-annotator-skill/references/installation.md tests/unit/release-package.test.js tests/unit/skill-scripts.test.js
git commit -m "release: prepare route-aware annotator 2.1.0"
```

- [ ] **Step 9: Verify repository state without pushing or publishing**

Run: `git status --short; git log -10 --oneline`

Expected: clean worktree and one focused commit for each task. Do not push, tag, publish a GitHub Release, upgrade the globally installed Skill, or upgrade another prototype project without separate user authorization.

---

## Plan Self-Review Traceability

- 多 HTML、Hash Router、动态参数、查询参数、普通锚点、深层路由和未知路由：Tasks 1–5 and 8.
- 独立 localStorage、View、Marker 和同步载荷：Tasks 2–3.
- 旧数据保留和未归类处理：Task 5 and Task 8.
- 五个 Tab、单 Panel、键盘和窄屏：Task 6 and Task 8.
- 字段规范、接口文档和多分组展示：Task 6.
- Skill 只按用户请求并依项目结构生成文档：Task 7.
- 标注同步不得修改文档：Task 7 and Task 9 gates.
- 路径、Manifest、移除和可再生成门禁：Tasks 4–5 and 9.
- TDD、完整回归、构建和 Release 包：every task, with final evidence in Task 9.
