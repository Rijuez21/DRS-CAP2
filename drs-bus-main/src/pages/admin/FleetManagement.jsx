import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bus, MapPin } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";

const STATUS_STYLES = {
  Active: "bg-emerald-100 text-emerald-700",
  Idle: "bg-slate-100 text-slate-600",
  Maintenance: "bg-amber-100 text-amber-700",
};

// This is the Fleet Management Module's bus *records* view (add/edit
// buses, see status/capacity) — the proposal document treats it as
// separate from the Real-Time Tracking Module, so the live map lives at
// /admin/tracking (FleetTracking.jsx) rather than being merged in here.
export default function AdminFleetManagement() {
  const [buses, setBuses] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .getBuses()
      .then(setBuses)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Fleet Management</h1>
          <p className="text-sm text-gray-500">The bus roster — status, plate number, and capacity.</p>
        </div>
        <Link
          to="/admin/tracking"
          className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded"
        >
          <MapPin className="w-4 h-4" />
          View Live Tracking
        </Link>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {!isLoading && buses.length === 0 && !error ? (
        <EmptyState icon={Bus} title="No buses in the fleet yet" description="Add a bus to get started." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Plate Number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">Year Model</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {buses.map((bus) => (
                <tr key={bus.bus_id}>
                  <td className="px-4 py-3 font-medium">{bus.plate_num}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {bus.type === "air_conditioned" ? "Air-Conditioned" : "Ordinary"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{bus.capacity} seats</td>
                  <td className="px-4 py-3 text-gray-600">{bus.year_model ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        STATUS_STYLES[bus.status] ?? STATUS_STYLES.Idle
                      }`}
                    >
                      {bus.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
