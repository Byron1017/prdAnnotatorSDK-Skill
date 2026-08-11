window.__PRD_ANNOTATOR_ROUTE_REGISTRY__ = {
  schemaVersion: 2,
  projectId: "device-demo-a13f92",
  htmlPath: "examples/device-ops/hash-router.html",
  basePage: {
    id: "hash-router-base",
    title: "消息原型首页",
    htmlPath: "examples/device-ops/hash-router.html",
    viewSrc: "message-list-view.js"
  },
  routes: [
    {
      id: "message-list",
      title: "消息列表",
      htmlPath: "examples/device-ops/hash-router.html",
      routePattern: "/message/list",
      viewSrc: "message-list-view.js"
    },
    {
      id: "message-edit",
      title: "编辑消息",
      htmlPath: "examples/device-ops/hash-router.html",
      routePattern: "/message/edit/:id",
      viewSrc: "message-edit-view.js"
    }
  ]
};
