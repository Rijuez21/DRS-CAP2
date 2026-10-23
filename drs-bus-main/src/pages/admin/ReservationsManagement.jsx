import { useEffect, useState } from "react";
import { Ticket, XCircle } from "lucide-react";
import * as api from "../../lib/api";
import DataTable from "../../components/common/DataTable";
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

  const columns = [
    {
      key: "passenger_name",
      header: "Passenger",
      truncate: true,
      render: (b) => (
        <span>
          <span className="block font-medium">{b.passenger_name}</span>
          <span className="block text-xs text-gray-500 font-mono">#{b.booking_id}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", type: "status", render: (b) => <StatusBadge status={b.status} /> },
    {
      key: "trip",
      header: "Trip",
      accessor: routeLabel,
      sortValue: (b) => b.departure_time,
      type: "date",
      render: (b) => (
        <div className="text-gray-600">
          <div className="truncate max-w-[16rem]" title={routeLabel(b)}>{routeLabel(b)}</div>
          <div className="text-xs text-gray-400 whitespace-nowrap">
            {formatDate(b.departure_time)} · {formatTime(b.departure_time)}
          </div>
        </div>
      ),
    },
    { key: "seat_number", header: "Seat", align: "right", render: (b) => <span className="text-gray-600 tabular-nums">{b.seat_number}</span> },
    { key: "channel", header: "Channel", accessor: (b) => CHANNEL_LABELS[b.channel] ?? b.channel, render: (b) => <span className="text-gray-600">{CHANNEL_LABELS[b.channel] ?? b.channel}</span> },
    { key: "booked_at", header: "Booked", type: "date", render: (b) => <span className="text-gray-600 text-xs whitespace-nowrap">{formatDateTime(b.booked_at) ?? "—"}</span> },
    {
      key: "actions",
      header: "",
      render: (b) =>
        b.status !== "Cancelled" && b.status !== "Boarded" && b.status !== "No-Show" ? (
          <OverflowMenu
            label={`More actions for booking #${b.booking_id}`}
            items={[{ label: "Cancel booking", icon: XCircle, tone: "danger", onClick: () => handleCancel(b) }]}
          />
        ) : null,
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Reservations" subtitle="Every booking across all channels. Newest first." />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <DataTable
        label="Bookings"
        state={table}
        columns={columns}
        rows={bookings}
        rowKey={(b) => b.booking_id}
        isLoading={isLoading}
        searchKeys={["passenger_name", routeLabel, "seat_number", "booking_id"]}
        searchPlaceholder="Search passenger, trip or seat…"
        filters={FILTERS}
        minWidth="56rem"
        emptyState={{ icon: Ticket, title: "No bookings yet" }}
        toolbar={bookings.length >= 500 && <span className="text-xs text-amber-700">Newest 500 shown — narrow by status or channel to see older ones.</span>}
      />
    </div>
  );
}
