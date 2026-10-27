import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2, UserRound, Bus, Phone, IdCard, Briefcase } from "lucide-react";
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
import StatusBadge from "../../components/common/StatusBadge";
import Modal from "../../components/admin/Modal";
import { initials } from "../../lib/format";

// Employee profile fields shared by staff and driver accounts: form key -> API column.
const PROFILE_FIELDS = {
  employeeNo: "employee_no",
  phoneno: "phoneno",
  birthDate: "birth_date",
  sex: "sex",
  address: "address",
  hireDate: "hire_date",
  emergencyContactName: "emergency_contact_name",
  emergencyContactPhone: "emergency_contact_phone",
};

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "terminal_staff",
  ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, ""])),
  licenseNumber: "",
  licenseExpiry: "",
  dutyStatus: "Active",
  busIds: [], // owner only: the buses they can track
};
const ROLE_LABELS = { admin: "Admin", terminal_staff: "Terminal Staff", driver: "Driver", owner: "Bus Owner" };
const ROLE_STYLES = {
  admin: { badge: "bg-violet-100 text-violet-800", icon: ShieldCheck },
  terminal_staff: { badge: "bg-sky-100 text-sky-800", icon: UserRound },
  driver: { badge: "bg-amber-100 text-amber-800", icon: Bus },
  owner: { badge: "bg-emerald-100 text-emerald-800", icon: Briefcase },
};
const busLabel = (b) => (b.bus_number ? `Bus ${b.bus_number} · ${b.plate_num}` : b.plate_num);
const DUTY = ["Active", "On Leave", "Suspended"];
const ROLE_FILTERS = [
  { key: "role", label: "Role", allLabel: "All roles", options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) },
];
const SORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role", accessor: (u) => ROLE_LABELS[u.role] ?? u.role },
  { key: "employee_no", label: "Employee No." },
];
const LIST_OPTIONS = { initialSort: { key: "name", dir: "asc" }, filters: ROLE_FILTERS, syncUrl: true };

