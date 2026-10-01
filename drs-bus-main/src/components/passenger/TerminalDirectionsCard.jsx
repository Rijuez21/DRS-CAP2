import { useEffect, useRef } from "react";
import { Navigation, LocateFixed, ExternalLink } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import LocationPermissionCard from "../common/LocationPermissionCard";
import { useGeolocation } from "../../hooks/useGeolocation";
import { useRoadRoute } from "../../hooks/useRoadRoute";
import { addStopMarker } from "../../lib/stopMarkers";
import { formatDistance } from "../../lib/geo";
import { TERMINAL, terminalDirectionsUrl } from "../../lib/terminal";

const TERMINAL_ZOOM = 15;

// Home's "Getting to the terminal" card: the terminal is always on the map;
// once the passenger shares their location, a "You" dot and the road route
// between them are added. The route follows the passenger as they move
// (useRoadRoute only re-asks the router after ~100 m of movement).
export default function TerminalDirectionsCard() {
  const { status, position: me, request } = useGeolocation();
  const { route, status: routeStatus } = useRoadRoute(me, TERMINAL, "terminal");

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const meMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const framedRef = useRef(false);

  // Map + terminal marker, once.
  useEffect(() => {
    const map = L.map(mapContainerRef.current, { scrollWheelZoom: false }).setView(
      [TERMINAL.latitude, TERMINAL.longitude],
      TERMINAL_ZOOM
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    addStopMarker(map, TERMINAL, { variant: "highlight", label: "permanent", zIndexOffset: 500 });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      meMarkerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  // "You" dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      return;
    }
    const latLng = [me.latitude, me.longitude];
    if (!meMarkerRef.current) {
      meMarkerRef.current = L.circleMarker(latLng, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 })
        .bindTooltip("You")
        .addTo(map);
    } else {
      meMarkerRef.current.setLatLng(latLng);
    }
  }, [me]);

  // Route line. Framed once, when the first route arrives; after that the
  // passenger controls the map (the ⌖ button re-frames it).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeLayerRef.current?.remove();
    routeLayerRef.current = null;
    if (!route) return;
    // White casing under a coloured line, so the path reads on any map tile.
    const casing = L.polyline(route.path, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false });
    const line = L.polyline(route.path, {
      color: "#2f9e5c",
      weight: 5,
      opacity: 0.95,
      dashArray: route.isFallback ? "8 10" : null, // dashed = straight line, not a real road
      interactive: false,
    });
    routeLayerRef.current = L.layerGroup([casing, line]).addTo(map);
    if (!framedRef.current) {
      framedRef.current = true;
      frameBoth();
    }
    // frameBoth reads the latest route/me itself; only a new route redraws
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  function frameBoth() {
    const map = mapRef.current;
    if (!map) return;
    const points = route?.path?.length ? [...route.path] : [];
    points.push([TERMINAL.latitude, TERMINAL.longitude]);
    if (me) points.push([me.latitude, me.longitude]);
    if (points.length === 1) map.setView(points[0], TERMINAL_ZOOM);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }

  let summary;
  if (!me) summary = "Share your location to see the way there.";
  else if (routeStatus === "loading" && !route) summary = "Finding the road…";
  else if (route?.isFallback) summary = `${formatDistance(route.distanceKm)} away in a straight line (road route unavailable right now).`;
  else if (route) {
    const minutes = Math.max(1, Math.round(route.durationMin));
    summary = `${formatDistance(route.distanceKm)} by road · about ${minutes} min by car`;
  }

  return (
    <section aria-labelledby="terminal-directions-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="terminal-directions-heading" className="font-display font-semibold text-lg">
          Getting to the terminal
        </h2>
        <a
          href={terminalDirectionsUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-green-600 hover:underline"
        >
          Directions <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="card rounded-2xl overflow-hidden">
        <div className="relative">
          <div ref={mapContainerRef} className="h-64 lg:h-72 w-full z-0" role="img" aria-label={`Map showing ${TERMINAL.name}${me ? " and your location" : ""}`} />
          {me && (
            <button
              type="button"
              onClick={frameBoth}
              aria-label="Show me and the terminal"
              title="Show me and the terminal"
              className="absolute right-3 bottom-3 z-[400] w-9 h-9 rounded-full bg-white shadow-md flex items-center justify-center text-ink-600 hover:text-brand-green-600"
            >
              <LocateFixed className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-green-600/10 text-brand-green-600 flex items-center justify-center">
              <Navigation className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-sm">{TERMINAL.name}</p>
              <p className="text-xs text-ink-600">{summary ?? TERMINAL.address}</p>
            </div>
          </div>
          <LocationPermissionCard status={status} onRequest={request} compact reason="See the route from where you are to the terminal." />
        </div>
      </div>
    </section>
  );
}
