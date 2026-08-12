import { UI_ATTRIBUTE } from "../constants.js";
import { styles } from "./styles.js";

export function createShell(document) {
  const host = document.createElement("div");
  host.setAttribute(UI_ATTRIBUTE, "host");

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${styles}</style>
    <div class="overlay" data-role="overlay" aria-hidden="true"></div>
    <div class="tools" data-role="tool-launcher" data-collapsed="false" role="group" aria-label="PRD 标注工具">
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
        <section class="drawer-page-info" aria-label="页面信息">
          <div data-role="page-metadata"></div>
          <div data-role="sync-state" aria-live="polite"></div>
          <div data-role="view-warning" aria-live="polite"></div>
        </section>
        <div class="drawer-tabs" role="tablist" aria-label="页面资料">
          <button id="prd-tab-annotations" type="button" role="tab" data-tab="annotations" aria-selected="true" aria-controls="prd-panel-annotations">本页标注 <span data-role="annotation-count">0</span></button>
          <button id="prd-tab-page-prd" type="button" role="tab" data-tab="page-prd" aria-selected="false" aria-controls="prd-panel-page-prd">页面 PRD</button>
          <button id="prd-tab-field-spec" type="button" role="tab" data-tab="field-spec" aria-selected="false" aria-controls="prd-panel-field-spec">页面字段规范</button>
          <button id="prd-tab-api-doc" type="button" role="tab" data-tab="api-doc" aria-selected="false" aria-controls="prd-panel-api-doc">页面接口文档</button>
          <button id="prd-tab-related" type="button" role="tab" data-tab="related" aria-selected="false" aria-controls="prd-panel-related">关联文档</button>
        </div>
        <section id="prd-panel-annotations" class="drawer-panel" role="tabpanel" data-panel="annotations" aria-labelledby="prd-tab-annotations">
          <div class="section-heading">
            <h3>本页标注</h3>
          </div>
          <div data-role="annotation-list"></div>
          <section data-role="sync-help" aria-label="同步说明"></section>
        </section>
        <section id="prd-panel-page-prd" class="drawer-panel" role="tabpanel" data-panel="page-prd" aria-labelledby="prd-tab-page-prd" hidden>
          <div class="page-document-switcher" data-role="page-prd-switcher" role="tablist" aria-label="页面 PRD 资料">
            <button type="button" role="tab" data-page-doc-view="prd" aria-selected="true">页面 PRD</button>
            <button type="button" role="tab" data-page-doc-view="supplements" aria-selected="false">本页补充资料 <span data-role="supplement-count">0</span></button>
          </div>
          <div data-page-doc-panel="prd">
            <div data-role="prd-content"></div>
            <div data-role="document-page-prd"></div>
          </div>
          <div data-page-doc-panel="supplements" hidden>
            <div data-role="document-page-supplements"></div>
          </div>
        </section>
        <section id="prd-panel-field-spec" class="drawer-panel" role="tabpanel" data-panel="field-spec" aria-labelledby="prd-tab-field-spec" hidden>
          <div data-role="document-field-spec"></div>
        </section>
        <section id="prd-panel-api-doc" class="drawer-panel" role="tabpanel" data-panel="api-doc" aria-labelledby="prd-tab-api-doc" hidden>
          <div data-role="document-api-doc"></div>
        </section>
        <section id="prd-panel-related" class="drawer-panel" role="tabpanel" data-panel="related" aria-labelledby="prd-tab-related" hidden>
          <div data-role="document-groups"></div>
        </section>
      </div>
    </aside>
  `;

  const documentContainers = {
    "page-prd": shadow.querySelector("[data-role='document-page-prd']"),
    supplements: shadow.querySelector("[data-role='document-page-supplements']"),
    related: shadow.querySelector("[data-role='document-groups']"),
    "field-spec": shadow.querySelector("[data-role='document-field-spec']"),
    "api-doc": shadow.querySelector("[data-role='document-api-doc']")
  };

  return {
    host,
    shadow,
    overlay: shadow.querySelector("[data-role='overlay']"),
    editor: shadow.querySelector("[data-role='editor']"),
    drawer: shadow.querySelector("[data-role='drawer']"),
    toolLauncher: shadow.querySelector("[data-role='tool-launcher']"),
    toolActions: shadow.querySelector("[data-role='tool-actions']"),
    toolLauncherToggle: shadow.querySelector(
      "[data-role='tool-launcher-toggle']"
    ),
    annotationButton: shadow.querySelector("[data-action='toggle-annotation']"),
    drawerButton: shadow.querySelector("[data-action='toggle-drawer']"),
    closeDrawerButton: shadow.querySelector("[data-action='close-drawer']"),
    tabs: shadow.querySelectorAll(".drawer-tabs > [role='tab']"),
    panels: shadow.querySelectorAll(".drawer-body > [role='tabpanel']"),
    pageTitle: shadow.querySelector("[data-role='page-title']"),
    annotationCount: shadow.querySelector("[data-role='annotation-count']"),
    annotationList: shadow.querySelector("[data-role='annotation-list']"),
    prdContent: shadow.querySelector("[data-role='prd-content']"),
    pagePrdSwitcher: shadow.querySelector("[data-role='page-prd-switcher']"),
    supplementCount: shadow.querySelector("[data-role='supplement-count']"),
    pageMetadata: shadow.querySelector("[data-role='page-metadata']"),
    syncState: shadow.querySelector("[data-role='sync-state']"),
    viewWarning: shadow.querySelector("[data-role='view-warning']"),
    documentGroups: documentContainers.related,
    documentContainers,
    syncHelp: shadow.querySelector("[data-role='sync-help']")
  };
}
