import { useEffect, useState } from "react";
import { CalendarClock, Plus, Pencil, XCircle, Bus, UserRound } from "lucide-react";
import * as api from "../../lib/api";
import ListFrame from "../../components/common/ListFrame";
import { SkeletonList } from "../../components/common/Skeletons";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import PageHeading from "../../components/common/PageHeading";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import SectionGroup from "../../components/common/SectionGroup";
import { useAuth } from "../../context/AuthContext";
import { formatDate, formatTime } from "../../lib/format";

const emptyForm = { busId: "", driverId: "", routeId: "", departureTime: "", arrivalTime: "" };
const UPCOMING_STATUSES = ["Scheduled", "Boarding", "In Transit"];
const ALL_STATUSES = [...UPCOMING_STATUSES, "Completed", "Cancelled"];
const routeLabel = (t) => `${t.origin} → ${t.destination}`;
const SORT_FIELDS = [
  { key: "departure_time", label: "Departure", type: "date" },
  { key: "booked_count", label: "Seats booked", type: "number", sortValue: (t) => Number(t.booked_count ?? 0) },
  { key: "route", label: "Route", accessor: routeLabel },
  { key: "status", label: "Status", type: "status" },
];

// Local calendar day of a timestamp, e.g. "2026-10-23".
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const RELATIVE_DAYS = ["Today", "Tomorrow", "Yesterday"];
function dayLabel(key) {
  const today = new Date();
  const offset = (n) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  if (key === offset(0)) return "Today";
  if (key === offset(1)) return "Tomorrow";
  if (key === offset(-1)) return "Yesterday";
  return formatDate(`${key}T00:00:00`);
}

// Agenda: the (already sorted) trips grouped by departure day. Days run in
// date order — newest first only when sorting by departure, newest first —
// and each day keeps the chosen sort inside it.
function groupByDay(trips, state) {
  const groups = new Map();
  for (const t of trips) {
    const k = dayKey(t.departure_time);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const desc = state.sortKey === "departure_time" && state.sortDir === "desc";
  return [...groups.entries()].sort(([a], [b]) => (desc ? b.localeCompare(a) : a.localeCompare(b)));
}

// <input type="datetime-local"> gives "2026-09-12T14:30"; MySQL's DATETIME
// column wants "2026-09-12 14:30:00" — mysql2 sends whatever string we
// hand it straight through as a bound parameter, so this has to happen
// client-side rather than relying on an implicit server-side cast.
// DATETIME from the API (ISO) -> the value a datetime-local input expects,
// in the admin's own (Philippine) time.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toMysqlDatetime(localValue) {
  if (!localValue) return localValue;
  return `${localValue.replace("T", " ")}:00`;
}

