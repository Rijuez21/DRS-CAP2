import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, ChevronRight } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

// A booking is "upcoming" while it still means a ride: it holds a seat and
// its trip hasn't finished or been called off. Everything else is history.
function isUpcoming(b) {
  return ["Reserved", "Confirmed", "Boarded"].includes(b.status) && !["Completed", "Cancelled"].includes(b.trip_status);
}

// One short, plain sentence per state — what this means for the passenger.
function hintFor(b) {
  if (b.trip_status === "Cancelled") return "This trip was cancelled";
  if (b.status === "Reserved") return "Pay online or at the terminal to confirm";
  if (b.status === "Confirmed") return b.trip_status === "Boarding" ? "Boarding now" : "Confirmed — see you on board";
  if (b.status === "Boarded") return b.trip_status === "In Transit" ? "On the road" : "Checked in";
  if (b.status === "No-Show") return "Marked as not boarded";
  return null;
}

export default function MyBookings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .getBookings()
      .then((rows) => {
        if (!cancelled) setBookings(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const upcoming = bookings.filter(isUpcoming).sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
  const past = bookings.filter((b) => !isUpcoming(b));

  return (
    <div className="max-w-md mx-auto lg:max-w-2xl px-4 py-6 space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold">My Bookings</h1>
        {!isLoading && bookings.length > 0 && (
          <p className="text-sm text-ink-600">
            {upcoming.length} upcoming · {past.length} past
          </p>
        )}
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : bookings.length === 0 && !error ? (
        <EmptyState
          icon={Ticket}
          title="No bookings yet"
          description="Seats you reserve, and buses you flag, show up here."
          action={
            <button
              type="button"
              onClick={() => navigate("/passenger/trips")}
              className="bg-brand-green-600 hover:bg-brand-green-500 text-white text-sm font-semibold rounded-xl px-4 py-2.5"
            >
              Book a seat
            </button>
          }
        />
      ) : (
        <>
          <Section title="Upcoming" rows={upcoming} empty="No upcoming trips." onOpen={(id) => navigate(`/passenger/my-bookings/${id}`)} />
          {past.length > 0 && <Section title="Past & cancelled" rows={past} muted onOpen={(id) => navigate(`/passenger/my-bookings/${id}`)} />}
        </>
      )}
    </div>
  );
}

function Section({ title, rows, empty, muted = false, onOpen }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-600">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-600">{empty}</p>
      ) : (
        rows.map((b) => (
          <button
            key={b.booking_id}
            type="button"
            onClick={() => onOpen(b.booking_id)}
            className={`w-full text-left rounded-2xl bg-white border border-slate-100 p-4 shadow-sm hover:border-brand-green-500/50 transition flex items-center gap-3 ${muted ? "opacity-75" : ""}`}
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display font-semibold truncate">
                  {b.origin} → {b.destination}
                </p>
                <StatusBadge status={b.status} />
              </div>
              <p className="text-sm text-ink-600">
                {formatDate(b.departure_time)?.replace(/, \d{4}$/, "")} · {formatTime(b.departure_time)} · Seat {b.seat_number}
                {b.channel === "flagged" && " · Flagged on the road"}
              </p>
              {hintFor(b) && <p className={`text-xs ${b.trip_status === "Cancelled" ? "text-rose-600 font-medium" : "text-ink-600"}`}>{hintFor(b)}</p>}
            </div>
            <ChevronRight className="w-4 h-4 text-ink-600 shrink-0" />
          </button>
        ))
      )}
    </section>
  );
}
