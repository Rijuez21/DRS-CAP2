import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2, Phone, Mail, IdCard } from "lucide-react";
import * as api from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";
import CardGrid from "../../components/common/CardGrid";
import PageHeading from "../../components/common/PageHeading";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import Modal from "../../components/admin/Modal";
import { initials } from "../../lib/format";

const emptyForm = { name: "", crewRole: "Driver", licenseNumber: "", phoneno: "", email: "", password: "", dutyStatus: "Active" };
const DUTY = ["Active", "On Leave", "Suspended"];
const CREW_ROLES = ["Driver", "Conductor"];
const FILTERS = [
  { key: "crew_role", label: "Job", allLabel: "Drivers and conductors", options: CREW_ROLES.map((v) => ({ value: v, label: `${v}s` })) },
  { key: "duty_status", label: "Duty status", allLabel: "All duty statuses", options: DUTY.map((v) => ({ value: v, label: v })) },
];
const SORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "crew_role", label: "Job" },
  { key: "duty_status", label: "Duty status", type: "status" },
  { key: "license_number", label: "License #" },
];

// Table 4's Driver Management, now the whole bus crew: drivers and
// conductors, each with their own login to the crew app. Roster + duty
// status toggle + add/edit. A conductor needs no driver's license.
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
  const [confirm, confirmDialog] = useConfirm();

  function load() {
    api.getDrivers().then(setDrivers).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(driver) {
    setForm({ name: driver.name, crewRole: driver.crew_role ?? "Driver", licenseNumber: driver.license_number, phoneno: driver.phoneno ?? "", email: driver.email, password: "", dutyStatus: driver.duty_status });
    setEditing(driver);
  }

  async function handleSave(e) {
    setError("");
    setSuccess("");
    e.preventDefault();
    const isDriver = form.crewRole === "Driver";
    if (!form.name || !form.email || (editing === "new" && (!form.password || (isDriver && !form.licenseNumber)))) {
      setError(isDriver ? "Name, email, and (for a new driver) license number and password are required." : "Name, email and (for a new conductor) password are required.");
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
        await api.createDriver({ name, crewRole: form.crewRole, licenseNumber: isDriver ? form.licenseNumber.trim() : null, phoneno, email, password: form.password });
        setSuccess(`${name} was added to the roster as a ${form.crewRole.toLowerCase()}.`);
      } else {
        await api.updateDriver(editing.driver_id, { name, crewRole: form.crewRole, phoneno, email, dutyStatus: form.dutyStatus });
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
    const ok = await confirm({ title: `Remove ${driver.name}?`, body: "Their crew account is removed. This can't be undone.", confirmLabel: "Remove" });
    if (!ok) return;
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
        title="Bus Crew"
        subtitle="Drivers and conductors: duty status, licenses and contact info. Each signs in to the crew app with their own account."
        actions={
          <PrimaryButton icon={Plus} onClick={openNew}>
            Add Crew Member
          </PrimaryButton>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <CardGrid
        label="Bus crew"
        rows={drivers}
        rowKey={(d) => d.driver_id}
        isLoading={isLoading}
        syncUrl
        initialSort={{ key: "name", dir: "asc" }}
        sortFields={SORT_FIELDS}
        searchKeys={["name", "license_number", "email", "phoneno"]}
        searchPlaceholder="Search name, license or contact…"
        filters={FILTERS}
        emptyState={{ icon: Users, title: "No crew yet", description: "Add a driver to start assigning trips." }}
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
                <p className="text-xs font-semibold text-gray-600">{d.crew_role ?? "Driver"}</p>
                {(d.crew_role ?? "Driver") === "Driver" && (
                  <p className="text-xs text-gray-500 inline-flex items-center gap-1 font-mono">
                    <IdCard className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="sr-only">License </span>
                    {d.license_number ?? "No license on file"}
                  </p>
                )}
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
              <OverflowMenu label={`More actions for ${d.name}`} items={[{ label: `Remove ${(d.crew_role ?? "Driver").toLowerCase()}`, icon: Trash2, tone: "danger", onClick: () => handleDelete(d) }]} />
            </div>
          </>
        )}
      />

      {editing && (
        <Modal
          title={editing === "new" ? "Add Crew Member" : `Edit ${form.crewRole}`}
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
            <Field label="Job">
              <div className="grid grid-cols-2 gap-2">
                {CREW_ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={form.crewRole === r}
                    onClick={() => setForm({ ...form, crewRole: r })}
                    className={`rounded-lg border-2 py-2 text-sm ${form.crewRole === r ? "border-brand-green-600 bg-brand-green-500/10 font-semibold" : "border-slate-200"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            {editing === "new" && form.crewRole === "Driver" && (
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
      {confirmDialog}
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
