import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bus, MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";

const STATUS_STYLES = {
  Active: "bg-emerald-100 text-emerald-700",
  Idle: "bg-slate-100 text-slate-600",
  Maintenance: "bg-amber-100 text-amber-700",
};

const emptyForm = {
  busNumber: "",
  plateNum: "",
  capacity: "",
  type: "ordinary",
  yearModel: "",
  currentDriverId: "",
  boardingPoint: "",
};

// This is the Fleet Management Module's bus *records* view (add/edit
// buses, see status/capacity) — the proposal document treats it as
// separate from the Real-Time Tracking Module, so the live map lives at
// /admin/tracking (FleetTracking.jsx) rather than being merged in here.
export default function AdminFleetManagement() {
  const [buses, setBuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | bus object
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    Promise.all([api.getBuses(), api.getDrivers()])
      .then(([busRows, driverRows]) => {
        setBuses(busRows);
        setDrivers(driverRows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(bus) {
    setForm({
      busNumber: bus.bus_number ?? "",
      plateNum: bus.plate_num,
      capacity: bus.capacity,
      type: bus.type,
      yearModel: bus.year_model ?? "",
      currentDriverId: bus.current_driver_id ?? "",
      boardingPoint: bus.boarding_point ?? "",
    });
    setEditing(bus);
  }

  async function handleSave(e) {
    setError("");
    setSuccess("");
    e.preventDefault();
    if (!form.plateNum || !form.capacity || !form.type) {
      setError("Plate number, capacity and type are required.");
      return;
    }

    const payload = {
      busNumber: form.busNumber || null,
      plateNum: form.plateNum,
      capacity: Number(form.capacity),
      type: form.type,
      yearModel: form.yearModel || null,
      currentDriverId: form.currentDriverId || null,
      boardingPoint: form.boardingPoint || null,
    };

    setIsSaving(true);
    setError("");
    try {
      if (editing === "new") {
        await api.createBus(payload);
        setSuccess("Bus added.");
      } else {
        await api.updateBus(editing.bus_id, payload);
        setSuccess("Bus updated.");
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(bus, status) {
    setError("");
    setSuccess("");
    try {
      await api.updateBusStatus(bus.bus_id, status);
      setSuccess(`Bus ${bus.bus_number ?? bus.plate_num} marked ${status}.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(bus) {
    setError("");
    setSuccess("");
    if (!window.confirm(`Remove bus ${bus.bus_number ?? bus.plate_num}? This can't be undone.`)) return;
    try {
      await api.deleteBus(bus.bus_id);
      setSuccess("Bus removed.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Fleet Management</h1>
          <p className="text-sm text-gray-500">The bus roster — bus number, plate, driver, and status.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded"
          >
            <Plus className="w-4 h-4" /> Add Bus
          </button>
          <Link
            to="/admin/tracking"
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-3 py-2 rounded"
          >
            <MapPin className="w-4 h-4" />
            View Live Tracking
          </Link>
        </div>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {!isLoading && buses.length === 0 && !error ? (
        <EmptyState icon={Bus} title="No buses in the fleet yet" description="Add a bus to get started." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Bus #</th>
                <th className="px-4 py-3">Plate Number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Boarding Point</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {buses.map((bus) => (
                <tr key={bus.bus_id}>
                  <td className="px-4 py-3 font-medium">{bus.bus_number ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{bus.plate_num}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {bus.type === "air_conditioned" ? "Air-Conditioned" : "Ordinary"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{bus.capacity} seats</td>
                  <td className="px-4 py-3 text-gray-600">{bus.driver_name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-gray-600">{bus.boarding_point ?? "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={bus.status}
                      onChange={(e) => handleStatusChange(bus, e.target.value)}
                      className={`text-xs font-semibold rounded-full px-2.5 py-1 border-0 ${
                        STATUS_STYLES[bus.status] ?? STATUS_STYLES.Idle
                      }`}
                    >
                      <option value="Active">Active</option>
                      <option value="Idle">Idle</option>
                      <option value="Maintenance">Maintenance</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(bus)} aria-label="Edit" title="Edit" className="text-gray-500 hover:text-emerald-700 inline-flex items-center">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(bus)} aria-label="Delete" title="Delete" className="text-gray-500 hover:text-rose-600 inline-flex items-center">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing === "new" ? "Add Bus" : "Edit Bus"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-semibold text-gray-600">
                Cancel
              </button>
              <button
                type="submit"
                form="bus-form"
                disabled={isSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="bus-form" onSubmit={handleSave} className="space-y-3">
            <Field label="Bus Number (queue #)">
              <input value={form.busNumber} onChange={(e) => setForm({ ...form, busNumber: e.target.value })} placeholder="e.g. 108" className="input" />
            </Field>
            <Field label="Plate Number">
              <input required value={form.plateNum} onChange={(e) => setForm({ ...form, plateNum: e.target.value })} className="input" />
            </Field>
            <Field label="Capacity">
              <input required type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="input" />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
                <option value="ordinary">Ordinary</option>
                <option value="air_conditioned">Air-Conditioned</option>
              </select>
            </Field>
            <Field label="Year Model">
              <input type="number" min="1980" max="2100" value={form.yearModel} onChange={(e) => setForm({ ...form, yearModel: e.target.value })} className="input" />
            </Field>
            <Field label="Assigned Driver">
              <select value={form.currentDriverId} onChange={(e) => setForm({ ...form, currentDriverId: e.target.value })} className="input">
                <option value="">Unassigned</option>
                {drivers.map((d) => (
                  <option key={d.driver_id} value={d.driver_id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Boarding Point">
              <input value={form.boardingPoint} onChange={(e) => setForm({ ...form, boardingPoint: e.target.value })} placeholder="e.g. Riken Star" className="input" />
            </Field>
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
