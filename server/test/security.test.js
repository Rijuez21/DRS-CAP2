// Security regression tests — one block per vulnerability that was fixed.
// Same harness as payments.test.js (real server + throwaway MySQL).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { setup, teardown, api, db, createStaff, createPassenger, createDriver, createTrip, BASE, PASSWORD, sleep } from "./helpers.js";
import { csvCell, likeEscape } from "../src/services/validate.js";
import { whyPasswordWeak } from "../src/services/passwordPolicy.js";

let admin;

before(async () => {
  await setup();
  admin = await createStaff("Root Admin", "admin");
});
after(teardown);

const login = (email, password, role) => api("POST", "/api/auth/login", { body: { email, password, role } });

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
      { name: "A", email: "not-an-email", password: "Good-pass-123" },
      { name: "x".repeat(200), email: "ok4@test.local", password: "Good-pass-123" },
      { name: "<script>", email: "ok5@test.local", password: "Good-pass-123" },
      { name: "A", email: "ok6@test.local", password: "Good-pass-123", phoneno: "call me maybe" },
    ];
    for (const body of cases) {
      const r = await api("POST", "/api/auth/register", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const ok = await api("POST", "/api/auth/register", { body: { name: "Real Person", email: "Real.Person@Test.local", password: "Good-pass-123" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.email, "real.person@test.local");
  });

  test("admin-created staff and driver passwords follow the same policy", async () => {
    const s = await api("POST", "/api/staff", { token: admin.token, body: { name: "S", email: "s1@test.local", password: "123", role: "terminal_staff" } });
    assert.equal(s.status, 400);
    const d = await api("POST", "/api/drivers", { token: admin.token, body: { name: "D", email: "d1@test.local", password: "driver123" } });
    assert.equal(d.status, 400);
    assert.ok(whyPasswordWeak("Strong-enough-42") === null);
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
    const p = await createPassenger();
    assert.equal((await api("GET", `/api/tracking/${trip.bus_id}/latest`, { token: p.token })).status, 200);
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
