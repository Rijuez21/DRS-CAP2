import { useEffect, useState } from "react";
import { RadioTower } from "lucide-react";
import * as api from "../../lib/api";
import EmptyState from "../../components/common/EmptyState";
import RoutePlayback from "../../components/common/RoutePlayback";
import FleetPlayback from "../../components/common/FleetPlayback";

const ALL = "all";

// Bus owner's route playback: replay where their buses went over a time
// range — all of them together on one clock (FleetPlayback, the default
// when they have more than one), or one bus with its route snapped to the
// roads (RoutePlayback, same player as the admin GPS Tracker's Playback
// tab). The server only returns history for buses linked to this owner
// (GET /api/owners/me/history and /me/history/all).
export default function OwnerPlayback() {
  const [buses, setBuses] = useState(null);
  const [busId, setBusId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getMyFleet()
      .then((rows) => {
        setBuses(rows);
        if (rows.length > 0) setBusId(rows.length > 1 ? ALL : String(rows[0].busId));
      })
      .catch((err) => setError(err.message));
  }, []);

  const bus = buses?.find((b) => String(b.busId) === busId) ?? null;

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Route Playback</h1>
          <p className="text-sm text-gray-500">Replay where your buses went — all together or one at a time, over up to 7 days.</p>
        </div>
        {buses?.length > 0 && (
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-gray-500">Bus</span>
            <select value={busId} onChange={(e) => setBusId(e.target.value)} className="input">
              {buses.length > 1 && <option value={ALL}>All buses ({buses.length})</option>}
              {buses.map((b) => (
                <option key={b.busId} value={b.busId}>
                  {b.busNumber ? `${b.busNumber} · ` : ""}
                  {b.plateNum}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      {!buses && !error ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : buses?.length === 0 ? (
        <EmptyState
          icon={RadioTower}
          title="No buses linked to your account yet"
          description="Ask the terminal administrator to link your buses to your owner account."
        />
      ) : busId === ALL ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <FleetPlayback loadHistory={api.getMyFleetHistory} />
        </div>
      ) : (
        bus && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            {/* key: switching bus starts a fresh player instead of showing the old bus's route */}
            <RoutePlayback key={bus.busId} bus={bus} loadHistory={api.getMyBusHistory} />
          </div>
        )
      )}
    </div>
  );
}
