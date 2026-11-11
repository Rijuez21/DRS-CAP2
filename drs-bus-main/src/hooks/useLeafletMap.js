import { useCallback, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { keepMapSized } from "../lib/leafletAutoResize";

// Returns [ref for the map's <div>, the Leaflet map once created]. A ref
// callback (with React 19 cleanup) creates/destroys the map with the div.
export function useLeafletMap() {
  const [map, setMap] = useState(null);
  const containerRef = useCallback((node) => {
    if (!node) return undefined;
    const m = L.map(node).setView([16.4023, 120.596], 13); // Baguio until the tracker reports
    const stopSizing = keepMapSized(m);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(m);
    setMap(m);
    return () => {
      stopSizing();
      m.remove();
      setMap(null);
    };
  }, []);
  return [containerRef, map];
}
