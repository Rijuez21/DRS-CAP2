import { useEffect, useState } from "react";
import { Wrench, Plus, AlertTriangle } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import { formatDate } from "../../lib/format";

const STATUS_STYLES = {
  Scheduled: "bg-slate-100 text-slate-600",
  "In Progress": "bg-amber-100 text-amber-700",
  Completed: "bg-emerald-100 text-emerald-700",
};
const emptyForm = { busId: "", serviceType: "", date: "", cost: "", mechanicNotes: "", nextServiceDate: "" };

// Table 4's Maintenance Tracking: log + status pipeline + overdue flag.
export default function AdminMaintenanceTracking() {
  const [records, setRecords] = useState([]);
  const [buses, setBuses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([api.getMaintenance(), api.getBuses()])
      .then(([m, b]) => { setRecords(m); setBuses(b); })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  const isOverdue = (r) => r.next_service_date && new Date(r.next_service_date) < new Date() && r.status !== "Completed";

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.busId || !form.serviceType || !form.date) {
      setError("Bus, service type and date are required.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await api.createMaintenance({ ...form, cost: form.cost || null, mechanicNotes: form.mechanicNotes || null, nextServiceDate: form.nextServiceDate || null });
      setSuccess("Maintenance record added.");
      setShowAdd(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function advanceStatus(record) {
    const next = record.status === "Scheduled" ? "In Progress" : record.status === "In Progress" ? "Completed" : null;
    if (!next) return;
    let cost = record.cost;
    if (next === "Completed") {
      const entered = window.prompt("Actual cost (₱)?", record.cost ?? "");
      if (entered === null) return;
      cost = entered === "" ? null : Number(entered);
    }
    try {
      await api.updateMaintenance(record.maintenance_id, { status: next, cost });
      setSuccess(`Marked as ${next}.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Maintenance Tracking</h1>
          <p className="text-sm text-gray-500">Service log, status pipeline, and overdue alerts.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded">
          <Plus className="w-4 h-4" /> Log Service
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : records.length === 0 ? (
        <EmptyState icon={Wrench} title="No maintenance records yet" description="Log a service event to start tracking." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Bus</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Next Service</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map((r) => (
                <tr key={r.maintenance_id}>
                  <td className="px-4 py-3 font-medium">{r.plate_num}</td>
                  <td className="px-4 py-3">{r.service_type}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(r.date)}</td>
                  <td className="px-4 py-3 text-gray-600">{r.cost != null ? `₱${r.cost}` : "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className={isOverdue(r) ? "text-rose-600 font-semibold flex items-center gap-1" : ""}>
                      {isOverdue(r) && <AlertTriangle className="w-3.5 h-3.5" />}
                      {r.next_service_date ? formatDate(r.next_service_date) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status !== "Completed" && (
                      <button type="button" onClick={() => advanceStatus(r)} className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap">
                        Mark {r.status === "Scheduled" ? "In Progress" : "Completed"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal
          title="Log Service"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" form="maintenance-form" disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded">
                {isSaving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="maintenance-form" onSubmit={handleAdd} className="space-y-3">
            <Field label="Bus">
              <select required value={form.busId} onChange={(e) => setForm({ ...form, busId: e.target.value })} className="input">
                <option value="">Select a bus…</option>
                {buses.map((b) => <option key={b.bus_id} value={b.bus_id}>{b.plate_num}</option>)}
              </select>
            </Field>
            <Field label="Service Type"><input required value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className="input" placeholder="Oil change, brake inspection…" /></Field>
            <Field label="Date"><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" /></Field>
            <Field label="Estimated Cost (₱)"><input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="input" /></Field>
            <Field label="Next Service Date"><input type="date" value={form.nextServiceDate} onChange={(e) => setForm({ ...form, nextServiceDate: e.target.value })} className="input" /></Field>
            <Field label="Mechanic Notes"><textarea value={form.mechanicNotes} onChange={(e) => setForm({ ...form, mechanicNotes: e.target.value })} className="input" rows={2} /></Field>
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
