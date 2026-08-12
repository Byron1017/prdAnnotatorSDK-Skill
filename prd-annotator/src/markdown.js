import { appendInlineMarkdown } from "./markdown-inline.js";
import { parseMarkdownTable, renderMarkdownTable } from "./markdown-table.js";

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const UNORDERED_PATTERN = /^\s*[-+*]\s+(.+)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE_PATTERN = /^\s*>\s?(.*)$/;
const RULE_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_PATTERN = /^\s*```([^`]*)$/;

function isBlockStart(line) {
  return HEADING_PATTERN.test(line)
    || UNORDERED_PATTERN.test(line)
    || ORDERED_PATTERN.test(line)
    || QUOTE_PATTERN.test(line)
    || RULE_PATTERN.test(line)
    || FENCE_PATTERN.test(line);
}

export function renderMarkdown(document, markdown) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      fragment.append(renderMarkdownTable(document, table));
      index = table.nextIndex;
      continue;
    }

    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const language = fence[1].trim().replace(/[^a-zA-Z0-9_-]/g, "");
      if (language) code.dataset.language = language;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const node = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(document, node, heading[2].trim());
      fragment.append(node);
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      fragment.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const listPattern = UNORDERED_PATTERN.test(line)
      ? UNORDERED_PATTERN
      : ORDERED_PATTERN.test(line)
        ? ORDERED_PATTERN
        : null;
    if (listPattern) {
      const list = document.createElement(
        listPattern === ORDERED_PATTERN ? "ol" : "ul"
      );
      while (index < lines.length) {
        const itemMatch = lines[index].match(listPattern);
        if (!itemMatch) break;
        const item = document.createElement("li");
        appendInlineMarkdown(document, item, itemMatch[1].trim());
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quoteLines = [];
      while (index < lines.length) {
        const quote = lines[index].match(QUOTE_PATTERN);
        if (!quote) break;
        quoteLines.push(quote[1]);
        index += 1;
      }
      const blockquote = document.createElement("blockquote");
      appendInlineMarkdown(document, blockquote, quoteLines.join("\n"));
      fragment.append(blockquote);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !isBlockStart(lines[index])
      && !parseMarkdownTable(lines, index)
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(document, paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
  }

  return fragment;
}
