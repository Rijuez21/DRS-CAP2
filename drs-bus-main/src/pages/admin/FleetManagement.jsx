import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bus, MapPin, Plus, Pencil, Trash2, UserRound, Satellite, Armchair, MapPinned } from "lucide-react";
import * as api from "../../lib/api";
import { useListState, useViewPreference } from "../../hooks/useListState";
import DataTable from "../../components/common/DataTable";
import CardGrid from "../../components/common/CardGrid";
import PageHeading from "../../components/common/PageHeading";
import ViewToggle from "../../components/common/ViewToggle";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import SeatLayoutEditor from "../../components/admin/SeatLayoutEditor";
import { busTypeLabel, formatDateTime } from "../../lib/format";
import { layoutProblems, legacyLayout, sameLayout, seatCount } from "../../lib/seatLayout";

// The status cell is an inline <select> (changing it updates the bus), so
// it keeps its own pill colours — matching StatusBadge's active/idle/maintenance.
const STATUS_STYLES = {
  Active: "bg-brand-green-500/15 text-emerald-700",
  Idle: "bg-slate-400/15 text-slate-600",
  Maintenance: "bg-brand-sunrise-500/15 text-amber-700",
};
const FLEET_FILTERS = [
  { key: "status", label: "Status", allLabel: "All statuses", options: ["Active", "Idle", "Maintenance"].map((v) => ({ value: v, label: v })) },
  { key: "type", label: "Type", allLabel: "All types", options: ["ordinary", "air_conditioned"].map((v) => ({ value: v, label: busTypeLabel(v) })) },
];
const SORT_FIELDS = [
  { key: "bus_number", label: "Bus #" },
  { key: "plate_num", label: "Plate" },
  { key: "capacity", label: "Capacity", type: "number" },
  { key: "status", label: "Status", type: "status" },
  { key: "driver_name", label: "Driver" },
];
const LIST_OPTIONS = { initialSort: { key: "bus_number", dir: "asc" }, filters: FLEET_FILTERS, syncUrl: true };

// A new bus starts as the standard 45-seat bus (2 · aisle · 2 + back bench).
const NEW_BUS_SEATS = 45;

