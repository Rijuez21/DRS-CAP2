// Security regression tests — one block per vulnerability that was fixed.
// Same harness as payments.test.js (real server + throwaway MySQL).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { setup, teardown, api, db, createStaff, createPassenger, createDriver, createTrip, BASE, PASSWORD, sleep } from "./helpers.js";
import { csvCell, likeEscape, dateTime } from "../src/services/validate.js";
import { whyPasswordWeak } from "../src/services/passwordPolicy.js";
import { describeDevice, cleanDeviceId } from "../src/services/device.js";
import { driverFirstName, passengerDriverName } from "../src/services/driverDisplay.js";
import bcrypt from "bcryptjs";

const bcryptHash = (password) => bcrypt.hash(password, 4);

let admin;

before(async () => {
  await setup();
  admin = await createStaff("Root Admin", "admin");
});
after(teardown);

// force: skips the "signed in on another device" warning, which most tests
// here aren't about (createPassenger etc. already signed the account in).
const login = (email, password, role) => api("POST", "/api/auth/login", { body: { email, password, role, force: true } });
const loginFrom = (deviceId, email, extra = {}) =>
  api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: "passenger", deviceId, ...extra } });

describe("one signed-in device per account", () => {
  test("logging in while another device is signed in warns first; continuing signs that device out", async () => {
    const p = await createPassenger("Two Phones");
    const phoneA = await loginFrom("device-aaaa-1111", p.email, { force: true });
    assert.equal(phoneA.status, 200);
    // Last used just now, from an Android phone.
    await db.query(`UPDATE auth_sessions SET device_label = 'Chrome on Android' WHERE account_kind = 'passenger' AND account_id = ?`, [p.id]);

    const warned = await loginFrom("device-bbbb-2222", p.email);
    assert.equal(warned.status, 409);
    assert.equal(warned.data.code, "SIGNED_IN_ELSEWHERE");
    assert.equal(warned.data.device, "Chrome on Android");
    assert.ok(warned.data.lastActiveAt);
    assert.ok(!warned.data.token, "no session is started until they confirm");
    assert.equal((await api("GET", "/api/payments/mine", { token: phoneA.data.token })).status, 200, "the first device is untouched");

    // The same browser logging in again (e.g. after closing the tab) isn't warned about itself.
    assert.equal((await loginFrom("device-aaaa-1111", p.email)).status, 200);

    // A wrong password never reveals the warning.
    assert.equal((await api("POST", "/api/auth/login", { body: { email: p.email, password: "Wrong-pass-1", role: "passenger", deviceId: "device-bbbb-2222" } })).status, 401);

    const second = await loginFrom("device-bbbb-2222", p.email, { force: true });
    assert.equal(second.status, 200);
    const old = await api("GET", "/api/payments/mine", { token: p.token });
    assert.equal(old.status, 401);
    assert.match(old.data.error, /another device/);
    assert.equal((await api("GET", "/api/payments/mine", { token: second.data.token })).status, 200);
    assert.equal((await api("GET", "/api/auth/session", { token: second.data.token })).status, 204);
  });

  test("no warning once the other device was signed out by a password reset or log out", async () => {
    const p = await createPassenger("Reset Elsewhere");
    await db.query(`UPDATE commuters SET password_hash = ? WHERE commuter_id = ?`, [await bcryptHash(PASSWORD), p.id]); // new hash = new token version
    assert.equal((await loginFrom("device-cccc-3333", p.email)).status, 200);

    const q = await createPassenger("Logged Out Elsewhere");
    assert.equal((await api("POST", "/api/auth/logout", { token: q.token })).status, 204);
    assert.equal((await loginFrom("device-dddd-4444", q.email)).status, 200);
  });

  test("an idle session is signed out, and doesn't trigger the warning", async () => {
    const p = await createPassenger("Walked Away");
    const phone = await loginFrom("device-eeee-5555", p.email, { force: true });
    assert.equal(phone.status, 200);
    // Last used 2 hours ago (the passenger limit is 60 minutes).
    await db.query(`UPDATE auth_sessions SET last_seen_at = NOW() - INTERVAL 2 HOUR WHERE account_kind = 'passenger' AND account_id = ?`, [p.id]);

    const stale = await api("GET", "/api/payments/mine", { token: phone.data.token });
    assert.equal(stale.status, 401);
    assert.match(stale.data.error, /60 minutes of inactivity/);
    // Logging in elsewhere just takes over — no "signed in on another device" warning.
    assert.equal((await loginFrom("device-ffff-6666", p.email)).status, 200);
  });

  test("a driver on a trip isn't signed out for inactivity", async () => {
    const d = await createDriver();
    const { tripId } = await createTrip({ hours: 1, driverId: d.id });
    await db.query(`UPDATE auth_sessions SET last_seen_at = NOW() - INTERVAL 5 HOUR WHERE account_kind = 'driver' AND account_id = ?`, [d.id]);
    assert.equal((await api("GET", "/api/auth/session", { token: d.token })).status, 401, "no trip running: signed out");

    const again = await login((await db.query(`SELECT email FROM drivers WHERE driver_id = ?`, [d.id]))[0][0].email, PASSWORD, "driver");
    await db.query(`UPDATE trips SET status = 'In Transit' WHERE trip_id = ?`, [tripId]);
    await db.query(`UPDATE auth_sessions SET last_seen_at = NOW() - INTERVAL 5 HOUR WHERE account_kind = 'driver' AND account_id = ?`, [d.id]);
    assert.equal((await api("GET", "/api/auth/session", { token: again.data.token })).status, 204, "on a trip: still signed in");
  });

  test("the warning names the other browser; device ids are validated", () => {
    const android = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    assert.equal(describeDevice(android), "Chrome on Android");
    assert.equal(describeDevice(edge), "Edge on Windows");
    assert.equal(describeDevice(iphone), "Safari on iPhone");
    assert.equal(describeDevice(""), "another device");
    assert.equal(cleanDeviceId("0f3a9c2e5b7d4e1f8a6c3b2d1e0f9a8b"), "0f3a9c2e5b7d4e1f8a6c3b2d1e0f9a8b");
    assert.equal(cleanDeviceId("<script>"), null);
    assert.equal(cleanDeviceId(42), null);
  });

  test("staff and admin accounts are limited the same way", async () => {
    const s = await createStaff("Desk Twice", "terminal_staff");
    const [[row]] = await db.query(`SELECT email FROM staff_accounts WHERE staff_id = ?`, [s.id]);
    assert.equal((await login(row.email, PASSWORD, "staff")).status, 200);
    assert.equal((await api("GET", "/api/payments/summary", { token: s.token })).status, 401);
  });

  test("the first device's live socket is told it was signed out", async () => {
    const p = await createPassenger("Socket Phone");
    const socket = ioClient(BASE, { transports: ["websocket"], auth: { token: p.token } });
    const revoked = new Promise((resolve) => socket.on("session:revoked", resolve));
    await new Promise((r) => socket.on("connect", r));
    await sleep(100);
    assert.equal((await login(p.email, PASSWORD, "passenger")).status, 200);
    const payload = await Promise.race([revoked, sleep(2000).then(() => null)]);
    socket.close();
    assert.ok(payload, "session:revoked was not received");
    assert.match(payload.message, /another device/);
  });

  test("logging out ends the session; a password change keeps this device signed in", async () => {
    const p = await createPassenger("Leaver");
    assert.equal((await api("POST", "/api/auth/logout", { token: p.token })).status, 204);
    assert.equal((await api("GET", "/api/payments/mine", { token: p.token })).status, 401);

    const again = await login(p.email, PASSWORD, "passenger");
    const changed = await api("POST", "/api/auth/change-password", { token: again.data.token, body: { currentPassword: PASSWORD, newPassword: "Other-pass-8812" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await api("GET", "/api/payments/mine", { token: changed.data.token })).status, 200);
  });
});

describe("driver names shown to passengers", () => {
  test("first name only, and only from the day of travel; staff keep the full name", async () => {
    const later = await createTrip({ hours: 72 });
    const anonLater = await api("GET", `/api/trips/${later.tripId}`);
    assert.equal(anonLater.status, 200);
    assert.equal(anonLater.data.driver_name, undefined, "the public view never has the full name");
    assert.equal(anonLater.data.driver_first_name, null, "not shown days ahead");

    const today = await createTrip({ hours: 72 });
    await db.query(`UPDATE trips SET status = 'Boarding' WHERE trip_id = ?`, [today.tripId]);
    assert.equal((await api("GET", `/api/trips/${today.tripId}`)).data.driver_first_name, "Fixture");

    // (The list is cached for a few seconds, so check every row rather than these trips.)
    const list = await api("GET", "/api/trips");
    assert.ok(list.data.every((t) => t.driver_name === undefined));

    const staffView = await api("GET", `/api/trips/${later.tripId}`, { token: admin.token });
    assert.equal(staffView.data.driver_name, "Fixture Driver");
    assert.ok((await api("GET", "/api/trips", { token: admin.token })).data.every((t) => typeof t.driver_name === "string"));
  });

  test("the passenger's ticket gets the first name on the day of travel", async () => {
    const p = await createPassenger("Ticket Holder");
    const { tripId } = await createTrip({ hours: 72 });
    const r = await api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers: ["4"] } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = r.data.bookings[0].booking_id;
    assert.equal((await api("GET", `/api/bookings/${id}`, { token: p.token })).data.driver_first_name, null);
    await db.query(`UPDATE trips SET status = 'Boarding' WHERE trip_id = ?`, [tripId]);
    assert.equal((await api("GET", `/api/bookings/${id}`, { token: p.token })).data.driver_first_name, "Fixture");
  });

  test("first-name rules", () => {
    assert.equal(driverFirstName("Boyet Marzan"), "Boyet");
    assert.equal(driverFirstName("Cyril"), "Cyril");
    assert.equal(driverFirstName("Ma. Lourdes Santos"), "Ma. Lourdes");
    assert.equal(driverFirstName("  "), null);
    const tomorrow = new Date(Date.now() + 48 * 3600 * 1000);
    assert.equal(passengerDriverName({ driverName: "Boyet Marzan", departureTime: tomorrow, tripStatus: "Scheduled" }), null);
    assert.equal(passengerDriverName({ driverName: "Boyet Marzan", departureTime: new Date(), tripStatus: "Scheduled" }), "Boyet");
    assert.equal(passengerDriverName({ driverName: "Boyet Marzan", departureTime: new Date(), tripStatus: "Cancelled" }), null);
  });
});

