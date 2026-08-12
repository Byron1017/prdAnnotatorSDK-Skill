import { isCurrentPageDocument } from "../document-scope.js";
import { appendDocumentCard } from "./drawer.js";

function renderCollection(container, documents, emptyText) {
  container.replaceChildren();
  for (const entry of documents) appendDocumentCard(container, entry);
  if (container.childElementCount) return;
  const empty = container.ownerDocument.createElement("p");
  empty.className = "empty-state";
  empty.textContent = emptyText;
  container.append(empty);
}

export function createPageDocumentController({
  root,
  prdContainer,
  pagePrdContainer,
  supplementContainer,
  fieldContainer,
  apiContainer
} = {}) {
  const buttons = [...root.querySelectorAll("[data-page-doc-view]")];
  const panels = [...root.querySelectorAll("[data-page-doc-panel]")];
  const count = root.querySelector("[data-role='supplement-count']");
  let selectedId = "prd";

  function select(id) {
    if (!buttons.some((button) => button.dataset.pageDocView === id)) {
      throw new Error(`Unknown page document view: ${id}`);
    }
    selectedId = id;
    for (const button of buttons) {
      const active = button.dataset.pageDocView === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.pageDocPanel !== id;
  }

  for (const button of buttons) {
    button.addEventListener("click", () => select(button.dataset.pageDocView));
  }

  function render({ documents, pageId, managedMarkdown } = {}) {
    const current = (documents || []).filter((entry) => isCurrentPageDocument(entry, pageId));
    const pagePrds = current.filter((entry) => entry.kind === "page-prd");
    const fields = current.filter((entry) => entry.kind === "field-spec");
    const apis = current.filter((entry) => entry.kind === "api-doc");
    const supplements = current.filter((entry) => !["page-prd", "field-spec", "api-doc"].includes(entry.kind));
    count.textContent = String(supplements.length);
    renderCollection(pagePrdContainer, pagePrds, "本页尚无关联的页面 PRD 文档");
    renderCollection(supplementContainer, supplements, "本页尚无补充资料");
    renderCollection(fieldContainer, fields, "本页尚无页面字段规范");
    renderCollection(apiContainer, apis, "本页尚无页面接口文档");
    if (typeof managedMarkdown !== "string") prdContainer.replaceChildren();
    select(selectedId);
  }

  function reset() {
    select("prd");
  }

  reset();
  return { render, select, reset };
}
