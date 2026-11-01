// Passenger account features: email confirmation at sign-up, change
// password, edit profile, close account, admin suspension, the activity
// log, data retention and departure reminders. Same harness as
// security.test.js (real server + throwaway MySQL).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, db, DB_URL, createPassenger, createStaff, createTrip, book, useKnownVerificationCode, PASSWORD } from "./helpers.js";

let admin;
before(async () => {
  await setup();
  admin = await createStaff("Account Admin", "admin");
});
after(async () => {
  await inProcessPool?.end();
  await teardown();
});

// Services called directly (no timer) need their own pool on the test DB.
let inProcessPool;
async function service(name) {
  process.env.MYSQL_URL = DB_URL;
  const mod = await import(`../src/services/${name}.js`);
  inProcessPool ??= (await import("../src/db/pool.js")).pool;
  return mod;
}

const login = (email, password, role = "passenger") => api("POST", "/api/auth/login", { body: { email, password, role } });
let phoneCounter = 0;
const signup = (email, extra = {}) => {
  phoneCounter += 1;
  return api("POST", "/api/auth/register", {
    body: { name: "Ana Reyes", email, password: "Good-pass-123", phoneno: `0919 111 ${String(phoneCounter).padStart(4, "0")}`, acceptedTerms: true, ...extra },
  });
};

describe("email confirmation at sign-up", () => {
  test("wrong codes count down; the right one signs the passenger in", async () => {
    const r = await signup("confirm1@test.local");
    assert.equal(r.status, 201);
    await useKnownVerificationCode(r.data.commuter_id, "111222");
    const wrong = await api("POST", "/api/auth/verify-email", { body: { email: "confirm1@test.local", code: "000000" } });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /4 attempts left/);
    const right = await api("POST", "/api/auth/verify-email", { body: { email: "confirm1@test.local", code: "111222" } });
    assert.equal(right.status, 200);
    assert.equal(right.data.user.role, "passenger");
    assert.equal((await api("GET", "/api/payments/mine", { token: right.data.token })).status, 200);
    // Used once only.
    const again = await api("POST", "/api/auth/verify-email", { body: { email: "confirm1@test.local", code: "111222" } });
    assert.equal(again.status, 400);
  });

  test("signing up again before confirming replaces the pending sign-up", async () => {
    const first = await signup("confirm2@test.local");
    const second = await signup("confirm2@test.local", { name: "Ana B. Reyes" });
    assert.equal(second.status, 201);
    assert.equal(second.data.commuter_id, first.data.commuter_id);
    const [[row]] = await db.query(`SELECT name FROM commuters WHERE commuter_id = ?`, [first.data.commuter_id]);
    assert.equal(row.name, "Ana B. Reyes");
  });

  test("a confirmed email can't be signed up again", async () => {
    const p = await createPassenger("Already Here");
    const r = await signup(p.email);
    assert.equal(r.status, 409);
  });

  test("resend answers the same for unknown emails", async () => {
    const r = await api("POST", "/api/auth/resend-verification", { body: { email: "nobody-at-all@test.local" } });
    assert.equal(r.status, 200);
  });
});

