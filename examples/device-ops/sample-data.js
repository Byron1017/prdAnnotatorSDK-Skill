window.PRD_ANNOTATOR_SAMPLE = {
  document: {
    schemaVersion: 1,
    page: {
      id: "equipment-ops",
      title: "设备运维台",
      route: "/examples/device-ops/index.html"
    },
    annotations: [
      {
        id: "A001",
        comment: "设备列表需要支持按车间批量选择，并提供批量停用入口。",
        status: "applied",
        createdAt: "2026-08-08T10:00:00.000Z",
        updatedAt: "2026-08-08T10:30:00.000Z",
        target: {
          cssPath: "[data-demo='device-table']",
          xpath: "/html/body/div/div/main/section[2]/div[3]",
          textQuote: "设备编号",
          rect: { x: 260, y: 420, width: 1120, height: 360 }
        },
        prd: {
          linkedSections: ["3.2 设备列表", "4.1 批量操作"],
          impactScope: "page",
          summary: "增加设备多选与批量停用能力"
        }
      }
    ]
  },
  pagePrdMarkdown: `# 设备运维页面 PRD

## 1. 页面目标

帮助设备管理员快速识别异常设备、筛选责任范围，并进入单台或批量处理流程。

## 2. 核心角色

- 设备管理员：维护设备档案与运行状态。
- 车间负责人：关注本车间告警和保养计划。
- 检修人员：处理停机设备并回填检修结果。

## 3. 页面能力

### 3.1 状态概览

- 展示设备总数、正常运行、待保养和停机检修数量。
- 数据更新时间与当前班次必须清晰可见。

### 3.2 设备列表

- 支持按设备名称、编号、车间和运行状态筛选。
- 列表展示设备编号、车间、状态、下次保养时间和责任人。
- 保留单台设备查看入口。

## 4. 标注关联需求

### 4.1 批量操作

- 设备列表增加多选能力。
- 选择一台及以上设备后显示批量停用入口。
- 批量停用必须二次确认，并说明受影响设备数量。

## 5. 验收标准

1. 筛选条件变化后，列表和结果数量保持一致。
2. 不同运行状态具有可区分的文字与颜色表达。
3. 批量停用未确认前不得改变设备状态。
4. 页面在窄屏下不产生整页横向滚动。`
};

window.PRDAnnotator.hydrate(window.PRD_ANNOTATOR_SAMPLE);
delete window.PRD_ANNOTATOR_SAMPLE;
