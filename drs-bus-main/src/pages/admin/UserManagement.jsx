import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";

const emptyForm = { name: "", email: "", password: "", role: "terminal_staff" };

// Table 4's User Account Administration: terminal-staff/admin accounts,
// both stored in staff_accounts (see schema.sql's note on why).
export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const [staff, setStaff] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    setIsLoading(true);
    api.getStaff().then(setStaff).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(s) {
    setForm({ name: s.name, email: s.email, password: "", role: s.role });
    setEditing(s);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.email || (editing === "new" && !form.password)) {
      setError("Name, email, and (for a new account) a password are required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      if (editing === "new") {
        await api.createStaff(form);
        setSuccess("Account created.");
      } else {
        await api.updateStaff(editing.staff_id, { name: form.name, email: form.email, role: form.role });
        setSuccess("Account updated.");
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(s) {
    if (s.staff_id === currentUser?.id) {
      setError("You can't delete your own account while signed in as it.");
      return;
    }
    if (!window.confirm(`Remove ${s.name}'s account? This can't be undone.`)) return;
    try {
      await api.deleteStaff(s.staff_id);
      setSuccess("Account removed.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">User Account Administration</h1>
          <p className="text-sm text-gray-500">Terminal staff and admin accounts.</p>
        </div>
        <button type="button" onClick={openNew} className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded">
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : staff.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No staff accounts yet" description="Add a terminal-staff or admin account." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {staff.map((s) => (
                <tr key={s.staff_id}>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600">{s.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${s.role === "admin" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                      {s.role === "admin" ? "Admin" : "Terminal Staff"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(s)} className="text-gray-500 hover:text-emerald-700 inline-flex items-center">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(s)} className="text-gray-500 hover:text-rose-600 inline-flex items-center">
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
          title={editing === "new" ? "Add Account" : "Edit Account"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" form="staff-form" disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded">
                {isSaving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="staff-form" onSubmit={handleSave} className="space-y-3">
            <Field label="Full Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
            <Field label="Email"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" /></Field>
            {editing === "new" && (
              <Field label="Temporary Password"><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" /></Field>
            )}
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
                <option value="terminal_staff">Terminal Staff</option>
                <option value="admin">Admin</option>
              </select>
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