describe("change password", () => {
  test("needs the current password; returns a fresh token and signs out the old one", async () => {
    const p = await createPassenger("Changer");
    const bad = await api("POST", "/api/auth/change-password", { token: p.token, body: { currentPassword: "nope-Wrong-1", newPassword: "Fresh-pass-456" } });
    assert.equal(bad.status, 400);
    const same = await api("POST", "/api/auth/change-password", { token: p.token, body: { currentPassword: PASSWORD, newPassword: PASSWORD } });
    assert.equal(same.status, 400);
    const ok = await api("POST", "/api/auth/change-password", { token: p.token, body: { currentPassword: PASSWORD, newPassword: "Fresh-pass-456" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.token);
    assert.equal((await api("GET", "/api/payments/mine", { token: p.token })).status, 401);
    assert.equal((await api("GET", "/api/payments/mine", { token: ok.data.token })).status, 200);
    assert.equal((await login(p.email, "Fresh-pass-456")).status, 200);
  });

  test("works for staff too", async () => {
    const s = await createStaff("Desk Changer", "terminal_staff");
    // (Not "Desk-…": the policy refuses a password containing the first name.)
    const r = await api("POST", "/api/auth/change-password", { token: s.token, body: { currentPassword: PASSWORD, newPassword: "Shift-pass-789" } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
});

describe("edit profile", () => {
  test("a passenger updates their name and mobile; another account's number is refused", async () => {
    const a = await createPassenger("Edit Me");
    const b = await createPassenger("Other One");
    const ok = await api("PATCH", "/api/auth/me", { token: a.token, body: { name: "Edited Name", phoneno: "0917 555 0001" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.name, "Edited Name");
    assert.equal(ok.data.user.phoneno, "+639175550001");
    const dup = await api("PATCH", "/api/auth/me", { token: b.token, body: { name: "Other One", phoneno: "+639175550001" } });
    assert.equal(dup.status, 409);
    const staff = await createStaff("Not A Passenger", "terminal_staff");
    assert.equal((await api("PATCH", "/api/auth/me", { token: staff.token, body: { name: "X", phoneno: "09175550002" } })).status, 403);
  });
});

describe("close account", () => {
  test("refused with an upcoming trip, then anonymises the account", async () => {
    const p = await createPassenger("Leaving Soon");
    const { tripId } = await createTrip({ hours: 48 });
    const [bookingId] = await book(p, tripId);
    const blocked = await api("DELETE", "/api/auth/me", { token: p.token, body: { password: PASSWORD } });
    assert.equal(blocked.status, 409);

    assert.equal((await api("PATCH", `/api/bookings/${bookingId}/status`, { token: p.token, body: { status: "Cancelled" } })).status, 200);
    const wrong = await api("DELETE", "/api/auth/me", { token: p.token, body: { password: "Wrong-pass-1" } });
    assert.equal(wrong.status, 400);
    const ok = await api("DELETE", "/api/auth/me", { token: p.token, body: { password: PASSWORD } });
    assert.equal(ok.status, 200);

    const [[row]] = await db.query(`SELECT name, email, phoneno, password_hash, closed_at FROM commuters WHERE commuter_id = ?`, [p.id]);
    assert.equal(row.name, "Closed account");
    assert.notEqual(row.email, p.email);
    assert.equal(row.password_hash, "");
    assert.ok(row.closed_at);
    const [[bk]] = await db.query(`SELECT passenger_name FROM bookings WHERE booking_id = ?`, [bookingId]);
    assert.equal(bk.passenger_name, "Closed account");
    assert.equal((await api("GET", "/api/payments/mine", { token: p.token })).status, 401);
    assert.equal((await login(p.email, PASSWORD)).status, 401);
  });
});

describe("admin: passengers", () => {
  test("search, suspend (signs them out) and unsuspend", async () => {
    const p = await createPassenger("Suspend Target");
    const list = await api("GET", `/api/passengers?q=${encodeURIComponent(p.email)}`, { token: admin.token });
    assert.equal(list.status, 200);
    assert.equal(list.data.passengers.length, 1);
    assert.equal(list.data.passengers[0].commuter_id, p.id);

    assert.equal((await api("PATCH", `/api/passengers/${p.id}/suspend`, { token: admin.token, body: {} })).status, 400);
    assert.equal((await api("PATCH", `/api/passengers/${p.id}/suspend`, { token: admin.token, body: { reason: "Repeated fake bookings" } })).status, 200);
    assert.equal((await api("GET", "/api/payments/mine", { token: p.token })).status, 401);
    const blocked = await login(p.email, PASSWORD);
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.error, /suspended/);

    const suspended = await api("GET", "/api/passengers?status=suspended", { token: admin.token });
    assert.ok(suspended.data.passengers.some((x) => x.commuter_id === p.id));

    assert.equal((await api("PATCH", `/api/passengers/${p.id}/unsuspend`, { token: admin.token })).status, 200);
    assert.equal((await login(p.email, PASSWORD)).status, 200);
  });

  test("staff can't manage passengers", async () => {
    const s = await createStaff("Curious Staff", "terminal_staff");
    assert.equal((await api("GET", "/api/passengers", { token: s.token })).status, 403);
  });

  test("an admin can confirm an email by hand", async () => {
    const r = await signup("handconfirm@test.local");
    assert.equal((await login("handconfirm@test.local", "Good-pass-123")).status, 403);
    assert.equal((await api("PATCH", `/api/passengers/${r.data.commuter_id}/verify-email`, { token: admin.token })).status, 200);
    assert.equal((await login("handconfirm@test.local", "Good-pass-123")).status, 200);
  });
});

describe("activity log", () => {
  test("lists staff actions with filters", async () => {
    const r = await api("GET", "/api/dashboard/audit-log?action=suspend", { token: admin.token });
    assert.equal(r.status, 200);
    assert.ok(r.data.entries.length >= 1);
    assert.ok(r.data.entries.every((e) => e.action === "suspend"));
    assert.ok(r.data.filters.actions.includes("suspend"));
    assert.equal((await api("GET", "/api/dashboard/audit-log?from=yesterday", { token: admin.token })).status, 400);
  });
});

describe("background jobs", () => {
  test("retention sweep removes old GPS points and stale unconfirmed sign-ups", async () => {
    const { tripId } = await createTrip();
    const [[trip]] = await db.query(`SELECT bus_id FROM trips WHERE trip_id = ?`, [tripId]);
    const [old] = await db.query(
      `INSERT INTO location_tracking (latitude, longitude, timestamp, bus_id) VALUES (16.4, 120.6, NOW() - INTERVAL 400 DAY, ?)`,
      [trip.bus_id]
    );
    const [recent] = await db.query(
      `INSERT INTO location_tracking (latitude, longitude, timestamp, bus_id) VALUES (16.4, 120.6, NOW() - INTERVAL 10 DAY, ?)`,
      [trip.bus_id]
    );
    const [stale] = await db.query(
      `INSERT INTO commuters (name, email, password_hash, email_verified, created_at) VALUES ('Never Confirmed', 'stale@test.local', 'x', FALSE, NOW() - INTERVAL 10 DAY)`
    );
    const { runRetentionSweep } = await service("retentionSweeper");
    await runRetentionSweep();
    const [[{ n: oldLeft }]] = await db.query(`SELECT COUNT(*) AS n FROM location_tracking WHERE tracking_id = ?`, [old.insertId]);
    const [[{ n: recentLeft }]] = await db.query(`SELECT COUNT(*) AS n FROM location_tracking WHERE tracking_id = ?`, [recent.insertId]);
    const [[{ n: staleLeft }]] = await db.query(`SELECT COUNT(*) AS n FROM commuters WHERE commuter_id = ?`, [stale.insertId]);
    assert.equal(oldLeft, 0);
    assert.equal(recentLeft, 1);
    assert.equal(staleLeft, 0);
  });

  test("departure reminder goes out once, about an hour before", async () => {
    const p = await createPassenger("Remind Me");
    const { tripId } = await createTrip({ hours: 0.5 });
    await db.query(
      `INSERT INTO bookings (passenger_name, seat_number, status, channel, passenger_id, trip_id) VALUES (?, '7', 'Confirmed', 'online', ?, ?)`,
      [p.name, p.id, tripId]
    );
    const { sendDepartureReminders } = await service("departureReminders");
    assert.ok((await sendDepartureReminders(null)) >= 1);
    const [rows] = await db.query(
      `SELECT message FROM notifications WHERE recipient_type = 'passenger' AND recipient_id = ? AND type = 'departure_reminder'`,
      [p.id]
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].message, /seat 7/);
    await sendDepartureReminders(null);
    const [[{ n }]] = await db.query(
      `SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'passenger' AND recipient_id = ? AND type = 'departure_reminder'`,
      [p.id]
    );
    assert.equal(n, 1);
  });
});
