(() => {
  // prd-annotator/src/constants.js
  var SDK_VERSION = "1.0.0";
  var SCHEMA_VERSION = 1;
  var UI_ATTRIBUTE = "data-prd-annotator-ui";
  var ANNOTATION_STATUSES = Object.freeze([
    "open",
    "needs-clarification",
    "applied",
    "superseded"
  ]);
  var IMPACT_SCOPES = Object.freeze(["page", "global"]);
  var STORAGE_PREFIX = "prd-annotator:v1";

  // prd-annotator/src/identity.js
  function fnv1a(value, seed = 2166136261) {
    let hash = seed >>> 0;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function stableHex(value, length) {
    return `${fnv1a(value)}${fnv1a(`prd:${value}`, 2654435769)}`.slice(0, length);
  }
  function normalizeRoute(pathname = "/") {
    const pathOnly = String(pathname).split(/[?#]/, 1)[0] || "/";
    const normalized = `/${pathOnly}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return normalized || "/";
  }
  function cleanAscii(value, maxLength = 40) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, maxLength).replace(/-$/g, "");
  }
  function resolvePageId({ explicitId, pathname = "/", manifestPages = [] }) {
    const explicit = cleanAscii(explicitId);
    if (explicit) return explicit;
    const route = normalizeRoute(pathname);
    const existing = manifestPages.find((page) => normalizeRoute(page.route) === route);
    const existingId = cleanAscii(existing?.id);
    if (existingId) return existingId;
    const segments = route.split("/").filter(Boolean).reverse();
    const slug = segments.map((segment) => cleanAscii(segment, 26)).find(Boolean);
    return slug ? `p-${slug}-${stableHex(route, 6)}`.slice(0, 40) : `p-${stableHex(route, 10)}`;
  }
  function resolveProjectKey({ explicitProjectId, scriptSrc = "" }) {
    const explicit = cleanAscii(explicitProjectId, 48);
    if (explicit) return explicit;
    const sdkDirectory = String(scriptSrc).replace(/[^/]*$/, "");
    return `project-${stableHex(sdkDirectory, 10)}`;
  }

  // prd-annotator/src/locator.js
  var BLOCKED_TAGS = /* @__PURE__ */ new Set([
    "HTML",
    "BODY",
    "SCRIPT",
    "STYLE",
    "LINK",
    "META"
  ]);
  function normalizedText(element) {
    return element.textContent.replace(/\s+/g, " ").trim();
  }
  function elementDepth(element) {
    let depth = 0;
    for (let node = element; node?.parentElement; node = node.parentElement) depth += 1;
    return depth;
  }
  function isAnnotatable(element) {
    const ElementConstructor = element?.ownerDocument?.defaultView?.Element;
    if (!ElementConstructor || !(element instanceof ElementConstructor)) return false;
    if (element.closest(`[${UI_ATTRIBUTE}]`)) return false;
    const rootHost = element.getRootNode()?.host;
    if (rootHost?.closest?.(`[${UI_ATTRIBUTE}]`)) return false;
    return !BLOCKED_TAGS.has(element.tagName);
  }
  function cssSegment(element) {
    const escape = element.ownerDocument.defaultView.CSS?.escape || ((value) => value.replace(/[^A-Za-z0-9_-]/g, "\\$&"));
    if (element.id && /^[A-Za-z][\w:-]*$/.test(element.id)) {
      return `#${escape(element.id)}`;
    }
    const siblings = [...element.parentElement?.children || []].filter((node) => node.tagName === element.tagName);
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : "";
    return `${element.tagName.toLowerCase()}${suffix}`;
  }
  function createCssPath(element) {
    const segments = [];
    const documentElement = element.ownerDocument.documentElement;
    for (let node = element; node && node !== documentElement; node = node.parentElement) {
      segments.unshift(cssSegment(node));
      if (segments[0].startsWith("#")) break;
    }
    return segments.join(" > ");
  }
  function createXpath(element) {
    const segments = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const peers = [...node.parentElement?.children || []].filter((peer) => peer.tagName === node.tagName);
      const index = peers.length > 1 ? `[${peers.indexOf(node) + 1}]` : "";
      segments.unshift(`${node.tagName.toLowerCase()}${index}`);
    }
    return `/${segments.join("/")}`;
  }
  function describeTarget(element) {
    if (!isAnnotatable(element)) throw new Error("Element is not annotatable");
    const rect = element.getBoundingClientRect();
    return {
      cssPath: createCssPath(element),
      xpath: createXpath(element),
      textQuote: normalizedText(element).slice(0, 160),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  }
  function resolveTarget(document2, descriptor) {
    try {
      const byCss = document2.querySelector(descriptor.cssPath);
      if (isAnnotatable(byCss)) return byCss;
    } catch {
    }
    try {
      const XPathResult = document2.defaultView.XPathResult;
      const result = document2.evaluate(
        descriptor.xpath,
        document2,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE
      );
      if (isAnnotatable(result.singleNodeValue)) return result.singleNodeValue;
    } catch {
    }
    const quote = String(descriptor.textQuote || "").replace(/\s+/g, " ").trim();
    if (!quote) return null;
    return [...document2.querySelectorAll("body *")].filter(isAnnotatable).filter((element) => normalizedText(element).includes(quote)).sort((left, right) => {
      const lengthDelta = normalizedText(left).length - normalizedText(right).length;
      if (lengthDelta) return lengthDelta;
      return elementDepth(right) - elementDepth(left);
    })[0] || null;
  }

  // prd-annotator/src/model.js
  function createEmptyDocument(page) {
    return {
      schemaVersion: SCHEMA_VERSION,
      page: {
        id: String(page.id),
        title: String(page.title || page.id),
        route: String(page.route || "/")
      },
      annotations: []
    };
  }
  function assertValidDocument(document2) {
    if (document2?.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("Unsupported schemaVersion");
    }
    if (!document2.page?.id || !/^[a-z0-9-]{1,40}$/.test(document2.page.id)) {
      throw new Error("Invalid page.id");
    }
    if (!Array.isArray(document2.annotations)) {
      throw new Error("annotations must be an array");
    }
    for (const annotation of document2.annotations) {
      if (!annotation.id || !annotation.comment || !annotation.target) {
        throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
      }
      if (!ANNOTATION_STATUSES.includes(annotation.status)) {
        throw new Error("Invalid annotation status");
      }
      if (!IMPACT_SCOPES.includes(annotation.prd?.impactScope)) {
        throw new Error("Invalid impact scope");
      }
    }
    return document2;
  }
  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }
  function mergeAnnotationDocuments(base, incoming) {
    assertValidDocument(base);
    assertValidDocument(incoming);
    if (base.page.id !== incoming.page.id) {
      throw new Error("Cannot merge different pages");
    }
    const annotationsById = new Map(
      base.annotations.map((item) => [item.id, clone(item)])
    );
    for (const candidate of incoming.annotations) {
      const current = annotationsById.get(candidate.id);
      if (!current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)) {
        annotationsById.set(candidate.id, clone(candidate));
      }
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      page: { ...base.page, ...incoming.page, id: base.page.id },
      annotations: [...annotationsById.values()]
    };
  }

  // prd-annotator/src/runtime/navigation.js
  function observeNavigation(window2, onRouteChange) {
    const { history } = window2;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const notify = () => onRouteChange(window2.location.pathname);
    history.pushState = function(...args) {
      const result = originalPush.apply(this, args);
      notify();
      return result;
    };
    history.replaceState = function(...args) {
      const result = originalReplace.apply(this, args);
      notify();
      return result;
    };
    window2.addEventListener("popstate", notify);
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window2.removeEventListener("popstate", notify);
    };
  }

  // prd-annotator/src/storage.js
  function makeStorageKey(projectKey, pageId) {
    return `${STORAGE_PREFIX}:${projectKey}:${pageId}`;
  }
  function clone2(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function createCacheStore({ storage, key }) {
    let memoryRecord = null;
    return Object.freeze({
      load() {
        try {
          const raw = storage?.getItem(key);
          if (!raw) return memoryRecord ? clone2(memoryRecord) : null;
          return JSON.parse(raw);
        } catch {
          return memoryRecord ? clone2(memoryRecord) : null;
        }
      },
      save(record) {
        memoryRecord = clone2(record);
        try {
          storage?.setItem(key, JSON.stringify(record));
        } catch {
        }
        return record;
      }
    });
  }

  // prd-annotator/src/markdown.js
  var HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
  var UNORDERED_PATTERN = /^\s*[-+*]\s+(.+)$/;
  var ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
  var QUOTE_PATTERN = /^\s*>\s?(.*)$/;
  var RULE_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var FENCE_PATTERN = /^\s*```([^`]*)$/;
  function isBlockStart(line) {
    return HEADING_PATTERN.test(line) || UNORDERED_PATTERN.test(line) || ORDERED_PATTERN.test(line) || QUOTE_PATTERN.test(line) || RULE_PATTERN.test(line) || FENCE_PATTERN.test(line);
  }
  function renderMarkdown(document2, markdown) {
    const fragment = document2.createDocumentFragment();
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; ) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const fence = line.match(FENCE_PATTERN);
      if (fence) {
        const codeLines = [];
        index += 1;
        while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const pre = document2.createElement("pre");
        const code = document2.createElement("code");
        const language = fence[1].trim().replace(/[^a-zA-Z0-9_-]/g, "");
        if (language) code.dataset.language = language;
        code.textContent = codeLines.join("\n");
        pre.append(code);
        fragment.append(pre);
        continue;
      }
      const heading = line.match(HEADING_PATTERN);
      if (heading) {
        const node = document2.createElement(`h${heading[1].length}`);
        node.textContent = heading[2].trim();
        fragment.append(node);
        index += 1;
        continue;
      }
      if (RULE_PATTERN.test(line)) {
        fragment.append(document2.createElement("hr"));
        index += 1;
        continue;
      }
      const listPattern = UNORDERED_PATTERN.test(line) ? UNORDERED_PATTERN : ORDERED_PATTERN.test(line) ? ORDERED_PATTERN : null;
      if (listPattern) {
        const list = document2.createElement(
          listPattern === ORDERED_PATTERN ? "ol" : "ul"
        );
        while (index < lines.length) {
          const itemMatch = lines[index].match(listPattern);
          if (!itemMatch) break;
          const item = document2.createElement("li");
          item.textContent = itemMatch[1].trim();
          list.append(item);
          index += 1;
        }
        fragment.append(list);
        continue;
      }
      if (QUOTE_PATTERN.test(line)) {
        const quoteLines = [];
        while (index < lines.length) {
          const quote = lines[index].match(QUOTE_PATTERN);
          if (!quote) break;
          quoteLines.push(quote[1]);
          index += 1;
        }
        const blockquote = document2.createElement("blockquote");
        blockquote.textContent = quoteLines.join("\n");
        fragment.append(blockquote);
        continue;
      }
      const paragraphLines = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      const paragraph = document2.createElement("p");
      paragraph.textContent = paragraphLines.join(" ");
      fragment.append(paragraph);
    }
    return fragment;
  }

  // prd-annotator/src/ui/drawer.js
  function renderAnnotationList(container, annotationDocument) {
    container.replaceChildren();
    if (!annotationDocument.annotations.length) {
      const empty = container.ownerDocument.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "本页还没有标注";
      container.append(empty);
      return;
    }
    const list = container.ownerDocument.createElement("ol");
    list.className = "annotation-list";
    annotationDocument.annotations.forEach((annotation, index) => {
      const item = container.ownerDocument.createElement("li");
      item.dataset.annotationId = annotation.id;
      const number = container.ownerDocument.createElement("span");
      number.className = "annotation-number";
      number.textContent = String(index + 1);
      const content = container.ownerDocument.createElement("div");
      content.className = "annotation-content";
      const comment = container.ownerDocument.createElement("p");
      comment.textContent = annotation.comment;
      const metadata = container.ownerDocument.createElement("div");
      metadata.className = "annotation-metadata";
      const status = container.ownerDocument.createElement("span");
      status.className = `status status-${annotation.status}`;
      status.textContent = annotation.status;
      const impact = container.ownerDocument.createElement("span");
      impact.className = `impact impact-${annotation.prd.impactScope}`;
      impact.textContent = annotation.prd.impactScope;
      metadata.append(status, impact);
      content.append(comment, metadata);
      if (annotation.prd.summary) {
        const summary = container.ownerDocument.createElement("p");
        summary.className = "annotation-summary";
        summary.textContent = annotation.prd.summary;
        content.append(summary);
      }
      if (annotation.prd.linkedSections.length) {
        const sections = container.ownerDocument.createElement("ul");
        sections.className = "linked-sections";
        for (const sectionName of annotation.prd.linkedSections) {
          const section = container.ownerDocument.createElement("li");
          section.textContent = sectionName;
          sections.append(section);
        }
        content.append(sections);
      }
      item.append(number, content);
      list.append(item);
    });
    container.append(list);
  }
  function renderPagePrd(container, markdown) {
    container.replaceChildren();
    if (!String(markdown || "").trim()) {
      const empty = container.ownerDocument.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "页面 PRD 尚未生成";
      container.append(empty);
      return;
    }
    container.append(renderMarkdown(container.ownerDocument, markdown));
  }

  // prd-annotator/src/ui/editor.js
  function targetLabel(target) {
    return target.textQuote || target.cssPath || "所选页面区域";
  }
  function closeEditor(container) {
    container.hidden = true;
    container.replaceChildren();
  }
  function openEditor({ container, target, onSave, onCancel }) {
    const document2 = container.ownerDocument;
    const heading = document2.createElement("h2");
    heading.textContent = "添加本页标注";
    const targetText = document2.createElement("p");
    targetText.className = "selected-target";
    targetText.textContent = targetLabel(target);
    const label = document2.createElement("label");
    label.htmlFor = "prd-annotation-comment";
    label.textContent = "批注内容";
    const textarea = document2.createElement("textarea");
    textarea.id = "prd-annotation-comment";
    textarea.dataset.field = "comment";
    textarea.rows = 6;
    textarea.required = true;
    textarea.placeholder = "说明希望修改什么、补充什么，或需要 AI 关注的问题";
    const error = document2.createElement("p");
    error.className = "field-error";
    error.hidden = true;
    error.textContent = "请填写批注内容";
    const actions = document2.createElement("div");
    actions.className = "editor-actions";
    const cancelButton = document2.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary-button";
    cancelButton.dataset.action = "cancel-annotation";
    cancelButton.textContent = "取消";
    const saveButton = document2.createElement("button");
    saveButton.type = "button";
    saveButton.dataset.action = "save-annotation";
    saveButton.textContent = "保存标注";
    cancelButton.addEventListener("click", () => onCancel());
    saveButton.addEventListener("click", () => {
      const comment = textarea.value.trim();
      if (!comment) {
        textarea.setAttribute("aria-invalid", "true");
        error.hidden = false;
        textarea.focus();
        return;
      }
      onSave(comment);
    });
    actions.append(cancelButton, saveButton);
    container.replaceChildren(heading, targetText, label, textarea, error, actions);
    container.hidden = false;
    textarea.focus();
  }

  // prd-annotator/src/ui/overlay.js
  function positionBox(node, rect) {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }
  function createOverlayController({ document: document2, container }) {
    const window2 = document2.defaultView;
    const requestFrame = typeof window2.requestAnimationFrame === "function" ? window2.requestAnimationFrame.bind(window2) : (callback) => window2.setTimeout(callback, 16);
    const cancelFrame = typeof window2.cancelAnimationFrame === "function" ? window2.cancelAnimationFrame.bind(window2) : (handle) => window2.clearTimeout(handle);
    const hover = document2.createElement("div");
    hover.className = "hover-outline";
    hover.hidden = true;
    container.append(hover);
    let markerNodes = [];
    let currentAnnotations = [];
    let refreshHandle = null;
    let destroyed = false;
    function showHover(element) {
      if (!isAnnotatable(element)) {
        hideHover();
        return;
      }
      positionBox(hover, element.getBoundingClientRect());
      hover.hidden = false;
    }
    function hideHover() {
      hover.hidden = true;
    }
    function renderMarkers(annotations) {
      currentAnnotations = annotations;
      for (const marker of markerNodes) marker.remove();
      markerNodes = [];
      annotations.forEach((annotation, index) => {
        const target = resolveTarget(document2, annotation.target);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const marker = document2.createElement("span");
        marker.className = "annotation-marker";
        marker.dataset.annotationId = annotation.id;
        marker.dataset.status = annotation.status;
        marker.textContent = String(index + 1);
        marker.style.left = `${rect.right}px`;
        marker.style.top = `${rect.top}px`;
        marker.setAttribute("aria-hidden", "true");
        container.append(marker);
        markerNodes.push(marker);
      });
    }
    const refresh = () => {
      refreshHandle = null;
      if (!destroyed) renderMarkers(currentAnnotations);
    };
    const scheduleRefresh = () => {
      if (destroyed || refreshHandle !== null) return;
      refreshHandle = requestFrame(refresh);
    };
    document2.addEventListener("scroll", scheduleRefresh, true);
    window2.addEventListener("resize", scheduleRefresh);
    const observer = new window2.MutationObserver(scheduleRefresh);
    if (document2.body) {
      observer.observe(document2.body, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }
    function destroy() {
      destroyed = true;
      document2.removeEventListener("scroll", scheduleRefresh, true);
      window2.removeEventListener("resize", scheduleRefresh);
      observer.disconnect();
      if (refreshHandle !== null) cancelFrame(refreshHandle);
      refreshHandle = null;
      currentAnnotations = [];
      markerNodes = [];
      container.replaceChildren();
    }
    return Object.freeze({
      showHover,
      hideHover,
      renderMarkers,
      destroy
    });
  }

  // prd-annotator/src/ui/styles.js
  var styles = `
  :host {
    all: initial;
    --prd-color-surface: #ffffff;
    --prd-color-surface-strong: #17212b;
    --prd-color-text: #17212b;
    --prd-color-text-inverse: #ffffff;
    --prd-color-border: #d5dde5;
    --prd-color-focus: #f59e0b;
    --prd-space-2: 8px;
    --prd-space-3: 12px;
    --prd-radius: 8px;
    --prd-shadow: 0 14px 36px rgb(15 23 42 / 22%);
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    pointer-events: none;
    color: var(--prd-color-text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .hover-outline {
    position: fixed;
    border: 2px dashed #d97706;
    background: rgb(245 158 11 / 10%);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 85%);
    pointer-events: none;
  }

  .annotation-marker {
    position: fixed;
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 2px solid #ffffff;
    border-radius: 50%;
    background: #d97706;
    box-shadow: 0 3px 10px rgb(15 23 42 / 28%);
    color: #ffffff;
    font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .annotation-marker[data-status="applied"] {
    background: #16835b;
  }

  .annotation-marker[data-status="needs-clarification"] {
    background: #c2410c;
  }

  .annotation-marker[data-status="superseded"] {
    background: #64748b;
  }

  .tools {
    position: fixed;
    right: 20px;
    bottom: 20px;
    display: flex;
    gap: var(--prd-space-2);
    pointer-events: auto;
  }

  button {
    min-height: 44px;
    border: 1px solid var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 9px 14px;
    background: var(--prd-color-surface-strong);
    box-shadow: var(--prd-shadow);
    color: var(--prd-color-text-inverse);
    font: 600 14px/1.25 ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }

  button:hover {
    background: #263647;
  }

  button:active,
  button[aria-pressed="true"],
  button[aria-expanded="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  button:focus-visible {
    outline: 3px solid var(--prd-color-focus);
    outline-offset: 3px;
  }

  .editor,
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    width: min(480px, 100vw);
    height: 100dvh;
    border-left: 1px solid var(--prd-color-border);
    background: var(--prd-color-surface);
    box-shadow: var(--prd-shadow);
    pointer-events: auto;
    overflow: auto;
  }

  .editor {
    inset: 50% auto auto 50%;
    width: min(440px, calc(100vw - 32px));
    height: auto;
    max-height: calc(100dvh - 32px);
    border: 1px solid var(--prd-color-border);
    border-radius: 10px;
    transform: translate(-50%, -50%);
    padding: 24px;
  }

  .editor h2,
  .drawer h2,
  .drawer h3,
  .editor p,
  .drawer p {
    margin: 0;
  }

  .editor h2 {
    font-size: 18px;
    line-height: 1.3;
  }

  .selected-target {
    margin-top: 8px !important;
    margin-bottom: 20px !important;
    padding-left: 10px;
    border-left: 3px solid #d97706;
    color: #475569;
    overflow-wrap: anywhere;
  }

  .editor label {
    display: block;
    margin-bottom: 6px;
    font-weight: 700;
  }

  .editor textarea {
    display: block;
    width: 100%;
    min-height: 132px;
    resize: vertical;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px 12px;
    color: var(--prd-color-text);
    background: #ffffff;
    font: 400 14px/1.55 ui-sans-serif, system-ui, sans-serif;
  }

  .editor textarea:focus-visible {
    border-color: #b45309;
    outline: 3px solid rgb(245 158 11 / 35%);
    outline-offset: 1px;
  }

  .editor textarea[aria-invalid="true"] {
    border-color: #b91c1c;
  }

  .field-error {
    margin-top: 6px !important;
    color: #b91c1c;
    font-size: 12px;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--prd-space-2);
    margin-top: 20px;
  }

  button.secondary-button,
  button.drawer-close {
    border-color: var(--prd-color-border);
    background: #ffffff;
    box-shadow: none;
    color: var(--prd-color-text);
  }

  button.secondary-button:hover,
  button.drawer-close:hover {
    background: #f1f5f9;
  }

  .drawer-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 84px;
    border-bottom: 1px solid var(--prd-color-border);
    padding: 16px 20px;
    background: rgb(255 255 255 / 96%);
  }

  .eyebrow {
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .drawer h2 {
    margin-top: 2px;
    font-size: 18px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  button.drawer-close {
    min-width: 44px;
    padding: 8px;
    font-size: 22px;
    line-height: 1;
  }

  .drawer-body {
    display: grid;
    gap: 28px;
    padding: 20px;
  }

  .drawer-body > section + section {
    border-top: 1px solid var(--prd-color-border);
    padding-top: 24px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .drawer h3 {
    font-size: 15px;
  }

  [data-role="annotation-count"] {
    min-width: 24px;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #334155;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .annotation-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .annotation-list li {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 10px;
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
  }

  .annotation-number {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 50%;
    background: #d97706;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
  }

  .annotation-content {
    min-width: 0;
  }

  .annotation-content p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .annotation-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .status,
  .impact {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .impact-global {
    background: #ffedd5;
    color: #9a3412;
  }

  .annotation-summary {
    margin-top: 10px !important;
    border-left: 2px solid #94a3b8;
    padding-left: 8px;
    color: #475569;
    font-size: 13px;
  }

  .linked-sections {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #475569;
    font-size: 12px;
  }

  [data-role="prd-content"] {
    margin-top: 12px;
    color: #334155;
    overflow-wrap: anywhere;
  }

  [data-role="prd-content"] h1,
  [data-role="prd-content"] h2,
  [data-role="prd-content"] h3,
  [data-role="prd-content"] h4,
  [data-role="prd-content"] h5,
  [data-role="prd-content"] h6 {
    margin: 22px 0 8px;
    color: #17212b;
    line-height: 1.3;
  }

  [data-role="prd-content"] > :first-child {
    margin-top: 0;
  }

  [data-role="prd-content"] h1 {
    font-size: 22px;
  }

  [data-role="prd-content"] h2 {
    font-size: 18px;
  }

  [data-role="prd-content"] h3 {
    font-size: 15px;
  }

  [data-role="prd-content"] p,
  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol,
  [data-role="prd-content"] blockquote,
  [data-role="prd-content"] pre {
    margin: 8px 0;
  }

  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol {
    padding-left: 22px;
  }

  [data-role="prd-content"] blockquote {
    border-left: 3px solid #d97706;
    padding: 8px 12px;
    background: #fff7ed;
    white-space: pre-wrap;
  }

  [data-role="prd-content"] pre {
    max-width: 100%;
    overflow: auto;
    border-radius: 6px;
    padding: 12px;
    background: #17212b;
    color: #e2e8f0;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  [data-role="prd-content"] hr {
    border: 0;
    border-top: 1px solid var(--prd-color-border);
    margin: 20px 0;
  }

  .empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: var(--prd-radius);
    padding: 20px 12px;
    color: #64748b;
    text-align: center;
  }

  @media (max-width: 520px) {
    .tools {
      right: 12px;
      bottom: 12px;
      gap: 6px;
    }

    button {
      padding-inline: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
`;

  // prd-annotator/src/ui/shell.js
  function createShell(document2) {
    const host = document2.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>${styles}</style>
    <div class="overlay" data-role="overlay" aria-hidden="true"></div>
    <div class="tools" aria-label="PRD 标注工具">
      <button type="button" data-role="tool-button" data-action="toggle-annotation" aria-pressed="false">标注模式</button>
      <button type="button" data-role="tool-button" data-action="toggle-drawer" aria-expanded="false">PRD 标注</button>
    </div>
    <section class="editor" data-role="editor" role="dialog" aria-modal="true" aria-label="添加标注" hidden></section>
    <aside class="drawer" data-role="drawer" aria-label="本页标注和页面 PRD" hidden>
      <header class="drawer-header">
        <div>
          <p class="eyebrow">当前页面</p>
          <h2 data-role="page-title"></h2>
        </div>
        <button type="button" class="drawer-close" data-action="close-drawer" aria-label="关闭 PRD 标注面板">×</button>
      </header>
      <div class="drawer-body">
        <section aria-labelledby="prd-annotation-heading">
          <div class="section-heading">
            <h3 id="prd-annotation-heading">本页标注</h3>
            <span data-role="annotation-count">0</span>
          </div>
          <div data-role="annotation-list"></div>
        </section>
        <section aria-labelledby="prd-content-heading">
          <h3 id="prd-content-heading">页面 PRD</h3>
          <div data-role="prd-content"></div>
        </section>
      </div>
    </aside>
  `;
    return {
      host,
      shadow,
      overlay: shadow.querySelector("[data-role='overlay']"),
      editor: shadow.querySelector("[data-role='editor']"),
      drawer: shadow.querySelector("[data-role='drawer']"),
      annotationButton: shadow.querySelector("[data-action='toggle-annotation']"),
      drawerButton: shadow.querySelector("[data-action='toggle-drawer']"),
      closeDrawerButton: shadow.querySelector("[data-action='close-drawer']"),
      pageTitle: shadow.querySelector("[data-role='page-title']"),
      annotationCount: shadow.querySelector("[data-role='annotation-count']"),
      annotationList: shadow.querySelector("[data-role='annotation-list']"),
      prdContent: shadow.querySelector("[data-role='prd-content']")
    };
  }

  // prd-annotator/src/runtime/controller.js
  function clone3(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }
  function createAnnotator({
    window: window2,
    document: document2,
    scriptSrc = "",
    explicitPageId,
    explicitProjectId,
    now = () => (/* @__PURE__ */ new Date()).toISOString()
  }) {
    const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
    let currentRoute = normalizeRoute(window2.location?.pathname || "/");
    let currentPageId = resolvePageId({
      explicitId: explicitPageId,
      pathname: currentRoute
    });
    let cache = createCacheStore({
      storage: window2.localStorage,
      key: makeStorageKey(projectKey, currentPageId)
    });
    let documentState = createEmptyDocument({
      id: currentPageId,
      title: document2.title || currentPageId,
      route: currentRoute
    });
    let pagePrdMarkdown = "";
    let shell = null;
    let disposers = [];
    let overlayController = null;
    let annotationModeActive = false;
    let pendingTarget = null;
    function loadCurrentPage() {
      documentState = createEmptyDocument({
        id: currentPageId,
        title: document2.title || currentPageId,
        route: currentRoute
      });
      pagePrdMarkdown = "";
      const cached = cache.load();
      try {
        if (cached?.schemaVersion === SCHEMA_VERSION) {
          assertValidDocument(cached.document);
          if (cached.document.page.id === currentPageId) {
            documentState = {
              ...clone3(cached.document),
              page: {
                ...clone3(cached.document.page),
                route: currentRoute
              }
            };
            pagePrdMarkdown = typeof cached.pagePrdMarkdown === "string" ? cached.pagePrdMarkdown : "";
          }
        }
      } catch {
      }
    }
    loadCurrentPage();
    function getSnapshot() {
      return clone3({
        schemaVersion: SCHEMA_VERSION,
        projectKey,
        document: documentState,
        pagePrdMarkdown
      });
    }
    function persistCache() {
      cache.save({
        schemaVersion: SCHEMA_VERSION,
        document: documentState,
        pagePrdMarkdown
      });
    }
    function nextAnnotationId() {
      const highest = documentState.annotations.reduce((maximum, annotation) => {
        const match = /^A(\d+)$/.exec(annotation.id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0);
      return `A${String(highest + 1).padStart(3, "0")}`;
    }
    function renderAll() {
      if (!shell) return;
      shell.pageTitle.textContent = documentState.page.title;
      shell.annotationCount.textContent = String(documentState.annotations.length);
      renderAnnotationList(shell.annotationList, documentState);
      renderPagePrd(shell.prdContent, pagePrdMarkdown);
      overlayController?.renderMarkers(documentState.annotations);
    }
    function closeCurrentEditor() {
      if (shell) closeEditor(shell.editor);
      pendingTarget = null;
      overlayController?.hideHover();
    }
    function savePendingAnnotation(comment) {
      if (!pendingTarget) return;
      const timestamp = now();
      const annotation = {
        id: nextAnnotationId(),
        comment,
        status: "open",
        createdAt: timestamp,
        updatedAt: timestamp,
        target: clone3(pendingTarget),
        prd: {
          linkedSections: [],
          impactScope: "page",
          summary: ""
        }
      };
      documentState = {
        ...documentState,
        annotations: [...documentState.annotations, annotation]
      };
      persistCache();
      closeCurrentEditor();
      renderAll();
    }
    function hydrate(input) {
      assertValidDocument(input?.document);
      documentState = mergeAnnotationDocuments(documentState, input.document);
      if (typeof input.pagePrdMarkdown === "string") {
        pagePrdMarkdown = input.pagePrdMarkdown;
      }
      persistCache();
      renderAll();
      return getSnapshot();
    }
    function mount() {
      if (shell?.host.isConnected) return;
      if (shell) unmount();
      shell = createShell(document2);
      const mountedShell = shell;
      overlayController = createOverlayController({
        document: document2,
        container: mountedShell.overlay
      });
      renderAll();
      const comesFromSdk = (event) => event.composedPath().includes(mountedShell.host);
      const stopIfDetached = () => {
        if (mountedShell.host.isConnected) return false;
        setAnnotationMode(false);
        return true;
      };
      const handlePointerMove = (event) => {
        if (stopIfDetached()) return;
        if (comesFromSdk(event) || !isAnnotatable(event.target)) {
          overlayController?.hideHover();
          return;
        }
        overlayController?.showHover(event.target);
      };
      const handleTargetClick = (event) => {
        if (stopIfDetached()) return;
        if (comesFromSdk(event) || !isAnnotatable(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingTarget = describeTarget(event.target);
        overlayController?.showHover(event.target);
        openEditor({
          container: mountedShell.editor,
          target: pendingTarget,
          onSave: savePendingAnnotation,
          onCancel: closeCurrentEditor
        });
      };
      const setAnnotationMode = (active) => {
        if (annotationModeActive === active) return;
        annotationModeActive = active;
        mountedShell.annotationButton.setAttribute("aria-pressed", String(active));
        if (active) {
          document2.addEventListener("pointermove", handlePointerMove, true);
          document2.addEventListener("click", handleTargetClick, true);
        } else {
          document2.removeEventListener("pointermove", handlePointerMove, true);
          document2.removeEventListener("click", handleTargetClick, true);
          overlayController?.hideHover();
          pendingTarget = null;
        }
      };
      const toggleAnnotation = () => {
        setAnnotationMode(!annotationModeActive);
      };
      const toggleDrawer = () => {
        const open = mountedShell.drawerButton.getAttribute("aria-expanded") === "true";
        if (!open) renderAll();
        mountedShell.drawerButton.setAttribute("aria-expanded", String(!open));
        mountedShell.drawer.hidden = open;
      };
      const closeDrawer = () => {
        mountedShell.drawerButton.setAttribute("aria-expanded", "false");
        mountedShell.drawer.hidden = true;
      };
      const handleKeyDown = (event) => {
        if (event.key !== "Escape") return;
        if (!mountedShell.editor.hidden) {
          closeCurrentEditor();
          mountedShell.annotationButton.focus();
        } else if (annotationModeActive) {
          setAnnotationMode(false);
          mountedShell.annotationButton.focus();
        } else if (!mountedShell.drawer.hidden) {
          closeDrawer();
          mountedShell.drawerButton.focus();
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      };
      const stopNavigation = observeNavigation(window2, (pathname) => {
        if (!mountedShell.host.isConnected) {
          stopNavigation();
          return;
        }
        const nextRoute = normalizeRoute(pathname);
        if (nextRoute === currentRoute) return;
        persistCache();
        currentRoute = nextRoute;
        currentPageId = resolvePageId({
          explicitId: explicitPageId,
          pathname: currentRoute
        });
        cache = createCacheStore({
          storage: window2.localStorage,
          key: makeStorageKey(projectKey, currentPageId)
        });
        loadCurrentPage();
        closeCurrentEditor();
        setAnnotationMode(false);
        closeDrawer();
        renderAll();
      });
      mountedShell.annotationButton.addEventListener("click", toggleAnnotation);
      mountedShell.drawerButton.addEventListener("click", toggleDrawer);
      mountedShell.closeDrawerButton.addEventListener("click", closeDrawer);
      document2.addEventListener("keydown", handleKeyDown, true);
      disposers = [
        () => setAnnotationMode(false),
        closeCurrentEditor,
        stopNavigation,
        () => document2.removeEventListener("keydown", handleKeyDown, true),
        () => mountedShell.annotationButton.removeEventListener("click", toggleAnnotation),
        () => mountedShell.drawerButton.removeEventListener("click", toggleDrawer),
        () => mountedShell.closeDrawerButton.removeEventListener("click", closeDrawer),
        () => overlayController?.destroy()
      ];
      document2.body.append(mountedShell.host);
    }
    function unmount() {
      for (const dispose of disposers.splice(0)) dispose();
      shell?.host.remove();
      overlayController = null;
      annotationModeActive = false;
      pendingTarget = null;
      shell = null;
    }
    const api = {
      version: SDK_VERSION,
      mount,
      unmount,
      isMounted: () => Boolean(shell?.host.isConnected),
      getPageId: () => documentState.page.id,
      getSnapshot,
      hydrate
    };
    return Object.freeze(api);
  }

  // prd-annotator/src/index.js
  function boot(windowObject = window) {
    if (windowObject.PRDAnnotator) return windowObject.PRDAnnotator;
    const script = windowObject.document.currentScript;
    const api = createAnnotator({
      window: windowObject,
      document: windowObject.document,
      scriptSrc: script?.src || "",
      explicitPageId: script?.dataset.pageId,
      explicitProjectId: script?.dataset.projectId
    });
    windowObject.PRDAnnotator = api;
    api.mount();
    return api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    boot(window);
  }
})();
