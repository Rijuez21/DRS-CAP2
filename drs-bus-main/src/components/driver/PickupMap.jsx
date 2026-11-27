import { useEffect, useRef } from "react";
import L from "leaflet";
import { useLeafletMap } from "../../hooks/useLeafletMap";

// The conductor's map of Flag a Bus pickups: the bus where it is now, and
// every passenger waiting by the road at their exact pickup pin, with a
// circle showing how accurate that pin is (a phone outdoors: a few metres;
// a laptop's Wi-Fi guess: hundreds). Amber = waiting for an answer, green =
// the bus is stopping for them. Live: pins move when the passenger does, the
// bus moves with every GPS update.

const busIcon = L.divIcon({
  className: "",
  html: `<div style="transform:translate(-50%,-50%);width:34px;height:34px;border-radius:9999px;background:#047857;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1">🚌</div>`,
  iconSize: [0, 0],
});

function pinIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="transform:translate(-50%,-100%)"><svg width="28" height="38" viewBox="0 0 28 38"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.3 21.7 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg></div>`,
    iconSize: [0, 0],
  });
}
const PENDING = "#d97706"; // amber: waiting for an answer
const STOPPING = "#059669"; // green: the bus is stopping for them

const pinOf = (f) => (f.pickup_latitude == null ? null : [Number(f.pickup_latitude), Number(f.pickup_longitude)]);

// focus: { id, at } — a new object each tap, so tapping the same passenger
// again re-centres on them.
export default function PickupMap({ bus, flags, focus }) {
  const [containerRef, map] = useLeafletMap();
  const busMarkerRef = useRef(null);
  const pinsRef = useRef(new Map()); // flag_id -> { marker, circle }
  const fittedForRef = useRef(""); // which set of pins the view was last framed for

  // The bus.
  useEffect(() => {
    if (!map) return;
    if (!bus) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      return;
    }
    const latLng = [bus.latitude, bus.longitude];
    if (!busMarkerRef.current) busMarkerRef.current = L.marker(latLng, { icon: busIcon, zIndexOffset: 1000 }).bindTooltip("Your bus").addTo(map);
    else busMarkerRef.current.setLatLng(latLng);
  }, [map, bus]);

  // The passengers' pins (+ accuracy circles), kept in step with `flags`.
  useEffect(() => {
    if (!map) return;
    const pins = pinsRef.current;
    const seen = new Set();
    for (const f of flags) {
      const latLng = pinOf(f);
      if (!latLng) continue;
      seen.add(f.flag_id);
      const color = f.status === "Acknowledged" ? STOPPING : PENDING;
      const radius = Number(f.pickup_accuracy_m) || 0;
      const label = `${f.passenger_name}${f.pickup_landmark ? ` · “${f.pickup_landmark}”` : ""}`;
      const existing = pins.get(f.flag_id);
      if (!existing) {
        const marker = L.marker(latLng, { icon: pinIcon(color) }).bindTooltip(label, { direction: "top", offset: [0, -34] }).addTo(map);
        const circle = radius > 0 ? L.circle(latLng, { radius, color, weight: 1, fillColor: color, fillOpacity: 0.12 }).addTo(map) : null;
        pins.set(f.flag_id, { marker, circle, color });
      } else {
        existing.marker.setLatLng(latLng).setTooltipContent(label);
        if (existing.color !== color) {
          existing.marker.setIcon(pinIcon(color));
          existing.circle?.setStyle({ color, fillColor: color });
          existing.color = color;
        }
        if (existing.circle) existing.circle.setLatLng(latLng).setRadius(radius || 1);
        else if (radius > 0) existing.circle = L.circle(latLng, { radius, color, weight: 1, fillColor: color, fillOpacity: 0.12 }).addTo(map);
      }
    }
    for (const [id, p] of pins) {
      if (seen.has(id)) continue;
      p.marker.remove();
      p.circle?.remove();
      pins.delete(id);
    }
  }, [map, flags]);

  // Frame the bus and every pin whenever a passenger is added or removed
  // (not on every GPS update, so the conductor can pan and zoom freely).
  const pinKey = flags
    .filter((f) => pinOf(f))
    .map((f) => f.flag_id)
    .sort((a, b) => a - b)
    .join(",");
  const hasBus = Boolean(bus);
  useEffect(() => {
    if (!map) return;
    const key = `${pinKey}|${hasBus}`;
    if (fittedForRef.current === key) return;
    const points = flags.map(pinOf).filter(Boolean);
    if (busMarkerRef.current) points.push(busMarkerRef.current.getLatLng());
    if (points.length === 0) return;
    fittedForRef.current = key;
    if (points.length === 1) map.setView(points[0], 15, { animate: false });
    else map.fitBounds(points, { padding: [36, 36], maxZoom: 16, animate: false });
  }, [map, pinKey, hasBus, flags]);

  // Tapping a passenger in the list zooms to their pin.
  useEffect(() => {
    if (!map || !focus) return;
    const p = pinsRef.current.get(focus.id);
    if (!p) return;
    map.setView(p.marker.getLatLng(), 17);
    p.marker.openTooltip();
  }, [map, focus]);

  return <div ref={containerRef} className="h-64 sm:h-72 w-full rounded-lg border overflow-hidden z-0" role="region" aria-label="Map of your bus and passengers waiting to be picked up" />;
}
