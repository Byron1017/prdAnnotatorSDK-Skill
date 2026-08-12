export const styles = `
  :host {
    all: initial;
    --prd-color-surface: #ffffff;
    --prd-color-surface-strong: #17212b;
    --prd-color-text: #17212b;
    --prd-color-text-inverse: #ffffff;
    --prd-color-border: #d5dde5;
    --prd-color-focus: #f59e0b;
    --prd-color-danger: #b91c1c;
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
    align-items: stretch;
    pointer-events: auto;
    transition: right 120ms ease, bottom 120ms ease;
  }

  .tool-actions {
    display: flex;
    gap: var(--prd-space-2);
  }

  .tools[data-collapsed="true"] {
    right: 0;
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

  button.tool-launcher-toggle {
    display: grid;
    width: 32px;
    min-width: 32px;
    height: 44px;
    min-height: 44px;
    place-items: center;
    margin-left: var(--prd-space-2);
    border-color: var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 0;
    background: var(--prd-color-surface-strong);
    color: var(--prd-color-text-inverse);
    transition: background-color 120ms ease;
  }

  button.tool-launcher-toggle:hover {
    background: #263647;
  }

  .tool-launcher-chevron {
    display: block;
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle {
    width: 24px;
    min-width: 24px;
    margin-left: 0;
    border-right: 0;
    border-radius: 22px 0 0 22px;
  }

  .tools[data-collapsed="true"] .tool-launcher-chevron {
    transform: rotate(180deg);
  }

  .tools[data-collapsed="true"]
    button.tool-launcher-toggle[data-annotation-active="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle:focus-visible {
    outline-offset: -4px;
  }

  .editor,
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    width: min(480px, 100%);
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

  .editor-form {
    display: grid;
    gap: 14px;
  }

  .editor-field {
    min-width: 0;
  }

  .editor label {
    display: block;
    margin-bottom: 6px;
    font-weight: 700;
  }

  .editor input,
  .editor select,
  .editor textarea {
    display: block;
    width: 100%;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px 12px;
    color: var(--prd-color-text);
    background: #ffffff;
    font: 400 14px/1.55 ui-sans-serif, system-ui, sans-serif;
  }

  .editor textarea {
    min-height: 84px;
    resize: vertical;
  }

  .editor [data-field="prdContent"] {
    min-height: 132px;
  }

  .editor input:focus-visible,
  .editor select:focus-visible,
  .editor textarea:focus-visible {
    border-color: #b45309;
    outline: 3px solid rgb(245 158 11 / 35%);
    outline-offset: 1px;
  }

  .editor input[aria-invalid="true"],
  .editor select[aria-invalid="true"],
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

  .delete-dialog {
    width: 100%;
    max-width: 100%;
  }

  .delete-dialog-description {
    margin-top: 12px !important;
    color: #475569;
    overflow-wrap: anywhere;
  }

  .delete-dialog-actions {
    display: flex;
    max-width: 100%;
    justify-content: flex-end;
    gap: var(--prd-space-2);
    margin-top: 20px;
  }

  button.confirm-delete {
    border-color: var(--prd-color-danger);
    background: var(--prd-color-danger);
  }

  button.confirm-delete:hover {
    background: #991b1b;
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
    padding: 0 20px 20px;
  }

  .drawer-page-info {
    padding: 20px 0 16px;
  }

  .drawer-tabs {
    position: sticky;
    top: 84px;
    z-index: 1;
    display: flex;
    margin: 0 -20px;
    border-block: 1px solid var(--prd-color-border);
    padding: 8px 20px;
    background: rgb(255 255 255 / 97%);
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
  }

  .drawer-tabs button[role="tab"] {
    flex: 0 0 auto;
    min-width: max-content;
    border-color: transparent;
    padding: 8px 10px;
    background: transparent;
    color: #475569;
    box-shadow: none;
  }

  .drawer-tabs button[role="tab"][aria-selected="true"] {
    border-color: #fdba74;
    background: #fff7ed;
    color: #9a3412;
  }

  .drawer-panel {
    padding-top: 20px;
  }

  .page-document-switcher {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    gap: 8px;
    margin: -20px 0 12px;
    padding: 12px 0;
    background: var(--prd-color-surface);
  }

  .page-document-switcher button {
    min-width: 0;
    min-height: 36px;
    padding: 7px 10px;
  }

  .page-document-switcher button[aria-selected="true"] {
    border-color: #fdba74;
    background: #fff7ed;
    color: #9a3412;
  }

  [data-page-doc-panel][hidden] {
    display: none;
  }

  .drawer-panel[hidden] {
    display: none;
  }

  .drawer-panel [data-role="sync-help"] {
    margin-top: 24px;
    border-top: 1px solid var(--prd-color-border);
    padding-top: 20px;
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

  .annotation-list > li {
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
  }

  .annotation-card {
    display: block;
  }

  .annotation-card-header {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
  }

  .annotation-heading {
    min-width: 0;
  }

  .annotation-card-header .annotation-actions {
    margin-top: 0;
  }

  .annotation-sections {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    /* Align section content with the title after the numbered marker. */
    padding-left: 40px;
  }

  .annotation-section {
    min-width: 0;
  }

  .annotation-section-label {
    margin: 0 0 4px;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .annotation-section-content {
    margin: 0 !important;
    color: #334155;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  .annotation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--prd-space-2);
    margin-top: 12px;
  }

  .linked-sections > li {
    display: list-item;
    border: 0;
    padding: 0;
    background: transparent;
    overflow-wrap: anywhere;
  }

  button.annotation-action {
    min-height: 32px;
    padding: 5px 10px;
    font-size: 12px;
  }

  button.annotation-delete {
    border-color: #fecaca;
    color: var(--prd-color-danger);
  }

  button.annotation-delete:hover {
    border-color: #fca5a5;
    background: #fef2f2;
  }

  .annotation-content p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .annotation-title {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .annotation-description {
    margin-top: 6px !important;
  }

  .annotation-prd-content,
  .annotation-detail {
    margin-top: 8px !important;
    color: #475569;
    font-size: 13px;
  }

  .annotation-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .annotation-type,
  .status,
  .impact {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .impact-global {
    background: #ffedd5;
    color: #9a3412;
  }

  .annotation-summary {
    margin-top: 10px !important;
    border-left: 2px solid #94a3b8;
    padding-left: 8px;
    color: #475569;
    font-size: 13px;
  }

  .linked-sections {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #475569;
    font-size: 12px;
  }

  [data-role="prd-content"] {
    margin-top: 12px;
    color: #334155;
    overflow-wrap: anywhere;
  }

  [data-role="prd-content"] h1,
  [data-role="prd-content"] h2,
  [data-role="prd-content"] h3,
  [data-role="prd-content"] h4,
  [data-role="prd-content"] h5,
  [data-role="prd-content"] h6 {
    margin: 22px 0 8px;
    color: #17212b;
    line-height: 1.3;
  }

  [data-role="prd-content"] > :first-child {
    margin-top: 0;
  }

  [data-role="prd-content"] h1 {
    font-size: 22px;
  }

  [data-role="prd-content"] h2 {
    font-size: 18px;
  }

  [data-role="prd-content"] h3 {
    font-size: 15px;
  }

  [data-role="prd-content"] p,
  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol,
  [data-role="prd-content"] blockquote,
  [data-role="prd-content"] pre {
    margin: 8px 0;
  }

  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol {
    padding-left: 22px;
  }

  [data-role="prd-content"] blockquote {
    border-left: 3px solid #d97706;
    padding: 8px 12px;
    background: #fff7ed;
    white-space: pre-wrap;
  }

  [data-role="prd-content"] pre {
    max-width: 100%;
    overflow: auto;
    border-radius: 6px;
    padding: 12px;
    background: #17212b;
    color: #e2e8f0;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  [data-role="prd-content"] hr {
    border: 0;
    border-top: 1px solid var(--prd-color-border);
    margin: 20px 0;
  }

  .markdown-table-scroll {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    border: 1px solid var(--prd-color-border);
    border-radius: 8px;
    background: #ffffff;
  }

  .markdown-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    color: #334155;
    font-size: 12px;
    line-height: 1.5;
  }

  .markdown-table th,
  .markdown-table td {
    min-width: 96px;
    max-width: 320px;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 10px;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  .markdown-table th {
    background: #f1f5f9;
    color: #17212b;
    font-weight: 700;
    white-space: nowrap;
  }

  .markdown-table tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  .markdown-table tr > :last-child {
    border-right: 0;
  }

  .markdown-table tbody tr:last-child > * {
    border-bottom: 0;
  }

  .markdown-table--empty thead tr > * {
    border-bottom: 0;
  }

  .markdown-table [data-align="center"] { text-align: center; }
  .markdown-table [data-align="right"] { text-align: right; }

  .markdown-inline-code {
    border-radius: 4px;
    padding: 1px 4px;
    background: #e2e8f0;
    color: #9a3412;
    font: 0.92em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    white-space: nowrap;
  }

  [data-role="prd-content"] a,
  .document-content a {
    color: #b45309;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  [data-role="page-metadata"],
  [data-role="sync-state"],
  [data-role="view-warning"] {
    color: #475569;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  [data-role="sync-state"][data-state="synced"] {
    color: #16835b;
  }

  [data-role="sync-state"][data-state="browser-only"],
  [data-role="sync-state"][data-state="memory-only"] {
    margin-top: 8px;
    border-left: 3px solid #b45309;
    padding: 8px 10px;
    background: #fff7ed;
    color: #9a3412;
  }

  .sync-instructions {
    display: grid;
    gap: 4px;
    margin: 10px 0 12px;
    padding-left: 22px;
    color: #475569;
    font-size: 13px;
  }

  .sync-copy-button {
    width: 100%;
  }

  .copy-result,
  .sync-fallback-label {
    margin-top: 10px !important;
    color: #475569;
    font-size: 12px;
  }

  .sync-prompt-fallback {
    display: block;
    width: 100%;
    min-height: 180px;
    margin-top: 8px;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px;
    background: #ffffff;
    color: var(--prd-color-text);
    font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    resize: vertical;
  }

  .page-metadata-generated {
    margin-top: 4px !important;
  }

  .view-warning,
  .document-warning {
    margin-top: 10px !important;
    border-left: 3px solid #b45309;
    padding: 8px 10px;
    background: #fff7ed;
    color: #9a3412;
    overflow-wrap: anywhere;
  }

  .document-group {
    display: grid;
    gap: 10px;
  }

  .document-group + .document-group {
    margin-top: 20px;
  }

  .document-group-title {
    margin: 0;
    color: #475569;
    font-size: 13px;
  }

  .document-card {
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
    overflow-wrap: anywhere;
  }

  .document-title {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
  }

  .document-path {
    margin-top: 6px !important;
    color: #475569;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  .document-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .document-format,
  .document-kind,
  .document-preview-status {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .document-content {
    margin-top: 12px;
    color: #334155;
  }

  .document-content > :first-child {
    margin-top: 0;
  }

  .document-content h1,
  .document-content h2,
  .document-content h3,
  .document-content h4,
  .document-content h5,
  .document-content h6 {
    margin: 18px 0 8px;
    color: #17212b;
    line-height: 1.3;
  }

  .document-content p,
  .document-content ul,
  .document-content ol,
  .document-content blockquote,
  .document-content pre {
    margin: 8px 0;
  }

  .document-content ul,
  .document-content ol {
    padding-left: 22px;
  }

  .document-content pre {
    max-width: 100%;
    overflow: auto;
    border-radius: 6px;
    padding: 12px;
    background: #17212b;
    color: #e2e8f0;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
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
    }

    .tools[data-collapsed="true"] {
      right: 0;
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    .tool-actions {
      gap: 6px;
    }

    button {
      padding-inline: 12px;
    }

    .annotation-card-header {
      grid-template-columns: 30px minmax(0, 1fr);
    }

    .annotation-card-header .annotation-actions {
      grid-column: 2;
    }

    .annotation-actions,
    .delete-dialog-actions {
      width: 100%;
      flex-wrap: wrap;
    }

    button.annotation-action {
      min-height: 44px;
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
