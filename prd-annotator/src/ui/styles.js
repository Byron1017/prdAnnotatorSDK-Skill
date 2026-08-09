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
    padding: 24px;
  }

  .editor h2,
  .drawer h2,
  .drawer h3,
  .editor p,
  .drawer p {
    margin: 0;
  }

  .editor h2 {
    font-size: 18px;
    line-height: 1.3;
  }

  .selected-target {
    margin-top: 8px !important;
    margin-bottom: 20px !important;
    padding-left: 10px;
    border-left: 3px solid #d97706;
    color: #475569;
    overflow-wrap: anywhere;
  }

  .editor label {
    display: block;
    margin-bottom: 6px;
    font-weight: 700;
  }

  .editor textarea {
    display: block;
    width: 100%;
    min-height: 132px;
    resize: vertical;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px 12px;
    color: var(--prd-color-text);
    background: #ffffff;
    font: 400 14px/1.55 ui-sans-serif, system-ui, sans-serif;
  }

  .editor textarea:focus-visible {
    border-color: #b45309;
    outline: 3px solid rgb(245 158 11 / 35%);
    outline-offset: 1px;
  }

  .editor textarea[aria-invalid="true"] {
    border-color: #b91c1c;
  }

  .field-error {
    margin-top: 6px !important;
    color: #b91c1c;
    font-size: 12px;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--prd-space-2);
    margin-top: 20px;
  }

  button.secondary-button,
  button.drawer-close {
    border-color: var(--prd-color-border);
    background: #ffffff;
    box-shadow: none;
    color: var(--prd-color-text);
  }

  button.secondary-button:hover,
  button.drawer-close:hover {
    background: #f1f5f9;
  }

  .drawer-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 84px;
    border-bottom: 1px solid var(--prd-color-border);
    padding: 16px 20px;
    background: rgb(255 255 255 / 96%);
  }

  .eyebrow {
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .drawer h2 {
    margin-top: 2px;
    font-size: 18px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  button.drawer-close {
    min-width: 44px;
    padding: 8px;
    font-size: 22px;
    line-height: 1;
  }

  .drawer-body {
    display: grid;
    gap: 28px;
    padding: 20px;
  }

  .drawer-body > section + section {
    border-top: 1px solid var(--prd-color-border);
    padding-top: 24px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .drawer h3 {
    font-size: 15px;
  }

  [data-role="annotation-count"] {
    min-width: 24px;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #334155;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .annotation-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .annotation-list li {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 10px;
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
  }

  .annotation-number {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 50%;
    background: #d97706;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
  }

  .annotation-content {
    min-width: 0;
  }

  .annotation-content p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .status {
    display: inline-block;
    margin-top: 8px;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: var(--prd-radius);
    padding: 20px 12px;
    color: #64748b;
    text-align: center;
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
