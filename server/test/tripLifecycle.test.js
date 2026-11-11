// Driver trip rules and the trip sweeper (services/tripLifecycle.js):
// boarding window, one active trip at a time, no leaving early while a booked
// passenger hasn't boarded, missed trips flagged for the admins, forgotten
// arrivals completed. Same harness as payments.test.js.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, db, createStaff, createPassenger, createDriver, createTrip, sleep } from "./helpers.js";

let admin;

before(async () => {
  await setup({ env: { TRIP_SWEEP_INTERVAL_MS: "300" } });
  admin = await createStaff("Trip Admin", "admin");
});
after(teardown);

const move = (token, tripId, status) => api("PATCH", `/api/trips/${tripId}/status`, { token, body: { status } });
const tripRow = async (id) => (await db.query(`SELECT status, missed_at FROM trips WHERE trip_id = ?`, [id]))[0][0];

describe("boarding window", () => {
  test("opens 3 hours before departure; an admin can override", async () => {
    const d = await createDriver();
    const far = await createTrip({ hours: 5, driverId: d.id });
    const early = await move(d.token, far.tripId, "Boarding");
    assert.equal(early.status, 409);
    assert.match(early.data.error, /Boarding opens 3 hours before departure/);
    assert.equal((await move(admin.token, far.tripId, "Boarding")).status, 200, "admin override");

    const d2 = await createDriver();
    const soon = await createTrip({ hours: 1, driverId: d2.id });
    assert.equal((await move(d2.token, soon.tripId, "Boarding")).status, 200);
  });
});

describe("one active trip at a time", () => {
  test("a driver can't board a second trip while one is boarding", async () => {
    const d = await createDriver();
    const first = await createTrip({ hours: 1, driverId: d.id });
    const second = await createTrip({ hours: 2, driverId: d.id });
    assert.equal((await move(d.token, first.tripId, "Boarding")).status, 200);
    const r = await move(d.token, second.tripId, "Boarding");
    assert.equal(r.status, 409);
    assert.match(r.data.error, /still boarding Baguio → Bontoc/);
  });
});

describe("leaving early", () => {
  test("only once every booked passenger has boarded", async () => {
    const d = await createDriver();
    const { tripId } = await createTrip({ hours: 1, driverId: d.id });
    const p = await createPassenger("Ana Reyes");
    const booked = await api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers: ["4"] } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    assert.equal((await move(d.token, tripId, "Boarding")).status, 200);

    const blocked = await move(d.token, tripId, "In Transit");
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /1 booked passenger hasn't boarded yet: Seat 4 Ana Reyes/);

    const id = booked.data.bookings[0].booking_id;
    assert.equal((await api("PATCH", `/api/bookings/${id}/status`, { token: d.token, body: { status: "Boarded" } })).status, 200);
    assert.equal((await move(d.token, tripId, "In Transit")).status, 200, "everyone's on: leave early");
  });
});

describe("trip sweeper", () => {
  test("a trip that never departed is flagged for the admins and taken off the driver's hands and off sale", async () => {
    const d = await createDriver();
    const { tripId } = await createTrip({ hours: -4, driverId: d.id }); // boarding closes 3h after departure
    await sleep(1200);
    assert.ok((await tripRow(tripId)).missed_at, "flagged");
    assert.equal((await tripRow(tripId)).status, "Scheduled", "never cancelled automatically");

    const r = await move(d.token, tripId, "Boarding");
    assert.equal(r.status, 409);
    assert.match(r.data.error, /sent to the admin/);
    const bookable = await api("GET", "/api/trips?scope=bookable");
    assert.ok(!bookable.data.some((t) => t.trip_id === tripId));
    const [[told]] = await db.query(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'staff' AND type = 'trip_missed' AND message LIKE ?`, [`Trip #${tripId} %`]);
    assert.ok(Number(told.n) >= 1);

    // The admin closes it: it did run.
    assert.equal((await move(admin.token, tripId, "Completed")).status, 200);
    assert.equal((await tripRow(tripId)).status, "Completed");
  });

  test("a trip left In Transit long after arrival is completed; unboarded bookings become No-Show", async () => {
    const d = await createDriver();
    const { tripId } = await createTrip({ hours: -10, driverId: d.id }); // arrival = departure + 4h, so 6h ago
    const p = await createPassenger();
    const [b] = await db.query(
      `INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel) VALUES (?, ?, 'Late Rider', '9', 'Confirmed', 'online')`,
      [tripId, p.id]
    );
    await db.query(`UPDATE trips SET status = 'In Transit' WHERE trip_id = ?`, [tripId]);
    await sleep(1200);
    assert.equal((await tripRow(tripId)).status, "Completed");
    const [[booking]] = await db.query(`SELECT status FROM bookings WHERE booking_id = ?`, [b.insertId]);
    assert.equal(booking.status, "No-Show");
  });
});
