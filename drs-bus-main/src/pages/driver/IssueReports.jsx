import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate } from "../../lib/format";

const CATEGORIES = ["mechanical", "safety", "passenger", "route", "other"];

export default function IssueReports() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [issues, setIssues] = useState([]);
  const [tripId, setTripId] = useState("");
  const [category, setCategory] = useState("mechanical");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch(() => {});
    api.getIssues(user.id).then(setIssues).catch(() => {});
  }

  useEffect(reload, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const selectedTrip = trips.find((t) => String(t.trip_id) === tripId);
    if (!selectedTrip) {
      setError("Select the trip this issue relates to.");
      return;
    }
    if (!description) {
      setError("Describe the issue.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.submitIssue({
        tripId: selectedTrip.trip_id,
        busId: selectedTrip.bus_id,
        driverId: user.id,
        category,
        description,
      });
      setDescription("");
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-lg">
      <header>
        <h1 className="text-xl font-bold">Issue Reports</h1>
        <p className="text-sm text-gray-500">Report a mechanical, safety, or route issue.</p>
      </header>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-4 space-y-3">
        <select
          value={tripId}
          onChange={(e) => setTripId(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          <option value="">Which trip?</option>
          {trips.map((t) => (
            <option key={t.trip_id} value={t.trip_id}>
              {t.origin} → {t.destination} · {t.plate_num}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened…"
          className="w-full border rounded px-3 py-2 text-sm"
          rows={4}
        />

        {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded"
        >
          {isSubmitting ? "Submitting…" : "Submit Report"}
        </button>
      </form>

      <div>
        <h2 className="font-semibold mb-2">Your Reports</h2>
        <div className="bg-white rounded-lg border divide-y">
          {issues.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No reports submitted yet.</p>
          ) : (
            issues.map((i) => (
              <div key={i.issue_id} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">
                    {i.category[0].toUpperCase() + i.category.slice(1)} · {i.plate_num}
                  </p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {i.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{i.description}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDate(i.reported_at)}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
