import { hubCategoryForDocument } from "../document-scope.js";
import { appendDocumentCard } from "./drawer.js";

export const HUB_CATEGORIES = Object.freeze([
  { id: "requirement", label: "总需求文档" },
  { id: "prd", label: "总 PRD 文档" },
  { id: "field", label: "总字段规范" },
  { id: "api", label: "总接口文档" }
]);

function appendEmpty(container, text) {
  const empty = container.ownerDocument.createElement("p");
  empty.className = "empty-state";
  empty.textContent = text;
  container.append(empty);
}

function appendDocuments(container, documents, emptyText) {
  container.replaceChildren();
  for (const entry of documents) appendDocumentCard(container, entry);
  if (!container.childElementCount) appendEmpty(container, emptyText);
}

export function createDocumentHub({ root } = {}) {
  const entriesView = root.querySelector("[data-hub-view='entries']");
  const detailView = root.querySelector("[data-hub-view='detail']");
  const title = root.querySelector("[data-role='hub-detail-title']");
  const globalDocuments = root.querySelector("[data-role='hub-global-documents']");
  const candidateDocuments = root.querySelector("[data-role='hub-candidate-documents']");
  const back = root.querySelector("[data-action='back-to-document-hub']");
  let documents = [];

  function categoryDocuments(categoryId, scope) {
    return documents.filter((entry) => entry.scope === scope && hubCategoryForDocument(entry) === categoryId);
  }

  function renderEntries() {
    entriesView.replaceChildren();
    for (const category of HUB_CATEGORIES) {
      const button = entriesView.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "document-hub-card";
      button.dataset.hubCategory = category.id;
      const heading = entriesView.ownerDocument.createElement("strong");
      heading.textContent = category.label;
      const counts = entriesView.ownerDocument.createElement("span");
      counts.className = "document-hub-counts";
      counts.textContent = `全局文档 ${categoryDocuments(category.id, "global").length} · 待关联候选 ${categoryDocuments(category.id, "unassigned").length}`;
      button.append(heading, counts);
      button.addEventListener("click", () => open(category.id));
      entriesView.append(button);
    }
  }

  function open(categoryId) {
    const category = HUB_CATEGORIES.find((entry) => entry.id === categoryId);
    if (!category) throw new Error(`Unknown document hub category: ${categoryId}`);
    title.textContent = category.label;
    appendDocuments(globalDocuments, categoryDocuments(categoryId, "global"), "暂无全局文档");
    appendDocuments(candidateDocuments, categoryDocuments(categoryId, "unassigned"), "暂无待关联候选");
    entriesView.hidden = true;
    detailView.hidden = false;
  }

  function reset() {
    detailView.hidden = true;
    entriesView.hidden = false;
  }

  function render(nextDocuments = []) {
    documents = nextDocuments.filter((entry) => ["global", "unassigned"].includes(entry.scope));
    renderEntries();
    reset();
  }

  back.addEventListener("click", reset);
  return { render, open, reset };
}
