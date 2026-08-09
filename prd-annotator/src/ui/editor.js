function targetLabel(target) {
  return target.textQuote || target.cssPath || "所选页面区域";
}

export function closeEditor(container) {
  container.hidden = true;
  container.replaceChildren();
}

export function openEditor({ container, target, onSave, onCancel }) {
  const document = container.ownerDocument;
  const heading = document.createElement("h2");
  heading.textContent = "添加本页标注";

  const targetText = document.createElement("p");
  targetText.className = "selected-target";
  targetText.textContent = targetLabel(target);

  const label = document.createElement("label");
  label.htmlFor = "prd-annotation-comment";
  label.textContent = "批注内容";

  const textarea = document.createElement("textarea");
  textarea.id = "prd-annotation-comment";
  textarea.dataset.field = "comment";
  textarea.rows = 6;
  textarea.required = true;
  textarea.placeholder = "说明希望修改什么、补充什么，或需要 AI 关注的问题";

  const error = document.createElement("p");
  error.className = "field-error";
  error.hidden = true;
  error.textContent = "请填写批注内容";

  const actions = document.createElement("div");
  actions.className = "editor-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.dataset.action = "cancel-annotation";
  cancelButton.textContent = "取消";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.dataset.action = "save-annotation";
  saveButton.textContent = "保存标注";

  cancelButton.addEventListener("click", () => onCancel());
  saveButton.addEventListener("click", () => {
    const comment = textarea.value.trim();
    if (!comment) {
      textarea.setAttribute("aria-invalid", "true");
      error.hidden = false;
      textarea.focus();
      return;
    }
    onSave(comment);
  });

  actions.append(cancelButton, saveButton);
  container.replaceChildren(heading, targetText, label, textarea, error, actions);
  container.hidden = false;
  textarea.focus();
}
