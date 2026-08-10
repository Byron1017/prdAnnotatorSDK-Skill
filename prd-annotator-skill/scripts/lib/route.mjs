const ROUTE_REQUIREMENTS = "must be a non-empty, trimmed, single-line route starting with / and containing no backslashes";

export function assertValidRoute(value, label = "route") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\r\n]/.test(value)
    || !value.startsWith("/")
    || value.includes("\\")
  ) {
    throw new Error(`${label} ${ROUTE_REQUIREMENTS}`);
  }
  return value;
}
