// Leaflet measures its container once, when the map is created. If the box
// changes size afterwards — FlagBus's map grows when a bus is tracked, a
// card above or beside it appears/disappears, the phone rotates, the
// browser bar collapses — Leaflet keeps drawing tiles for the old size, so
// the new area stays blank white and fitBounds/centring are computed for
// the wrong box. This re-measures on every container resize.
//
// Call right after L.map(...); returns a cleanup function to run before
// map.remove().
export function keepMapSized(map) {
  const container = map.getContainer();
  // The first paint can still be mid-layout (page-enter animation, a modal
  // opening), so measure once more after it.
  const timer = setTimeout(() => map.invalidateSize(), 0);
  let frame = null;
  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          // Coalesce bursts (CSS height transitions fire many entries).
          if (frame != null) return;
          frame = requestAnimationFrame(() => {
            frame = null;
            map.invalidateSize();
          });
        })
      : null;
  resizeObserver?.observe(container);
  return () => {
    clearTimeout(timer);
    if (frame != null) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
  };
}
