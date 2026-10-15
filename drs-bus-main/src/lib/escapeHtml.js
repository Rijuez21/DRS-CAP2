// Leaflet treats tooltip/popup/divIcon strings as HTML. Anything that comes
// from data (stop names, plate numbers, bus numbers…) must go through this
// first, or a value like `<img src=x onerror=…>` would run as script.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
