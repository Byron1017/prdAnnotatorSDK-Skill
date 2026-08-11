export function makeToolLauncherPreferenceKey(projectId) {
  return "prd-annotator:ui:v1:" + String(projectId) + ":launcher";
}

function normalizePreference(value, fallback) {
  return value
    && typeof value === "object"
    && typeof value.collapsed === "boolean"
    ? { collapsed: value.collapsed }
    : { collapsed: fallback.collapsed };
}

export function createToolLauncherPreference({ storage, projectId }) {
  const key = makeToolLauncherPreferenceKey(projectId);
  let memory = { collapsed: false };

  function load() {
    try {
      const raw = storage?.getItem(key);
      if (raw !== null && raw !== undefined) {
        memory = normalizePreference(JSON.parse(raw), memory);
      }
    } catch {
      // Current-instance memory remains authoritative when storage is blocked.
    }
    return { ...memory };
  }

  function save(value) {
    memory = { collapsed: Boolean(value?.collapsed) };
    try {
      storage?.setItem(key, JSON.stringify(memory));
    } catch {
      // The preference remains usable for the lifetime of this SDK instance.
    }
    return { ...memory };
  }

  return Object.freeze({ key, load, save });
}
