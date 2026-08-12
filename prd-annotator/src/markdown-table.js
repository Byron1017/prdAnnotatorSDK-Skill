import { appendInlineMarkdown } from "./markdown-inline.js";

const DELIMITER_CELL = /^:?-{3,}:?$/;

function splitTableRow(line) {
  const source = String(line || "").trim();
  const codeSpanEnds = findCodeSpanEnds(source);
  const cells = [];
  let cell = "";
  let firstSeparator = -1;
  let lastSeparator = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (codeSpanEnds.has(index)) {
      cell += character;
    } else if (character === "\\") {
      let runEnd = index;
      while (source[runEnd] === "\\") runEnd += 1;
      const count = runEnd - index;
      if (source[runEnd] === "|") {
        cell += "\\".repeat(Math.floor(count / 2));
        if (count % 2) cell += "|";
        else {
          if (firstSeparator === -1) firstSeparator = index;
          lastSeparator = runEnd;
          cells.push(cell.trim());
          cell = "";
        }
        index = runEnd;
      } else {
        cell += source.slice(index, runEnd);
        index = runEnd - 1;
      }
    } else if (character === "|" && !codeSpanEnds.has(index)) {
      if (firstSeparator === -1) firstSeparator = index;
      lastSeparator = index;
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  if (firstSeparator === 0) cells.shift();
  if (lastSeparator === source.length - 1) cells.pop();
  return cells;
}

function findCodeSpanEnds(source) {
  const protectedIndexes = new Set();
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "`") continue;
    let delimiterEnd = index;
    while (source[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiterLength = delimiterEnd - index;
    let cursor = delimiterEnd;
    let closingStart = -1;
    while (cursor < source.length) {
      if (source[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let candidateEnd = cursor;
      while (source[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - cursor === delimiterLength) {
        closingStart = cursor;
        break;
      }
      cursor = candidateEnd;
    }
    if (closingStart === -1) {
      index = delimiterEnd - 1;
      continue;
    }
    for (let protectedIndex = index; protectedIndex < closingStart + delimiterLength; protectedIndex += 1) {
      protectedIndexes.add(protectedIndex);
    }
    index = closingStart + delimiterLength - 1;
  }
  return protectedIndexes;
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
