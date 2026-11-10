import { pool } from "../db/pool.js";
import { DISCOUNT_RATE } from "./discounts.js";

// Cash accountability: what a trip collected, where the money went, and
// whether the conductor's remittance matches what was recorded on board.
//
// Money for a trip arrives three ways:
//   online   — paid to the operator's account, verified by staff (payments)
//   terminal — cash taken by staff at the counter (walk-in sales, and online
//              bookings paid in cash via Validate Reservation)
//   on board — cash the conductor collects (onboard_fares): flagged riders
//              and walk-on passengers who board along the road without the app
// Only the on-board cash passes through the conductor's hands, so that is
// what the remittance after the trip is checked against.

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ---- Fares between stops -------------------------------------------------
// The fare list (routes) gives one fare per stop, always between the hub
// (Baguio) and that stop, in both directions. A ride between two stops is
// charged the difference between their hub fares; from or to the hub itself
// that is simply the listed fare. Discounted riders (student / PWD / senior)
// pay the listed special fare, or 20% off where none is listed.
// Never below the cheapest listed fare.

// Returns { hub, outbound, stops: [{ name, distance, regular, discounted }] }
// ordered in the trip's direction of travel, or null if no fare list exists.
export async function fareStopsForTrip(conn, trip) {
  const [[outCount]] = await conn.query(`SELECT COUNT(*) AS n FROM routes WHERE origin = ? AND is_active = TRUE`, [trip.origin]);
  const outbound = outCount.n > 1;
  const hub = outbound ? trip.origin : trip.destination;
  const [rows] = await conn.query(
    outbound
      ? `SELECT destination AS name, distance, base_fare, special_fare FROM routes WHERE origin = ? AND is_active = TRUE AND distance <= ? ORDER BY distance, route_id`
      : `SELECT origin AS name, distance, base_fare, special_fare FROM routes WHERE destination = ? AND is_active = TRUE AND distance <= ? ORDER BY distance, route_id`,
    [hub, trip.distance ?? 100000]
  );
  if (rows.length === 0) return null;
  const seen = new Set();
  const stops = [{ name: hub, distance: 0, regular: 0, discounted: 0 }];
  for (const r of rows) {
    if (seen.has(r.name) || r.name === hub) continue;
    seen.add(r.name);
    const regular = round2(r.base_fare);
    const discounted = r.special_fare != null ? round2(r.special_fare) : round2(regular * (1 - DISCOUNT_RATE));
    stops.push({ name: r.name, distance: Number(r.distance), regular, discounted });
  }
  const priced = stops.filter((s) => s.distance > 0);
  const minimum = {
    regular: priced.length ? Math.min(...priced.map((s) => s.regular)) : 0,
    discounted: priced.length ? Math.min(...priced.map((s) => s.discounted)) : 0,
  };
  return { hub, outbound, minimum, stops: outbound ? stops : stops.reverse() };
}

// Fare per rider between two stops, or { error }.
export function fareBetween(fareList, boardStop, dropStop, fareType) {
  const idx = (name) => fareList.stops.findIndex((s) => s.name === name);
  const a = idx(boardStop);
  const b = idx(dropStop);
  if (a === -1) return { error: "Choose where the passenger boarded from the list" };
  if (b === -1) return { error: "Choose where the passenger gets off from the list" };
  if (b <= a) return { error: "The drop-off stop must come after the boarding stop on this route" };
  const key = fareType === "discounted" ? "discounted" : "regular";
  const diff = round2(Math.abs(fareList.stops[b][key] - fareList.stops[a][key]));
  return { fare: Math.max(diff, fareList.minimum[key]) };
}

// ---- Trip collection rows (remittances page + reports) -------------------
const TRIP_COLLECTION_SQL = `
  SELECT tr.trip_id, tr.departure_time, tr.status AS trip_status, tr.completed_at,
         rt.origin, rt.destination, rt.base_fare,
         b.bus_id, b.plate_num, b.bus_number, d.driver_id, d.name AS driver_name,
         (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = tr.trip_id AND x.status = 'Boarded' AND x.channel = 'online') AS boarded_online,
         (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = tr.trip_id AND x.status = 'Boarded' AND x.channel = 'walk_in') AS boarded_walk_in,
         (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = tr.trip_id AND x.status = 'Boarded' AND x.channel = 'flagged') AS boarded_flagged,
         (SELECT COALESCE(SUM(f.passenger_count), 0) FROM onboard_fares f WHERE f.trip_id = tr.trip_id AND f.voided_at IS NULL AND f.booking_id IS NULL) AS walk_on_passengers,
         (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = tr.trip_id AND x.channel = 'flagged' AND x.status = 'Boarded'
            AND NOT EXISTS (SELECT 1 FROM onboard_fares f WHERE f.booking_id = x.booking_id AND f.voided_at IS NULL)) AS flagged_unpaid,
         (SELECT COALESCE(SUM(f.amount), 0) FROM onboard_fares f WHERE f.trip_id = tr.trip_id AND f.voided_at IS NULL) AS onboard_cash,
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN bookings x ON x.booking_id = p.booking_id
            WHERE x.trip_id = tr.trip_id AND p.status = 'Verified') AS online_paid,
         (SELECT COUNT(*) FROM bookings x WHERE x.trip_id = tr.trip_id AND x.channel = 'walk_in' AND x.status <> 'Cancelled') AS walk_in_tickets,
         (SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.details, '$.fare')) AS DECIMAL(10,2))), 0)
            FROM audit_log a JOIN bookings x ON x.booking_id = a.entity_id
            WHERE a.entity_type = 'booking' AND a.action = 'counter_payment' AND x.trip_id = tr.trip_id AND x.status <> 'Cancelled') AS counter_cash,
         rm.remittance_id, rm.expected_amount, rm.remitted_amount, rm.received_at, rm.notes AS remittance_notes,
         rm.corrected_at, s.name AS received_by_name, cs.name AS corrected_by_name
  FROM trips tr
  JOIN routes rt ON rt.route_id = tr.route_id
  JOIN buses b ON b.bus_id = tr.bus_id
  JOIN drivers d ON d.driver_id = tr.driver_id
  LEFT JOIN trip_remittances rm ON rm.trip_id = tr.trip_id
  LEFT JOIN staff_accounts s ON s.staff_id = rm.received_by
  LEFT JOIN staff_accounts cs ON cs.staff_id = rm.corrected_by`;

