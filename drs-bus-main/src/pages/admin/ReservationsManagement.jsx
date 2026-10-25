import { useEffect, useState } from "react";
import { Ticket, XCircle, Armchair, Bus } from "lucide-react";
import * as api from "../../lib/api";
import ListFrame from "../../components/common/ListFrame";
import SectionGroup from "../../components/common/SectionGroup";
import { groupBy } from "../../lib/groupBy";
import { SkeletonList } from "../../components/common/Skeletons";
import OverflowMenu from "../../components/common/OverflowMenu";
import PageHeading from "../../components/common/PageHeading";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import { useListState } from "../../hooks/useListState";
import { formatDate, formatDateTime, formatTime } from "../../lib/format";

const STATUS_OPTIONS = ["Reserved", "Confirmed", "Boarded", "Cancelled", "No-Show"];
const CHANNEL_OPTIONS = ["online", "walk_in", "flagged"]; // "flagged" = roadside hail a driver acknowledged (Flag a Bus mode)
const CHANNEL_LABELS = { online: "Online", walk_in: "Walk-in", flagged: "Flagged (roadside)" };

// Status and channel go to the server (it returns the newest 500 matching
// bookings), so they're serverSide: the table only holds their values.
const FILTERS = [
  { key: "status", label: "Status", allLabel: "All statuses", serverSide: true, options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })) },
  { key: "channel", label: "Channel", allLabel: "All channels", serverSide: true, options: CHANNEL_OPTIONS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] })) },
];
const SORT_FIELDS = [
  { key: "booked_at", label: "Booked", type: "date" },
  { key: "trip", label: "Trip departure", type: "date", sortValue: (b) => b.departure_time },
  { key: "passenger_name", label: "Passenger" },
  { key: "status", label: "Status", type: "status" },
  { key: "seat_number", label: "Seat", accessor: (b) => b.seat_number },
];
const routeLabel = (b) => `${b.origin} → ${b.destination}`;

// Table 4's Reservations Oversight: filterable, read-only except cancel.
export default function AdminReservationsManagement() {
  const table = useListState({ initialSort: { key: "booked_at", dir: "desc" }, filters: FILTERS, pageSize: 25, syncUrl: true });
  const { status, channel } = table.filters;
  const [bookings, setBookings] = useState([]);
  // Which filter combination the rows on screen came from; loading until it
  // matches the current one.
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const filterKey = `${status}|${channel}`;
  const isLoading = loadedKey !== filterKey;

  function load() {
    // No filters = every booking (newest 500). The old default silently
    // swapped "All statuses" for Reserved-only because the API used to
    // reject an unfiltered request.
    const params = { status: status || undefined, channel: channel || undefined };
    api
      .getBookings(params)
      .then((rows) => {
        setBookings(rows);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadedKey(filterKey));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [status, channel]);

  async function handleCancel(booking) {
    if (!window.confirm(`Cancel booking #${booking.booking_id} (${booking.passenger_name})?`)) return;
    try {
      await api.updateBookingStatus(booking.booking_id, "Cancelled");
      setSuccess(`Booking #${booking.booking_id} (${booking.passenger_name}, seat ${booking.seat_number}) was cancelled — the seat is free again.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Reservations" subtitle="Every booking across all channels, grouped by trip. Most recently booked trips first." />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <ListFrame
        state={table}
        rows={bookings}
        fields={SORT_FIELDS}
        isLoading={isLoading}
        paging="more"
        pageSize={30}
        searchKeys={["passenger_name", routeLabel, "seat_number", "booking_id"]}
        searchPlaceholder="Search passenger, trip or seat…"
        filters={FILTERS}
        skeleton={<SkeletonList count={4} />}
        emptyState={{ icon: Ticket, title: "No bookings yet" }}
        toolbar={bookings.length >= 500 && <span className="text-xs text-amber-700">Newest 500 shown — narrow by status or channel to see older ones.</span>}
      >
        {(pageRows) => (
          <div className="space-y-4">
            {groupBy(pageRows, (b) => b.trip_id).map(([tripId, items]) => {
              const t = items[0];
              const live = items.filter((b) => b.status !== "Cancelled" && b.status !== "No-Show").length;
              return (
                <SectionGroup
                  key={tripId}
                  id={`trip-${tripId}`}
                  icon={Bus}
                  title={routeLabel(t)}
                  subtitle={`${formatDate(t.departure_time)} · ${formatTime(t.departure_time)} · ${t.plate_num ?? "Bus"}`}
                  count={items.length}
                  countLabel={items.length === 1 ? "booking" : "bookings"}
                  aside={
                    <>
                      <span className="text-xs text-gray-500">{live} active</span>
                      <StatusBadge status={t.trip_status} />
                    </>
                  }
                >
                  <ul className="divide-y divide-slate-100">
                    {items.map((b) => {
                      const cancellable = b.status !== "Cancelled" && b.status !== "Boarded" && b.status !== "No-Show";
                      return (
                        <li key={b.booking_id} className={`flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-brand-green-500/5 ${b.status === "Cancelled" ? "opacity-60" : ""}`}>
                          <span className="inline-flex items-center gap-1.5 w-16 shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-sm font-semibold tabular-nums text-ink-900" title="Seat">
                            <Armchair className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
                            {b.seat_number}
                          </span>
                          <div className="min-w-[10rem] flex-1">
                            <p className="font-medium text-ink-900 truncate" title={b.passenger_name}>
                              {b.passenger_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              <span className="font-mono">#{b.booking_id}</span> · {CHANNEL_LABELS[b.channel] ?? b.channel} · booked {formatDateTime(b.booked_at) ?? "—"}
                            </p>
                          </div>
                          <div className="sm:w-32 flex sm:justify-end">
                            <StatusBadge status={b.status} />
                          </div>
                          <div className="w-9 shrink-0 flex justify-end">
                            {cancellable && (
                              <OverflowMenu
                                label={`More actions for booking #${b.booking_id}`}
                                items={[{ label: "Cancel booking", icon: XCircle, tone: "danger", onClick: () => handleCancel(b) }]}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </SectionGroup>
              );
            })}
          </div>
        )}
      </ListFrame>
    </div>
  );
}
