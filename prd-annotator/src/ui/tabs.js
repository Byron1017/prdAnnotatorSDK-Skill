export function createTabController({ tabs, panels, initialId = "annotations" } = {}) {
  const orderedTabs = [...(tabs || [])];
  const orderedPanels = [...(panels || [])];
  if (!orderedTabs.length || orderedTabs.length !== orderedPanels.length) {
    throw new Error("Drawer tabs and panels must be non-empty and paired");
  }

  function select(id, { focus = false } = {}) {
    if (!orderedTabs.some((tab) => tab.dataset.tab === id)) {
      throw new Error(`Unknown Drawer tab: ${id}`);
    }
    for (const tab of orderedTabs) {
      const active = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of orderedPanels) panel.hidden = panel.dataset.panel !== id;
  }

  function onKeyDown(event) {
    const index = orderedTabs.indexOf(event.currentTarget);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta || index < 0) return;
    event.preventDefault();
    const next = orderedTabs[(index + delta + orderedTabs.length) % orderedTabs.length];
    select(next.dataset.tab, { focus: true });
  }

  for (const tab of orderedTabs) {
    tab.addEventListener("click", () => select(tab.dataset.tab));
    tab.addEventListener("keydown", onKeyDown);
  }
  select(initialId);

  return {
    select,
    reset: () => select(initialId)
  };
}