describe("revoked access stops working immediately", () => {
  test("demoted admin's old token loses admin access", async () => {
    const other = await createStaff("Second Admin", "admin");
    assert.equal((await api("GET", "/api/staff", { token: other.token })).status, 200);
    const r = await api("PATCH", `/api/staff/${other.id}`, { token: admin.token, body: { role: "terminal_staff" } });
    assert.equal(r.status, 200);
    const after = await api("GET", "/api/staff", { token: other.token });
    assert.equal(after.status, 401);
  });

  test("deleted staff account's token is rejected", async () => {
    const s = await createStaff("Temp Staff", "terminal_staff");
    assert.equal((await api("GET", "/api/payments/summary", { token: s.token })).status, 200);
    const del = await api("DELETE", `/api/staff/${s.id}`, { token: admin.token });
    assert.equal(del.status, 204);
    assert.equal((await api("GET", "/api/payments/summary", { token: s.token })).status, 401);
  });

  test("suspended driver can't log in and their existing token stops working", async () => {
    const d = await createDriver();
    const [[row]] = await db.query(`SELECT email FROM drivers WHERE driver_id = ?`, [d.id]);
    assert.equal((await api("GET", `/api/drivers/${d.id}`, { token: d.token })).status, 200);
    await api("PATCH", `/api/drivers/${d.id}`, { token: admin.token, body: { dutyStatus: "Suspended" } });
    assert.equal((await api("GET", `/api/drivers/${d.id}`, { token: d.token })).status, 401);
    const again = await login(row.email, PASSWORD, "driver");
    assert.equal(again.status, 403);
  });

  test("changing a password invalidates tokens issued before it", async () => {
    const s = await createStaff("Pw Change", "terminal_staff");
    await api("PATCH", `/api/staff/${s.id}`, { token: admin.token, body: { password: "Brand-new-pass-9" } });
    assert.equal((await api("GET", "/api/payments/summary", { token: s.token })).status, 401);
  });

  test("tokens signed with another algorithm or secret are refused", async () => {
    const forged = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ id: admin.id, role: "admin" })).toString("base64url")}.`;
    assert.equal((await api("GET", "/api/staff", { token: forged })).status, 401);
  });
});

describe("login brute-force and enumeration", () => {
  test("repeated wrong passwords for one account are rate limited", async () => {
    const p = await createPassenger("Target");
    const [[row]] = await db.query(`SELECT email FROM commuters WHERE commuter_id = ?`, [p.id]);
    const codes = [];
    // normal logins never count towards the lockout
    for (let i = 0; i < 12; i += 1) assert.equal((await login(row.email, PASSWORD, "passenger")).status, 200);
    for (let i = 0; i < 12; i += 1) codes.push((await login(row.email, `wrong-${i}`, "passenger")).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(codes.slice(10), [429, 429]);
    // even the right password is blocked during the lockout window
    assert.equal((await login(row.email, PASSWORD, "passenger")).status, 429);
  });

  test("unknown email and wrong password look the same (message and timing)", async () => {
    const p = await createPassenger();
    const [[row]] = await db.query(`SELECT email FROM commuters WHERE commuter_id = ?`, [p.id]);
    let t = Date.now();
    const unknown = await login(`nobody-${Date.now()}@test.local`, "Whatever-123", "passenger");
    const unknownMs = Date.now() - t;
    t = Date.now();
    const wrong = await login(row.email, "Whatever-123", "passenger");
    const wrongMs = Date.now() - t;
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.data.error, wrong.data.error);
    assert.ok(unknownMs > 20, `unknown-email path runs bcrypt too (${unknownMs} ms)`);
    assert.ok(Math.abs(unknownMs - wrongMs) < 150, `${unknownMs} vs ${wrongMs} ms`);
  });

  test("passwords are case-sensitive and a wrong one gets a clear message", async () => {
    const p = await createPassenger();
    const [[row]] = await db.query(`SELECT email FROM commuters WHERE commuter_id = ?`, [p.id]);
    for (const guess of [PASSWORD.toUpperCase(), PASSWORD.toLowerCase()]) {
      const r = await login(row.email, guess, "passenger");
      assert.equal(r.status, 401, guess);
      assert.equal(r.data.error, "Invalid password. Please try again.");
    }
    assert.equal((await login(row.email, PASSWORD, "passenger")).status, 200);
  });

  test("malformed login bodies get 400, never a server error", async () => {
    for (const body of [
      { email: { $ne: "" }, password: "x", role: "passenger" },
      { email: "a@b.co", password: ["x"], role: "passenger" },
      { email: "a@b.co", password: "x", role: "__proto__" },
      { email: "a@b.co", password: "x", role: "constructor" },
    ]) {
      const r = await api("POST", "/api/auth/login", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const walkIn = await login("walk-in@drs.local", "", "passenger");
    assert.equal(walkIn.status, 400);
  });
});

describe("registration and password policy", () => {
  test("weak passwords, bad emails and oversized names are refused", async () => {
    const cases = [
      { name: "A", email: "ok1@test.local", password: "short1" },
      { name: "A", email: "ok2@test.local", password: "allletters" },
      { name: "A", email: "ok3@test.local", password: "password123" },
      { name: "A", email: "ok7@test.local", password: "no-capitals-123" },
      { name: "A", email: "not-an-email", password: "Good-pass-123" },
      { name: "x".repeat(200), email: "ok4@test.local", password: "Good-pass-123" },
      { name: "<script>", email: "ok5@test.local", password: "Good-pass-123" },
      { name: "A", email: "ok6@test.local", password: "Good-pass-123", phoneno: "call me maybe" },
    ];
    // A valid mobile number and consent by default, so each case fails on
    // the field it's testing (signup.test.js covers those two).
    for (const c of cases) {
      const body = { phoneno: "09170000001", acceptedTerms: true, ...c };
      const r = await api("POST", "/api/auth/register", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const ok = await api("POST", "/api/auth/register", { body: { name: "Real Person", email: "Real.Person@Test.local", phoneno: "09170000001", password: "Good-pass-123", acceptedTerms: true } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.email, "real.person@test.local");
  });

  test("admin-created staff and driver passwords follow the same policy", async () => {
    const s = await api("POST", "/api/staff", { token: admin.token, body: { name: "S", email: "s1@test.local", password: "123", role: "terminal_staff" } });
    assert.equal(s.status, 400);
    const d = await api("POST", "/api/drivers", { token: admin.token, body: { name: "D", email: "d1@test.local", password: "driver123" } });
    assert.equal(d.status, 400);
    assert.ok(whyPasswordWeak("Strong-enough-42") === null);
    assert.equal(whyPasswordWeak("strong-enough-42"), "Use at least one capital letter in the password");
  });
});

describe("admin safety rails", () => {
  test("the last admin can't be demoted or deleted, and nobody deletes themselves", async () => {
    // demote every other admin first so `admin` is the only one
    const [admins] = await db.query(`SELECT staff_id FROM staff_accounts WHERE role = 'admin' AND staff_id <> ?`, [admin.id]);
    for (const a of admins) await db.query(`UPDATE staff_accounts SET role = 'terminal_staff' WHERE staff_id = ?`, [a.staff_id]);
    const self = await api("DELETE", `/api/staff/${admin.id}`, { token: admin.token });
    assert.equal(self.status, 409);
    const helper = await createStaff("Helper Admin", "admin");
    await db.query(`UPDATE staff_accounts SET role = 'terminal_staff' WHERE staff_id = ?`, [admin.id]);
    // now `helper` is the only admin; `admin` token is stale (role changed) — use helper
    const demoteSelf = await api("PATCH", `/api/staff/${helper.id}`, { token: helper.token, body: { role: "terminal_staff" } });
    assert.equal(demoteSelf.status, 409);
    await db.query(`UPDATE staff_accounts SET role = 'admin' WHERE staff_id = ?`, [admin.id]);
    admin = await createStaff("Root Admin 2", "admin");
  });
});

describe("input validation on admin data", () => {
  test("fares must be real positive amounts; bus capacity must be sane", async () => {
    for (const baseFare of [-50, 0, "abc", "1e3", "12.345"]) {
      const r = await api("POST", "/api/routes", { token: admin.token, body: { origin: "A", destination: "B", baseFare } });
      assert.equal(r.status, 400, String(baseFare));
    }
    const ok = await api("POST", "/api/routes", { token: admin.token, body: { origin: "A", destination: "B", baseFare: "120.50" } });
    assert.equal(ok.status, 201);
    const zero = await api("PATCH", `/api/routes/${ok.data.route_id}`, { token: admin.token, body: { baseFare: 0 } });
    assert.equal(zero.status, 400);
    for (const capacity of [0, -1, 1000, 2.5, "lots"]) {
      const r = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: `P${Date.now()}${Math.random()}`.slice(0, 15).replace(".", ""), capacity } });
      assert.equal(r.status, 400, String(capacity));
    }
    const plate = await api("POST", "/api/buses", { token: admin.token, body: { plateNum: "<img src=x onerror=alert(1)>" } });
    assert.equal(plate.status, 400);
  });

  test("trip times must be valid dates; unknown ids give 400 not 500", async () => {
    const bad = await api("POST", "/api/trips", { token: admin.token, body: { busId: 1, driverId: 1, routeId: 1, departureTime: "tomorrow-ish", arrivalTime: "later" } });
    assert.equal(bad.status, 400);
    const missing = await api("POST", "/api/trips", {
      token: admin.token,
      body: { busId: 999999, driverId: 999999, routeId: 999999, departureTime: "2030-01-01T08:00:00Z", arrivalTime: "2030-01-01T12:00:00Z" },
    });
    assert.equal(missing.status, 400);
  });
});

describe("trip times", () => {
  test("a time typed in the admin form means Philippine time, whatever zone the server runs in", () => {
    const manila = (v) => dateTime(v, { label: "t" }).value.toLocaleString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
    assert.equal(manila("2026-11-11 22:00:00"), "10:00 PM");
    assert.equal(manila("2026-11-11T14:30"), "2:30 PM");
    assert.equal(dateTime("2026-11-11 22:00:00", { label: "t" }).value.toISOString(), "2026-11-11T14:00:00.000Z");
    assert.equal(manila("2026-11-11T14:30:00.000Z"), "10:30 PM", "an explicit zone keeps its meaning");
  });

  test("a trip scheduled for 10:00 PM is stored and shown as 10:00 PM", async () => {
    const [bus] = await db.query(`INSERT INTO buses (plate_num, capacity) VALUES (?, 40)`, [`TZ${Date.now() % 100000}`]);
    const [route] = await db.query(`INSERT INTO routes (origin, destination, distance, base_fare) VALUES ('Baguio', 'Bontoc', 140, '350.00')`);
    const driver = await createDriver();
    const day = new Date(Date.now() + 3 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const r = await api("POST", "/api/trips", {
      token: admin.token,
      body: { busId: bus.insertId, driverId: driver.id, routeId: route.insertId, departureTime: `${day} 22:00:00`, arrivalTime: `${day} 23:30:00` },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const [[row]] = await db.query(`SELECT DATE_FORMAT(departure_time, '%H:%i') AS dep FROM trips WHERE trip_id = ?`, [r.data.trip_id]);
    assert.equal(row.dep, "22:00");

    const moved = await api("PATCH", `/api/trips/${r.data.trip_id}`, { token: admin.token, body: { departureTime: `${day} 21:15:00` } });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const [[after]] = await db.query(`SELECT DATE_FORMAT(departure_time, '%H:%i') AS dep FROM trips WHERE trip_id = ?`, [r.data.trip_id]);
    assert.equal(after.dep, "21:15");

    // A clash names the trip in the way, in Philippine time.
    const otherDriver = await createDriver();
    const clash = await api("POST", "/api/trips", {
      token: admin.token,
      body: { busId: bus.insertId, driverId: otherDriver.id, routeId: route.insertId, departureTime: `${day} 22:00:00`, arrivalTime: `${day} 22:30:00` },
    });
    assert.equal(clash.status, 409);
    assert.match(clash.data.error, new RegExp(`Bus TZ\\d+ is already on Baguio → Bontoc, .*9:15.*\\(trip #${r.data.trip_id}\\)`));
    assert.deepEqual(clash.data.conflictTripIds, [r.data.trip_id]);

    // Once that trip is Completed it no longer blocks the bus, even though its
    // scheduled arrival is still in the way.
    await db.query(`UPDATE trips SET status = 'Completed' WHERE trip_id = ?`, [r.data.trip_id]);
    const free = await api("POST", "/api/trips", {
      token: admin.token,
      body: { busId: bus.insertId, driverId: otherDriver.id, routeId: route.insertId, departureTime: `${day} 22:00:00`, arrivalTime: `${day} 22:30:00` },
    });
    assert.equal(free.status, 201, JSON.stringify(free.data));
  });
});

