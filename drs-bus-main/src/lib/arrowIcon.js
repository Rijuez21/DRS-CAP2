import L from "leaflet";

// A bus drawn as a direction arrow (course in degrees, 0 = north): the GPS
// Tracker live map and route playback.
export function arrowIcon(course, color = "#047857") {
  return L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;transform:rotate(${Number(course) || 0}deg)"><svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="11" fill="white" stroke="${color}" stroke-width="2"/><path d="M12 4 L17 17 L12 14 L7 17 Z" fill="${color}"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}
