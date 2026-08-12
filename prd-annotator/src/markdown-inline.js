const INLINE_PATTERN = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\n]+)\)|\*([^*\n]+)\*|_([^_\n]+)_/g;
const BROWSER_URL_BOUNDARY_WHITESPACE = /^[\0-\x20]+|[\0-\x20]+$/g;
const ASCII_URL_CONTROLS = /[\t\r\n]/;
const LEADING_AUTHORITY_PREFIX = /^[\\/]{2}/;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEME = /^(?:https?:|mailto:)/i;

export function sanitizeMarkdownHref(value) {
  const href = String(value || "").replace(BROWSER_URL_BOUNDARY_WHITESPACE, "");
  if (!href || ASCII_URL_CONTROLS.test(href) || LEADING_AUTHORITY_PREFIX.test(href)) {
    return null;
  }
  if (href.startsWith("#")) return href;
  if (EXPLICIT_SCHEME.test(href)) return ALLOWED_SCHEME.test(href) ? href : null;
  return href;
}

function appendText(document, parent, value) {
  if (value) parent.append(document.createTextNode(value));
}

export function appendInlineMarkdown(document, parent, source) {
  const text = String(source || "");
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    appendText(document, parent, text.slice(cursor, match.index));
    const [token, codeText, starStrong, underscoreStrong, linkLabel,
      linkHref, starEmphasis, underscoreEmphasis] = match;
    if (codeText !== undefined) {
      const code = document.createElement("code");
      code.className = "markdown-inline-code";
      code.textContent = codeText;
      parent.append(code);
    } else if (starStrong !== undefined || underscoreStrong !== undefined) {
      const strong = document.createElement("strong");
      appendInlineMarkdown(document, strong, starStrong ?? underscoreStrong);
      parent.append(strong);
    } else if (linkLabel !== undefined) {
      const href = sanitizeMarkdownHref(linkHref);
      if (!href) {
        appendInlineMarkdown(document, parent, linkLabel);
      } else {
        const link = document.createElement("a");
        link.setAttribute("href", href);
        if (/^https?:/i.test(href)) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        appendInlineMarkdown(document, link, linkLabel);
        parent.append(link);
      }
    } else {
      const emphasis = document.createElement("em");
      appendInlineMarkdown(document, emphasis, starEmphasis ?? underscoreEmphasis);
      parent.append(emphasis);
    }
    cursor = match.index + token.length;
  }
  appendText(document, parent, text.slice(cursor));
}
