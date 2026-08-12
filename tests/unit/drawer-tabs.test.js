import { beforeEach, describe, expect, it } from "vitest";
import { createShell } from "../../prd-annotator/src/ui/shell.js";
import { createTabController } from "../../prd-annotator/src/ui/tabs.js";
import { styles } from "../../prd-annotator/src/ui/styles.js";

describe("Drawer tabs", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates five semantic tabs with only annotations visible initially", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    createTabController({ tabs: shell.tabs, panels: shell.panels });

    expect([...shell.tabs].map((tab) => tab.dataset.tab)).toEqual([
      "annotations",
      "page-prd",
      "field-spec",
      "api-doc",
      "related"
    ]);
    expect([...shell.tabs].map((tab) => tab.textContent.trim())).toEqual([
      "本页标注 0",
      "页面 PRD",
      "页面字段规范",
      "页面接口文档",
      "关联文档"
    ]);
    expect([...shell.panels].filter((panel) => !panel.hidden).map((panel) => panel.dataset.panel))
      .toEqual(["annotations"]);
    expect(shell.syncHelp.closest("[role='tabpanel']").dataset.panel).toBe("annotations");
  });

  it("shows only the selected panel and resets to annotations", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    const controller = createTabController({ tabs: shell.tabs, panels: shell.panels });
    const visiblePanelIds = () => [...shell.panels]
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.dataset.panel);

    expect(visiblePanelIds()).toEqual(["annotations"]);
    shell.shadow.querySelector("[data-tab='api-doc']").click();
    expect(visiblePanelIds()).toEqual(["api-doc"]);
    controller.reset();
    expect(visiblePanelIds()).toEqual(["annotations"]);
  });

  it("supports arrow-key navigation across all five tabs", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    createTabController({ tabs: shell.tabs, panels: shell.panels });
    const tabs = [...shell.tabs];

    tabs[0].focus();
    tabs[0].dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true
    }));

    expect(shell.shadow.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(-1);
    expect([...shell.panels].filter((panel) => !panel.hidden).map((panel) => panel.dataset.panel))
      .toEqual(["page-prd"]);
  });

  it("uses a responsive wide Drawer and distributes all desktop tabs", () => {
    const drawerRule = styles.match(
      /\.editor,\s*\.drawer\s*\{[^}]*\}\s*\.drawer\s*\{([^}]*)\}/
    )?.[1] ?? "";
    const tabsRule = styles.match(/\.drawer-tabs\s*\{([^}]*)\}/)?.[1] ?? "";
    const tabButtonRule = styles.match(
      /\.drawer-tabs button\[role="tab"\]\s*\{([^}]*)\}/
    )?.[1] ?? "";

    expect(drawerRule).toMatch(/width:\s*clamp\(720px,\s*56vw,\s*900px\)/);
    expect(drawerRule).toMatch(/max-width:\s*100%/);
    expect(drawerRule).toMatch(/overflow-x:\s*hidden/);
    expect(tabsRule).toMatch(/position:\s*sticky/);
    expect(tabsRule).toMatch(/top:\s*84px/);
    expect(tabsRule).toMatch(/overflow-x:\s*hidden/);
    expect(tabButtonRule).toMatch(/flex:\s*1 1 0/);
    expect(tabButtonRule).toMatch(/min-width:\s*0/);
    expect(tabButtonRule).toMatch(/white-space:\s*nowrap/);
  });

  it("restores non-compressing horizontal Tab scrolling below 720px", () => {
    const narrowStart = styles.indexOf("@media (max-width: 719px)");
    const mobileStart = styles.indexOf("@media (max-width: 520px)");
    const narrowStyles = styles.slice(narrowStart, mobileStart);

    expect(narrowStart).toBeGreaterThan(-1);
    expect(mobileStart).toBeGreaterThan(narrowStart);
    expect(narrowStyles).toMatch(/\.drawer-tabs\s*\{[^}]*overflow-x:\s*auto/);
    expect(narrowStyles).toMatch(
      /\.drawer-tabs button\[role="tab"\]\s*\{[^}]*flex:\s*0 0 auto/
    );
    expect(narrowStyles).toMatch(/min-width:\s*max-content/);
  });

  it("centers exactly the four document panels within an 800px reading measure", () => {
    const readingRule = styles.match(
      /\.drawer-panel\[data-panel="page-prd"\],\s*\.drawer-panel\[data-panel="field-spec"\],\s*\.drawer-panel\[data-panel="api-doc"\],\s*\.drawer-panel\[data-panel="related"\]\s*\{([^}]*)\}/
    )?.[1] ?? "";

    expect(readingRule).toMatch(/width:\s*100%/);
    expect(readingRule).toMatch(/max-width:\s*800px/);
    expect(readingRule).toMatch(/margin-inline:\s*auto/);
    expect(styles).not.toMatch(
      /\.drawer-panel\[data-panel="annotations"\][^{]*\{[^}]*max-width:/
    );
  });

  it("places the page PRD secondary switch before long content as a flat inline control", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    const switcher = shell.shadow.querySelector("[data-role='page-prd-switcher']");
    const content = shell.shadow.querySelector("[data-role='prd-content']");
    const switcherRule = styles.match(/\.page-document-switcher\s*\{([^}]*)\}/)?.[1] ?? "";
    const buttonRule = styles.match(/\.page-document-switcher button\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(switcher).toBeTruthy();
    expect(switcher.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(switcherRule).not.toMatch(/\bposition\s*:\s*sticky\b/);
    expect(switcherRule).not.toMatch(/\btop\s*:/);
    expect(switcherRule).not.toMatch(/\bz-index\s*:/);
    expect(buttonRule).toMatch(/box-shadow\s*:\s*none/);
    expect(buttonRule).toMatch(/transform\s*:\s*none/);
    expect(buttonRule).toMatch(/transition\s*:\s*none/);
    expect(buttonRule).toMatch(/animation\s*:\s*none/);
  });

  it("uses explicit section padding without an inert mobile grid-column rule", () => {
    expect(styles).toMatch(/\.annotation-sections\s*\{[\s\S]*?padding-left:\s*40px/);
    const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 520px)"));
    expect(mobileStyles).not.toMatch(
      /\.annotation-sections\s*\{[^}]*grid-column/
    );
  });

  it("removes the header border only for explicitly empty Markdown tables", () => {
    expect(styles).toMatch(
      /\.markdown-table--empty thead tr > \*\s*\{\s*border-bottom:\s*0;/
    );
    expect(styles).toMatch(
      /\.markdown-table tbody tr:last-child > \*\s*\{\s*border-bottom:\s*0;/
    );
  });
});
