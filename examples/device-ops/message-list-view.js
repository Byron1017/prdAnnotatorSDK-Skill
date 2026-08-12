(() => {
  const generatedAt = "2026-08-11T00:00:00.000Z";
  const projectId = "device-demo-a13f92";
  const htmlPath = "examples/device-ops/hash-router.html";
  const emptyFingerprint = "fnv1a32:741638a5";

  function bundle({ id, title, route, documents }) {
    const page = { id, title, htmlPath };
    return {
      schemaVersion: 2,
      generatedAt,
      projectId,
      page,
      persistedAnnotationFingerprint: emptyFingerprint,
      document: {
        schemaVersion: 2,
        projectId,
        page: { ...page, route },
        annotations: [],
        managedPrd: null
      },
      documents
    };
  }

  window.PRDAnnotator.registerView(bundle({
    id: "hash-router-base",
    title: "消息原型首页",
    route: "/examples/device-ops/hash-router.html",
    documents: []
  }));

  window.PRDAnnotator.registerView(bundle({
    id: "message-list",
    title: "消息列表",
    route: "/message/list",
    documents: [
      {
        id: "doc-message-list-prd",
        title: "消息列表页面 PRD",
        path: "doc/prd/pages/message-list.md",
        format: "markdown",
        kind: "page-prd",
        displayGroups: ["page-prd"],
        scope: "page",
        pageIds: ["message-list"],
        fingerprint: `sha256:${"1".repeat(64)}`,
        previewStatus: "available",
        missing: false,
        content: "# 消息列表页面 PRD\n\n展示消息列表、筛选与分页。"
      },
      {
        id: "doc-message-total",
        title: "消息中心总 PRD",
        path: "doc/prd/PRD.md",
        format: "markdown",
        kind: "total-prd",
        displayGroups: ["related"],
        scope: "global",
        pageIds: [],
        fingerprint: `sha256:${"2".repeat(64)}`,
        previewStatus: "available",
        missing: false,
        content: "# 消息中心总 PRD\n\n覆盖消息列表与编辑流程。"
      },
      {
        id: "doc-message-fields",
        title: "消息字段规范",
        path: "doc/data/message-fields.md",
        format: "markdown",
        kind: "field-spec",
        displayGroups: ["field-spec"],
        scope: "page",
        pageIds: ["message-list"],
        fingerprint: `sha256:${"3".repeat(64)}`,
        previewStatus: "available",
        missing: false,
        content: "# 消息字段规范\n\n| Field | Type |\n| --- | --- |\n| messageId | string |"
      },
      {
        id: "doc-message-api",
        title: "消息接口文档",
        path: "doc/api/messages.md",
        format: "markdown",
        kind: "api-doc",
        displayGroups: ["api-doc"],
        scope: "page",
        pageIds: ["message-list"],
        fingerprint: `sha256:${"4".repeat(64)}`,
        previewStatus: "available",
        missing: false,
        content: "# 消息接口文档\n\nGET /api/messages"
      }
    ]
  }));
})();
