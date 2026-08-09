import { ANNOTATION_TYPES } from "../constants.js";

function targetLabel(target) {
  return target.textQuote || target.cssPath || "所选页面区域";
}

export function closeEditor(container) {
  container.hidden = true;
  container.replaceChildren();
}

export function openEditor({ container, target, onSave, onCancel }) {
  const document = container.ownerDocument;
  const fields = [
    { name: "title", label: "标题", required: true, control: "input" },
    { name: "description", label: "说明", required: true, control: "textarea" },
    { name: "type", label: "类型", required: true, control: "select" },
    { name: "prdContent", label: "PRD 内容", required: true, control: "textarea" },
    { name: "acceptanceCriteria", label: "验收标准", control: "textarea" },
    { name: "dataFields", label: "数据字段", control: "textarea" },
    { name: "apiPath", label: "接口路径", control: "input" },
    { name: "edgeCases", label: "异常与边界", control: "textarea" }
  ];
  const typeLabels = {
    requirement: "需求",
    change: "变更",
    question: "问题",
    bug: "缺陷"
  };

  const heading = document.createElement("h2");
  heading.textContent = "添加本页标注";

  const targetText = document.createElement("p");
  targetText.className = "selected-target";
  targetText.textContent = targetLabel(target);

  const fieldControls = new Map();
  const fieldErrors = new Map();
  const form = document.createElement("div");
  form.className = "editor-form";
  for (const field of fields) {
    const fieldGroup = document.createElement("div");
    fieldGroup.className = "editor-field";

    const label = document.createElement("label");
    label.htmlFor = `prd-annotation-${field.name}`;
    label.textContent = `${field.label}${field.required ? " *" : ""}`;

    const control = document.createElement(field.control);
    control.id = `prd-annotation-${field.name}`;
    control.dataset.field = field.name;
    control.required = Boolean(field.required);
    if (field.control === "textarea") control.rows = field.name === "prdContent" ? 5 : 3;
    if (field.control === "select") {
      for (const type of ANNOTATION_TYPES) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = typeLabels[type];
        control.append(option);
      }
    }

    const error = document.createElement("p");
    error.className = "field-error";
    error.dataset.errorFor = field.name;
    error.hidden = true;
    error.textContent = `请填写${field.label}`;

    fieldControls.set(field.name, control);
    fieldErrors.set(field.name, error);
    fieldGroup.append(label, control, error);
    form.append(fieldGroup);
  }

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
    const formValue = Object.fromEntries(
      fields.map(({ name }) => [name, fieldControls.get(name).value.trim()])
    );
    let firstInvalidControl = null;
    for (const field of fields.filter(({ required }) => required)) {
      const control = fieldControls.get(field.name);
      const error = fieldErrors.get(field.name);
      const isInvalid = !formValue[field.name];
      control.toggleAttribute("aria-invalid", isInvalid);
      error.hidden = !isInvalid;
      if (isInvalid && !firstInvalidControl) firstInvalidControl = control;
    }
    if (firstInvalidControl) {
      firstInvalidControl.focus();
      return;
    }
    onSave(formValue);
  });

  actions.append(cancelButton, saveButton);
  container.replaceChildren(heading, targetText, form, actions);
  container.hidden = false;
  fieldControls.get("title").focus();
}
