import { describe, expect, it } from "vitest";
import { fingerprintValue } from "../../prd-annotator/src/fingerprint.js";
import { buildSyncPrompt } from "../../prd-annotator/src/sync-prompt.js";

const annotations = [{
  id: "A001",
  title: "Batch disable",
  description: "Add a batch action.",
  updatedAt: "2026-08-09T00:00:00.000Z"
}];

const context = {
  projectId: "device-demo-a13f92",
  pageId: "equipment-ops-7c31fa",
  htmlPath: "prototype/index.html",
  manifestPath: ".prd-annotator/manifest.json",
  annotationPath: ".prd-annotator/data/pages/equipment-ops-7c31fa.json",
  viewPath: ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
  fingerprint: fingerprintValue(annotations),
  document: {
    schemaVersion: 2,
    projectId: "device-demo-a13f92",
    page: { id: "equipment-ops-7c31fa" },
    annotations
  }
};

describe("universal sync prompt", () => {
  it("copies a complete Agent-independent synchronization payload", () => {
    const prompt = buildSyncPrompt(context);

    expect(prompt).toContain("请将以下 PRD Annotator 本页标注同步到当前项目文件");
    expect(prompt).toContain("复制提示词不代表同步成功");
    expect(prompt).toContain("本次只同步标注并重新生成 view，不修改任何 PRD");
    expect(prompt).toContain("仅当 projectId 与 pageId 均匹配时才可合并");
    expect(prompt).toContain("绝不能将空浏览器快照视为清空永久数据的许可");
    expect(prompt).toContain("绝不能减少永久标注 ID 集合");
    expect(prompt).toContain("必须保留每一个仅存在于项目文件中的永久标注 ID");
    expect(prompt).toContain("---PRD_ANNOTATOR_PAYLOAD_START---");
    expect(prompt).toContain('"pageId":"equipment-ops-7c31fa"');
    expect(prompt).toContain('"annotations"');
    expect(prompt).toContain("---PRD_ANNOTATOR_PAYLOAD_END---");
  });

  it("keeps the payload byte-for-byte stable for equivalent context", () => {
    expect(buildSyncPrompt(context)).toBe(buildSyncPrompt({
      ...context,
      document: {
        annotations,
        page: { id: "equipment-ops-7c31fa" },
        projectId: "device-demo-a13f92",
        schemaVersion: 2
      }
    }));
  });
});
