import { beforeEach, describe, expect, it } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

function fillRequiredForm(shadow, values = {}) {
  const formValue = {
    title: "Batch disable",
    description: "Add a batch action.",
    type: "requirement",
    prdContent: "Selected devices can be disabled together.",
    acceptanceCriteria: "Confirm before changing state.",
    dataFields: "deviceIds: string[]",
    apiPath: "POST /api/devices/batch-disable",
    edgeCases: "Empty selection is rejected.",
    ...values
  };

  for (const [name, value] of Object.entries(formValue)) {
    shadow.querySelector(`[data-field='${name}']`).value = value;
  }
}

function openAnnotationEditor() {
  const api = createAnnotator({
    window,
    document,
    scriptSrc: "https://example.test/code/prd-annotator.js",
    explicitProjectId: "device-demo-a13f92",
    explicitPageId: "equipment-ops-7c31fa"
  });
  api.mount();
  const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
  shadow.querySelector("[data-action='toggle-annotation']").click();
  document.querySelector("#device-list").dispatchEvent(
    new MouseEvent("click", { bubbles: true })
  );
  return { api, shadow };
}

describe("human annotation flow", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main><section id='device-list'>Device list</section></main>";
    localStorage.clear();
  });

  it("saves every required and recommended annotation field", () => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();

    const saved = api.getSnapshot().document.annotations[0];
    expect(saved).toMatchObject({
      title: "Batch disable",
      description: "Add a batch action.",
      type: "requirement",
      prdContent: "Selected devices can be disabled together.",
      acceptanceCriteria: "Confirm before changing state.",
      dataFields: "deviceIds: string[]",
      apiPath: "POST /api/devices/batch-disable",
      edgeCases: "Empty selection is rejected."
    });
    expect(saved).not.toHaveProperty("comment");
  });

  it.each(["title", "description", "prdContent"])(
    "blocks save when %s is blank",
    (field) => {
      const { api, shadow } = openAnnotationEditor();
      fillRequiredForm(shadow);
      shadow.querySelector(`[data-field='${field}']`).value = "   ";
      shadow.querySelector("[data-action='save-annotation']").click();

      expect(api.getSnapshot().document.annotations).toHaveLength(0);
      expect(shadow.querySelector(`[data-error-for='${field}']`).hidden).toBe(false);
    }
  );

  it("marks every blank required field and focuses the first one", () => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow, {
      title: "   ",
      description: "   ",
      prdContent: "   "
    });
    shadow.querySelector("[data-field='prdContent']").focus();
    shadow.querySelector("[data-action='save-annotation']").click();

    expect(api.getSnapshot().document.annotations).toHaveLength(0);
    for (const field of ["title", "description", "prdContent"]) {
      expect(shadow.querySelector(`[data-error-for='${field}']`).hidden).toBe(false);
    }
    expect(shadow.activeElement).toBe(shadow.querySelector("[data-field='title']"));
  });

  it("renders complete annotation details in the Drawer", () => {
    const { shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();

    const list = shadow.querySelector("[data-role='annotation-list']");
    expect(list.textContent).toContain("Batch disable");
    expect(list.textContent).toContain("requirement");
    expect(list.textContent).toContain("Add a batch action.");
    expect(list.textContent).toContain("Selected devices can be disabled together.");
    expect(list.textContent).toContain("Confirm before changing state.");
    expect(list.textContent).toContain("deviceIds: string[]");
    expect(list.textContent).toContain("POST /api/devices/batch-disable");
    expect(list.textContent).toContain("Empty selection is rejected.");
  });

  it("keeps a stale target in the Drawer while omitting its marker", () => {
    const { api, shadow } = openAnnotationEditor();
    api.hydrate({
      document: {
        ...api.getSnapshot().document,
        annotations: [{
          id: "A999",
          title: "Keep historical requirement",
          description: "The DOM target was removed.",
          type: "requirement",
          prdContent: "Retain this requirement until the replacement target is known.",
          acceptanceCriteria: "",
          dataFields: "",
          apiPath: "",
          edgeCases: "",
          status: "open",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
          target: {
            cssPath: "#missing-target",
            xpath: "/html/body/main/article[999]",
            textQuote: "Removed target",
            rect: { x: 0, y: 0, width: 10, height: 10 }
          },
          prd: {
            linkedDocuments: [],
            linkedSections: [],
            impactScope: "page",
            summary: ""
          }
        }]
      }
    });
    shadow.querySelector("[data-action='toggle-drawer']").click();

    expect(shadow.querySelector("[data-role='annotation-list']").textContent)
      .toContain("Keep historical requirement");
    expect(shadow.querySelector("[data-annotation-id='A999']")).toBeNull();
  });
});
