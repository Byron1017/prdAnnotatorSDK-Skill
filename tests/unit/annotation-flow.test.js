import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

function fillRequiredForm(shadow, values = {}) {
  const formValue = {
    title: "Batch disable",
    description: "Add a batch action.",
    type: "requirement",
    prdContent: "Selected devices can be disabled together.",
    note: "Confirm wording with operations.",
    ...values
  };

  for (const [name, value] of Object.entries(formValue)) {
    shadow.querySelector(`[data-field='${name}']`).value = value;
  }
}

function openAnnotationEditor(options = {}) {
  const api = createAnnotator({
    window,
    document,
    scriptSrc: "https://example.test/code/prd-annotator.js",
    explicitProjectId: "device-demo-a13f92",
    explicitPageId: "equipment-ops-7c31fa",
    ...options
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the simplified annotation fields without retired properties", () => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);

    for (const field of [
      "acceptanceCriteria",
      "dataFields",
      "apiPath",
      "edgeCases"
    ]) {
      expect(shadow.querySelector(`[data-field='${field}']`)).toBeNull();
    }
    shadow.querySelector("[data-action='save-annotation']").click();

    const saved = api.getSnapshot().document.annotations[0];
    expect(saved).toMatchObject({
      title: "Batch disable",
      description: "Add a batch action.",
      type: "requirement",
      prdContent: "Selected devices can be disabled together.",
      note: "Confirm wording with operations."
    });
    for (const field of [
      "acceptanceCriteria",
      "dataFields",
      "apiPath",
      "edgeCases"
    ]) expect(saved).not.toHaveProperty(field);
  });

  it("stores an empty note string", () => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow, { note: "   " });
    shadow.querySelector("[data-action='save-annotation']").click();

    expect(api.getSnapshot().document.annotations[0].note).toBe("");
  });

  it("includes note changes in the annotation fingerprint", async () => {
    const timestamps = [
      "2026-08-11T09:00:00.000Z",
      "2026-08-11T09:05:00.000Z"
    ];
    const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });
    fillRequiredForm(shadow, { note: "First note" });
    shadow.querySelector("[data-action='save-annotation']").click();
    const before = api.getSnapshot().annotationFingerprint;
    api.hydrateView({
      schemaVersion: 2,
      generatedAt: "2026-08-11T09:01:00.000Z",
      projectId: api.getSnapshot().document.projectId,
      page: api.getSnapshot().document.page,
      persistedAnnotationFingerprint: before,
      document: api.getSnapshot().document,
      documents: []
    });
    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector("[data-action='edit-annotation']").click();
    shadow.querySelector("[data-field='note']").value = "Second note";
    shadow.querySelector("[data-action='save-annotation']").click();
    await Promise.resolve();

    expect(api.getSnapshot().annotationFingerprint).not.toBe(before);
    expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
      .toBe("browser-only");
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

  it("renders a compact card with labeled sections and top-row actions", () => {
    const { shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();

    const card = shadow.querySelector(".annotation-list > .annotation-card");
    expect(card.querySelector(".annotation-card-header")).not.toBeNull();
    expect(card.querySelector(".annotation-number").textContent).toBe("1");
    expect(card.querySelector(".annotation-title").textContent).toBe("Batch disable");
    expect(card.querySelector(".annotation-actions").parentElement)
      .toBe(card.querySelector(".annotation-card-header"));
    expect([...card.querySelectorAll(".annotation-section-label")]
      .map((node) => node.textContent))
      .toEqual(["说明", "PRD 内容", "备注"]);
    expect(card.textContent).toContain("Confirm wording with operations.");
  });

  it("edits five visible fields without clearing historical properties", () => {
    const { api, shadow } = openAnnotationEditor({
      now: () => "2026-08-11T10:00:00.000Z"
    });
    const page = api.getSnapshot().document.page;
    api.hydrate({
      document: {
        ...api.getSnapshot().document,
        page,
        annotations: [{
          id: "A001",
          title: "Historical",
          description: "Historical description",
          type: "change",
          prdContent: "Historical PRD content",
          acceptanceCriteria: "Historical acceptance",
          dataFields: "legacyField: string",
          apiPath: "GET /api/legacy",
          edgeCases: "Historical edge case",
          status: "open",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
          target: {
            cssPath: "#device-list",
            xpath: "/html/body/main/section",
            textQuote: "Device list",
            rect: { x: 0, y: 0, width: 10, height: 10 }
          },
          prd: {
            linkedDocuments: ["doc-page-primary"],
            linkedSections: ["3.2 Batch operations"],
            impactScope: "page",
            summary: "Historical summary"
          },
          legacyExtension: { owner: "operations" }
        }]
      }
    });
    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector("[data-action='edit-annotation']").click();
    const edits = {
      title: "Updated",
      description: "Updated description",
      type: "requirement",
      prdContent: "Updated PRD content",
      note: "New note"
    };
    for (const [field, value] of Object.entries(edits)) {
      shadow.querySelector(`[data-field='${field}']`).value = value;
    }
    shadow.querySelector("[data-action='save-annotation']").click();

    expect(api.getSnapshot().document.annotations[0]).toMatchObject({
      ...edits,
      acceptanceCriteria: "Historical acceptance",
      dataFields: "legacyField: string",
      apiPath: "GET /api/legacy",
      edgeCases: "Historical edge case",
      legacyExtension: { owner: "operations" },
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-11T10:00:00.000Z"
    });
  });

  it("edits an annotation without changing identity, target, linkage, or creation time", async () => {
    const timestamps = [
      "2026-08-11T09:00:00.000Z",
      "2026-08-11T09:05:00.000Z"
    ];
    const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();

    const before = api.getSnapshot().document.annotations[0];
    const editButton = shadow.querySelector(
      "[data-action='edit-annotation'][data-annotation-id='A001']"
    );
    editButton.click();
    expect(shadow.querySelector("[data-field='title']").value).toBe("Batch disable");
    expect(shadow.querySelector("[data-role='editor'] h2").textContent)
      .toBe("编辑本页标注");
    expect(shadow.querySelector("[data-action='save-annotation']").textContent)
      .toBe("保存修改");
    shadow.querySelector("[data-field='title']").value = "Batch disable devices";
    shadow.querySelector("[data-action='save-annotation']").click();
    await Promise.resolve();

    const after = api.getSnapshot().document.annotations[0];
    expect(after).toMatchObject({
      id: before.id,
      title: "Batch disable devices",
      createdAt: before.createdAt,
      updatedAt: "2026-08-11T09:05:00.000Z",
      target: before.target,
      status: before.status,
      prd: before.prd
    });
    expect(shadow.activeElement).toBe(shadow.querySelector(
      "[data-action='edit-annotation'][data-annotation-id='A001']"
    ));
  });

  it("requires confirmation and records one tombstone for an explicit delete", () => {
    const { api, shadow } = openAnnotationEditor({
      now: () => "2026-08-11T09:10:00.000Z"
    });
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A001']"
    ).click();

    expect(shadow.querySelector("[role='dialog']").textContent)
      .toContain("不会自动修改 PRD");
    shadow.querySelector("[data-action='cancel-delete']").click();
    expect(api.getSnapshot().document.annotations).toHaveLength(1);

    shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A001']"
    ).click();
    shadow.querySelector("[data-action='confirm-delete']").click();
    expect(api.getSnapshot().document.annotations).toEqual([]);
    expect(api.getSnapshot().document.deletedAnnotations).toEqual([
      { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
    ]);
    expect(shadow.querySelector("[data-annotation-id='A001']")).toBeNull();
  });

  it("cancels deletion with Escape and restores focus to the delete action", async () => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A001']"
    ).click();

    const cancel = shadow.querySelector("[data-action='cancel-delete']");
    const confirm = shadow.querySelector("[data-action='confirm-delete']");
    expect(shadow.activeElement).toBe(cancel);
    cancel.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true
    }));
    expect(shadow.activeElement).toBe(confirm);
    confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(shadow.activeElement).toBe(cancel);

    cancel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await Promise.resolve();

    expect(api.getSnapshot().document.annotations).toHaveLength(1);
    expect(shadow.querySelector("[data-role='editor']").hidden).toBe(true);
    expect(shadow.activeElement).toBe(shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A001']"
    ));
  });

  it("does not renumber surviving markers or reuse a deleted id", () => {
    const timestamps = [
      "2026-08-11T09:00:00.000Z",
      "2026-08-11T09:01:00.000Z",
      "2026-08-11T09:02:00.000Z",
      "2026-08-11T09:03:00.000Z",
      "2026-08-11T09:04:00.000Z"
    ];
    const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });

    for (const title of ["First", "Second", "Third"]) {
      fillRequiredForm(shadow, { title, description: title, prdContent: title });
      shadow.querySelector("[data-action='save-annotation']").click();
      if (title !== "Third") {
        document.querySelector("#device-list").dispatchEvent(
          new MouseEvent("click", { bubbles: true })
        );
      }
    }

    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A002']"
    ).click();
    shadow.querySelector("[data-action='confirm-delete']").click();
    expect([...shadow.querySelectorAll(".annotation-marker")].map((node) => node.textContent))
      .toEqual(["1", "3"]);

    document.querySelector("#device-list").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    fillRequiredForm(shadow, {
      title: "Fourth",
      description: "Fourth",
      prdContent: "Fourth"
    });
    shadow.querySelector("[data-action='save-annotation']").click();
    expect(api.getSnapshot().document.annotations.map(({ id }) => id))
      .toEqual(["A001", "A003", "A004"]);
  });

  it("keeps a confirmed deletion in memory when localStorage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { api, shadow } = openAnnotationEditor({
      now: () => "2026-08-11T09:10:00.000Z"
    });
    fillRequiredForm(shadow);
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();
    shadow.querySelector(
      "[data-action='delete-annotation'][data-annotation-id='A001']"
    ).click();
    shadow.querySelector("[data-action='confirm-delete']").click();

    expect(api.getSnapshot().document.annotations).toEqual([]);
    expect(api.getSnapshot().document.deletedAnnotations.map(({ id }) => id))
      .toEqual(["A001"]);
    expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
      .toBe("memory-only");
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
    expect(shadow.querySelector(".annotation-marker[data-annotation-id='A999']"))
      .toBeNull();
  });
});