describe("GPS data", () => {
  test("invalid coordinates and oversized batches are refused; location needs login", async () => {
    const driver = await createDriver();
    const { tripId } = await createTrip({ hours: 1, driverId: driver.id });
    const [[trip]] = await db.query(`SELECT bus_id FROM trips WHERE trip_id = ?`, [tripId]);
    await db.query(`UPDATE trips SET status = 'Boarding' WHERE trip_id = ?`, [tripId]);
    const base = { busId: trip.bus_id, timestamp: new Date().toISOString() };
    for (const point of [{ latitude: 200, longitude: 120 }, { latitude: "abc", longitude: 120 }, { latitude: true, longitude: 120 }, { latitude: 16.4, longitude: 120.6, timestamp: "2001-01-01" }]) {
      const r = await api("POST", "/api/tracking", { token: driver.token, body: { ...base, ...point } });
      assert.equal(r.status, 400, JSON.stringify(point));
    }
    const ok = await api("POST", "/api/tracking", { token: driver.token, body: { ...base, latitude: 16.41, longitude: 120.59 } });
    assert.equal(ok.status, 201);
    const big = await api("POST", "/api/tracking/batch", { token: driver.token, body: { points: Array.from({ length: 1001 }, () => ({ ...base, latitude: 16.4, longitude: 120.6 })) } });
    assert.equal(big.status, 413);
    assert.equal((await api("GET", `/api/tracking/${trip.bus_id}/latest`)).status, 401);

    // Passengers: only with a PAID seat on the bus's current trip.
    const p = await createPassenger();
    assert.equal((await api("GET", `/api/tracking/${trip.bus_id}/latest`, { token: p.token })).status, 403, "no booking");
    const booked = await api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers: ["7"] } });
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    const unpaid = await api("GET", `/api/tracking/${trip.bus_id}/latest`, { token: p.token });
    assert.equal(unpaid.status, 403, "reserved but not paid");
    assert.match(unpaid.data.error, /payment/);
    await db.query(`UPDATE bookings SET status = 'Confirmed' WHERE booking_id = ?`, [booked.data.bookings[0].booking_id]);
    assert.equal((await api("GET", `/api/tracking/${trip.bus_id}/latest`, { token: p.token })).status, 200, "paid");
    assert.equal((await api("GET", `/api/tracking/${trip.bus_id}/latest`, { token: driver.token })).status, 200, "staff/drivers unaffected");
  });

  test("anonymous sockets can't follow a bus; signed-in ones can", async () => {
    const driver = await createDriver();
    const { tripId } = await createTrip({ hours: 1, driverId: driver.id });
    const [[trip]] = await db.query(`SELECT bus_id FROM trips WHERE trip_id = ?`, [tripId]);
    await db.query(`UPDATE trips SET status = 'Boarding' WHERE trip_id = ?`, [tripId]);
    const p = await createPassenger();
    const anon = ioClient(BASE, { transports: ["websocket"] });
    const authed = ioClient(BASE, { transports: ["websocket"], auth: { token: p.token } });
    const got = { anon: 0, authed: 0 };
    anon.on("location:update", () => (got.anon += 1));
    authed.on("location:update", () => (got.authed += 1));
    await Promise.all([new Promise((r) => anon.on("connect", r)), new Promise((r) => authed.on("connect", r))]);
    anon.emit("subscribe:bus", trip.bus_id);
    authed.emit("subscribe:bus", trip.bus_id);
    await sleep(200);
    await api("POST", "/api/tracking", { token: driver.token, body: { busId: trip.bus_id, latitude: 16.42, longitude: 120.6, timestamp: new Date().toISOString() } });
    await sleep(400);
    anon.close();
    authed.close();
    assert.equal(got.anon, 0);
    assert.equal(got.authed, 1);
  });
});

