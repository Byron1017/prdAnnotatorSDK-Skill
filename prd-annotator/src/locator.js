import { UI_ATTRIBUTE } from "./constants.js";

const BLOCKED_TAGS = new Set([
  "HTML",
  "BODY",
  "SCRIPT",
  "STYLE",
  "LINK",
  "META"
]);

function normalizedText(element) {
  return element.textContent.replace(/\s+/g, " ").trim();
}

function elementDepth(element) {
  let depth = 0;
  for (let node = element; node?.parentElement; node = node.parentElement) depth += 1;
  return depth;
}

export function isAnnotatable(element) {
  const ElementConstructor = element?.ownerDocument?.defaultView?.Element;
  if (!ElementConstructor || !(element instanceof ElementConstructor)) return false;
  if (element.closest(`[${UI_ATTRIBUTE}]`)) return false;

  const rootHost = element.getRootNode()?.host;
  if (rootHost?.closest?.(`[${UI_ATTRIBUTE}]`)) return false;
  return !BLOCKED_TAGS.has(element.tagName);
}

function cssSegment(element) {
  const escape = element.ownerDocument.defaultView.CSS?.escape
    || ((value) => value.replace(/[^A-Za-z0-9_-]/g, "\\$&"));
  if (element.id && /^[A-Za-z][\w:-]*$/.test(element.id)) {
    return `#${escape(element.id)}`;
  }

  const siblings = [...(element.parentElement?.children || [])]
    .filter((node) => node.tagName === element.tagName);
  const suffix = siblings.length > 1
    ? `:nth-of-type(${siblings.indexOf(element) + 1})`
    : "";
  return `${element.tagName.toLowerCase()}${suffix}`;
}

function createCssPath(element) {
  const segments = [];
  const documentElement = element.ownerDocument.documentElement;
  for (
    let node = element;
    node && node !== documentElement;
    node = node.parentElement
  ) {
    segments.unshift(cssSegment(node));
    if (segments[0].startsWith("#")) break;
  }
  return segments.join(" > ");
}

function createXpath(element) {
  const segments = [];
  for (let node = element; node?.nodeType === 1; node = node.parentElement) {
    const peers = [...(node.parentElement?.children || [])]
      .filter((peer) => peer.tagName === node.tagName);
    const index = peers.length > 1 ? `[${peers.indexOf(node) + 1}]` : "";
    segments.unshift(`${node.tagName.toLowerCase()}${index}`);
  }
  return `/${segments.join("/")}`;
}

export function describeTarget(element) {
  if (!isAnnotatable(element)) throw new Error("Element is not annotatable");

  const rect = element.getBoundingClientRect();
  return {
    cssPath: createCssPath(element),
    xpath: createXpath(element),
    textQuote: normalizedText(element).slice(0, 160),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}

export function resolveTarget(document, descriptor) {
  try {
    const byCss = document.querySelector(descriptor.cssPath);
    if (isAnnotatable(byCss)) return byCss;
  } catch {
    // Continue with the next non-destructive recovery strategy.
  }

  try {
    const XPathResult = document.defaultView.XPathResult;
    const result = document.evaluate(
      descriptor.xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE
    );
    if (isAnnotatable(result.singleNodeValue)) return result.singleNodeValue;
  } catch {
    // Continue with text recovery.
  }

  const quote = String(descriptor.textQuote || "").replace(/\s+/g, " ").trim();
  if (!quote) return null;

  return [...document.querySelectorAll("body *")]
    .filter(isAnnotatable)
    .filter((element) => normalizedText(element).includes(quote))
    .sort((left, right) => {
      const lengthDelta = normalizedText(left).length - normalizedText(right).length;
      if (lengthDelta) return lengthDelta;
      return elementDepth(right) - elementDepth(left);
    })[0] || null;
}
