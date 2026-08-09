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
