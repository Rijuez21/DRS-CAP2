import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2, UserRound } from "lucide-react";
import * as api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useListState, useViewPreference } from "../../hooks/useListState";
import CardGrid from "../../components/common/CardGrid";
import DataTable from "../../components/common/DataTable";
import PageHeading from "../../components/common/PageHeading";
import ViewToggle from "../../components/common/ViewToggle";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import { initials } from "../../lib/format";

const emptyForm = { name: "", email: "", password: "", role: "terminal_staff" };
const ROLE_LABELS = { admin: "Admin", terminal_staff: "Terminal Staff" };
const ROLE_FILTERS = [
  { key: "role", label: "Role", allLabel: "All roles", options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) },
];
const SORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role", accessor: (s) => ROLE_LABELS[s.role] ?? s.role },
];
const LIST_OPTIONS = { initialSort: { key: "name", dir: "asc" }, filters: ROLE_FILTERS, syncUrl: true };

// Table 4's User Account Administration: terminal-staff/admin accounts,
// both stored in staff_accounts (see schema.sql's note on why).
// Layout: compact cards (few accounts, found by name + role) with a
// remembered Table toggle.
export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const [staff, setStaff] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useViewPreference("drs:view:users", "cards");
  const list = useListState(LIST_OPTIONS); // shared by both views, so switching keeps search/filters

  function load() {
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
    setError("");
    setSuccess("");
    e.preventDefault();
    if (!form.name || !form.email || (editing === "new" && !form.password)) {
      setError("Name, email, and (for a new account) a password are required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      // Postel's Law: tolerate stray spaces and capitals in what's typed.
      const clean = { ...form, name: form.name.trim(), email: form.email.trim().toLowerCase() };
      if (editing === "new") {
        await api.createStaff(clean);
        setSuccess(`Account created for ${clean.name}.`);
      } else {
        await api.updateStaff(editing.staff_id, { name: clean.name, email: clean.email, role: clean.role });
        setSuccess(`${clean.name}'s account was updated.`);
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
    setError("");
    setSuccess("");
    if (s.staff_id === currentUser?.id) {
      setError("You can't delete your own account while signed in as it.");
      return;
    }
    if (!window.confirm(`Remove ${s.name}'s account? This can't be undone.`)) return;
    try {
      await api.deleteStaff(s.staff_id);
      setSuccess(`${s.name}'s account was removed.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const isMe = (s) => s.staff_id === currentUser?.id;
  const actions = (s) => (
    <>
      <TextAction onClick={() => openEdit(s)}>
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
      </TextAction>
      <OverflowMenu
        label={`More actions for ${s.name}`}
        items={[{ label: "Delete account", icon: Trash2, tone: "danger", onClick: () => handleDelete(s), disabled: isMe(s) }]}
      />
    </>
  );

  const shared = {
    state: list,
    rows: staff,
    rowKey: (s) => s.staff_id,
    isLoading,
    searchKeys: ["name", "email"],
    searchPlaceholder: "Search name or email…",
    filters: ROLE_FILTERS,
    emptyState: { icon: ShieldCheck, title: "No staff accounts yet", description: "Add a terminal-staff or admin account." },
    toolbar: <ViewToggle value={view} onChange={setView} />,
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="User Accounts"
        subtitle="Terminal staff and admin accounts."
        actions={
          <PrimaryButton icon={Plus} onClick={openNew}>
            Add Account
          </PrimaryButton>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {view === "table" ? (
        <DataTable
          {...shared}
          label="Staff accounts"
          minWidth="36rem"
          columns={[
            {
              key: "name",
              header: "Name",
              truncate: true,
              render: (s) => (
                <span className="font-medium">
                  {s.name} {isMe(s) && <span className="text-xs font-normal text-gray-500">(you)</span>}
                </span>
              ),
            },
            { key: "email", header: "Email", truncate: true, render: (s) => <span className="text-gray-600">{s.email}</span> },
            { key: "role", header: "Role", accessor: (s) => ROLE_LABELS[s.role] ?? s.role, render: (s) => <RoleBadge role={s.role} /> },
            { key: "actions", header: "", render: actions },
          ]}
        />
      ) : (
        <CardGrid
          {...shared}
          label="Staff accounts"
          sortFields={SORT_FIELDS}
          renderCard={(s) => (
            <>
              <div className="flex items-start gap-3">
                <span className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${s.role === "admin" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`} aria-hidden="true">
                  {initials(s.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-900 truncate" title={s.name}>
                    {s.name} {isMe(s) && <span className="text-xs font-normal text-gray-500">(you)</span>}
                  </p>
                  <p className="text-sm text-gray-600 truncate" title={s.email}>
                    {s.email}
                  </p>
                </div>
                <RoleBadge role={s.role} />
              </div>
              <div className="flex justify-end gap-1 border-t border-slate-100 pt-2 mt-auto">{actions(s)}</div>
            </>
          )}
        />
      )}

      {editing && (
        <Modal
          title={editing === "new" ? "Add Account" : "Edit Account"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <CancelButton onClick={() => setEditing(null)} />
              <SubmitButton form="staff-form" isSaving={isSaving} />
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

// Role isn't a status, so it isn't a StatusBadge — but it follows the same
// pill shape, with an icon so colour isn't the only cue.
function RoleBadge({ role }) {
  const admin = role === "admin";
  const Icon = admin ? ShieldCheck : UserRound;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${admin ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {ROLE_LABELS[role] ?? role}
    </span>
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
