import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import InlineAlert from "../../components/common/InlineAlert";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

const ITEMS = [
  { key: "engineOk", label: "Engine" },
  { key: "tiresOk", label: "Tires" },
  { key: "brakesOk", label: "Brakes" },
  { key: "lightsOk", label: "Lights" },
  { key: "fuelOk", label: "Fuel" },
  { key: "cleanlinessOk", label: "Cleanliness" },
];

function checksFromRow(row) {
  return {
    engineOk: !!row.engine_ok,
    tiresOk: !!row.tires_ok,
    brakesOk: !!row.brakes_ok,
    lightsOk: !!row.lights_ok,
    fuelOk: !!row.fuel_ok,
    cleanlinessOk: !!row.cleanliness_ok,
  };
}

// Pre-trip checklist, one per trip; saving again updates it. Two old bugs:
// the second save was rejected by the server, and switching to a trip with
// no checklist kept showing the previous trip's ticks (the "not found"
// response was swallowed without resetting the form).
export default function VehicleChecklist() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = searchParams.get("tripId");
  const [trips, setTrips] = useState([]);
  const [checks, setChecks] = useState({});
  const [notes, setNotes] = useState("");
  const [savedAt, setSavedAt] = useState(null); // when this trip's checklist was last saved, if ever
  const [loadedFor, setLoadedFor] = useState(null); // tripId the form currently reflects
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!tripId) return undefined;
    let cancelled = false;
    api
      .getChecklist(tripId)
      .then((row) => {
        if (cancelled) return;
        setChecks(checksFromRow(row));
        setNotes(row.notes ?? "");
        setSavedAt(row.submitted_at ?? true);
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 = nothing submitted for this trip yet: start from a blank form.
        setChecks({});
        setNotes("");
        setSavedAt(null);
        if (err.status !== 404) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(tripId);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  function chooseTrip(id) {
    setError("");
    setSuccess("");
    setLoadedFor(null);
    setSearchParams(id ? { tripId: id } : {});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);
    try {
      const result = await api.submitChecklist({ tripId: Number(tripId), notes, ...checks });
      setSavedAt(new Date().toISOString());
      setSuccess(
        result.allOk
          ? "Checklist saved — all items OK. You're ready to go."
          : "Saved. Some items aren't ticked — fix them or add a note, then save again."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const trip = trips.find((t) => String(t.trip_id) === String(tripId));
  const locked = trip && (trip.status === "Completed" || trip.status === "Cancelled");
  const doneCount = ITEMS.filter((i) => checks[i.key]).length;
  const ready = tripId && loadedFor === tripId;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-xl">
      <header>
        <h1 className="text-xl font-bold">Pre-Trip Checklist</h1>
        <p className="text-sm text-gray-500">Check each item before you start boarding. You can save and come back.</p>
      </header>

      <select value={tripId ?? ""} onChange={(e) => chooseTrip(e.target.value)} className="input bg-white">
        <option value="">Select a trip…</option>
        {trips
          .filter((t) => t.status !== "Cancelled")
          .map((t) => (
            <option key={t.trip_id} value={t.trip_id}>
              {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(t.departure_time)} · {t.origin} → {t.destination} · {t.plate_num}
            </option>
          ))}
      </select>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {tripId && !ready && <p className="text-sm text-gray-500">Loading checklist…</p>}

      {ready && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-4 space-y-3">
          <p className="text-sm text-gray-600 flex items-center justify-between">
            <span>
              {doneCount} of {ITEMS.length} checked
            </span>
            {savedAt && (
              <span className="flex items-center gap-1 text-emerald-700 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ITEMS.map((item) => (
              <label key={item.key} className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm ${checks[item.key] ? "border-emerald-300 bg-emerald-50" : ""}`}>
                <input
                  type="checkbox"
                  className="w-5 h-5"
                  disabled={locked}
                  checked={!!checks[item.key]}
                  onChange={(e) => setChecks((c) => ({ ...c, [item.key]: e.target.checked }))}
                />
                {item.label} OK
              </label>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={locked}
            placeholder="Notes — anything that needs attention (optional)"
            rows={3}
            className="input"
          />
          {locked ? (
            <p className="text-sm text-gray-600">This trip is {trip.status.toLowerCase()} — its checklist is read-only.</p>
          ) : (
            <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5">
              {isSubmitting ? "Saving…" : savedAt ? "Update checklist" : doneCount === ITEMS.length ? "Submit checklist" : "Save progress"}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
