export function openDeleteDialog({
  container,
  annotation,
  displayNumber,
  onConfirm,
  onCancel
}) {
  const document = container.ownerDocument;
  const heading = document.createElement("h2");
  heading.id = "prd-delete-dialog-heading";
  heading.textContent = `删除标注 ${displayNumber}？`;

  const description = document.createElement("p");
  description.id = "prd-delete-dialog-description";
  description.className = "delete-dialog-description";
  description.textContent = [
    `“${annotation.title}”会立即从本页消失。`,
    "请通知 AI Agent 同步标注后更新项目文件。",
    "不会自动修改 PRD 或其他项目文档。"
  ].join("");

  const actions = document.createElement("div");
  actions.className = "delete-dialog-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.dataset.action = "cancel-delete";
  cancel.textContent = "取消";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "confirm-delete";
  confirm.dataset.action = "confirm-delete";
  confirm.textContent = "确认删除";

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const activeElement = container.getRootNode().activeElement;
    if (event.shiftKey && activeElement === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && activeElement === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  };

  cancel.addEventListener("click", () => onCancel());
  confirm.addEventListener("click", () => onConfirm());
  cancel.addEventListener("keydown", handleKeyDown);
  confirm.addEventListener("keydown", handleKeyDown);
  actions.append(cancel, confirm);

  const surface = document.createElement("div");
  surface.className = "delete-dialog";
  surface.append(heading, description, actions);
  container.replaceChildren(surface);
  container.dataset.dialog = "delete-confirmation";
  container.removeAttribute("aria-label");
  container.setAttribute("aria-labelledby", heading.id);
  container.setAttribute("aria-describedby", description.id);
  container.hidden = false;
  cancel.focus();
}
