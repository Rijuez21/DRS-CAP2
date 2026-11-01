import { pool } from "../db/pool.js";
import { notifyRecipient } from "./notify.js";

// "Your bus leaves soon" — about an hour before departure, every passenger
// with a Confirmed online seat gets one reminder per trip (bell and email;
// see notify.js). Runs on a timer, index.js.
// bookings.reminder_sent_at makes it once-only, even with several server
// instances: the UPDATE below claims the bookings before anything is sent.

const RUN_EVERY_MS = 5 * 60 * 1000;
const REMIND_WITHIN_MINUTES = 75;

const manilaTime = (d) => new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

export async function sendDepartureReminders(io) {
  const [due] = await pool.query(
    `SELECT bk.passenger_id, t.trip_id, t.departure_time, rt.origin, rt.destination, b.plate_num, b.bus_number,
            GROUP_CONCAT(bk.seat_number ORDER BY bk.seat_number SEPARATOR ', ') AS seats,
            GROUP_CONCAT(bk.booking_id) AS booking_ids
     FROM bookings bk
     JOIN trips t ON t.trip_id = bk.trip_id
     JOIN routes rt ON rt.route_id = t.route_id
     JOIN buses b ON b.bus_id = t.bus_id
     WHERE bk.status = 'Confirmed' AND bk.channel = 'online' AND bk.reminder_sent_at IS NULL
       AND t.status IN ('Scheduled', 'Boarding')
       AND t.departure_time BETWEEN NOW() AND NOW() + INTERVAL ? MINUTE
     GROUP BY bk.passenger_id, t.trip_id, t.departure_time, rt.origin, rt.destination, b.plate_num, b.bus_number
     LIMIT 500`,
    [REMIND_WITHIN_MINUTES]
  );
  let sent = 0;
  for (const r of due) {
    const ids = String(r.booking_ids).split(",").map(Number);
    const [claim] = await pool.query(
      `UPDATE bookings SET reminder_sent_at = NOW() WHERE booking_id IN (?) AND reminder_sent_at IS NULL`,
      [ids]
    );
    if (claim.affectedRows === 0) continue; // another instance got it
    const seatWord = ids.length === 1 ? "seat" : "seats";
    const bus = r.bus_number ? `Bus ${r.bus_number} (${r.plate_num})` : r.plate_num;
    await notifyRecipient(
      io,
      { type: "passenger", id: r.passenger_id },
      `Reminder: your bus from ${r.origin} to ${r.destination} leaves at ${manilaTime(r.departure_time)} — ${bus}, ${seatWord} ${r.seats}. Please be at the terminal at least 15 minutes early.`,
      "departure_reminder"
    );
    sent += 1;
  }
  return sent;
}

let running = false;
export function startDepartureReminders(io) {
  const timer = setInterval(async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      await sendDepartureReminders(io);
    } catch (err) {
      console.error("Departure reminders failed (non-fatal):", err.message);
    } finally {
      running = false;
    }
  }, RUN_EVERY_MS);
  timer.unref?.();
  return timer;
}
