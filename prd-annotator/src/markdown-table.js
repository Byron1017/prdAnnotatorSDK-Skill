import { appendInlineMarkdown } from "./markdown-inline.js";

const DELIMITER_CELL = /^:?-{3,}:?$/;

function splitTableRow(line) {
  let source = String(line || "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      inCode = !inCode;
      cell += character;
    } else if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignmentFor(delimiter) {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

export function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length || !lines[startIndex].includes("|")) return null;
  const headers = splitTableRow(lines[startIndex]);
  const delimiters = splitTableRow(lines[startIndex + 1]);
  if (
    headers.length < 2
    || delimiters.length !== headers.length
    || delimiters.some((cell) => !DELIMITER_CELL.test(cell))
  ) return null;

  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim()) {
    if (!lines[nextIndex].includes("|")) break;
    const cells = splitTableRow(lines[nextIndex]);
    if (cells.length !== headers.length) break;
    rows.push(cells);
    nextIndex += 1;
  }
  return {
    headers,
    alignments: delimiters.map(alignmentFor),
    rows,
    nextIndex
  };
}

function appendCell(document, row, tagName, value, alignment) {
  const cell = document.createElement(tagName);
  cell.dataset.align = alignment;
  if (tagName === "th") cell.scope = "col";
  appendInlineMarkdown(document, cell, value);
  row.append(cell);
}

export function renderMarkdownTable(document, table) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-table-scroll";
  const element = document.createElement("table");
  element.className = "markdown-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  table.headers.forEach((header, index) => {
    appendCell(document, headRow, "th", header, table.alignments[index]);
  });
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const sourceRow of table.rows) {
    const row = document.createElement("tr");
    sourceRow.forEach((value, index) => {
      appendCell(document, row, "td", value, table.alignments[index]);
    });
    body.append(row);
  }
  element.append(head, body);
  wrapper.append(element);
  return wrapper;
}
