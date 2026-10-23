import { useEffect, useMemo, useState } from "react";
import { Route as RouteIcon, Plus, Pencil, Power, MapPin } from "lucide-react";
import * as api from "../../lib/api";
import DataTable from "../../components/common/DataTable";
import PageHeading from "../../components/common/PageHeading";
import OverflowMenu from "../../components/common/OverflowMenu";
import { CancelButton, PrimaryButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import Modal from "../../components/admin/Modal";
import StopPinMap from "../../components/admin/StopPinMap";
import { hasPin } from "../../lib/stopMarkers";
import { formatPeso } from "../../lib/format";

const emptyForm = { origin: "", destination: "", distance: "", baseFare: "", specialFare: "" };

const PIN_FILTERS = [
  {
    key: "pin",
    label: "Filter by map pin",
    type: "chips",
    defaultValue: "all",
    options: [
      { value: "all", label: "All" },
      { value: "pinned", label: "Pinned" },
      { value: "unpinned", label: "Not pinned" },
    ],
    match: (r, value) => (value === "pinned" ? hasPin(r) : !hasPin(r)),
  },
];

// Table 4's Route Management: add/edit routes, and "deactivate" (not
// delete — routes.is_active) since past trips still reference the row.
//
// Note: routes here are one row per km post along the Baguio–Bontoc line
// (161 of them, from the digitized fare chart) rather than a handful of
// city-pair routes, so this page has a search box instead of assuming the
// whole list fits on screen.
//
// Each row is also a bus stop: "Pin on map" (StopPinMap) sets where that
// stop really is, and the tracking maps show it. The Pinned filter makes it
// easy to work through the stops that still need a pin.
export default function AdminRouteManagement() {
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(null); // null | 'new' | route object
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [pinning, setPinning] = useState(null); // route whose pin dialog is open

  function load() {
    api.getAdminRoutes().then(setRoutes).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  const pinnedCount = useMemo(() => routes.filter(hasPin).length, [routes]);

  // Patch the saved row in place (no reload) so the table keeps its scroll
  // position while the admin works down the list pinning stops.
  function handlePinSaved(updated, outcome) {
    setRoutes((prev) => prev.map((r) => (r.route_id === updated.route_id ? { ...r, ...updated } : r)));
    setPinning(null);
    setError("");
    setSuccess(outcome === "cleared" ? `Pin removed for ${updated.destination}.` : `${updated.destination} pinned on the map.`);
  }

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(route) {
    setForm({
      origin: route.origin,
      destination: route.destination,
      distance: route.distance ?? "",
      baseFare: route.base_fare,
      specialFare: route.special_fare ?? "",
    });
    setEditing(route);
  }

  async function handleSave(e) {
    setError("");
    setSuccess("");
    e.preventDefault();
    if (!form.origin || !form.destination || form.baseFare === "") {
      setError("Origin, destination and base fare are required.");
      return;
    }
    if (Number(form.baseFare) < 0) {
      setError("Base fare can't be negative.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const payload = {
        origin: form.origin,
        destination: form.destination,
        distance: form.distance || null,
        baseFare: Number(form.baseFare),
        specialFare: form.specialFare === "" ? null : Number(form.specialFare),
      };
      if (editing === "new") {
        await api.createRoute(payload);
        setSuccess("Route created.");
      } else {
        await api.updateRoute(editing.route_id, payload);
        setSuccess("Route updated.");
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(route) {
    setError("");
    setSuccess("");
    if (!window.confirm(`${route.is_active ? "Deactivate" : "Reactivate"} ${route.origin} → ${route.destination}?`)) return;
    try {
      await api.setRouteActive(route.route_id, !route.is_active);
      setSuccess(`Route ${route.is_active ? "deactivated" : "reactivated"}.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = [
    { key: "origin", header: "Origin", truncate: true, render: (r) => <span className="font-medium">{r.origin}</span> },
    { key: "destination", header: "Destination", truncate: true, primary: true, render: (r) => <span className="font-medium">{r.destination}</span> },
    { key: "distance", header: "Distance (km)", type: "number", render: (r) => <span className="text-gray-600 tabular-nums">{r.distance ?? "—"}</span> },
    { key: "base_fare", header: "Regular Fare", type: "number", render: (r) => <span className="text-gray-600 tabular-nums">{formatPeso(r.base_fare)}</span> },
    {
      key: "special_fare",
      header: "Student/Special Fare",
      type: "number",
      render: (r) => <span className="text-gray-600 tabular-nums">{r.special_fare != null ? formatPeso(r.special_fare) : "—"}</span>,
    },
    {
      key: "is_active",
      header: "Status",
      type: "status",
      accessor: (r) => (r.is_active ? "Active" : "Inactive"),
      render: (r) => <StatusBadge status={r.is_active ? "Active" : "Inactive"} />,
    },
    {
      key: "pinned",
      header: "Pinned",
      accessor: (r) => (hasPin(r) ? "Pinned" : "Not pinned"),
      render: (r) =>
        hasPin(r) ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap" title={`${Number(r.latitude).toFixed(6)}, ${Number(r.longitude).toFixed(6)}`}>
            <MapPin className="w-4 h-4 fill-emerald-100" /> Pinned
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
            <MapPin className="w-4 h-4" /> Not pinned
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <>
          <TextAction onClick={() => setPinning(r)}>
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> {hasPin(r) ? "Move pin" : "Pin"}
            <span className="sr-only"> {r.destination} on the map</span>
          </TextAction>
          <TextAction onClick={() => openEdit(r)}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
          </TextAction>
          <OverflowMenu
            label={`More actions for ${r.destination}`}
            items={[
              {
                label: r.is_active ? "Deactivate (hide from booking)" : "Reactivate",
                icon: Power,
                tone: r.is_active ? "danger" : undefined,
                onClick: () => toggleActive(r),
              },
            ]}
          />
        </>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="Routes"
        subtitle="Origins, destinations, distance, and regular / student fares."
        actions={
          <PrimaryButton icon={Plus} onClick={openNew}>
            Add Route
          </PrimaryButton>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <DataTable
        label="Routes"
        columns={columns}
        rows={routes}
        rowKey={(r) => r.route_id}
        isLoading={isLoading}
        syncUrl
        pageSize={25}
        searchKeys={["origin", "destination"]}
        searchPlaceholder="Search by origin or destination…"
        filters={PIN_FILTERS}
        rowClassName={(r) => (r.is_active ? "" : "opacity-60")}
        minWidth="64rem"
        emptyState={{ icon: RouteIcon, title: "No routes yet", description: "Add a route to start scheduling trips." }}
        toolbar={
          routes.length > 0 && (
            <span className="text-xs text-gray-500">
              {pinnedCount} of {routes.length} stops pinned
            </span>
          )
        }
      />

      {pinning && <StopPinMap route={pinning} allRoutes={routes} onSaved={handlePinSaved} onClose={() => setPinning(null)} />}

      {editing && (
        <Modal
          title={editing === "new" ? "Add Route" : "Edit Route"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <CancelButton onClick={() => setEditing(null)} />
              <SubmitButton form="route-form" isSaving={isSaving} />
            </>
          }
        >
          <form id="route-form" onSubmit={handleSave} className="space-y-3">
            <Field label="Origin">
              <input required value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} className="input" />
            </Field>
            <Field label="Destination">
              <input required value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className="input" />
            </Field>
            <Field label="Distance (km)">
              <input type="number" min="0" step="0.1" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} className="input" />
            </Field>
            <Field label="Regular Fare (₱)">
              <input required type="number" min="0" step="0.01" value={form.baseFare} onChange={(e) => setForm({ ...form, baseFare: e.target.value })} className="input" />
            </Field>
            <Field label="Student / Special Fare (₱)">
              <input type="number" min="0" step="0.01" value={form.specialFare} onChange={(e) => setForm({ ...form, specialFare: e.target.value })} className="input" />
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
