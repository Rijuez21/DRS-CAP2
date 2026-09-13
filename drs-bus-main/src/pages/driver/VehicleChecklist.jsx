import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";

const ITEMS = [
  { key: "engineOk", label: "Engine" },
  { key: "tiresOk", label: "Tires" },
  { key: "brakesOk", label: "Brakes" },
  { key: "lightsOk", label: "Lights" },
  { key: "fuelOk", label: "Fuel" },
  { key: "cleanlinessOk", label: "Cleanliness" },
];

export default function VehicleChecklist() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = searchParams.get("tripId");

  const [trips, setTrips] = useState([]);
  const [checks, setChecks] = useState({});
  const [notes, setNotes] = useState("");
  const [existing, setExisting] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!tripId) return;
    api
      .getChecklist(tripId)
      .then((row) => {
        setExisting(row);
        if (row) {
          setChecks({
            engineOk: !!row.engine_ok,
            tiresOk: !!row.tires_ok,
            brakesOk: !!row.brakes_ok,
            lightsOk: !!row.lights_ok,
            fuelOk: !!row.fuel_ok,
            cleanlinessOk: !!row.cleanliness_ok,
          });
          setNotes(row.notes ?? "");
        } else {
          setChecks({});
          setNotes("");
        }
      })
      .catch(() => {});
  }, [tripId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      await api.submitChecklist({ tripId: Number(tripId), driverId: user.id, notes, ...checks });
      setMessage("Checklist saved.");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const allChecked = ITEMS.every((i) => checks[i.key]);

  return (
    <div className="p-6 space-y-4 max-w-lg">
      <header>
        <h1 className="text-xl font-bold">Pre-Trip Vehicle Checklist</h1>
        <p className="text-sm text-gray-500">Complete before departure.</p>
      </header>

      <select
        value={tripId ?? ""}
        onChange={(e) => setSearchParams(e.target.value ? { tripId: e.target.value } : {})}
        className="border rounded px-3 py-2 text-sm bg-white w-full"
      >
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.trip_id} value={t.trip_id}>
            {t.origin} → {t.destination} · {new Date(t.departure_time).toLocaleString("en-PH")}
          </option>
        ))}
      </select>

      {tripId && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-4 space-y-3">
          {existing && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1">
              Already submitted for this trip — saving again will update it.
            </p>
          )}
          {ITEMS.map((item) => (
            <label key={item.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!checks[item.key]}
                onChange={(e) => setChecks((c) => ({ ...c, [item.key]: e.target.checked }))}
              />
              {item.label}
            </label>
          ))}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full border rounded px-3 py-2 text-sm"
            rows={3}
          />
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
          >
            {isSubmitting ? "Saving…" : allChecked ? "Submit Checklist" : "Save Progress"}
          </button>
        </form>
      )}
    </div>
  );
}
