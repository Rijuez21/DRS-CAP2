import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CircleDot, MapPin, Search, Wallet } from "lucide-react";
import { todayIsoDate } from "../../lib/format";

// The landing page's trip search. It sends people to the passenger trip
// list (/passenger/trips?origin=…&destination=…&date=…); anyone not signed
// in is asked to sign in first and then lands on their results.
// `routes` comes from the public GET /api/routes (loaded by LandingPage).
const FIELD =
  "w-full min-w-0 appearance-none bg-white border border-slate-300 rounded-xl pl-10 pr-3 py-3 text-[15px] text-ink-900 outline-none hover:border-slate-400 focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/25";

export default function LandingSearch({ routes }) {
  const navigate = useNavigate();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");

  const origins = useMemo(() => [...new Set(routes.map((r) => r.origin))].sort(), [routes]);
  // Stops reachable from the chosen origin, nearest first (same as the passenger app).
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
    const params = new URLSearchParams();
    if (origin) params.set("origin", origin);
    if (destination) params.set("destination", destination);
    if (date) params.set("date", date);
    const qs = params.toString();
    navigate(`/passenger/trips${qs ? `?${qs}` : ""}`);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-brand-forest-900/10 shadow-[0_30px_60px_-30px_rgb(18_39_27/0.35)] p-5 sm:p-6 space-y-3" aria-label="Find a trip">
      <p className="font-display font-semibold text-lg text-brand-forest-900">Where are you headed?</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" icon={CircleDot}>
          <select
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setDestination("");
            }}
            className={FIELD}
          >
            <option value="">Any origin</option>
            {origins.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To" icon={MapPin}>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className={FIELD}>
            <option value="">Any stop</option>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Travel date" icon={CalendarDays}>
        <input type="date" min={todayIsoDate()} value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
      </Field>

      <button
        type="submit"
        className="w-full inline-flex items-center justify-center gap-2 min-h-12 rounded-xl bg-brand-sunrise-500 hover:bg-brand-sunrise-400 text-brand-forest-950 font-display font-semibold"
      >
        <Search className="w-4 h-4" aria-hidden="true" /> Find trips
      </button>

      <p className="flex gap-2.5 rounded-xl bg-brand-green-500/10 px-3.5 py-3 text-sm text-brand-forest-900">
        <Wallet className="w-4 h-4 mt-0.5 shrink-0 text-brand-green-600" aria-hidden="true" />
        <span>
          Your seat is reserved online. You pay at the terminal or when you board, in cash or by e-wallet.
        </span>
      </p>
    </form>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="block min-w-0">
      <span className="block text-sm font-medium text-ink-600 mb-1">{label}</span>
      <span className="relative block">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-green-600 pointer-events-none" aria-hidden="true" />
        {children}
      </span>
    </label>
  );
}