// Table 4's Trip Scheduling: assign bus + driver + route + times, with
// server-side overlap-conflict prevention surfaced right in the form.
// Shared by admin (/admin/trips) and terminal staff (/staff/trips): staff
// can add and edit Scheduled trips; cancelling a trip stays admin-only
// (it cancels every booking on it), so staff don't see that button.
export default function AdminTripScheduling() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const accent = isAdmin
    ? "bg-emerald-700 hover:bg-emerald-600"
    : "bg-amber-700 hover:bg-amber-600";
  const [trips, setTrips] = useState([]);
  const [buses, setBuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = scheduling a new trip
  const [showPast, setShowPast] = useState(false);
  const [busyTripId, setBusyTripId] = useState(null);

  function load() {
    Promise.all([api.getTrips(), api.getBuses(), api.getDrivers(), api.getAdminRoutes()])
      .then(([t, b, d, r]) => { setTrips(t); setBuses(b); setDrivers(d); setRoutes(r.filter((rt) => rt.is_active)); })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function openEdit(t) {
    setEditingId(t.trip_id);
    setForm({
      busId: String(t.bus_id),
      driverId: String(t.driver_id),
      routeId: String(t.route_id ?? ""),
      departureTime: toLocalInput(t.departure_time),
      arrivalTime: toLocalInput(t.arrival_time),
    });
    setFormError("");
    setShowForm(true);
  }

  // Cancelling also cancels every open booking on the trip (server side)
  // and notifies those passengers — the confirm says so.
  async function handleCancelTrip(t) {
    const booked = Number(t.booked_count ?? 0);
    const msg = `Cancel ${t.origin} → ${t.destination} on ${formatDate(t.departure_time)} ${formatTime(t.departure_time)}?` +
      (booked > 0 ? `\n\n${booked} booked passenger${booked === 1 ? "" : "s"} will have their booking cancelled and be notified.` : "");
    if (!window.confirm(msg)) return;
    setBusyTripId(t.trip_id);
    setError("");
    try {
      await api.updateTripStatus(t.trip_id, "Cancelled");
      setSuccess(booked > 0 ? `Trip cancelled. ${booked} passenger${booked === 1 ? " was" : "s were"} notified.` : "Trip cancelled.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTripId(null);
    }
  }

  const visibleTrips = showPast ? trips : trips.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  // New trips can only use buses and drivers that are actually available.
  const selectableBuses = buses.filter((b) => b.status === "Active" || String(b.bus_id) === form.busId);
  const selectableDrivers = drivers.filter((d) => (d.duty_status ?? "Active") === "Active" || String(d.driver_id) === form.driverId);
  // Past dates/times are greyed out in the pickers. When editing, the trip's
  // own (unchanged) departure stays allowed even if it has already passed,
  // so its other details can still be fixed.
  const nowInput = toLocalInput(new Date());
  const originalDeparture = editingId ? toLocalInput(trips.find((t) => t.trip_id === editingId)?.departure_time) : "";
  const minDeparture = originalDeparture && originalDeparture < nowInput ? originalDeparture : nowInput;
  const minArrival = form.departureTime && form.departureTime > minDeparture ? form.departureTime : minDeparture;

  async function handleSchedule(e) {
    e.preventDefault();
    if (!form.busId || !form.driverId || !form.routeId || !form.departureTime || !form.arrivalTime) {
      setFormError("All fields are required.");
      return;
    }
    if (new Date(form.arrivalTime) <= new Date(form.departureTime)) {
      setFormError("Arrival must be after departure.");
      return;
    }
    if (form.departureTime !== originalDeparture && form.departureTime < toLocalInput(new Date())) {
      setFormError("Departure can't be in the past.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    try {
      const payload = { ...form, departureTime: toMysqlDatetime(form.departureTime), arrivalTime: toMysqlDatetime(form.arrivalTime) };
      if (editingId) {
        await api.updateTrip(editingId, payload);
        setSuccess("Trip updated. Booked passengers were notified of any time change.");
      } else {
        await api.createTrip(payload);
        setSuccess("Trip scheduled. It's now open for booking.");
      }
      setEditingId(null);
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setFormError(err.message); // surfaces the 409 conflict message from the backend directly
    } finally {
      setIsSaving(false);
    }
  }

  const statusFilters = [
    {
      key: "status",
      label: "Status",
      allLabel: "All statuses",
      options: (showPast ? ALL_STATUSES : UPCOMING_STATUSES).map((v) => ({ value: v, label: v })),
    },
  ];

  function tripActions(t) {
    const canCancel = isAdmin && (t.status === "Scheduled" || t.status === "Boarding");
    return (
      <>
        {t.status === "Scheduled" && (
          <TextAction onClick={() => openEdit(t)}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
          </TextAction>
        )}
        {canCancel && (
          <OverflowMenu
            label={`More actions for ${routeLabel(t)} at ${formatTime(t.departure_time)}`}
            items={[{ label: busyTripId === t.trip_id ? "Cancelling…" : "Cancel trip", icon: XCircle, tone: "danger", disabled: busyTripId === t.trip_id, onClick: () => handleCancelTrip(t) }]}
          />
        )}
      </>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="Trips"
        subtitle={isAdmin ? "Assign a bus, driver, and route to a departure time." : "Add a departure: pick the route, bus, driver, and times. New trips open for booking right away."}
        actions={
          <PrimaryButton
            icon={Plus}
            className={accent}
            onClick={() => { setEditingId(null); setForm(emptyForm); setFormError(""); setShowForm(true); }}
          >
            {isAdmin ? "Schedule Trip" : "Add Schedule"}
          </PrimaryButton>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <ListFrame
        rows={visibleTrips}
        fields={SORT_FIELDS}
        isLoading={isLoading}
        syncUrl
        initialSort={{ key: "departure_time", dir: "asc" }}
        pageSize={25}
        paging="pages"
        searchKeys={[routeLabel, "plate_num", "bus_number", "driver_name"]}
        searchPlaceholder="Search route, bus or driver…"
        filters={statusFilters}
        skeleton={<SkeletonList count={5} />}
        emptyState={{ icon: CalendarClock, title: "No trips scheduled", description: "Schedule a trip to get started." }}
        toolbar={
          <label className="flex items-center gap-2 min-h-11 md:min-h-10 text-sm text-gray-600">
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} className="w-4 h-4" /> Show completed and cancelled
          </label>
        }
      >
        {(pageRows, { state }) => (
          <div className="space-y-5">
            {groupByDay(pageRows, state).map(([day, trips]) => (
              <SectionGroup
                key={day}
                id={`day-${day}`}
                icon={CalendarClock}
                title={dayLabel(day)}
                subtitle={RELATIVE_DAYS.includes(dayLabel(day)) ? formatDate(`${day}T00:00:00`) : undefined}
                count={trips.length}
                countLabel={trips.length === 1 ? "trip" : "trips"}
              >
                <ul className="divide-y divide-slate-100">
                  {trips.map((t) => {
                    const booked = Number(t.booked_count ?? 0);
                    const full = t.capacity != null && booked >= t.capacity;
                    const done = t.status === "Completed" || t.status === "Cancelled";
                    return (
                      <li key={t.trip_id} className={`flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-brand-green-500/5 ${done ? "opacity-70" : ""}`}>
                        <div className="w-20 shrink-0">
                          <p className="font-display text-lg font-bold tabular-nums text-ink-900 leading-tight">{formatTime(t.departure_time)}</p>
                          {t.arrival_time && <p className="text-xs text-gray-500">arr. {formatTime(t.arrival_time)}</p>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink-900 truncate" title={routeLabel(t)}>
                              {routeLabel(t)}
                            </span>
                            <StatusBadge status={t.status} />
                            {full && !done && <StatusBadge status="Full" />}
                          </p>
                          <p className="text-sm text-gray-600 flex flex-wrap gap-x-3">
                            <span className="inline-flex items-center gap-1">
                              <Bus className="w-3.5 h-3.5" aria-hidden="true" /> {t.plate_num}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <UserRound className="w-3.5 h-3.5" aria-hidden="true" /> {t.driver_name}
                            </span>
                          </p>
                        </div>
                        <div className="text-right tabular-nums shrink-0 w-20">
                          <p className="text-sm font-semibold text-ink-900">
                            {booked}/{t.capacity ?? "?"}
                          </p>
                          <p className="text-xs text-gray-500">seats booked</p>
                        </div>
                        <div className="flex items-center justify-end gap-1 shrink-0 ml-auto sm:ml-0 sm:w-36">{tripActions(t)}</div>
                      </li>
                    );
                  })}
                </ul>
              </SectionGroup>
            ))}
          </div>
        )}
      </ListFrame>

      {showForm && (
        <Modal
          title={editingId ? "Edit Trip" : isAdmin ? "Schedule Trip" : "Add Schedule"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <CancelButton onClick={() => setShowForm(false)} />
              <SubmitButton form="trip-form" isSaving={isSaving} savingLabel="Checking availability…" className={accent}>
                {editingId ? "Save changes" : "Schedule"}
              </SubmitButton>
            </>
          }
        >
          <form id="trip-form" onSubmit={handleSchedule} className="space-y-3">
            <InlineAlert type="error" message={formError} onDismiss={() => setFormError("")} />
            <Field label="Route">
              <select required value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })} className="input">
                <option value="">Select a route…</option>
                {routes.map((r) => <option key={r.route_id} value={r.route_id}>{r.origin} → {r.destination}</option>)}
              </select>
            </Field>
            <Field label="Bus">
              <select required value={form.busId} onChange={(e) => setForm({ ...form, busId: e.target.value })} className="input">
                <option value="">Select a bus…</option>
                {selectableBuses.map((b) => <option key={b.bus_id} value={b.bus_id}>{b.plate_num} ({b.capacity ?? "?"} seats)</option>)}
              </select>
            </Field>
            <Field label="Driver">
              <select required value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} className="input">
                <option value="">Select a driver…</option>
                {selectableDrivers.map((d) => <option key={d.driver_id} value={d.driver_id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Departure Time"><input required type="datetime-local" min={minDeparture} value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} className="input" /></Field>
            <Field label="Arrival Time"><input required type="datetime-local" min={minArrival} value={form.arrivalTime} onChange={(e) => setForm({ ...form, arrivalTime: e.target.value })} className="input" /></Field>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</span>
      {children}
    </label>
  );
}
