import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";

const emptyForm = { name: "", licenseNumber: "", phoneno: "", email: "", password: "", dutyStatus: "Active" };
const DUTY_STYLES = {
  Active: "bg-emerald-100 text-emerald-700",
  "On Leave": "bg-amber-100 text-amber-700",
  Suspended: "bg-rose-100 text-rose-700",
};

// Table 4's Driver Management: roster + duty status toggle + add/edit.
export default function AdminDriverManagement() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(null); // null | 'new' | driver object
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    api.getDrivers().then(setDrivers).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(driver) {
    setForm({ name: driver.name, licenseNumber: driver.license_number, phoneno: driver.phoneno ?? "", email: driver.email, password: "", dutyStatus: driver.duty_status });
    setEditing(driver);
  }

  async function handleSave(e) {
    setError("");
    setSuccess("");
    e.preventDefault();
    if (!form.name || !form.email || (editing === "new" && (!form.licenseNumber || !form.password))) {
      setError("Name, email, and (for a new driver) license number and password are required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      if (editing === "new") {
        await api.createDriver({ name: form.name, licenseNumber: form.licenseNumber, phoneno: form.phoneno || null, email: form.email, password: form.password });
        setSuccess("Driver added.");
      } else {
        await api.updateDriver(editing.driver_id, { name: form.name, phoneno: form.phoneno || null, email: form.email, dutyStatus: form.dutyStatus });
        setSuccess("Driver updated.");
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(driver) {
    setError("");
    setSuccess("");
    if (!window.confirm(`Remove ${driver.name}? This can't be undone.`)) return;
    try {
      await api.deleteDriver(driver.driver_id);
      setSuccess("Driver removed.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Driver Management</h1>
          <p className="text-sm text-gray-500">License numbers, duty status, and contact info.</p>
        </div>
        <button type="button" onClick={openNew} className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded">
          <Plus className="w-4 h-4" /> Add Driver
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : drivers.length === 0 ? (
        <EmptyState icon={Users} title="No drivers yet" description="Add a driver to start assigning trips." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">License #</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Duty Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {drivers.map((d) => (
                <tr key={d.driver_id}>
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-gray-600">{d.license_number}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{d.email}</div>
                    {d.phoneno && <div className="text-xs text-gray-400">{d.phoneno}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${DUTY_STYLES[d.duty_status] ?? DUTY_STYLES.Active}`}>{d.duty_status}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(d)} aria-label="Edit" title="Edit" className="text-gray-500 hover:text-emerald-700 inline-flex items-center">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(d)} aria-label="Delete" title="Delete" className="text-gray-500 hover:text-rose-600 inline-flex items-center">
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
          title={editing === "new" ? "Add Driver" : "Edit Driver"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" form="driver-form" disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded">
                {isSaving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="driver-form" onSubmit={handleSave} className="space-y-3">
            <Field label="Full Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
            {editing === "new" && (
              <Field label="License Number"><input required value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} className="input" /></Field>
            )}
            <Field label="Phone"><input value={form.phoneno} onChange={(e) => setForm({ ...form, phoneno: e.target.value })} className="input" /></Field>
            <Field label="Email"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" /></Field>
            {editing === "new" && (
              <Field label="Temporary Password"><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" /></Field>
            )}
            {editing !== "new" && (
              <Field label="Duty Status">
                <select value={form.dutyStatus} onChange={(e) => setForm({ ...form, dutyStatus: e.target.value })} className="input">
                  <option>Active</option>
                  <option>On Leave</option>
                  <option>Suspended</option>
                </select>
              </Field>
            )}
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
