import { renderMarkdown } from "../markdown.js";

export function renderAnnotationList(container, annotationDocument) {
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

    const number = container.ownerDocument.createElement("span");
    number.className = "annotation-number";
    number.textContent = String(index + 1);

    const content = container.ownerDocument.createElement("div");
    content.className = "annotation-content";

    const title = container.ownerDocument.createElement("h4");
    title.className = "annotation-title";
    title.textContent = annotation.title;

    const type = container.ownerDocument.createElement("span");
    type.className = "annotation-type";
    type.textContent = annotation.type;

    const description = container.ownerDocument.createElement("p");
    description.className = "annotation-description";
    description.textContent = annotation.description;

    const prdContent = container.ownerDocument.createElement("p");
    prdContent.className = "annotation-prd-content";
    prdContent.textContent = annotation.prdContent;

    const metadata = container.ownerDocument.createElement("div");
    metadata.className = "annotation-metadata";

    const status = container.ownerDocument.createElement("span");
    status.className = `status status-${annotation.status}`;
    status.textContent = annotation.status;

    const impact = container.ownerDocument.createElement("span");
    impact.className = `impact impact-${annotation.prd.impactScope}`;
    impact.textContent = annotation.prd.impactScope;
    metadata.append(type, status, impact);

    content.append(title, description, prdContent, metadata);
    const recommendedFields = [
      ["验收标准", annotation.acceptanceCriteria],
      ["数据字段", annotation.dataFields],
      ["接口路径", annotation.apiPath],
      ["异常与边界", annotation.edgeCases]
    ];
    for (const [label, value] of recommendedFields) {
      if (!value) continue;
      const detail = container.ownerDocument.createElement("p");
      detail.className = "annotation-detail";
      detail.textContent = `${label}: ${value}`;
      content.append(detail);
    }
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

export function renderPagePrd(container, markdown) {
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

function appendTextElement(container, tagName, className, text) {
  const element = container.ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = text;
  container.append(element);
  return element;
}

function previewLabel(status) {
  return {
    available: "可预览",
    unavailable: "暂不可预览",
    missing: "源文件缺失",
    stale: "内容可能已过期"
  }[status] || status;
}

function appendDocumentCard(container, documentEntry) {
  const card = container.ownerDocument.createElement("article");
  card.className = "document-card";
  card.dataset.documentId = documentEntry.id;
  appendTextElement(card, "h4", "document-title", documentEntry.title);
  appendTextElement(card, "p", "document-path", `来源：${documentEntry.path}`);

  const metadata = container.ownerDocument.createElement("div");
  metadata.className = "document-metadata";
  appendTextElement(metadata, "span", "document-format", `格式：${documentEntry.format}`);
  appendTextElement(metadata, "span", "document-kind", `类型：${documentEntry.kind}`);
  appendTextElement(metadata, "span", "document-preview-status", `预览：${previewLabel(documentEntry.previewStatus)}`);
  card.append(metadata);

  if (documentEntry.previewStatus === "stale") {
    appendTextElement(card, "p", "document-warning", "内容可能已过期，请让 AI Agent 重新生成展示数据。");
  }
  if (documentEntry.previewStatus === "missing") {
    appendTextElement(card, "p", "document-warning", "源文件缺失，需要 AI Agent 重新生成展示数据。");
  }
  if (documentEntry.content.trim()) {
    const content = container.ownerDocument.createElement("div");
    content.className = "document-content";
    content.append(renderMarkdown(container.ownerDocument, documentEntry.content));
    card.append(content);
  }
  container.append(card);
}

function documentDisplayGroups(documentEntry) {
  if (Array.isArray(documentEntry.displayGroups) && documentEntry.displayGroups.length) {
    return [...new Set(documentEntry.displayGroups)];
  }
  if (documentEntry.kind === "page-prd") return ["page-prd"];
  if (documentEntry.kind === "field-spec") return ["field-spec"];
  if (documentEntry.kind === "api-doc") return ["api-doc"];
  return ["related"];
}

export function renderDocumentsByGroup(containers, documents, pageId) {
  const groupIds = ["page-prd", "related", "field-spec", "api-doc"];
  const grouped = Object.fromEntries(groupIds.map((groupId) => [groupId, []]));
  const seen = Object.fromEntries(groupIds.map((groupId) => [groupId, new Set()]));
  for (const documentEntry of documents) {
    for (const declaredGroup of documentDisplayGroups(documentEntry)) {
      const groupId = declaredGroup === "page-prd" && !documentEntry.pageIds.includes(pageId)
        ? "related"
        : declaredGroup;
      if (!grouped[groupId] || seen[groupId].has(documentEntry.id)) continue;
      grouped[groupId].push(documentEntry);
      seen[groupId].add(documentEntry.id);
    }
  }

  const emptyText = {
    "page-prd": "本页尚无关联的页面 PRD 文档",
    related: "本页尚无关联文档",
    "field-spec": "本页尚无字段规范",
    "api-doc": "本页尚无接口文档"
  };
  for (const groupId of groupIds) {
    const container = containers[groupId];
    if (!container) throw new Error(`Missing document group container: ${groupId}`);
    container.replaceChildren();
    for (const documentEntry of grouped[groupId]) appendDocumentCard(container, documentEntry);
    if (!container.childElementCount) {
      appendTextElement(container, "p", "empty-state", emptyText[groupId]);
    }
  }
}

export function renderViewWarning(container, error) {
  container.replaceChildren();
  if (!error) return;
  appendTextElement(container, "p", "view-warning", "需要 AI Agent 重新生成本页展示数据。浏览器中的标注将继续保留。");
}

export function renderSyncState(container, state) {
  container.replaceChildren();
  container.dataset.state = state;
  const message = {
    synced: "已同步到项目",
    "browser-only": "当前标注仅保存在此浏览器，尚未同步到项目",
    "memory-only": "浏览器存储不可用。关闭页面前必须复制提示词并让 AI 同步"
  }[state];
  appendTextElement(container, "p", "sync-state-message", message);
}

export function renderSyncHelp(container, {
  prompt,
  copyResult = "",
  showFallback = false,
  onCopy
}) {
  container.replaceChildren();
  const heading = appendTextElement(container, "h3", "sync-help-heading", "同步到项目");
  heading.id = "prd-sync-help-heading";
  container.setAttribute("aria-labelledby", heading.id);
  const instructions = container.ownerDocument.createElement("ol");
  instructions.className = "sync-instructions";
  ["复制", "返回 AI Agent", "粘贴并发送", "等待文件写入报告", "刷新原型，确认 AI Agent 已重新生成 view bundle"].forEach((instruction) => {
    appendTextElement(instructions, "li", "sync-instruction", instruction);
  });
  container.append(instructions);

  const copyButton = container.ownerDocument.createElement("button");
  copyButton.type = "button";
  copyButton.className = "secondary-button sync-copy-button";
  copyButton.dataset.action = "copy-sync-prompt";
  copyButton.textContent = "复制同步提示词";
  copyButton.addEventListener("click", onCopy);
  container.append(copyButton);

  const result = appendTextElement(container, "p", "copy-result", copyResult);
  result.dataset.role = "copy-result";
  result.setAttribute("aria-live", "polite");

  if (!showFallback) return;
  const fallbackLabel = appendTextElement(
    container,
    "p",
    "sync-fallback-label",
    "无法访问剪贴板。请手动选择并复制以下提示词："
  );
  const fallback = container.ownerDocument.createElement("textarea");
  fallback.className = "sync-prompt-fallback";
  fallback.dataset.role = "sync-prompt-fallback";
  fallback.readOnly = true;
  fallback.value = prompt;
  fallback.setAttribute("aria-label", fallbackLabel.textContent);
  container.append(fallback);
}

export function renderPageMetadata(container, page, generatedAt) {
  container.replaceChildren();
  appendTextElement(container, "p", "page-metadata-path", page.htmlPath);
  if (generatedAt) appendTextElement(container, "p", "page-metadata-generated", `展示数据生成于：${generatedAt}`);
}
