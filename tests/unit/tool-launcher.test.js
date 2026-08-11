import { beforeEach, describe, expect, it } from "vitest";
import { createShell } from "../../prd-annotator/src/ui/shell.js";
import { applyToolLauncherState } from "../../prd-annotator/src/ui/tool-launcher.js";

describe("tool launcher UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders two business actions and one independent persistent toggle", () => {
    const shell = createShell(document);

    expect(shell.shadow.querySelectorAll("[data-role='tool-button']"))
      .toHaveLength(2);
    expect(shell.shadow.querySelectorAll("[data-role='tool-launcher-toggle']"))
      .toHaveLength(1);
    expect(shell.toolLauncher.getAttribute("role")).toBe("group");
    expect(shell.toolLauncherToggle.tagName).toBe("BUTTON");
    expect(shell.toolLauncherToggle.getAttribute("aria-controls"))
      .toBe(shell.toolActions.id);
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses only the action container and keeps focus on the toggle", () => {
    const shell = createShell(document);
    document.body.append(shell.host);
    shell.toolLauncherToggle.focus();

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: true,
      annotationModeActive: false
    });

    expect(shell.toolLauncher.dataset.collapsed).toBe("true");
    expect(shell.toolActions.hidden).toBe(true);
    expect(shell.toolLauncherToggle.hidden).toBe(false);
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("false");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具");
    expect(shell.shadow.activeElement).toBe(shell.toolLauncherToggle);
  });

  it("restores actions and communicates active annotation mode when collapsed", () => {
    const shell = createShell(document);

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: true,
      annotationModeActive: true
    });

    expect(shell.toolLauncherToggle.dataset.annotationActive).toBe("true");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具（标注模式已开启）");

    applyToolLauncherState({
      launcher: shell.toolLauncher,
      actions: shell.toolActions,
      toggle: shell.toolLauncherToggle,
      collapsed: false,
      annotationModeActive: true
    });

    expect(shell.toolActions.hidden).toBe(false);
    expect(shell.toolLauncher.dataset.collapsed).toBe("false");
    expect(shell.toolLauncherToggle.dataset.annotationActive).toBe("false");
    expect(shell.toolLauncherToggle.getAttribute("aria-expanded")).toBe("true");
    expect(shell.toolLauncherToggle.getAttribute("aria-label"))
      .toBe("收起 PRD 标注工具");
  });
});
