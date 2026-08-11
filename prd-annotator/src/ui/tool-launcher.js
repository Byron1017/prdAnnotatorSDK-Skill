const COLLAPSE_LABEL = "收起 PRD 标注工具";
const EXPAND_LABEL = "展开 PRD 标注工具";
const EXPAND_ACTIVE_LABEL = "展开 PRD 标注工具（标注模式已开启）";

export function applyToolLauncherState({
  launcher,
  actions,
  toggle,
  collapsed,
  annotationModeActive
}) {
  const isCollapsed = Boolean(collapsed);
  const showActiveState = isCollapsed && Boolean(annotationModeActive);

  launcher.dataset.collapsed = String(isCollapsed);
  actions.hidden = isCollapsed;
  toggle.setAttribute("aria-expanded", String(!isCollapsed));
  toggle.dataset.annotationActive = String(showActiveState);
  toggle.setAttribute(
    "aria-label",
    isCollapsed
      ? (showActiveState ? EXPAND_ACTIVE_LABEL : EXPAND_LABEL)
      : COLLAPSE_LABEL
  );
}