// Status of the cash check for one trip.
//   On the road         — trip not finished yet, nothing to remit
//   Awaiting remittance — completed, conductor hasn't turned the cash over
//   Balanced / Short / Over — remitted vs the on-board cash recorded
function shapeRow(r) {
  const onboardCash = round2(r.onboard_cash);
  const expected = r.remittance_id ? round2(r.expected_amount) : onboardCash;
  const remitted = r.remittance_id ? round2(r.remitted_amount) : null;
  const difference = remitted == null ? null : round2(remitted - expected);
  const status =
    r.trip_status !== "Completed" ? "On the road"
      : remitted == null ? "Awaiting remittance"
        : difference < 0 ? "Short"
          : difference > 0 ? "Over"
            : "Balanced";
  const walkInCash = round2(Number(r.walk_in_tickets) * Number(r.base_fare));
  const counterCash = round2(r.counter_cash);
  const onlinePaid = round2(r.online_paid);
  return {
    trip_id: r.trip_id,
    departure_time: r.departure_time,
    trip_status: r.trip_status,
    origin: r.origin,
    destination: r.destination,
    bus_id: r.bus_id,
    plate_num: r.plate_num,
    bus_number: r.bus_number,
    driver_id: r.driver_id,
    driver_name: r.driver_name,
    passengers: {
      online: Number(r.boarded_online),
      walk_in: Number(r.boarded_walk_in),
      flagged: Number(r.boarded_flagged),
      walk_on: Number(r.walk_on_passengers),
      total: Number(r.boarded_online) + Number(r.boarded_walk_in) + Number(r.boarded_flagged) + Number(r.walk_on_passengers),
    },
    flagged_unpaid: Number(r.flagged_unpaid),
    collected: {
      online: onlinePaid,
      terminal: round2(walkInCash + counterCash),
      on_board: onboardCash,
      total: round2(onlinePaid + walkInCash + counterCash + onboardCash),
    },
    remittance: r.remittance_id
      ? { remittance_id: r.remittance_id, expected, remitted, received_at: r.received_at, received_by: r.received_by_name, notes: r.remittance_notes, corrected_at: r.corrected_at, corrected_by: r.corrected_by_name }
      : null,
    expected_remittance: expected,
    difference,
    status,
  };
}

export async function tripCollections({ from, to, tripId } = {}) {
  const where = tripId ? "WHERE tr.trip_id = ?" : "WHERE tr.status <> 'Cancelled' AND DATE(tr.departure_time) BETWEEN ? AND ?";
  const [rows] = await pool.query(`${TRIP_COLLECTION_SQL} ${where} ORDER BY tr.departure_time DESC, tr.trip_id DESC`, tripId ? [tripId] : [from, to]);
  return rows.map(shapeRow);
}

// Daily totals over a date range, newest day first.
export function dailySummary(trips) {
  const byDay = new Map();
  for (const t of trips) {
    const d = new Date(t.departure_time);
    const day = new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10); // Philippine date
    const s = byDay.get(day) ?? { day, trips: 0, passengers: 0, online: 0, terminal: 0, on_board: 0, total: 0, remitted: 0, awaiting: 0, short_trips: 0, shortage: 0 };
    s.trips += 1;
    s.passengers += t.passengers.total;
    s.online = round2(s.online + t.collected.online);
    s.terminal = round2(s.terminal + t.collected.terminal);
    s.on_board = round2(s.on_board + t.collected.on_board);
    s.total = round2(s.total + t.collected.total);
    if (t.remittance) s.remitted = round2(s.remitted + t.remittance.remitted);
    if (t.status === "Awaiting remittance") s.awaiting += 1;
    if (t.status === "Short") { s.short_trips += 1; s.shortage = round2(s.shortage - t.difference); }
    byDay.set(day, s);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
