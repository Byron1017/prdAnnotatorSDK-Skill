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
    <aside class="drawer" data-role="drawer" aria-label="本页标注和页面 PRD" hidden></aside>
  `;

  return {
    host,
    shadow,
    overlay: shadow.querySelector("[data-role='overlay']"),
    editor: shadow.querySelector("[data-role='editor']"),
    drawer: shadow.querySelector("[data-role='drawer']"),
    annotationButton: shadow.querySelector("[data-action='toggle-annotation']"),
    drawerButton: shadow.querySelector("[data-action='toggle-drawer']")
  };
}
