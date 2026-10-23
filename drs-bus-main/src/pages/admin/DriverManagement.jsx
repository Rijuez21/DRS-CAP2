import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2, Phone, Mail, IdCard } from "lucide-react";
import * as api from "../../lib/api";
import CardGrid from "../../components/common/CardGrid";
import PageHeading from "../../components/common/PageHeading";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import Modal from "../../components/admin/Modal";
import { initials } from "../../lib/format";

const emptyForm = { name: "", licenseNumber: "", phoneno: "", email: "", password: "", dutyStatus: "Active" };
const DUTY = ["Active", "On Leave", "Suspended"];
const DUTY_FILTERS = [{ key: "duty_status", label: "Duty status", allLabel: "All duty statuses", options: DUTY.map((v) => ({ value: v, label: v })) }];
const SORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "duty_status", label: "Duty status", type: "status" },
  { key: "license_number", label: "License #" },
];

// Table 4's Driver Management: roster + duty status toggle + add/edit.
// Layout: cards — a small roster scanned by duty status, so the status sits
// top-right on every card and anyone not Active stands out.
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
    // Postel's Law: tolerate stray spaces and capitals in what's typed.
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const phoneno = form.phoneno.trim() || null;
    try {
      if (editing === "new") {
        await api.createDriver({ name, licenseNumber: form.licenseNumber.trim(), phoneno, email, password: form.password });
        setSuccess(`${name} was added to the roster.`);
      } else {
        await api.updateDriver(editing.driver_id, { name, phoneno, email, dutyStatus: form.dutyStatus });
        setSuccess(`${name}'s details were updated.`);
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
      setSuccess(`${driver.name} was removed.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="Drivers"
        subtitle="License numbers, duty status, and contact info."
        actions={
          <PrimaryButton icon={Plus} onClick={openNew}>
            Add Driver
          </PrimaryButton>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <CardGrid
        label="Drivers"
        rows={drivers}
        rowKey={(d) => d.driver_id}
        isLoading={isLoading}
        syncUrl
        initialSort={{ key: "name", dir: "asc" }}
        sortFields={SORT_FIELDS}
        searchKeys={["name", "license_number", "email", "phoneno"]}
        searchPlaceholder="Search name, license or contact…"
        filters={DUTY_FILTERS}
        emptyState={{ icon: Users, title: "No drivers yet", description: "Add a driver to start assigning trips." }}
        cardClassName={(d) => (d.duty_status === "Suspended" ? "border-l-4 border-l-rose-500" : d.duty_status === "On Leave" ? "border-l-4 border-l-amber-500" : "")}
        renderCard={(d) => (
          <>
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 shrink-0 rounded-full bg-brand-forest-900 text-white flex items-center justify-center text-sm font-bold" aria-hidden="true">
                {initials(d.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900 truncate" title={d.name}>
                  {d.name}
                </p>
                <p className="text-xs text-gray-500 inline-flex items-center gap-1 font-mono">
                  <IdCard className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="sr-only">License </span>
                  {d.license_number ?? "No license on file"}
                </p>
              </div>
              <StatusBadge status={d.duty_status ?? "Active"} />
            </div>
            <dl className="text-sm text-gray-600 space-y-1">
              <div className="flex items-center gap-2 min-w-0">
                <dt>
                  <Mail className="w-4 h-4 text-gray-400" aria-label="Email" />
                </dt>
                <dd className="truncate" title={d.email}>
                  {d.email ?? "—"}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>
                  <Phone className="w-4 h-4 text-gray-400" aria-label="Phone" />
                </dt>
                <dd>
                  {d.phoneno ? (
                    <a href={`tel:${d.phoneno.replace(/[^\d+]/g, "")}`} className="hover:underline">
                      {d.phoneno}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
            <div className="flex justify-end gap-1 border-t border-slate-100 pt-2 mt-auto">
              <TextAction onClick={() => openEdit(d)}>
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
              </TextAction>
              <OverflowMenu label={`More actions for ${d.name}`} items={[{ label: "Remove driver", icon: Trash2, tone: "danger", onClick: () => handleDelete(d) }]} />
            </div>
          </>
        )}
      />

      {editing && (
        <Modal
          title={editing === "new" ? "Add Driver" : "Edit Driver"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <CancelButton onClick={() => setEditing(null)} />
              <SubmitButton form="driver-form" isSaving={isSaving} />
            </>
          }
        >
          <form id="driver-form" onSubmit={handleSave} className="space-y-3">
            <Field label="Full Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
            {editing === "new" && (
              <Field label="License Number"><input required value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} className="input" /></Field>
            )}
            <Field label="Phone"><input type="tel" value={form.phoneno} onChange={(e) => setForm({ ...form, phoneno: e.target.value })} className="input" /></Field>
            <Field label="Email"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" /></Field>
            {editing === "new" && (
              <Field label="Temporary Password"><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" /></Field>
            )}
            {editing !== "new" && (
              <Field label="Duty Status">
                <select value={form.dutyStatus} onChange={(e) => setForm({ ...form, dutyStatus: e.target.value })} className="input">
                  {DUTY.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
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
