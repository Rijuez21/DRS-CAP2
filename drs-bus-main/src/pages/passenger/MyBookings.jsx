import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket } from "lucide-react";
import StatusBadge from "../../components/common/StatusBadge";
import EmptyState from "../../components/common/EmptyState";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatTime, formatDate } from "../../lib/format";

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
      .getBookings({ passengerId: user.id })
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

  const counts = bookings.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-md mx-auto lg:max-w-2xl px-4 py-6 space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold">My Bookings</h1>
        <p className="text-sm text-ink-600">
          {isLoading ? "Loading…" : `${bookings.length} total`}
          {!isLoading && bookings.length > 0 && (
            <>
              {" · "}
              {Object.entries(counts)
                .map(([status, n]) => `${n} ${status}`)
                .join(", ")}
            </>
          )}
        </p>
      </header>

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      {!isLoading && bookings.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="No bookings yet"
          description="Trips you reserve will show up here."
          action={
            <button
              type="button"
              onClick={() => navigate("/passenger/trips")}
              className="text-sm font-medium text-brand-green-600 hover:underline"
            >
              Browse trips
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <button
              key={b.booking_id}
              type="button"
              onClick={() => navigate(`/passenger/my-bookings/${b.booking_id}`)}
              className="w-full text-left rounded-2xl bg-white border border-slate-100 p-4 shadow-sm hover:border-brand-green-500/50 hover:shadow-md transition space-y-2"
            >
              <div className="flex items-center justify-between">
                <p className="font-display font-semibold">
                  {b.origin} → {b.destination}
                </p>
                <StatusBadge status={b.status} />
              </div>
              <div className="flex items-center justify-between text-sm text-ink-600">
                <span>
                  {formatDate(b.departure_time)} · {formatTime(b.departure_time)}
                </span>
                <span>Seat {b.seat_number}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
