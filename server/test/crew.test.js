// Bus crew: a conductor with their own login works the trip alongside the
// driver (services/crew.js), and walk-on riders who flag the bus without
// the app take seats until the conductor marks them off. Same harness as
// tripLifecycle.test.js.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { setup, teardown, api, db, createStaff, createPassenger, createDriver, createTrip, PASSWORD } from "./helpers.js";

let admin;
let staff;

before(async () => {
  await setup();
  admin = await createStaff("Crew Admin", "admin");
  staff = await createStaff("Crew Staff", "staff");
  // A middle stop, so the route's fare list is Baguio -> Sabangan -> Bontoc.
  await db.query(`INSERT INTO routes (origin, destination, distance, base_fare) VALUES ('Baguio', 'Sabangan', 100, 250)`);
});
after(teardown);

async function createConductor(name = "Conductor") {
  const email = `conductor-${randomBytes(3).toString("hex")}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [r] = await db.query(`INSERT INTO drivers (name, email, password_hash, crew_role) VALUES (?, ?, ?, 'Conductor')`, [name, email, hash]);
  const login = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: "driver" } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return { id: r.insertId, token: login.data.token, user: login.data.user };
}

// A trip already on the road, with a driver and a conductor.
async function tripOnRoad({ capacity = 40 } = {}) {
  const driver = await createDriver();
  const conductor = await createConductor();
  const { tripId } = await createTrip({ hours: 1, capacity, driverId: driver.id });
  await db.query(`UPDATE trips SET conductor_id = ?, status = 'In Transit' WHERE trip_id = ?`, [conductor.id, tripId]);
  return { driver, conductor, tripId };
}

const walkOn = (token, tripId, count, dropStop = "Bontoc") =>
  api("POST", `/api/collections/trips/${tripId}/fares`, { token, body: { boardStop: "Baguio", dropStop, fareType: "regular", passengerCount: count } });

describe("conductor accounts", () => {
  test("login says the account is a conductor", async () => {
    const c = await createConductor();
    assert.equal(c.user.crewRole, "Conductor");
  });

  test("an admin schedules a trip with a conductor; a driver can't fill the conductor slot", async () => {
    const d = await createDriver();
    const c = await createConductor();
    const [[bus]] = await db.query(`SELECT bus_id FROM buses LIMIT 1`);
    const [[route]] = await db.query(`SELECT route_id FROM routes LIMIT 1`);
    const at = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace("T", " ");
    const body = { busId: bus.bus_id, driverId: d.id, routeId: route.route_id, departureTime: at(30), arrivalTime: at(34) };

    const wrong = await api("POST", "/api/trips", { token: admin.token, body: { ...body, conductorId: d.id } });
    assert.equal(wrong.status, 400);

    const asDriver = await api("POST", "/api/trips", { token: admin.token, body: { ...body, driverId: c.id } });
    assert.equal(asDriver.status, 400);
    assert.match(asDriver.data.error, /is a conductor, not a driver/);

    const ok = await api("POST", "/api/trips", { token: admin.token, body: { ...body, conductorId: c.id } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));

    // The same conductor can't be on another bus at the same time.
    const d2 = await createDriver();
    const [bus2] = await db.query(`INSERT INTO buses (plate_num, capacity) VALUES (?, 40)`, [`C${randomBytes(3).toString("hex")}`]);
    const clash = await api("POST", "/api/trips", { token: admin.token, body: { ...body, busId: bus2.insertId, driverId: d2.id, conductorId: c.id } });
    assert.equal(clash.status, 409);
    assert.match(clash.data.error, /conductor/);
  });
});

describe("the conductor works the trip", () => {
  test("sees it in their schedule and opens the manifest; only the driver moves the trip on; outsiders can't", async () => {
    const driver = await createDriver();
    const conductor = await createConductor();
    const { tripId } = await createTrip({ hours: 1, driverId: driver.id });
    await db.query(`UPDATE trips SET conductor_id = ? WHERE trip_id = ?`, [conductor.id, tripId]);

    const mine = await api("GET", `/api/trips?driverId=${conductor.id}`, { token: conductor.token });
    assert.equal(mine.status, 200);
    const row = mine.data.find((t) => t.trip_id === tripId);
    assert.equal(row?.my_role, "conductor");

    assert.equal((await api("GET", `/api/trips/${tripId}/manifest`, { token: conductor.token })).status, 200);
    const byConductor = await api("PATCH", `/api/trips/${tripId}/status`, { token: conductor.token, body: { status: "Boarding" } });
    assert.equal(byConductor.status, 409);
    assert.match(byConductor.data.error, /Only the driver/);
    assert.equal((await api("PATCH", `/api/trips/${tripId}/status`, { token: driver.token, body: { status: "Boarding" } })).status, 200);

    // GPS is the driver's job too: the conductor's phone can't report the bus.
    const [[trip]] = await db.query(`SELECT bus_id FROM trips WHERE trip_id = ?`, [tripId]);
    const gps = await api("POST", "/api/tracking", {
      token: conductor.token,
      body: { busId: trip.bus_id, latitude: 16.9, longitude: 120.9, timestamp: new Date().toISOString() },
    });
    assert.equal(gps.status, 403);

    const stranger = await createConductor();
    assert.equal((await api("GET", `/api/trips/${tripId}/manifest`, { token: stranger.token })).status, 403);
    assert.equal((await walkOn(stranger.token, tripId, 1)).status, 403);
  });
});

describe("walk-on riders", () => {
  test("take seats until the conductor marks them off", async () => {
    const { conductor, tripId } = await tripOnRoad({ capacity: 10 });
    const added = await walkOn(conductor.token, tripId, 3, "Sabangan");
    assert.equal(added.status, 201, JSON.stringify(added.data));
    assert.equal(added.data.occupancy.walk_ons_aboard, 3);
    assert.equal(added.data.occupancy.seats_left, 7);
    assert.equal(Number(added.data.amount), 750); // 3 x the Baguio -> Sabangan fare, priced by the server

    const off = await api("POST", `/api/collections/fares/${added.data.fare_id}/alight`, { token: conductor.token, body: {} });
    assert.equal(off.status, 200);
    assert.equal(off.data.occupancy.seats_left, 10);

    const undo = await api("POST", `/api/collections/fares/${added.data.fare_id}/alight`, { token: conductor.token, body: { undo: true } });
    assert.equal(undo.data.occupancy.walk_ons_aboard, 3);
  });

  test("a bus full of walk-ons refuses new Flag a Bus requests", async () => {
    const { conductor, tripId } = await tripOnRoad({ capacity: 2 });
    assert.equal((await walkOn(conductor.token, tripId, 2)).status, 201);
    const p = await createPassenger("Roadside Rider");
    const flag = await api("POST", "/api/bookings/flags", {
      token: p.token,
      body: { tripId, pickupLatitude: 16.9, pickupLongitude: 120.9, pickupAccuracy: 20 },
    });
    assert.equal(flag.status, 409);
    assert.match(flag.data.error, /already full/);
  });

  test("everyone still aboard is marked off when the trip completes", async () => {
    const { driver, conductor, tripId } = await tripOnRoad();
    const added = await walkOn(conductor.token, tripId, 2);
    assert.equal((await api("PATCH", `/api/trips/${tripId}/status`, { token: driver.token, body: { status: "Completed" } })).status, 200);
    const [[row]] = await db.query(`SELECT alighted_at FROM onboard_fares WHERE fare_id = ?`, [added.data.fare_id]);
    assert.ok(row.alighted_at);
  });
});

describe("remittance", () => {
  test("is recorded against the conductor, who is told the amount", async () => {
    const { conductor, tripId } = await tripOnRoad();
    assert.equal((await walkOn(conductor.token, tripId, 1)).status, 201);
    await db.query(`UPDATE trips SET status = 'Completed', completed_at = NOW() WHERE trip_id = ?`, [tripId]);
    const r = await api("POST", `/api/collections/trips/${tripId}/remittance`, { token: staff.token, body: { amount: 350 } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.cash_holder_name, "Conductor");
    const [[rm]] = await db.query(`SELECT driver_id FROM trip_remittances WHERE trip_id = ?`, [tripId]);
    assert.equal(rm.driver_id, conductor.id);
  });
});
