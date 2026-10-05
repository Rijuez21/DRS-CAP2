import { useNavigate } from "react-router-dom";
import { Bus, Armchair, ArrowRight } from "lucide-react";
import StatusBadge from "../common/StatusBadge";
import { formatDate } from "../../lib/format";

export default function TripCard({ trip }) {
  const navigate = useNavigate();
  const soldOut = trip.seatsAvailable === 0;
  const fewLeft = !soldOut && trip.seatsAvailable != null && trip.seatsAvailable <= 5;

  return (
    <button
      type="button"
      onClick={() => navigate(`/passenger/trips/${trip.id}`)}
      disabled={soldOut}
      aria-label={`${trip.origin} to ${trip.destination}, departs ${trip.departureTime}${soldOut ? ", sold out" : ""}`}
      className="group card card-interactive w-full text-left rounded-2xl overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-600">{formatDate(trip.departureIso)?.replace(/, \d{4}$/, "")}</p>
          {trip.status === "Boarding" && <StatusBadge status="Boarding" />}
        </div>

        {/* departure ── bus · duration ── arrival */}
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="font-display text-xl font-bold leading-tight">{trip.departureTime}</p>
            <p className="text-sm text-ink-600 truncate">{trip.origin}</p>
          </div>
          <div className="flex-1 min-w-12 flex flex-col items-center gap-1 px-1" aria-hidden="true">
            <span className="text-[11px] font-medium text-ink-600 whitespace-nowrap">{trip.duration ?? " "}</span>
            <span className="relative w-full flex items-center">
              <span className="w-2 h-2 rounded-full border-2 border-brand-green-600 bg-white shrink-0" />
              <span className="flex-1 border-t-2 border-dashed border-slate-200" />
              <span className="w-7 h-7 rounded-full bg-brand-forest-900 flex items-center justify-center shrink-0">
                <Bus className="w-3.5 h-3.5 text-brand-sunrise-400" />
              </span>
              <span className="flex-1 border-t-2 border-dashed border-slate-200" />
              <span className="w-2 h-2 rounded-full bg-brand-sunrise-500 shrink-0" />
            </span>
          </div>
          <div className="min-w-0 text-right">
            <p className="font-display text-xl font-bold leading-tight">{trip.arrivalTime ?? "—"}</p>
            <p className="text-sm text-ink-600 truncate">{trip.destination}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50/80 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-ink-600 min-w-0">
          <span className="truncate">{trip.busModel ?? "Bus"}</span>
          {trip.seatsAvailable != null && (
            <span
              className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                soldOut ? "bg-rose-500/10 text-rose-600" : fewLeft ? "bg-brand-sunrise-500/15 text-amber-700" : "bg-brand-green-500/12 text-brand-green-600"
              }`}
            >
              <Armchair className="w-3 h-3" />
              {soldOut ? "Sold out" : `${trip.seatsAvailable} left`}
            </span>
          )}
        </div>
        <span className="flex items-center gap-2 shrink-0">
          <span className="font-display text-lg font-bold text-brand-green-600">{trip.fare != null ? `₱${trip.fare}` : "—"}</span>
          {!soldOut && (
            <span className="w-7 h-7 rounded-full bg-brand-green-600 text-white flex items-center justify-center transition-transform group-hover:translate-x-0.5" aria-hidden="true">
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
