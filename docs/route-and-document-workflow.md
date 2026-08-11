# PRD Annotator 路由与文档工作流

## 1. 适用范围

PRD Annotator 2.2.0 只用于原型 HTML 标注。浏览器展示层不负责写项目文件，也不启动 Python、Node、扩展、云端或本地保存服务。浏览器把未同步标注保存在 `localStorage`；具备项目写权限的 AI Agent 负责把标注、路由注册和文档资产持久化。

## 2. 页面身份

页面唯一身份为：

```text
projectId + normalizedHtmlPath + optionalRoutePattern
```

规则如下：

- 多 HTML：`index.html` 与 `settings.html` 永远是不同物理页，即使它们使用相同 Hash。
- 无前端路由：一个 HTML 对应一个 `document` 页面。
- Hash 路由：`#/message/edit/123` 和 `#/message/edit/456` 都匹配声明模板 `#/message/edit/:id`，共用一个逻辑页。
- 动态参数：页面 ID、文件名和 localStorage 键只使用声明模板，不使用 `123`、UUID 等实际值。
- 查询参数：`#/message/list?page=1` 与 `#/message/list?page=2` 属于同一逻辑页。
- 普通锚点：`#section` 属于基础 HTML 页面，不是业务路由。
- 深层直达：直接打开 `index.html#/message/edit/123` 时，SDK 先加载 `data-route-src` 指定的离线路由注册表，再加载编辑页 View。
- 未知路由：未登记的 `#/...` 进入独立隔离缓存并显示“需要 AI Agent 更新展示数据”的提示，绝不回退到其他页的标注或 PRD。

每个逻辑页拥有独立文件：

```text
.prd-annotator/data/pages/<page-id>.json
.prd-annotator/view/pages/<page-id>.js
```

一个物理 HTML 始终只注入一个 SDK 标签；存在 Hash 路由时，标签增加项目内相对路径 `data-route-src`。

## 3. 路由发现和刷新

AI Agent 只从 Vue Router 或等价路由源码提取声明模板，并保留 `:id`、可选参数和 catch-all 语法。不能根据当前 URL 中的数字或 UUID 猜测动态参数。

Agent 将确认后的 `{ "title", "routePattern" }` 列表写入临时 JSON，然后执行：

```powershell
node "<skill-dir>/scripts/set-routes.mjs" `
  --project-root "<project-root>" `
  --html "prototype/index.html" `
  --routes "<agent-controlled-routes.json>" `
  --confirm-route-write

node "<skill-dir>/scripts/refresh-project.mjs" --project-root "<project-root>"
node "<skill-dir>/scripts/check-project.mjs" --project-root "<project-root>"
```

如果源码证据不足，Agent 保持未知路由隔离并询问用户，不猜测映射。

## 4. 旧数据保留

给已有单页增加 Hash 路由时，原页面标注继续保存在基础页 JSON，并在迁移元数据中记录为 `legacy-unassigned`。Agent 不会把旧标注自动复制或分配给任一新路由。用户后续可以明确要求 AI 按业务语义整理。

移除展示层时，只删除 HTML 的 SDK 引用。Manifest、路由注册表、标注 JSON、View、PRD、字段规范、接口文档、历史目标和浏览器缓存全部保留。

## 5. Drawer 五个 Tab

Drawer 固定显示：

1. `本页标注`：当前逻辑页的标注和同步操作。
2. `页面 PRD`：当前页 PRD 正文与关联的页面 PRD 候选。
3. `关联文档`：总 PRD、公共规则、需求及其他候选。
4. `字段规范`：字段表、数据字典、数据模型或 schema 文档。
5. `接口文档`：API、接口契约、请求响应和错误码文档。

一次只展示一个 Panel。`displayGroups` 可以让同一文档出现在多个 Tab；SDK 不筛选、不合并、不替用户选择文档。

## 6. 标注同步授权

标注同步只授权以下写入：

- 当前逻辑页的永久 annotation JSON；
- Manifest 中的标注相关元数据；
- 可重新生成的 View 和路由注册表。

复制提示词不等于同步。AI Agent 必须完成精确载荷合并、刷新 View，并让 `check-project.mjs` 通过后才能报告已同步。空浏览器快照不能删除项目中已有标注。

## 7. 文档写入授权

安装 SDK、创建标注、同步标注、刷新路由或刷新 View 都不构成文档写入授权。只有用户明确提出创建或更新页面 PRD、总 PRD、字段规范、接口文档或其他关联文档时，AI Agent 才能写源文档。

授权后的流程：

1. 读取当前逻辑页 JSON 和 Manifest 中全部文档资产。
2. 查找同类文档的目录、命名、格式、章节、表格和术语。
3. 使用用户指定目标；只有一个明确模板时沿用；存在多个候选时先列出并询问。
4. 只写用户要求的文档，保留其他候选和人工映射。
5. 页面级影响只更新页面 PRD；公共规则、跨页面流程或总体范围同时更新已经明确的总 PRD。总 PRD 不明确时询问。
6. 刷新 Manifest 和 View，执行 `check-project.mjs`，报告修改文件与内容摘要。

文档生成后，页面 PRD、字段规范和接口文档分别进入对应 Tab；用户仍可以查看全部候选并自行决定后续合并或取舍。
