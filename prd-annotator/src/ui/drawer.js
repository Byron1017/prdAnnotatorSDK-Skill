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

    const status = container.ownerDocument.createElement("span");
    status.className = `status status-${annotation.status}`;
    status.textContent = annotation.status;

    content.append(comment, status);
    item.append(number, content);
    list.append(item);
  });
  container.append(list);
}
