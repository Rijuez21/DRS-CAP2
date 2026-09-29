import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import * as api from "../../lib/api";
import { todayIsoDate } from "../../lib/format";

export default function TripSearchPanel({ onSearch }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [routes, setRoutes] = useState([]);

  useEffect(() => {
    api.getRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, []);

  const origins = useMemo(
    () => [...new Set(routes.map((r) => r.origin))].sort(),
    [routes]
  );
  // Only stops actually reachable from the chosen origin, in route order
  // (nearest first) — the unfiltered list mixed ~160 km-post stops from
  // every origin, most of which had no trip from where you are.
  const destinations = useMemo(() => {
    const seen = new Set();
    return routes
      .filter((r) => !origin || r.origin === origin)
      .sort((a, b) => Number(a.distance ?? 0) - Number(b.distance ?? 0))
      .filter((r) => (seen.has(r.destination) ? false : seen.add(r.destination)))
      .map((r) => r.destination);
  }, [routes, origin]);

  function handleSubmit(e) {
    e.preventDefault();
    onSearch?.({ origin, destination, date });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl bg-brand-forest-900 p-5 space-y-4 shadow-lg shadow-brand-forest-900/20 lg:sticky lg:top-6"
    >
      <Field label="From">
        <select
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value);
            setDestination("");
          }}
          className="w-full bg-brand-sunrise-400/90 text-ink-900 font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/60"
        >
          <option value="">Select origin</option>
          {origins.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>

      <Field label="To">
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="w-full bg-brand-sunrise-400/90 text-ink-900 font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/60"
        >
          <option value="">Select destination</option>
          {destinations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date">
        <input
          type="date"
          min={todayIsoDate()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-brand-sunrise-400/90 text-ink-900 font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/60"
        />
      </Field>

      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 bg-brand-green-600 hover:bg-brand-green-500 transition-colors text-white font-display font-semibold rounded-xl py-3"
      >
        <Search className="w-4 h-4" />
        Search Trips
      </button>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-white/60 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
