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

  it("keeps the modal annotation editor above an open wide Drawer", () => {
    const editorRule = styles.match(/\.editor\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(editorRule).toMatch(/z-index:\s*2/);
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

  it("uses the approved document typography and heading hierarchy", () => {
    const contentRule = styles.match(
      /\[data-role="prd-content"\],\s*\.document-content\s*\{([^}]*)\}/
    )?.[1] ?? "";

    expect(contentRule).toMatch(/font-size:\s*15px/);
    expect(contentRule).toMatch(/line-height:\s*1\.75/);
    expect(contentRule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h1\s*\{[^}]*font-size:\s*28px/);
    expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h2\s*\{[^}]*border-bottom:\s*1px solid/);
    expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h3\s*\{[^}]*font-size:\s*17px/);
    expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) li \+ li\s*\{[^}]*margin-top:\s*6px/);
  });

  it("uses restrained document and Related-document cards", () => {
    const documentCardRule = styles.match(/\.document-card\s*\{([^}]*)\}/)?.[1] ?? "";
    const hubCardRule = styles.match(/\.document-hub-card\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(documentCardRule).toMatch(/background:\s*#ffffff/);
    expect(documentCardRule).toMatch(/box-shadow:\s*none/);
    expect(documentCardRule).toMatch(/padding:\s*20px/);
    expect(hubCardRule).toMatch(/min-height:\s*96px/);
    expect(hubCardRule).toMatch(/background:\s*#ffffff/);
    expect(hubCardRule).toMatch(/box-shadow:\s*none/);
    expect(styles).toMatch(/\.document-content\s*\{[^}]*border-top:\s*1px solid/);
    expect(styles).toMatch(/\.empty-state\s*\{[^}]*background:\s*#ffffff/);
    expect(styles).toMatch(
      /\.view-warning,\s*\.document-warning\s*\{[^}]*border-radius:\s*6px/
    );
  });

  it("confines wide tables and code to their document surface", () => {
    const tableScrollRule = styles.match(/\.markdown-table-scroll\s*\{([^}]*)\}/)?.[1] ?? "";
    const tableRule = styles.match(/\.markdown-table\s*\{([^}]*)\}/)?.[1] ?? "";
    const tableCellRule = styles.match(
      /\.markdown-table th,\s*\.markdown-table td\s*\{([^}]*)\}/
    )?.[1] ?? "";

    expect(tableScrollRule).toMatch(/max-width:\s*100%/);
    expect(tableScrollRule).toMatch(/overflow-x:\s*auto/);
    expect(tableScrollRule).toMatch(/overflow-y:\s*hidden/);
    expect(tableRule).toMatch(/font-size:\s*13px/);
    expect(tableRule).toMatch(/line-height:\s*1\.6/);
    expect(tableCellRule).toMatch(/padding:\s*10px 12px/);
    expect(tableCellRule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) pre\s*\{[^}]*overflow:\s*auto/);
  });
});
