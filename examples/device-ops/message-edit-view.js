(() => {
  const projectId = "device-demo-a13f92";
  const page = {
    id: "message-edit",
    title: "编辑消息",
    htmlPath: "examples/device-ops/hash-router.html"
  };
  window.PRDAnnotator.registerView({
    schemaVersion: 2,
    generatedAt: "2026-08-11T00:00:00.000Z",
    projectId,
    page,
    persistedAnnotationFingerprint: "fnv1a32:741638a5",
    document: {
      schemaVersion: 2,
      projectId,
      page: { ...page, route: "/message/edit/:id" },
      annotations: [],
      managedPrd: null
    },
    documents: [
      {
        id: "doc-message-edit-prd",
        title: "消息编辑页面 PRD",
        path: "doc/prd/pages/message-edit.md",
        format: "markdown",
        kind: "page-prd",
        displayGroups: ["page-prd"],
        pageIds: ["message-edit"],
        fingerprint: `sha256:${"5".repeat(64)}`,
        previewStatus: "available",
        missing: false,
        content: "# 消息编辑页面 PRD\n\n编辑标题、正文与发布状态。"
      }
    ]
  });
})();
