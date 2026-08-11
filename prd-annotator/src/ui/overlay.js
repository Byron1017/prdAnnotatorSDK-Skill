import { isAnnotatable, resolveTarget } from "../locator.js";
import { annotationDisplayNumber } from "../model.js";

function positionBox(node, rect) {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

export function createOverlayController({ document, container }) {
  const window = document.defaultView;
  const requestFrame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 16);
  const cancelFrame = typeof window.cancelAnimationFrame === "function"
    ? window.cancelAnimationFrame.bind(window)
    : (handle) => window.clearTimeout(handle);
  const hover = document.createElement("div");
  hover.className = "hover-outline";
  hover.hidden = true;
  container.append(hover);

  let markerNodes = [];
  let currentAnnotations = [];
  let refreshHandle = null;
  let destroyed = false;

  function showHover(element) {
    if (!isAnnotatable(element)) {
      hideHover();
      return;
    }
    positionBox(hover, element.getBoundingClientRect());
    hover.hidden = false;
  }

  function hideHover() {
    hover.hidden = true;
  }

  function renderMarkers(annotations) {
    currentAnnotations = annotations;
    for (const marker of markerNodes) marker.remove();
    markerNodes = [];

    annotations.forEach((annotation, index) => {
      const target = resolveTarget(document, annotation.target);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const marker = document.createElement("span");
      marker.className = "annotation-marker";
      marker.dataset.annotationId = annotation.id;
      marker.dataset.status = annotation.status;
      marker.textContent = annotationDisplayNumber(annotation, index);
      marker.style.left = `${rect.right}px`;
      marker.style.top = `${rect.top}px`;
      marker.setAttribute("aria-hidden", "true");
      container.append(marker);
      markerNodes.push(marker);
    });
  }

  const refresh = () => {
    refreshHandle = null;
    if (!destroyed) renderMarkers(currentAnnotations);
  };
  const scheduleRefresh = () => {
    if (destroyed || refreshHandle !== null) return;
    refreshHandle = requestFrame(refresh);
  };

  document.addEventListener("scroll", scheduleRefresh, true);
  window.addEventListener("resize", scheduleRefresh);
  const observer = new window.MutationObserver(scheduleRefresh);
  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  function destroy() {
    destroyed = true;
    document.removeEventListener("scroll", scheduleRefresh, true);
    window.removeEventListener("resize", scheduleRefresh);
    observer.disconnect();
    if (refreshHandle !== null) cancelFrame(refreshHandle);
    refreshHandle = null;
    currentAnnotations = [];
    markerNodes = [];
    container.replaceChildren();
  }

  return Object.freeze({
    showHover,
    hideHover,
    renderMarkers,
    destroy
  });
}
