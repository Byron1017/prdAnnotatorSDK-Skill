import { isAnnotatable, resolveTarget } from "../locator.js";

function positionBox(node, rect) {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

export function createOverlayController({ document, container }) {
  const hover = document.createElement("div");
  hover.className = "hover-outline";
  hover.hidden = true;
  container.append(hover);

  let markerNodes = [];

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
      marker.textContent = String(index + 1);
      marker.style.left = `${rect.right}px`;
      marker.style.top = `${rect.top}px`;
      marker.setAttribute("aria-hidden", "true");
      container.append(marker);
      markerNodes.push(marker);
    });
  }

  function destroy() {
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
