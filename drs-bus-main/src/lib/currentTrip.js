// A crew member works one trip at a time (the server allows only one
// Boarding / In Transit trip per driver, conductor and bus), so the crew
// pages don't ask which trip: they show the one that's running, or, before
// it starts, the next one. Missed trips (sent to the office) are skipped.
export function pickCurrentTrip(trips) {
  const live = trips.filter((t) => !t.missed_at);
  return (
    live.find((t) => t.status === "In Transit") ??
    live.find((t) => t.status === "Boarding") ??
    live
      .filter((t) => t.status === "Scheduled")
      .sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time))[0] ??
    null
  );
}