describe("information leaks and headers", () => {
  test("API responses carry security headers and no framework banner", async () => {
    const r = await fetch(`${BASE}/api/health`);
    assert.equal(r.headers.get("x-powered-by"), null);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    const body = await r.json();
    assert.deepEqual(Object.keys(body).sort(), ["database", "redis", "status"]);
    assert.ok(!/error/i.test(JSON.stringify(body)));
  });

  test("unknown API paths and bad JSON get clean JSON errors, no stack traces", async () => {
    const nf = await api("GET", "/api/definitely-not-here");
    assert.equal(nf.status, 404);
    assert.deepEqual(nf.data, { error: "Not found" });
    const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.ok(!text.includes("at ") && !text.includes("node_modules"), text);
  });

  test("anonymous requests can't send 8 MB bodies to the payment routes", async () => {
    const res = await fetch(`${BASE}/api/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(300 * 1024) }) });
    assert.equal(res.status, 413);
  });
});

describe("output encoding helpers", () => {
  test("CSV cells can't start a spreadsheet formula; LIKE wildcards are literal", async () => {
    assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), `"'=HYPERLINK(""http://evil"")"`);
    assert.equal(csvCell("+cmd"), `"'+cmd"`);
    assert.equal(csvCell("-5"), `"-5"`);
    assert.equal(csvCell("Baguio"), `"Baguio"`);
    assert.equal(likeEscape("50%_off"), "50\\%\\_off");

    await api("POST", "/api/routes", { token: admin.token, body: { origin: "=SUM(1+1)", destination: "@evil", baseFare: "10" } });
    const res = await fetch(`${BASE}/api/reports/export?type=reservation-trends&from=2026-01-01&to=2026-12-31";x=1`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="reservation-trends-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/);

    const staff = await createStaff("Searcher", "terminal_staff");
    const search = await api("GET", "/api/bookings/search?q=%25", { token: staff.token });
    assert.equal(search.status, 200);
    assert.equal(search.data.length, 0, "'%' matches only a literal percent sign");
  });
});
