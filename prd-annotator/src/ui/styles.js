export const styles = `
  :host {
    all: initial;
    --prd-color-surface: #ffffff;
    --prd-color-surface-strong: #17212b;
    --prd-color-text: #17212b;
    --prd-color-text-inverse: #ffffff;
    --prd-color-border: #d5dde5;
    --prd-color-focus: #f59e0b;
    --prd-space-2: 8px;
    --prd-space-3: 12px;
    --prd-radius: 8px;
    --prd-shadow: 0 14px 36px rgb(15 23 42 / 22%);
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    pointer-events: none;
    color: var(--prd-color-text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .hover-outline {
    position: fixed;
    border: 2px dashed #d97706;
    background: rgb(245 158 11 / 10%);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 85%);
    pointer-events: none;
  }

  .annotation-marker {
    position: fixed;
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 2px solid #ffffff;
    border-radius: 50%;
    background: #d97706;
    box-shadow: 0 3px 10px rgb(15 23 42 / 28%);
    color: #ffffff;
    font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .annotation-marker[data-status="applied"] {
    background: #16835b;
  }

  .annotation-marker[data-status="needs-clarification"] {
    background: #c2410c;
  }

  .annotation-marker[data-status="superseded"] {
    background: #64748b;
  }

  .tools {
    position: fixed;
    right: 20px;
    bottom: 20px;
    display: flex;
    gap: var(--prd-space-2);
    pointer-events: auto;
  }

  button {
    min-height: 44px;
    border: 1px solid var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 9px 14px;
    background: var(--prd-color-surface-strong);
    box-shadow: var(--prd-shadow);
    color: var(--prd-color-text-inverse);
    font: 600 14px/1.25 ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }

  button:hover {
    background: #263647;
  }

  button:active,
  button[aria-pressed="true"],
  button[aria-expanded="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  button:focus-visible {
    outline: 3px solid var(--prd-color-focus);
    outline-offset: 3px;
  }

  .editor,
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    width: min(480px, 100vw);
    height: 100dvh;
    border-left: 1px solid var(--prd-color-border);
    background: var(--prd-color-surface);
    box-shadow: var(--prd-shadow);
    pointer-events: auto;
    overflow: auto;
  }

  .editor {
    inset: 50% auto auto 50%;
    width: min(440px, calc(100vw - 32px));
    height: auto;
    max-height: calc(100dvh - 32px);
    border: 1px solid var(--prd-color-border);
    border-radius: 10px;
    transform: translate(-50%, -50%);
  }

  @media (max-width: 520px) {
    .tools {
      right: 12px;
      bottom: 12px;
      gap: 6px;
    }

    button {
      padding-inline: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
`;
