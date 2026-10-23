// Seat layouts through the real API: capacity derived from the layout,
// booking custom seat labels, the legacy fallback, and the 409 that stops
// an admin removing a seat someone has booked. Same harness as
// payments.test.js (real server + throwaway MySQL).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setup, teardown, api, db, createStaff, createPassenger, createTrip } from "./helpers.js";

let admin;
let staff;
let passenger;

before(async () => {
  await setup();
  admin = await createStaff("Layout Admin", "admin");
  staff = await createStaff("Layout Staff", "terminal_staff");
  passenger = await createPassenger("Layout Rider");
});
after(teardown);

const S = (l) => ({ t: "seat", l });
const A = { t: "aisle" };
const B = { t: "blank" };
// 2 + 1 seats per row, labelled by row: 1A 1B · 1C
const twoByOne = (rows = 3) => ({
  version: 1,
  cols: 4,
  rows: [[{ t: "driver" }, B, A, { t: "door" }], ...Array.from({ length: rows }, (_, i) => [S(`${i + 1}A`), S(`${i + 1}B`), A, S(`${i + 1}C`)])],
});
const plate = () => `L${randomBytes(3).toString("hex")}`;

async function createBus(body) {
  const r = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: plate(), ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.bus_id;
}

// A trip on a given bus, `hours` from now, with the given status.
async function tripOn(busId, { hours = 24, status = "Scheduled" } = {}) {
  const [route] = await db.query(`INSERT INTO routes (origin, destination, distance, base_fare) VALUES ('Baguio', 'Bontoc', 140, '350.00')`);
  const [d] = await db.query(`INSERT INTO drivers (name) VALUES ('Layout Driver')`);
  const [trip] = await db.query(
    `INSERT INTO trips (departure_time, arrival_time, status, bus_id, driver_id, route_id)
     VALUES (NOW() + INTERVAL ? MINUTE, NOW() + INTERVAL ? MINUTE, ?, ?, ?, ?)`,
    [Math.round(hours * 60), Math.round(hours * 60) + 240, status, busId, d.insertId, route.insertId]
  );
  return trip.insertId;
}

const bookSeats = (tripId, seatNumbers) => api("POST", "/api/bookings", { token: passenger.token, body: { tripId, seatNumbers } });

describe("saving a layout", () => {
  test("capacity is derived from the layout's seats", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const [[row]] = await db.query(`SELECT capacity, seat_layout FROM buses WHERE bus_id = ?`, [busId]);
    assert.equal(row.capacity, 9);
    assert.equal(row.seat_layout.rows.length, 4);

    const list = await api("GET", "/api/buses", { token: admin.token });
    const bus = list.data.find((b) => b.bus_id === busId);
    assert.equal(bus.capacity, 9);
    assert.deepEqual(bus.seat_layout, twoByOne(3));
  });

  test("a capacity that disagrees with the layout is refused", async () => {
    const r = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: plate(), capacity: 40, seatLayout: twoByOne(3) } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /doesn't match the seat layout, which has 9 seats/);
    const ok = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: plate(), capacity: 9, seatLayout: twoByOne(3) } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.capacity, 9);
  });

  test("editing the layout updates capacity; capacity alone can't drift from it", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: twoByOne(5) } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.capacity, 15);
    const [[row]] = await db.query(`SELECT capacity FROM buses WHERE bus_id = ?`, [busId]);
    assert.equal(row.capacity, 15);

    const drift = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { capacity: 40 } });
    assert.equal(drift.status, 400);
    const same = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { capacity: 15, boardingPoint: "Riken Star" } });
    assert.equal(same.status, 200);
  });

  test("invalid layouts are refused with a reason", async () => {
    const dup = twoByOne(2);
    dup.rows[2][0] = S("1A");
    for (const seatLayout of [dup, { rows: [[A, B]] }, { rows: [[S("1"), { t: "bench" }]] }, { rows: [[S("1"), S("2")], [S("3")]] }]) {
      const r = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: plate(), seatLayout } });
      assert.equal(r.status, 400, JSON.stringify(seatLayout));
      assert.ok(r.data.error);
    }
  });

  test("only admins can change a layout", async () => {
    const busId = await createBus({ capacity: 40 });
    const r = await api("PATCH", `/api/buses/${busId}`, { token: staff.token, body: { seatLayout: twoByOne(1) } });
    assert.equal(r.status, 403);
  });

  test("a bus created without a layout behaves as before", async () => {
    const busId = await createBus({ capacity: 40 });
    const [[row]] = await db.query(`SELECT capacity, seat_layout FROM buses WHERE bus_id = ?`, [busId]);
    assert.equal(row.capacity, 40);
    assert.equal(row.seat_layout, null);
  });
});

