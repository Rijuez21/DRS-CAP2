import { useNavigate } from "react-router-dom";
import { Bus, Clock, MapPin } from "lucide-react";
import StatusBadge from "../common/StatusBadge";

export default function TripCard({ trip }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/passenger/trips/${trip.id}`)}
      className="w-full text-left rounded-2xl bg-white border border-slate-100 p-4 space-y-3 shadow-sm hover:border-brand-green-500/50 hover:shadow-md transition"
    >
      <div className="flex items-center gap-1.5 text-sm text-ink-600">
        <MapPin className="w-3.5 h-3.5 text-brand-green-600" />
        <span className="font-medium text-ink-900">{trip.origin}</span>
        <span>→</span>
        <span className="font-medium text-ink-900">{trip.destination}</span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-ink-600">Departs</p>
          <p className="font-display text-lg font-bold">{trip.departureTime}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-ink-600 pb-1">
          <Clock className="w-3.5 h-3.5" />
          {trip.duration}
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-600">Arrives</p>
          <p className="font-display text-lg font-bold">{trip.arrivalTime}</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <Bus className="w-4 h-4 text-brand-green-600" />
          {trip.busModel} · {trip.seatsAvailable} seats left
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={trip.status} />
          <span className="font-display font-bold text-brand-green-600">
            {trip.fare != null ? `₱${trip.fare}` : "—"}
          </span>
        </div>
      </div>
    </button>
  );
}
