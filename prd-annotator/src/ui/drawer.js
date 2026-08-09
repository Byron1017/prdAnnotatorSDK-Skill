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

export function renderDocumentGroups(container, documents, pageId) {
  container.replaceChildren();
  const groups = [
    {
      title: "本页关联文档",
      documents: documents.filter((entry) => entry.pageIds.includes(pageId))
    },
    {
      title: "项目级文档",
      documents: documents.filter((entry) => !entry.pageIds.includes(pageId)
        && ["total-prd", "public", "public-rule"].includes(entry.kind))
    },
    {
      title: "其他相关文档",
      documents: documents.filter((entry) => !entry.pageIds.includes(pageId)
        && !["total-prd", "public", "public-rule"].includes(entry.kind))
    }
  ];
  for (const group of groups) {
    if (!group.documents.length) continue;
    const section = container.ownerDocument.createElement("section");
    section.className = "document-group";
    appendTextElement(section, "h4", "document-group-title", group.title);
    for (const documentEntry of group.documents) appendDocumentCard(section, documentEntry);
    container.append(section);
  }
  if (!container.childElementCount) {
    appendTextElement(container, "p", "empty-state", "本页展示数据尚未生成");
  }
}

export function renderViewWarning(container, error) {
  container.replaceChildren();
  if (!error) return;
  appendTextElement(container, "p", "view-warning", "需要 AI Agent 重新生成本页展示数据。浏览器中的标注将继续保留。");
}

export function renderPageMetadata(container, page, generatedAt) {
  container.replaceChildren();
  appendTextElement(container, "p", "page-metadata-path", page.htmlPath);
  if (generatedAt) appendTextElement(container, "p", "page-metadata-generated", `展示数据生成于：${generatedAt}`);
}