// Table 4's User Account Administration: every account the admin manages in
// one place — terminal staff and admins (staff_accounts), drivers (drivers)
// and bus owners (bus_owners). They live in different tables, so each row
// carries `kind` to know which API to call. Layout: compact cards (found by
// name + role) with a remembered Table toggle.
export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [buses, setBuses] = useState([]); // for linking buses to an owner
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(null); // null | 'new' | user row
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useViewPreference("drs:view:users", "cards");
  const list = useListState(LIST_OPTIONS); // shared by both views, so switching keeps search/filters

  function load() {
    Promise.all([api.getStaff(), api.getDrivers(), api.getOwners(), api.getBuses()])
      .then(([staff, drivers, owners, busRows]) => {
        setUsers([
          ...staff.map((s) => ({ ...s, kind: "staff", id: s.staff_id, key: `s${s.staff_id}` })),
          ...drivers.map((d) => ({ ...d, kind: "driver", role: "driver", id: d.driver_id, key: `d${d.driver_id}` })),
          ...owners.map((o) => ({ ...o, kind: "owner", role: "owner", id: o.owner_id, key: `o${o.owner_id}` })),
        ]);
        setBuses(busRows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const isNew = editing === "new";
  const isDriver = form.role === "driver";
  const isOwner = form.role === "owner";

  // Which owner currently has each bus, so the picker can say "owned by …".
  const ownerOfBus = new Map();
  for (const u of users) if (u.kind === "owner") for (const id of u.bus_ids ?? []) ownerOfBus.set(id, u);
  const toggleBus = (busId) =>
    setForm((f) => ({ ...f, busIds: f.busIds.includes(busId) ? f.busIds.filter((id) => id !== busId) : [...f.busIds, busId] }));

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(u) {
    setForm({
      ...emptyForm,
      name: u.name,
      email: u.email ?? "",
      role: u.role,
      ...Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([k, col]) => [k, u[col] ?? ""])),
      licenseNumber: u.license_number ?? "",
      licenseExpiry: u.license_expiry ?? "",
      dutyStatus: u.duty_status ?? "Active",
      busIds: u.bus_ids ?? [],
    });
    setEditing(u);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.name.trim() || !form.email.trim() || !form.phoneno.trim() || (isNew && !form.password) || (isDriver && !form.licenseNumber.trim())) {
      setError(`Full name, email, phone${isNew ? ", a temporary password" : ""}${isDriver ? " and a license number" : ""} are required.`);
      return;
    }

    setIsSaving(true);
    // Postel's Law: tolerate stray spaces and capitals in what's typed.
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    // Owners aren't employees: just contact details and their buses.
    const payload = isOwner
      ? { name, email, phoneno: form.phoneno.trim(), address: form.address.trim(), busIds: form.busIds }
      : { name, email, ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, form[k].trim()])) };
    if (isDriver) Object.assign(payload, { licenseNumber: form.licenseNumber.trim(), licenseExpiry: form.licenseExpiry });
    else if (!isOwner) payload.role = form.role;

    try {
      if (isNew) {
        const create = isOwner ? api.createOwner : isDriver ? api.createDriver : api.createStaff;
        await create({ ...payload, password: form.password });
        setSuccess(`${ROLE_LABELS[form.role]} account created for ${name}.`);
      } else if (editing.kind === "owner") {
        await api.updateOwner(editing.id, form.password ? { ...payload, password: form.password } : payload);
        setSuccess(`${name}'s account was updated.`);
      } else if (editing.kind === "driver") {
        await api.updateDriver(editing.id, { ...payload, dutyStatus: form.dutyStatus });
        setSuccess(`${name}'s account was updated.`);
      } else {
        await api.updateStaff(editing.id, payload);
        setSuccess(`${name}'s account was updated.`);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(u) {
    setError("");
    setSuccess("");
    if (isMe(u)) {
      setError("You can't delete your own account while signed in as it.");
      return;
    }
    if (!window.confirm(`Remove ${u.name}'s account? This can't be undone.`)) return;
    try {
      await ({ driver: api.deleteDriver, owner: api.deleteOwner }[u.kind] ?? api.deleteStaff)(u.id);
      setSuccess(`${u.name}'s account was removed.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const isMe = (u) => u.kind === "staff" && u.staff_id === currentUser?.id;
  const actions = (u) => (
    <>
      <TextAction onClick={() => openEdit(u)}>
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
      </TextAction>
      <OverflowMenu
        label={`More actions for ${u.name}`}
        items={[{ label: "Delete account", icon: Trash2, tone: "danger", onClick: () => handleDelete(u), disabled: isMe(u) }]}
      />
    </>
  );
  const nameCell = (u) => (
    <>
      {u.name} {isMe(u) && <span className="text-xs font-normal text-gray-500">(you)</span>}
    </>
  );

  const shared = {
    state: list,
    rows: users,
    rowKey: (u) => u.key,
    isLoading,
    searchKeys: ["name", "email", "employee_no", "phoneno", "license_number"],
    searchPlaceholder: "Search name, email, employee no. or phone…",
    filters: ROLE_FILTERS,
    emptyState: { icon: ShieldCheck, title: "No accounts yet", description: "Add a terminal-staff, admin, driver or bus owner account." },
    toolbar: <ViewToggle value={view} onChange={setView} />,
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="User Accounts"
        subtitle="Terminal staff, admin, driver and bus owner accounts."
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
          label="Employee accounts"
          minWidth="52rem"
          columns={[
            { key: "name", header: "Name", truncate: true, render: (u) => <span className="font-medium">{nameCell(u)}</span> },
            { key: "employee_no", header: "Employee No.", render: (u) => <span className="font-mono text-gray-600">{u.employee_no ?? "—"}</span> },
            { key: "email", header: "Email", truncate: true, render: (u) => <span className="text-gray-600">{u.email ?? "—"}</span> },
            { key: "phoneno", header: "Phone", render: (u) => <span className="text-gray-600">{u.phoneno ?? "—"}</span> },
            { key: "role", header: "Role", accessor: (u) => ROLE_LABELS[u.role] ?? u.role, render: (u) => <RoleBadge role={u.role} /> },
            { key: "actions", header: "", render: actions },
          ]}
        />
      ) : (
        <CardGrid
          {...shared}
          label="Employee accounts"
          sortFields={SORT_FIELDS}
          renderCard={(u) => (
            <>
              <div className="flex items-start gap-3">
                <span className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${ROLE_STYLES[u.role]?.badge}`} aria-hidden="true">
                  {initials(u.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-900 truncate" title={u.name}>
                    {nameCell(u)}
                  </p>
                  <p className="text-sm text-gray-600 truncate" title={u.email ?? ""}>
                    {u.email ?? "No login email"}
                  </p>
                </div>
                <RoleBadge role={u.role} />
              </div>
              <dl className="text-sm text-gray-600 space-y-1">
                <div className="flex items-center gap-2">
                  {u.kind === "owner" ? (
                    <>
                      <dt>
                        <Bus className="w-4 h-4 text-gray-400" aria-label="Buses" />
                      </dt>
                      <dd>{u.bus_ids?.length ? `${u.bus_ids.length} bus${u.bus_ids.length === 1 ? "" : "es"}` : "No buses linked"}</dd>
                    </>
                  ) : (
                    <>
                      <dt>
                        <IdCard className="w-4 h-4 text-gray-400" aria-label="Employee number" />
                      </dt>
                      <dd className="font-mono">{u.employee_no ?? "—"}</dd>
                    </>
                  )}
                  {u.kind === "driver" && u.duty_status && u.duty_status !== "Active" && (
                    <dd className="ml-auto">
                      <StatusBadge status={u.duty_status} />
                    </dd>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <dt>
                    <Phone className="w-4 h-4 text-gray-400" aria-label="Phone" />
                  </dt>
                  <dd>{u.phoneno ?? "—"}</dd>
                </div>
              </dl>
              <div className="flex justify-end gap-1 border-t border-slate-100 pt-2 mt-auto">{actions(u)}</div>
            </>
          )}
        />
      )}

      {editing && (
        <Modal
          size="lg"
          title={isNew ? "Add Account" : "Edit Account"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <CancelButton onClick={() => setEditing(null)} />
              <SubmitButton form="account-form" isSaving={isSaving} />
            </>
          }
        >
          <form id="account-form" onSubmit={handleSave} className="space-y-5">
            <FormSection title="Account">
              <Field label="Role" required>
                {/* Staff, drivers and owners are stored separately, so an existing account can't switch between them. */}
                <select value={form.role} onChange={set("role")} className="input" disabled={!isNew && editing.kind !== "staff"}>
                  {(isNew || editing.kind === "staff") && (
                    <>
                      <option value="terminal_staff">Terminal Staff</option>
                      <option value="admin">Admin</option>
                    </>
                  )}
                  {(isNew || editing.kind === "driver") && <option value="driver">Driver</option>}
                  {(isNew || editing.kind === "owner") && <option value="owner">Bus Owner</option>}
                </select>
              </Field>
              <Field label="Email" required>
                <input required type="email" autoComplete="off" value={form.email} onChange={set("email")} className="input" />
              </Field>
              {isNew && (
                <Field label="Temporary Password" required hint="8+ characters with a capital letter and a number.">
                  <input required type="password" autoComplete="new-password" value={form.password} onChange={set("password")} className="input" />
                </Field>
              )}
              {!isNew && isOwner && (
                <Field label="New Password" hint="Leave blank to keep the current password.">
                  <input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} className="input" />
                </Field>
              )}
            </FormSection>

            {isOwner ? (
              <>
                <FormSection title="Owner Information">
                  <Field label="Full Name" required wide>
                    <input required value={form.name} onChange={set("name")} className="input" />
                  </Field>
                  <Field label="Phone" required>
                    <input required type="tel" placeholder="09XX XXX XXXX" value={form.phoneno} onChange={set("phoneno")} className="input" />
                  </Field>
                  <Field label="Address" wide>
                    <input value={form.address} onChange={set("address")} className="input" />
                  </Field>
                </FormSection>

                <fieldset>
                  <legend className="font-display font-bold text-sm text-ink-900 mb-1">Buses</legend>
                  <p className="text-xs text-gray-500 mb-2">The owner can track only the buses checked here. A bus has one owner — checking one owned by someone else moves it.</p>
                  {buses.length === 0 ? (
                    <p className="text-sm text-gray-500">No buses in the fleet yet. Add them in Fleet Management.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                      {buses.map((b) => {
                        const other = ownerOfBus.get(b.bus_id);
                        const ownedByOther = other && (isNew || other.id !== editing.id);
                        return (
                          <label key={b.bus_id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                            <input type="checkbox" className="mt-0.5" checked={form.busIds.includes(b.bus_id)} onChange={() => toggleBus(b.bus_id)} />
                            <span>
                              <span className="font-medium text-ink-900">{busLabel(b)}</span>
                              {ownedByOther && <span className="block text-xs text-amber-700">Owned by {other.name}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              </>
            ) : (
            <>
            <FormSection title="Personal Information">
              <Field label="Full Name" required wide>
                <input required value={form.name} onChange={set("name")} className="input" />
              </Field>
              <Field label="Sex">
                <select value={form.sex} onChange={set("sex")} className="input">
                  <option value="">—</option>
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </Field>
              <Field label="Birth Date">
                <input type="date" value={form.birthDate} onChange={set("birthDate")} className="input" />
              </Field>
              <Field label="Phone" required>
                <input required type="tel" placeholder="09XX XXX XXXX" value={form.phoneno} onChange={set("phoneno")} className="input" />
              </Field>
              <Field label="Home Address" wide>
                <input value={form.address} onChange={set("address")} className="input" />
              </Field>
            </FormSection>

            <FormSection title="Employment">
              <Field label="Employee No.">
                <input value={form.employeeNo} onChange={set("employeeNo")} className="input" />
              </Field>
              <Field label="Hire Date">
                <input type="date" value={form.hireDate} onChange={set("hireDate")} className="input" />
              </Field>
              {isDriver && (
                <>
                  <Field label="Driver's License No." required>
                    <input required value={form.licenseNumber} onChange={set("licenseNumber")} className="input" />
                  </Field>
                  <Field label="License Expiry">
                    <input type="date" value={form.licenseExpiry} onChange={set("licenseExpiry")} className="input" />
                  </Field>
                  {!isNew && (
                    <Field label="Duty Status">
                      <select value={form.dutyStatus} onChange={set("dutyStatus")} className="input">
                        {DUTY.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </FormSection>

            <FormSection title="Emergency Contact">
              <Field label="Contact Name">
                <input value={form.emergencyContactName} onChange={set("emergencyContactName")} className="input" />
              </Field>
              <Field label="Contact Phone">
                <input type="tel" value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} className="input" />
              </Field>
            </FormSection>
            </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}

// Role isn't a status, so it isn't a StatusBadge — but it follows the same
// pill shape, with an icon so colour isn't the only cue.
function RoleBadge({ role }) {
  const { badge, icon: Icon } = ROLE_STYLES[role] ?? ROLE_STYLES.terminal_staff;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${badge}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function FormSection({ title, children }) {
  return (
    <fieldset>
      <legend className="font-display font-bold text-sm text-ink-900 mb-2">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, required, hint, wide, children }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-rose-600" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}
