import { useEffect, useMemo, useState } from "react";
import { Route as RouteIcon, Plus, Pencil, Power, Search, MapPin } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import StopPinMap from "../../components/admin/StopPinMap";
import { hasPin } from "../../lib/stopMarkers";

const emptyForm = { origin: "", destination: "", distance: "", baseFare: "", specialFare: "" };

const PIN_FILTERS = [
  { value: "all", label: "All" },
  { value: "pinned", label: "Pinned" },
  { value: "unpinned", label: "Not pinned" },
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
  const [search, setSearch] = useState("");
  const [pinFilter, setPinFilter] = useState("all");
  const [pinning, setPinning] = useState(null); // route whose pin dialog is open

  function load() {
    api.getAdminRoutes().then(setRoutes).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  const pinnedCount = useMemo(() => routes.filter(hasPin).length, [routes]);

  // Search and the Pinned filter narrow the list together.
  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return routes.filter((r) => {
      if (pinFilter === "pinned" && !hasPin(r)) return false;
      if (pinFilter === "unpinned" && hasPin(r)) return false;
      return !q || r.origin.toLowerCase().includes(q) || r.destination.toLowerCase().includes(q);
    });
  }, [routes, search, pinFilter]);

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

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Route Management</h1>
          <p className="text-sm text-gray-500">Origins, destinations, distance, and regular / student fares.</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded"
        >
          <Plus className="w-4 h-4" /> Add Route
        </button>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {!isLoading && routes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by origin or destination…"
              className="input pl-9"
            />
          </div>
          <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label="Filter by map pin">
            {PIN_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setPinFilter(f.value)}
                aria-pressed={pinFilter === f.value}
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${pinFilter === f.value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">
            {pinnedCount} of {routes.length} stops pinned
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : routes.length === 0 ? (
        <EmptyState icon={RouteIcon} title="No routes yet" description="Add a route to start scheduling trips." />
      ) : filteredRoutes.length === 0 ? (
        <p className="text-sm text-gray-500">
          {search.trim()
            ? `No ${pinFilter === "pinned" ? "pinned " : pinFilter === "unpinned" ? "unpinned " : ""}routes match "${search.trim()}".`
            : pinFilter === "pinned"
              ? "No stops are pinned yet. Use the pin button on a row to place one."
              : "Every stop is pinned."}
        </p>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-3">Origin</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Distance (km)</th>
                <th className="px-4 py-3">Regular Fare</th>
                <th className="px-4 py-3">Student/Special Fare</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pinned</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredRoutes.map((r) => (
                <tr key={r.route_id} className={r.is_active ? "" : "opacity-60"}>
                  <td className="px-4 py-3 font-medium">{r.origin}</td>
                  <td className="px-4 py-3">{r.destination}</td>
                  <td className="px-4 py-3 text-gray-600">{r.distance ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">₱{r.base_fare}</td>
                  <td className="px-4 py-3 text-gray-600">{r.special_fare != null ? `₱${r.special_fare}` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${r.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {hasPin(r) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700" title={`${Number(r.latitude).toFixed(6)}, ${Number(r.longitude).toFixed(6)}`}>
                        <MapPin className="w-4 h-4 fill-emerald-100" /> Pinned
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                        <MapPin className="w-4 h-4" /> Not pinned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setPinning(r)}
                      aria-label={`Pin ${r.destination} on map`}
                      title={hasPin(r) ? "Move or clear the map pin" : "Pin on map"}
                      className={`inline-flex items-center ${hasPin(r) ? "text-emerald-700 hover:text-emerald-600" : "text-gray-500 hover:text-emerald-700"}`}
                    >
                      <MapPin className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => openEdit(r)} aria-label="Edit" title="Edit" className="text-gray-500 hover:text-emerald-700 inline-flex items-center">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => toggleActive(r)} aria-label={r.is_active ? "Deactivate" : "Activate"} title={r.is_active ? "Deactivate route (hide from booking)" : "Activate route"} className="text-gray-500 hover:text-rose-600 inline-flex items-center">
                      <Power className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {routes.length > 0 && (
        <p className="text-xs text-gray-400">
          Showing {filteredRoutes.length} of {routes.length} routes.
        </p>
      )}

      {pinning && <StopPinMap route={pinning} allRoutes={routes} onSaved={handlePinSaved} onClose={() => setPinning(null)} />}

      {editing && (
        <Modal
          title={editing === "new" ? "Add Route" : "Edit Route"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-semibold text-gray-600">
                Cancel
              </button>
              <button
                type="submit"
                form="route-form"
                disabled={isSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
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
