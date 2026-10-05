import L from "leaflet";

// One place for how a pinned bus stop looks and behaves on every Leaflet
// map (admin RouteManagement pin picker, FleetTracking, passenger
// LiveTracking and FlagBus), so a stop reads the same everywhere and never
// gets confused with a bus.
//
// A "stop" is a routes row (one km post on the Baguio–Bontoc line) whose
// latitude AND longitude the admin has pinned. A row missing either is
// unpinned and simply isn't drawn — nothing guesses a position for it.

// Rough box around the Baguio–Bontoc corridor. Mirrors CORRIDOR_BOUNDS in
// server/src/routes/routes.js (the server is the one that enforces it; the
// admin map uses this copy to warn before saving).
export const STOP_CORRIDOR_BOUNDS = { minLat: 16.2, maxLat: 17.3, minLng: 120.4, maxLng: 121.15 };

// Where the pin picker opens for a stop that hasn't been pinned yet: the
// middle of the line, zoomed out enough to see Baguio and Bontoc.
export const CORRIDOR_CENTER = [16.9, 120.8];
export const CORRIDOR_ZOOM = 10;

// Below this zoom the permanent stop labels are hidden (they'd overlap).
export const STOP_LABEL_MIN_ZOOM = 13;

export function hasPin(route) {
  return route?.latitude != null && route?.longitude != null;
}

export function isInCorridor({ latitude, longitude }) {
  const b = STOP_CORRIDOR_BOUNDS;
  return latitude >= b.minLat && latitude <= b.maxLat && longitude >= b.minLng && longitude <= b.maxLng;
}

// routes rows -> the pinned stops only, in a shape every map can use.
export function toPinnedStops(routes) {
  return (routes ?? []).filter(hasPin).map((r) => ({
    routeId: r.route_id,
    name: r.destination,
    origin: r.origin,
    distance: r.distance != null ? Number(r.distance) : null,
    isActive: r.is_active !== false && r.is_active !== 0,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  }));
}

// A rounded square with a white "bus stop" sign glyph — deliberately not a
// circle, since every bus on these maps is a round dot.
//   variant "default"   normal stop
//           "highlight" the stop this screen is about (bigger, darker)
//           "faint"     context only (other stops in the pin picker)
export function stopIcon(variant = "default") {
  const size = variant === "highlight" ? 26 : variant === "faint" ? 14 : 18;
  const background = variant === "highlight" ? "#1d4ed8" : variant === "faint" ? "#94a3b8" : "#2563eb";
  const opacity = variant === "faint" ? 0.75 : 1;
  const glyph =
    variant === "faint"
      ? ""
      : `<svg viewBox="0 0 24 24" width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>`;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:5px;background:${background};opacity:${opacity};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;">${glyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}

// Adds one stop marker to a map or layer group and returns it.
//   label: "permanent" (always shown, hidden when zoomed out — see
//          bindStopLabelZoom), "hover", or false
//   interactive: false lets taps fall through to the map — FlagBus needs
//          this so tapping near a stop still places the pickup pin exactly
//          as before
export function addStopMarker(target, stop, { variant = "default", label = "permanent", interactive = true, zIndexOffset = 0 } = {}) {
  const marker = L.marker([stop.latitude, stop.longitude], {
    icon: stopIcon(variant),
    interactive,
    keyboard: false,
    zIndexOffset,
    // Native hover title works at any zoom, even when the label is hidden.
    title: interactive ? `Bus stop: ${stop.name}` : undefined,
  });
  if (label) {
    marker.bindTooltip(stop.name, {
      permanent: label === "permanent",
      direction: "top",
      className: "drs-stop-label",
      opacity: 1,
    });
  }
  marker.addTo(target);
  return marker;
}

// Hides permanent stop labels below `minZoom` (CSS: .drs-stop-labels-hidden
// in index.css). Returns a cleanup function.
export function bindStopLabelZoom(map, minZoom = STOP_LABEL_MIN_ZOOM) {
  const container = map.getContainer();
  const apply = () => container.classList.toggle("drs-stop-labels-hidden", map.getZoom() < minZoom);
  apply();
  map.on("zoomend", apply);
  return () => {
    map.off("zoomend", apply);
    container.classList.remove("drs-stop-labels-hidden");
  };
}
