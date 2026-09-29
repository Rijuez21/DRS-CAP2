import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

export default function RouteSchedule() {
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch((err) => setError(err.message));
  }, [user]);

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Route Schedule</h1>
        <p className="text-sm text-gray-500">
          All your assigned trips, earliest first.
        </p>
      </header>

      {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

      <div className="bg-white rounded-lg border divide-y">
        {trips.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No trips scheduled.</p>
        ) : (
          trips.map((t) => (
            <div key={t.trip_id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {t.origin} → {t.destination}
                </p>
                <p className="text-xs text-gray-500">{formatDate(t.departure_time)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{formatTime(t.departure_time)}</p>
                <p className="text-xs text-gray-500">{t.status}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
