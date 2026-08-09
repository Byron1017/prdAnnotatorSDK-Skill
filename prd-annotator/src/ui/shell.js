import { UI_ATTRIBUTE } from "../constants.js";
import { styles } from "./styles.js";

export function createShell(document) {
  const host = document.createElement("div");
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
        <section aria-label="页面信息">
          <div data-role="page-metadata"></div>
          <div data-role="sync-state"></div>
          <div data-role="view-warning" aria-live="polite"></div>
        </section>
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
        <section aria-labelledby="document-groups-heading">
          <h3 id="document-groups-heading">关联文档</h3>
          <div data-role="document-groups"></div>
        </section>
        <section data-role="sync-help" aria-label="同步说明"></section>
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
    prdContent: shadow.querySelector("[data-role='prd-content']"),
    pageMetadata: shadow.querySelector("[data-role='page-metadata']"),
    syncState: shadow.querySelector("[data-role='sync-state']"),
    viewWarning: shadow.querySelector("[data-role='view-warning']"),
    documentGroups: shadow.querySelector("[data-role='document-groups']"),
    syncHelp: shadow.querySelector("[data-role='sync-help']")
  };
}
