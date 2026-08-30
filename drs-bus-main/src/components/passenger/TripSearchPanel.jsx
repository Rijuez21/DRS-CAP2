import { useState } from "react";
import { Search } from "lucide-react";

export default function TripSearchPanel({ onSearch }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");

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
          onChange={(e) => setOrigin(e.target.value)}
          className="w-full bg-brand-sunrise-400/90 text-ink-900 font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/60"
        >
          <option value="">Select origin</option>
          {/* TODO: populate from GET /api/terminals once the backend is connected */}
        </select>
      </Field>

      <Field label="To">
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="w-full bg-brand-sunrise-400/90 text-ink-900 font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/60"
        >
          <option value="">Select destination</option>
          {/* TODO: populate from GET /api/terminals once the backend is connected */}
        </select>
      </Field>

      <Field label="Date">
        <input
          type="date"
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
