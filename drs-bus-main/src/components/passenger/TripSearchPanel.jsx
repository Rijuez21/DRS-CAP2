import { useEffect, useMemo, useState } from "react";
import { Search, CircleDot, MapPin, CalendarDays, ChevronDown } from "lucide-react";
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
      className="hero-forest rounded-3xl p-5 space-y-4 shadow-xl shadow-brand-forest-900/25 lg:sticky lg:top-6"
    >
      <div>
        <p className="font-display font-semibold text-lg">Find a trip</p>
        <p className="text-xs text-white/60">Scheduled departures from the terminal</p>
      </div>

      <Field label="From" icon={CircleDot}>
        <select
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value);
            setDestination("");
          }}
          className={`${fieldClass} appearance-none`}
        >
          <option value="">Select origin</option>
          {origins.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-600 pointer-events-none" />
      </Field>

      <Field label="To" icon={MapPin}>
        <select value={destination} onChange={(e) => setDestination(e.target.value)} className={`${fieldClass} appearance-none`}>
          <option value="">Select destination</option>
          {destinations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-600 pointer-events-none" />
      </Field>

      <Field label="Date" icon={CalendarDays}>
        <input type="date" min={todayIsoDate()} value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
      </Field>

      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 bg-brand-sunrise-500 hover:bg-brand-sunrise-400 active:scale-[0.99] transition text-brand-forest-950 font-display font-semibold rounded-xl py-3 shadow-lg shadow-black/20"
      >
        <Search className="w-4 h-4" />
        Search Trips
      </button>
    </form>
  );
}

const fieldClass =
  "w-full bg-white text-ink-900 font-medium rounded-xl pl-10 pr-9 py-3 outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-brand-sunrise-400";

// The label names the field for screen readers; visually it's the small
// caption above, with the icon sitting inside the input.
function Field({ label, icon: Icon, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-1.5">{label}</span>
      <span className="relative block">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-green-600 pointer-events-none z-10" />
        {children}
      </span>
    </label>
  );
}
