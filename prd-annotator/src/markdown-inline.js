const INLINE_PATTERN = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\n]+)\)|\*([^*\n]+)\*|_([^_\n]+)_/g;
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

function findCodeSpan(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] !== "`") continue;
    let delimiterEnd = index;
    while (source[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiterLength = delimiterEnd - index;
    let cursor = delimiterEnd;
    while (cursor < source.length && source[cursor] !== "\n") {
      if (source[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let candidateEnd = cursor;
      while (source[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - cursor === delimiterLength) {
        return {
          index,
          end: candidateEnd,
          content: source.slice(delimiterEnd, cursor)
        };
      }
      cursor = candidateEnd;
    }
    index = delimiterEnd - 1;
  }
  return null;
}

function findFormatting(source, startIndex) {
  INLINE_PATTERN.lastIndex = startIndex;
  return INLINE_PATTERN.exec(source);
}

export function appendInlineMarkdown(document, parent, source) {
  const text = String(source || "");
  let cursor = 0;
  while (cursor < text.length) {
    const codeSpan = findCodeSpan(text, cursor);
    const formatting = findFormatting(text, cursor);
    if (codeSpan && (!formatting || codeSpan.index <= formatting.index)) {
      appendText(document, parent, text.slice(cursor, codeSpan.index));
      const code = document.createElement("code");
      code.className = "markdown-inline-code";
      code.textContent = codeSpan.content;
      parent.append(code);
      cursor = codeSpan.end;
      continue;
    }
    if (!formatting) break;

    appendText(document, parent, text.slice(cursor, formatting.index));
    const [token, starStrong, underscoreStrong, linkLabel,
      linkHref, starEmphasis, underscoreEmphasis] = formatting;
    if (starStrong !== undefined || underscoreStrong !== undefined) {
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
    cursor = formatting.index + token.length;
  }
  appendText(document, parent, text.slice(cursor));
}