const emptyForm = {
  busNumber: "",
  plateNum: "",
  type: "ordinary",
  yearModel: "",
  currentDriverId: "",
  boardingPoint: "",
  gpsDeviceId: "",
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
  // Seat layout being edited, and what it was when the dialog opened (a
  // bus without a saved layout opens with its generated one).
  const [layout, setLayout] = useState(null);
  const [initialLayout, setInitialLayout] = useState(null);
  const [formError, setFormError] = useState(null); // string or node, shown inside the dialog
  const [view, setView] = useViewPreference("drs:view:fleet", "cards");
  const list = useListState(LIST_OPTIONS); // shared by both views

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

  function openLayout(next) {
    setLayout(next);
    setInitialLayout(next);
    setFormError(null);
  }

  function openNew() {
    setForm(emptyForm);
    openLayout(legacyLayout(NEW_BUS_SEATS));
    setEditing("new");
  }

  function openEdit(bus) {
    openLayout(bus.seat_layout ?? legacyLayout(bus.capacity) ?? legacyLayout(NEW_BUS_SEATS));
    setForm({
      busNumber: bus.bus_number ?? "",
      plateNum: bus.plate_num,
      type: bus.type,
      yearModel: bus.year_model ?? "",
      currentDriverId: bus.current_driver_id ?? "",
      boardingPoint: bus.boarding_point ?? "",
      gpsDeviceId: bus.gps_device_id ?? "",
    });
    setEditing(bus);
  }

  // What to send about seats. Capacity is never typed — it's the layout's
  // seat count. A layout identical to the generated 2 · aisle · 2 one is
  // sent as a plain capacity, so such a bus stays an ordinary (legacy) bus;
  // an unchanged layout on edit sends nothing.
  function seatPayload() {
    const count = seatCount(layout);
    const plain = sameLayout(layout, legacyLayout(count));
    if (editing === "new") return plain ? { capacity: count } : { seatLayout: layout };
    const unchanged = sameLayout(layout, initialLayout) && editing.capacity != null;
    if (unchanged) return {};
    return plain && !editing.seat_layout ? { capacity: count } : { seatLayout: layout };
  }

  async function handleSave(e) {
    setError("");
    setSuccess("");
    setFormError(null);
    e.preventDefault();
    if (!form.plateNum || !form.type) {
      setFormError("Plate number, capacity and type are required.");
      return;
    }
    const problems = layoutProblems(layout).errors;
    if (problems.length > 0) {
      setFormError(`Fix the seat layout first: ${problems[0]}`);
      return;
    }

    const payload = {
      busNumber: form.busNumber || null,
      plateNum: form.plateNum,
      type: form.type,
      yearModel: form.yearModel || null,
      currentDriverId: form.currentDriverId || null,
      boardingPoint: form.boardingPoint || null,
      gpsDeviceId: form.gpsDeviceId.trim() || null,
      ...seatPayload(),
    };

    setIsSaving(true);
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
      setFormError(err.status === 409 && err.data?.affected ? <SeatsInUse message={err.message} affected={err.data.affected} /> : err.message);
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

  const columns = [
    { key: "bus_number", header: "Bus #", primary: true, render: (bus) => <span className="font-medium">{bus.bus_number ?? "—"}</span> },
    { key: "plate_num", header: "Plate Number", render: (bus) => <span className="font-medium">{bus.plate_num}</span> },
    { key: "type", header: "Type", accessor: (bus) => busTypeLabel(bus.type), render: (bus) => <span className="text-gray-600">{busTypeLabel(bus.type)}</span> },
    {
      key: "capacity",
      header: "Capacity",
      type: "number",
      render: (bus) => (
        <span className="text-gray-600 tabular-nums">
          {bus.capacity} seats
          {bus.seat_layout && <span className="block text-[11px] text-emerald-700">Custom layout</span>}
        </span>
      ),
    },
    { key: "driver_name", header: "Driver", truncate: true, render: (bus) => <span className="text-gray-600">{bus.driver_name ?? "Unassigned"}</span> },
    { key: "boarding_point", header: "Boarding Point", truncate: true, render: (bus) => <span className="text-gray-600">{bus.boarding_point ?? "—"}</span> },
    { key: "gps_device_id", header: "GPS Device", render: (bus) => <span className="text-gray-600 font-mono text-xs">{bus.gps_device_id ?? "—"}</span> },
    {
      key: "status",
      header: "Status",
      type: "status",
      render: (bus) => statusSelect(bus),
    },
    {
      key: "actions",
      header: "",
      render: (bus) => busActions(bus),
    },
  ];

  // The status pill is a select: changing it updates the bus right away.
  function statusSelect(bus) {
    return (
      <select
        value={bus.status}
        onChange={(e) => handleStatusChange(bus, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status of bus ${bus.bus_number ?? bus.plate_num}`}
        className={`text-xs font-semibold rounded-full px-2.5 min-h-11 md:min-h-8 border-0 ${STATUS_STYLES[bus.status] ?? STATUS_STYLES.Idle}`}
      >
        <option value="Active">Active</option>
        <option value="Idle">Idle</option>
        <option value="Maintenance">Maintenance</option>
      </select>
    );
  }

  function busActions(bus) {
    return (
      <>
        <TextAction onClick={() => openEdit(bus)}>
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
        </TextAction>
        <OverflowMenu label={`More actions for bus ${bus.bus_number ?? bus.plate_num}`} items={[{ label: "Remove bus", icon: Trash2, tone: "danger", onClick: () => handleDelete(bus) }]} />
      </>
    );
  }

  const shared = {
    state: list,
    rows: buses,
    rowKey: (bus) => bus.bus_id,
    isLoading,
    searchKeys: ["plate_num", "bus_number", "driver_name", "gps_device_id"],
    searchPlaceholder: "Search plate, bus # or driver…",
    filters: FLEET_FILTERS,
    emptyState: { icon: Bus, title: "No buses in the fleet yet", description: "Add a bus to get started." },
    toolbar: <ViewToggle value={view} onChange={setView} />,
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="Fleet"
        subtitle="The bus roster — bus number, plate, driver, and status."
        actions={
          <>
            {/* secondary: a plain link, so "Add Bus" stays the one primary action */}
            <Link to="/admin/tracking" className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100">
              <MapPin className="w-4 h-4" aria-hidden="true" />
              Live tracking
            </Link>
            <PrimaryButton icon={Plus} onClick={openNew}>
              Add Bus
            </PrimaryButton>
          </>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {view === "table" ? (
        <DataTable {...shared} label="Buses" columns={columns} minWidth="60rem" />
      ) : (
        <CardGrid
          {...shared}
          label="Buses"
          sortFields={SORT_FIELDS}
          cardClassName={(bus) => (bus.status === "Maintenance" ? "border-l-4 border-l-amber-500" : "")}
          renderCard={(bus) => (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold text-ink-900 leading-tight">{bus.bus_number ? `Bus ${bus.bus_number}` : bus.plate_num}</p>
                  <p className="text-sm text-gray-600">
                    {bus.bus_number && <span className="font-mono">{bus.plate_num} · </span>}
                    {busTypeLabel(bus.type) ?? "Type not set"}
                  </p>
                </div>
                {statusSelect(bus)}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <Fact icon={Armchair} label="Seats">
                  {bus.capacity ?? "—"}
                  {bus.seat_layout && <span className="text-xs text-emerald-700"> · custom layout</span>}
                </Fact>
                <Fact icon={UserRound} label="Driver">
                  {bus.driver_name ?? <span className="text-gray-400">Unassigned</span>}
                </Fact>
                <Fact icon={MapPinned} label="Boarding point">
                  {bus.boarding_point ?? <span className="text-gray-400">—</span>}
                </Fact>
                <Fact icon={Satellite} label="GPS tracker">
                  {bus.gps_device_id ? <span className="font-mono text-xs">{bus.gps_device_id}</span> : <span className="text-gray-400">None fitted</span>}
                </Fact>
              </dl>
              <div className="flex justify-end gap-1 border-t border-slate-100 pt-2 mt-auto">{busActions(bus)}</div>
            </>
          )}
        />
      )}

      {editing && (
        <Modal
          title={editing === "new" ? "Add Bus" : "Edit Bus"}
          size="lg"
          onClose={() => setEditing(null)}
          footer={
            <>
              <CancelButton onClick={() => setEditing(null)} />
              <SubmitButton form="bus-form" isSaving={isSaving} />
            </>
          }
        >
          <form id="bus-form" onSubmit={handleSave} className="space-y-4">
            <InlineAlert type="error" message={formError} onDismiss={() => setFormError(null)} />
            <Fieldset legend="Bus">
            <Field label="Bus Number (queue #)">
              <input value={form.busNumber} onChange={(e) => setForm({ ...form, busNumber: e.target.value })} placeholder="e.g. 108" className="input" />
            </Field>
            <Field label="Plate Number">
              <input required value={form.plateNum} onChange={(e) => setForm({ ...form, plateNum: e.target.value })} className="input" />
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
            </Fieldset>
            <Fieldset legend="Assignment">
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
            <Field label="GPS Device ID (from the tracker's label, as entered in Traccar)">
              <input value={form.gpsDeviceId} onChange={(e) => setForm({ ...form, gpsDeviceId: e.target.value })} placeholder="Leave blank if no tracker is fitted" maxLength={32} className="input" />
            </Field>
            </Fieldset>

            {/* not inside a <label>: the editor is full of buttons */}
            <section className="border-t pt-4 space-y-2" aria-labelledby="seat-layout-heading">
              <h3 id="seat-layout-heading" className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Seat layout
              </h3>
              <SeatLayoutEditor layout={layout} onChange={setLayout} />
            </section>
          </form>
        </Modal>
      )}
    </div>
  );
}

// The 409 when a layout edit would remove or rename seats people have
// booked: which seats, on which trips.
function SeatsInUse({ message, affected }) {
  return (
    <span className="block space-y-1">
      <span className="block">{message}</span>
      <span className="block font-normal">
        {affected.map((t) => (
          <span key={t.tripId} className="block">
            • {t.route}, {formatDateTime(t.departureTime)} ({t.status}): seat{t.seats.length === 1 ? "" : "s"} {t.seats.join(", ")}
          </span>
        ))}
      </span>
    </span>
  );
}

// Groups of 3–4 fields (Miller's Law), two columns from sm up.
function Fieldset({ legend, children }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-gray-500">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}
      </dt>
      <dd className="truncate text-ink-900">{children}</dd>
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
