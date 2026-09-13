import { useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import StatusBadge from "../../components/common/StatusBadge";
import { formatDate, formatTime } from "../../lib/format";

const emptyForm = { busId: "", driverId: "", routeId: "", departureTime: "", arrivalTime: "" };

// <input type="datetime-local"> gives "2026-09-12T14:30"; MySQL's DATETIME
// column wants "2026-09-12 14:30:00" — mysql2 sends whatever string we
// hand it straight through as a bound parameter, so this has to happen
// client-side rather than relying on an implicit server-side cast.
function toMysqlDatetime(localValue) {
  if (!localValue) return localValue;
  return `${localValue.replace("T", " ")}:00`;
}

// Table 4's Trip Scheduling: assign bus + driver + route + times, with
// server-side overlap-conflict prevention surfaced right in the form.
export default function AdminTripScheduling() {
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

  function load() {
    setIsLoading(true);
    Promise.all([api.getTrips(), api.getBuses(), api.getDrivers(), api.getAdminRoutes()])
      .then(([t, b, d, r]) => { setTrips(t); setBuses(b); setDrivers(d); setRoutes(r.filter((rt) => rt.is_active)); })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  async function handleSchedule(e) {
    e.preventDefault();
    if (!form.busId || !form.driverId || !form.routeId || !form.departureTime || !form.arrivalTime) {
      setFormError("All fields are required.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    try {
      await api.createTrip({ ...form, departureTime: toMysqlDatetime(form.departureTime), arrivalTime: toMysqlDatetime(form.arrivalTime) });
      setSuccess("Trip scheduled.");
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
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Trip Scheduling</h1>
          <p className="text-sm text-gray-500">Assign a bus, driver, and route to a departure time.</p>
        </div>
        <button type="button" onClick={() => { setForm(emptyForm); setFormError(""); setShowForm(true); }} className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded">
          <Plus className="w-4 h-4" /> Schedule Trip
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : trips.length === 0 ? (
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
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {trips.map((t) => (
                <tr key={t.trip_id}>
                  <td className="px-4 py-3 font-medium">{t.origin} → {t.destination}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(t.departure_time)} · {formatTime(t.departure_time)}</td>
                  <td className="px-4 py-3 text-gray-600">{t.plate_num}</td>
                  <td className="px-4 py-3 text-gray-600">{t.driver_name}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal
          title="Schedule Trip"
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" form="trip-form" disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded">
                {isSaving ? "Checking availability…" : "Schedule"}
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
                {buses.map((b) => <option key={b.bus_id} value={b.bus_id}>{b.plate_num} ({b.capacity} seats)</option>)}
              </select>
            </Field>
            <Field label="Driver">
              <select required value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} className="input">
                <option value="">Select a driver…</option>
                {drivers.map((d) => <option key={d.driver_id} value={d.driver_id}>{d.name}</option>)}
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
