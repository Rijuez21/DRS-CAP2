import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, ChevronRight, Clock, Armchair, Hand } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import PageHeader from "../../components/passenger/PageHeader";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatTime } from "../../lib/format";

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
    <div className="page-enter max-w-md mx-auto lg:max-w-2xl px-4 py-6 lg:py-10 space-y-6">
      <PageHeader
        icon={Ticket}
        title="My Bookings"
        subtitle={!isLoading && bookings.length > 0 ? `${upcoming.length} upcoming · ${past.length} past` : "Your reserved seats and flagged rides"}
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
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
              className="mt-2 bg-brand-green-600 hover:bg-brand-green-500 text-white text-sm font-semibold rounded-xl px-4 py-2.5 shadow-md shadow-brand-green-600/25 transition-colors"
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
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-600">
        {title}
        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] text-ink-600">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-600 rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-center">{empty}</p>
      ) : (
        rows.map((b) => {
          const d = b.departure_time ? new Date(b.departure_time) : null;
          return (
            <button
              key={b.booking_id}
              type="button"
              onClick={() => onOpen(b.booking_id)}
              className={`group card card-interactive w-full text-left rounded-2xl p-3 pr-4 flex items-center gap-4 ${muted ? "opacity-70 hover:opacity-100" : ""}`}
            >
              {/* calendar-leaf date block */}
              <div
                className={`w-14 shrink-0 self-stretch rounded-xl flex flex-col items-center justify-center py-2 ${
                  muted ? "bg-slate-100 text-ink-600" : "bg-brand-forest-900 text-white"
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${muted ? "" : "text-brand-sunrise-400"}`}>
                  {d ? d.toLocaleDateString("en-PH", { month: "short" }) : "—"}
                </span>
                <span className="font-display text-xl font-bold leading-none mt-0.5">{d ? d.getDate() : ""}</span>
                <span className="text-[10px] opacity-70 mt-0.5">{d ? d.toLocaleDateString("en-PH", { weekday: "short" }) : ""}</span>
              </div>

              <div className="flex-1 min-w-0 space-y-1 py-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display font-semibold truncate">
                    {b.origin} → {b.destination}
                  </p>
                  <StatusBadge status={b.status} />
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-600">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> {formatTime(b.departure_time)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Armchair className="w-3.5 h-3.5" /> Seat {b.seat_number}
                  </span>
                  {b.channel === "flagged" && (
                    <span className="inline-flex items-center gap-1">
                      <Hand className="w-3.5 h-3.5" /> Flagged on the road
                    </span>
                  )}
                </p>
                {hintFor(b) && <p className={`text-xs ${b.trip_status === "Cancelled" ? "text-rose-600 font-medium" : "text-ink-600"}`}>{hintFor(b)}</p>}
              </div>
              <ChevronRight className="w-4 h-4 text-ink-600 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })
      )}
    </section>
  );
}