describe("booking custom seat labels", () => {
  test("seats are validated against the bus's labels", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const tripId = await tripOn(busId);

    const ok = await bookSeats(tripId, ["2b"]);
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.bookings[0].seat_number, "2B");

    assert.equal((await bookSeats(tripId, ["5"])).data.error, "Seat 5 doesn't exist on this bus");
    assert.equal((await bookSeats(tripId, ["4A"])).status, 400);
    const taken = await bookSeats(tripId, ["2B"]);
    assert.equal(taken.status, 409);
    assert.equal(taken.data.conflictSeat, "2B");
  });

  test("walk-in sales use the same labels", async () => {
    const busId = await createBus({ seatLayout: twoByOne(2) });
    const tripId = await tripOn(busId);
    const r = await api("POST", "/api/bookings/walk-in", { token: staff.token, body: { tripId, passengerName: "Counter Rider", seatNumbers: ["1C", "2a"], cashReceived: 700 } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(r.data.bookings.map((b) => b.seat_number), ["1C", "2A"]);
    const bad = await api("POST", "/api/bookings/walk-in", { token: staff.token, body: { tripId, passengerName: "Counter Rider", seatNumbers: ["3"], cashReceived: 350 } });
    assert.equal(bad.status, 400);
  });

  test("the seat map endpoint returns the layout", async () => {
    const busId = await createBus({ seatLayout: twoByOne(2) });
    const tripId = await tripOn(busId);
    await bookSeats(tripId, ["1A"]);
    const r = await api("GET", `/api/trips/${tripId}/seats`);
    assert.equal(r.status, 200);
    assert.equal(r.data.capacity, 6);
    assert.deepEqual(r.data.bookedSeats, ["1A"]);
    assert.equal(r.data.layoutSource, "custom");
    assert.deepEqual(r.data.layout, twoByOne(2));
  });

  test("the manifest sorts labels naturally", async () => {
    const busId = await createBus({ seatLayout: twoByOne(10) });
    const tripId = await tripOn(busId);
    for (const s of ["10A", "2A", "1B", "1A"]) assert.equal((await bookSeats(tripId, [s])).status, 201);
    const r = await api("GET", `/api/trips/${tripId}/manifest`, { token: staff.token });
    assert.deepEqual(r.data.map((b) => b.seat_number), ["1A", "1B", "2A", "10A"]);
  });
});

describe("legacy buses (no layout)", () => {
  test("seat map, booking and messages are unchanged", async () => {
    const { tripId } = await createTrip({ capacity: 40 });
    const seats = await api("GET", `/api/trips/${tripId}/seats`);
    assert.equal(seats.data.capacity, 40);
    assert.equal(seats.data.layoutSource, "legacy");
    assert.equal(seats.data.layout.cols, 5);
    const labels = seats.data.layout.rows.flat().filter((c) => c.t === "seat").map((c) => c.l);
    assert.deepEqual(labels, Array.from({ length: 40 }, (_, i) => String(i + 1)));

    assert.equal((await bookSeats(tripId, ["07"])).data.bookings[0].seat_number, "7");
    assert.equal((await bookSeats(tripId, ["41"])).data.error, "Seat 41 doesn't exist on this bus (seats 1–40)");
  });

  test("an admin can give a legacy bus a layout (no bookings in the way)", async () => {
    const busId = await createBus({ capacity: 40 });
    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: twoByOne(2) } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.capacity, 6);
  });
});

describe("protecting booked seats", () => {
  test("removing a booked seat is refused with the affected seats and trips", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const tripId = await tripOn(busId);
    await bookSeats(tripId, ["3C"]);

    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: twoByOne(2) } });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, "SEATS_IN_USE");
    assert.equal(r.data.affected.length, 1);
    assert.equal(r.data.affected[0].tripId, tripId);
    assert.deepEqual(r.data.affected[0].seats, ["3C"]);
    assert.match(r.data.error, /3C/);
    const [[row]] = await db.query(`SELECT capacity FROM buses WHERE bus_id = ?`, [busId]);
    assert.equal(row.capacity, 9, "nothing was saved");
  });

  test("renaming a booked seat is refused too; other edits go through", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const tripId = await tripOn(busId);
    await bookSeats(tripId, ["1A"]);

    const renamed = twoByOne(3);
    renamed.rows[1][0] = S("X1");
    assert.equal((await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: renamed } })).status, 409);

    const fewer = twoByOne(3);
    fewer.rows[3][3] = B; // drop the unbooked 3C; 1A stays
    const ok = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: fewer } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.capacity, 8);
  });

  test("cancelled bookings and finished trips don't block the change", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const tripId = await tripOn(busId);
    const { data } = await bookSeats(tripId, ["3A"]);
    await db.query(`UPDATE bookings SET status = 'Cancelled' WHERE booking_id = ?`, [data.bookings[0].booking_id]);
    const doneTrip = await tripOn(busId, { hours: -48, status: "Completed" });
    await db.query(`INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel) VALUES (?, ?, 'Old Rider', '3B', 'Boarded', 'online')`, [doneTrip, passenger.id]);

    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: twoByOne(2) } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });

  test("seats on an in-transit trip are protected", async () => {
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const tripId = await tripOn(busId, { hours: -1, status: "In Transit" });
    await db.query(`INSERT INTO bookings (trip_id, passenger_id, passenger_name, seat_number, status, channel) VALUES (?, ?, 'Rider', '3A', 'Boarded', 'online')`, [tripId, passenger.id]);
    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { seatLayout: twoByOne(2) } });
    assert.equal(r.status, 409);
  });

  test("legacy bus: shrinking capacity below a booked seat is refused", async () => {
    const busId = await createBus({ capacity: 40 });
    const tripId = await tripOn(busId);
    await bookSeats(tripId, ["38"]);
    const r = await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { capacity: 30 } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.data.affected[0].seats, ["38"]);
    assert.equal((await api("PATCH", `/api/buses/${busId}`, { token: admin.token, body: { capacity: 45 } })).status, 200);
  });

  test("swapping a trip onto a bus whose layout lacks a booked seat is refused", async () => {
    const { tripId } = await createTrip({ capacity: 40 });
    await bookSeats(tripId, ["12"]);
    const busId = await createBus({ seatLayout: twoByOne(3) });
    const r = await api("PATCH", `/api/trips/${tripId}`, { token: admin.token, body: { busId } });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /no seat 12/);
  });
});
