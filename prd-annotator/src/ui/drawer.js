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
