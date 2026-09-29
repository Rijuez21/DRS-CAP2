import { useNavigate } from "react-router-dom";
import { MapPin, Clock, Bus } from "lucide-react";
import StatusBadge from "../common/StatusBadge";
import { formatDate } from "../../lib/format";

export default function TripCard({ trip }) {
  const navigate = useNavigate();
  const soldOut = trip.seatsAvailable === 0;

  return (
    <button
      type="button"
      onClick={() => navigate(`/passenger/trips/${trip.id}`)}
      disabled={soldOut}
      aria-label={`${trip.origin} to ${trip.destination}, departs ${trip.departureTime}${soldOut ? ", sold out" : ""}`}
      className="w-full text-left rounded-2xl bg-white border border-slate-100 p-4 space-y-3 shadow-sm hover:border-brand-green-500/50 hover:shadow-md transition disabled:opacity-60 disabled:hover:shadow-sm disabled:hover:border-slate-100 disabled:cursor-not-allowed"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-ink-600 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-brand-green-600 shrink-0" />
          <span className="font-medium text-ink-900 truncate">{trip.origin}</span>
          <span>→</span>
          <span className="font-medium text-ink-900 truncate">{trip.destination}</span>
        </div>
        {trip.status === "Boarding" && <StatusBadge status="Boarding" />}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-ink-600">{formatDate(trip.departureIso)?.replace(/, \d{4}$/, "")}</p>
          <p className="font-display text-lg font-bold">{trip.departureTime}</p>
        </div>
        {trip.duration && (
          <div className="flex items-center gap-1 text-xs text-ink-600 pb-1">
            <Clock className="w-3.5 h-3.5" />
            {trip.duration}
          </div>
        )}
        <div className="text-right">
          <p className="text-xs text-ink-600">Arrives</p>
          <p className="font-display text-lg font-bold">{trip.arrivalTime ?? "—"}</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <Bus className="w-4 h-4 text-brand-green-600" />
          {trip.busModel ?? "Bus"}
          {trip.seatsAvailable != null && (
            <span className={soldOut ? "font-semibold text-rose-600" : trip.seatsAvailable <= 5 ? "font-semibold text-brand-sunrise-500" : ""}>
              · {soldOut ? "Sold out" : `${trip.seatsAvailable} seat${trip.seatsAvailable === 1 ? "" : "s"} left`}
            </span>
          )}
        </div>
        <span className="font-display font-bold text-brand-green-600">{trip.fare != null ? `₱${trip.fare}` : "—"}</span>
      </div>
    </button>
  );
}
