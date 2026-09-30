import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, LocateFixed, Trash2, AlertTriangle, MousePointerClick } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../../lib/leafletDefaultIcon"; // makes the default pin marker load (see that file)
import Modal from "./Modal";
import InlineAlert from "../common/InlineAlert";
import { useGeolocation } from "../../hooks/useGeolocation";
import * as api from "../../lib/api";
import { distanceKm, formatDistance } from "../../lib/geo";
import {
  CORRIDOR_CENTER,
  CORRIDOR_ZOOM,
  STOP_CORRIDOR_BOUNDS,
  addStopMarker,
  hasPin,
  isInCorridor,
  toPinnedStops,
} from "../../lib/stopMarkers";

const PINNED_ZOOM = 17; // close enough to see which side of the road the shed is on
const GPS_ZOOM = 18;
const GPS_WARN_ACCURACY_M = 30; // worse than this, the admin should nudge the pin by eye
const TOO_CLOSE_M = 50; // another stop this close is probably the same place pinned twice

const fmt7 = (n) => Number(n).toFixed(7);

// Text box -> number, only if it's a real in-range coordinate.
function parseCoord(text, min, max) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Admin: set exactly where one stop (a routes row) is on the map.
//   click the map          -> drop the pin there
//   drag the pin           -> fine-tune it
//   type lat / lng         -> the pin follows
//   "Use my current location" -> for an admin standing at the stop
// Other pinned stops are drawn faintly for context so the same shed isn't
// pinned twice under two km posts.
//
// props: route (the row being pinned), allRoutes (for the context markers),
//        onSaved(updatedRoute, "pinned" | "cleared"), onClose()
export default function StopPinMap({ route, allRoutes, onSaved, onClose }) {
  const initialPin = hasPin(route) ? { latitude: Number(route.latitude), longitude: Number(route.longitude) } : null;

  // focus: whether this change should move the map to the pin (typed or GPS
  // positions can be off-screen; a click or drag already is where you look)
  const [pin, setPin] = useState(initialPin ? { ...initialPin, focus: false } : null);
  const [latText, setLatText] = useState(initialPin ? fmt7(initialPin.latitude) : "");
  const [lngText, setLngText] = useState(initialPin ? fmt7(initialPin.longitude) : "");
  const [cursor, setCursor] = useState(null);
  const [gpsFix, setGpsFix] = useState(null); // the GPS reading the pin came from, for its accuracy
  const [wantGps, setWantGps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const { status: gpsStatus, position, request: requestGps } = useGeolocation();

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const pinMarkerRef = useRef(null);

  const otherStops = useMemo(() => toPinnedStops(allRoutes).filter((s) => s.routeId !== route.route_id), [allRoutes, route.route_id]);

  // Only calls state setters (which never change), so it's stable and the
  // map's click/drag listeners, bound once, can call it directly.
  const placePin = useCallback((point, { focus = false, fromGps = null } = {}) => {
    setPin({ latitude: point.latitude, longitude: point.longitude, focus });
    setLatText(fmt7(point.latitude));
    setLngText(fmt7(point.longitude));
    setGpsFix(fromGps);
    setError("");
  }, [setPin, setLatText, setLngText, setGpsFix, setError]);

  // "Use my current location": use the fix we already have, or ask for one
  // and use the first fix that arrives. Applied here, during render, rather
  // than in an effect — React's documented way to react to a new value.
  if (wantGps && gpsStatus === "ok" && position) {
    setWantGps(false);
    placePin(position, { focus: true, fromGps: position });
  }
  function handleUseMyLocation() {
    setError("");
    if (gpsStatus === "ok" && position) placePin(position, { focus: true, fromGps: position });
    else {
      setWantGps(true);
      requestGps();
    }
  }

  function handleTyped(nextLatText, nextLngText) {
    setLatText(nextLatText);
    setLngText(nextLngText);
    const lat = parseCoord(nextLatText, -90, 90);
    const lng = parseCoord(nextLngText, -180, 180);
    if (lat != null && lng != null) {
      setPin({ latitude: lat, longitude: lng, focus: true });
      setGpsFix(null);
    }
  }

  // 1. The map, created once. Inside a modal the container has no size at
  // the moment Leaflet measures it, so invalidateSize() runs after the
  // first paint and whenever the container resizes (phone rotation, etc.).
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return undefined;
    const map = L.map(container).setView(initialPin ? [initialPin.latitude, initialPin.longitude] : CORRIDOR_CENTER, initialPin ? PINNED_ZOOM : CORRIDOR_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    for (const stop of otherStops) addStopMarker(map, stop, { variant: "faint", label: "hover" });

    map.on("click", (e) => placePin({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
    map.on("mousemove", (e) => setCursor({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
    map.on("mouseout", () => setCursor(null));
    mapRef.current = map;

    const timer = setTimeout(() => map.invalidateSize(), 0);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    resizeObserver?.observe(container);
    return () => {
      clearTimeout(timer);
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      pinMarkerRef.current = null;
    };
    // Built once per open dialog; the context stops don't change while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. The pin itself: created, moved, or removed as `pin` changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pin) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      return;
    }
    const latLng = [pin.latitude, pin.longitude];
    if (!pinMarkerRef.current) {
      const marker = L.marker(latLng, { draggable: true, autoPan: true, zIndexOffset: 1000 })
        .bindTooltip(route.destination, { direction: "top", offset: [-16, -8] }) // default icon anchors tooltips top-right; this centres it above the pin
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        placePin({ latitude: lat, longitude: lng });
      });
      pinMarkerRef.current = marker;
    } else {
      pinMarkerRef.current.setLatLng(latLng);
    }
    if (pin.focus) map.setView(latLng, Math.max(map.getZoom(), gpsFix ? GPS_ZOOM : PINNED_ZOOM));
  }, [pin, gpsFix, route.destination, placePin]);

  // ---- Checks shown before saving ---------------------------------------
  const outsideCorridor = pin && !isInCorridor(pin);
  const nearest = useMemo(() => {
    if (!pin) return null;
    let best = null;
    for (const s of otherStops) {
      const km = distanceKm(pin, s);
      if (km != null && (!best || km < best.km)) best = { stop: s, km };
    }
    return best;
  }, [pin, otherStops]);
  const tooClose = nearest && nearest.km * 1000 < TOO_CLOSE_M;
  const gpsImprecise = gpsFix && gpsFix.accuracy > GPS_WARN_ACCURACY_M;
  const unchanged = pin && initialPin && pin.latitude === initialPin.latitude && pin.longitude === initialPin.longitude;
  const typedInvalid =
    (latText.trim() !== "" && parseCoord(latText, -90, 90) == null) || (lngText.trim() !== "" && parseCoord(lngText, -180, 180) == null);

  async function handleSave() {
    if (!pin) return;
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.pinRoute(route.route_id, { latitude: pin.latitude, longitude: pin.longitude });
      onSaved(updated, "pinned");
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  }

  async function handleClear() {
    if (!window.confirm(`Remove the map pin for ${route.destination}? It will stop showing on the tracking maps.`)) return;
    setIsSaving(true);
    setError("");
    try {
      const updated = await api.pinRoute(route.route_id, { latitude: null, longitude: null });
      onSaved(updated, "cleared");
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  }

  const gpsMessage =
    wantGps && gpsStatus === "locating"
      ? "Getting your location…"
      : wantGps && gpsStatus === "denied"
        ? "Location is blocked for this site. Allow it in your browser's site settings, then try again."
        : wantGps && gpsStatus === "unavailable"
          ? "Couldn't get a GPS fix. Step outside or turn on GPS, and it'll pin as soon as one arrives."
          : wantGps && gpsStatus === "unsupported"
            ? "This browser can't share its location."
            : null;

  return (
    <Modal
      size="lg"
      title={`Pin bus stop · ${route.destination}`}
      onClose={isSaving ? undefined : onClose}
      footer={
        <>
          {initialPin && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isSaving}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 rounded disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" /> Clear pin
            </button>
          )}
          <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-gray-600 disabled:opacity-60">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !pin || unchanged || outsideCorridor || typedInvalid}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded"
          >
            {isSaving ? "Saving…" : "Save pin"}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        {route.origin} → {route.destination}
        {route.distance != null && ` · km ${route.distance}`}.{" "}
        <span className="inline-flex items-center gap-1 text-gray-500">
          <MousePointerClick className="w-3.5 h-3.5" /> Click the map to drop the pin, then drag it to fine-tune.
        </span>
      </p>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {/* isolate: keeps Leaflet's z-index 400+ panes inside the dialog */}
      <div className="relative isolate">
        <div ref={mapContainerRef} className="w-full h-72 sm:h-96 rounded-xl overflow-hidden border border-slate-200 cursor-crosshair" />
        <div className="absolute bottom-2 left-2 z-[500] rounded-md bg-white/90 px-2 py-1 text-[11px] font-mono text-gray-600 shadow-sm pointer-events-none">
          {cursor ? `${fmt7(cursor.latitude)}, ${fmt7(cursor.longitude)}` : pin ? `Pin ${fmt7(pin.latitude)}, ${fmt7(pin.longitude)}` : "No pin yet"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Latitude</span>
          <input
            inputMode="decimal"
            value={latText}
            onChange={(e) => handleTyped(e.target.value, lngText)}
            placeholder="e.g. 16.4592000"
            className="input font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Longitude</span>
          <input
            inputMode="decimal"
            value={lngText}
            onChange={(e) => handleTyped(latText, e.target.value)}
            placeholder="e.g. 120.5876000"
            className="input font-mono"
          />
        </label>
      </div>
      {typedInvalid && <p className="text-sm text-rose-600">Latitude must be between -90 and 90 and longitude between -180 and 180.</p>}

      <div className="space-y-2">
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={isSaving}
          className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold rounded-lg px-3 py-2 disabled:opacity-60"
        >
          <LocateFixed className="w-4 h-4 text-emerald-700" /> Use my current location
        </button>
        {gpsMessage && <p className="text-sm text-gray-600">{gpsMessage}</p>}
        {gpsFix && (
          <p className={`text-sm ${gpsImprecise ? "text-amber-700" : "text-emerald-700"}`}>
            Pinned from your GPS · accuracy ±{Math.round(gpsFix.accuracy)} m
            {gpsImprecise && " — that's rough. Drag the pin onto the exact spot, or wait a moment outdoors and tap again."}
          </p>
        )}
      </div>

      {outsideCorridor && (
        <p className="flex gap-2 text-sm rounded-lg bg-rose-50 text-rose-700 px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          This point is outside the Baguio–Bontoc area (lat {STOP_CORRIDOR_BOUNDS.minLat}–{STOP_CORRIDOR_BOUNDS.maxLat}, lng{" "}
          {STOP_CORRIDOR_BOUNDS.minLng}–{STOP_CORRIDOR_BOUNDS.maxLng}). Check for swapped latitude/longitude or a missing digit.
        </p>
      )}
      {!outsideCorridor && tooClose && (
        <p className="flex gap-2 text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Only {formatDistance(nearest.km)} from the pin for {nearest.stop.name}. Make sure you're not pinning the same stop twice.
        </p>
      )}
      {!outsideCorridor && !tooClose && nearest && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <MapPin className="w-3.5 h-3.5" /> Nearest other pinned stop: {nearest.stop.name}, {formatDistance(nearest.km)} away (straight line).
        </p>
      )}
    </Modal>
  );
}
