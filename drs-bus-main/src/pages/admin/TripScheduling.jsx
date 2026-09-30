import { useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { useAuth } from "../../context/AuthContext";
import { formatDate, formatTime } from "../../lib/format";

const emptyForm = { busId: "", driverId: "", routeId: "", departureTime: "", arrivalTime: "" };

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

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Trip Scheduling</h1>
          <p className="text-sm text-gray-500">
            {isAdmin ? "Assign a bus, driver, and route to a departure time." : "Add a departure: pick the route, bus, driver, and times. New trips open for booking right away."}
          </p>
        </div>
        <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); setFormError(""); setShowForm(true); }} className={`flex items-center gap-1.5 ${accent} text-white text-sm font-semibold px-3 py-2 rounded shrink-0`}>
          <Plus className="w-4 h-4" /> {isAdmin ? "Schedule Trip" : "Add Schedule"}
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show completed and cancelled trips
        </label>
      )}
      {isLoading ? null : visibleTrips.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No trips scheduled" description="Schedule a trip to get started." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Bus</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Booked</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleTrips.map((t) => (
                <tr key={t.trip_id}>
                  <td className="px-4 py-3 font-medium">{t.origin} → {t.destination}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(t.departure_time)} · {formatTime(t.departure_time)}</td>
                  <td className="px-4 py-3 text-gray-600">{t.plate_num}</td>
                  <td className="px-4 py-3 text-gray-600">{t.driver_name}</td>
                  <td className="px-4 py-3 text-gray-600">{t.booked_count ?? 0}/{t.capacity ?? "?"}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                    {t.status === "Scheduled" && (
                      <button type="button" onClick={() => openEdit(t)} className="text-xs font-semibold text-emerald-700 hover:underline">Edit</button>
                    )}
                    {isAdmin && (t.status === "Scheduled" || t.status === "Boarding") && (
                      <button type="button" onClick={() => handleCancelTrip(t)} disabled={busyTripId === t.trip_id} className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">
                        {busyTripId === t.trip_id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal
          title={editingId ? "Edit Trip" : isAdmin ? "Schedule Trip" : "Add Schedule"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" form="trip-form" disabled={isSaving} className={`px-4 py-2 text-sm font-semibold text-white ${accent} disabled:opacity-60 rounded`}>
                {isSaving ? "Checking availability…" : editingId ? "Save changes" : "Schedule"}
              </button>
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
            <Field label="Departure Time"><input required type="datetime-local" value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} className="input" /></Field>
            <Field label="Arrival Time"><input required type="datetime-local" value={form.arrivalTime} onChange={(e) => setForm({ ...form, arrivalTime: e.target.value })} className="input" /></Field>
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
