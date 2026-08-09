import { canonicalJson } from "./fingerprint.js";

export function computeSyncState({ currentFingerprint, persistedFingerprint, cacheStatus }) {
  if (cacheStatus?.mode === "memory") return "memory-only";
  return currentFingerprint === persistedFingerprint ? "synced" : "browser-only";
}

export function buildSyncPrompt(context) {
  const payload = {
    annotationPath: context.annotationPath,
    document: context.document,
    fingerprint: context.fingerprint,
    htmlPath: context.htmlPath,
    manifestPath: context.manifestPath,
    pageId: context.pageId,
    projectId: context.projectId,
    viewPath: context.viewPath
  };

  return [
    "请将以下 PRD Annotator 本页标注同步到当前项目文件。",
    "复制提示词不代表同步成功；必须由 AI Agent 完成文件写入、重新生成 view 和项目 gate 后才算同步。",
    "本次只同步标注并重新生成 view，不修改任何 PRD。",
    "执行要求：验证 payload 的 projectId、pageId、annotationPath、viewPath、fingerprint 和标注必填字段；仅当 projectId 与 pageId 均匹配时才可合并；按 id 和 updatedAt 合并；绝不能将空浏览器快照视为清空永久数据的许可；绝不能减少永久标注 ID 集合；必须保留每一个仅存在于项目文件中的永久标注 ID；写入标注 JSON；重新生成本页 view；运行项目 gate；最后报告实际变更的文件和 gate 结果。",
    "不要编辑、改写、删除或新增任何 PRD 文件。",
    "---PRD_ANNOTATOR_PAYLOAD_START---",
    canonicalJson(payload),
    "---PRD_ANNOTATOR_PAYLOAD_END---"
  ].join("\n");
}
