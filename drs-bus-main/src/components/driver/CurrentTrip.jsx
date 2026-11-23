import { Link } from "react-router-dom";
import { BusFront } from "lucide-react";
import StatusBadge from "../common/StatusBadge";
import { formatDate, formatTime } from "../../lib/format";

// The trip this page is about, as a plain card (no picker). Which trip:
// lib/currentTrip.js — one trip at a time, so there's nothing to choose.
export function CurrentTripCard({ trip }) {
  const upcoming = trip.status === "Scheduled";
  return (
    <section className="bg-white rounded-xl border px-4 py-3 flex items-center gap-3">
      <span className="w-10 h-10 shrink-0 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
        <BusFront className="w-5 h-5" aria-hidden="true" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{upcoming ? "Next trip" : "Current trip"}</p>
        <p className="font-bold truncate">
          {trip.origin} → {trip.destination}
        </p>
        <p className="text-sm text-gray-600">
          {formatDate(trip.departure_time)?.replace(/, \d{4}$/, "")} · {formatTime(trip.departure_time)} · {trip.bus_number ? `Bus ${trip.bus_number}` : trip.plate_num}
        </p>
      </div>
      <StatusBadge status={trip.status} />
    </section>
  );
}

// Nothing to show: no trip running and none scheduled.
export function NoTripCard({ loading }) {
  return (
    <section className="bg-white rounded-xl border p-4 text-sm text-gray-600 space-y-2">
      {loading ? (
        <p>Loading your trip…</p>
      ) : (
        <>
          <p className="font-semibold text-ink-900">No trip assigned right now.</p>
          <p>When the office puts you on a trip, it shows up here.</p>
          <Link to="/driver/dashboard" className="inline-block text-emerald-700 font-semibold underline">
            Go to My Trips
          </Link>
        </>
      )}
    </section>
  );
}
