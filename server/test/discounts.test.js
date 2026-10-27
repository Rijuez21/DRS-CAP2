// Student / PWD / senior fare discount — integration tests (real server + MySQL).
// Run: npm test   (see test/helpers.js for the database it uses)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, db, createStaff, createPassenger, createTrip, book, pngReceipt, jpegBytesAsPng } from "./helpers.js";

let admin;
let staff;

before(async () => {
  await setup();
  admin = await createStaff("Ana Admin", "admin");
  staff = await createStaff("Tess Terminal", "terminal_staff");
});
after(teardown);

async function apply(passenger, category = "student", idImage = pngReceipt()) {
  return api("POST", "/api/discounts", { token: passenger.token, body: { category, idNumber: "2026-00123", idImage } });
}

test("a passenger sends an ID; it waits as Pending and only one can be pending", async () => {
  const p = await createPassenger("Stu Dent");
  const r = await apply(p);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, "Pending");

  const again = await apply(p);
  assert.equal(again.status, 409);

  const mine = await api("GET", "/api/discounts/mine", { token: p.token });
  assert.equal(mine.data.latest.status, "Pending");
  assert.equal(mine.data.active, null);
  assert.equal(mine.data.can_apply, false);
});

test("bad ID uploads are refused", async () => {
  const p = await createPassenger("Bad Upload");
  assert.equal((await apply(p, "student", "")).status, 400);
  assert.equal((await apply(p, "student", jpegBytesAsPng())).status, 400);
  assert.equal((await apply(p, "veteran")).status, 400);
});

test("passengers and drivers can't review IDs; staff can see the queue and the image", async () => {
  const p = await createPassenger("Queue Check");
  const { data } = await apply(p, "pwd");
  assert.equal((await api("GET", "/api/discounts", { token: p.token })).status, 403);
  assert.equal((await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: p.token })).status, 403);

  const queue = await api("GET", "/api/discounts", { token: staff.token });
  assert.equal(queue.status, 200);
  const row = queue.data.find((r) => r.application_id === data.application_id);
  assert.ok(row);
  assert.equal(row.id_image, undefined, "the list must not carry the images");

  const img = await api("GET", `/api/discounts/${data.application_id}/image`, { token: staff.token });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
});

test("approving a student ID gives one year; the first seat booked is 20% off", async () => {
  const p = await createPassenger("Year Student");
  const { data } = await apply(p, "student");
  const ok = await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: staff.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const days = (new Date(ok.data.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 364 && days < 366, `expected ~365 days, got ${days}`);

  const again = await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: staff.token });
  assert.equal(again.status, 409);

  const { tripId } = await createTrip({ fare: "350.00" });
  const [own, companion] = await book(p, tripId, ["11", "12"]);
  const ownRow = await api("GET", `/api/bookings/${own}`, { token: p.token });
  const companionRow = await api("GET", `/api/bookings/${companion}`, { token: p.token });
  assert.equal(ownRow.data.discount_category, "student");
  assert.equal(Number(ownRow.data.fare_due), 280);
  assert.equal(companionRow.data.discount_category, null);
  assert.equal(Number(companionRow.data.fare_due), 350);

  // Online payment asks for the discounted amount.
  const pay = await api("GET", `/api/payments/booking/${own}`, { token: p.token });
  assert.equal(pay.data.amount_due, 280);

  // A second booking on the same trip doesn't get a second discounted seat.
  const [later] = await book(p, tripId, ["13"]);
  const laterRow = await api("GET", `/api/bookings/${later}`, { token: p.token });
  assert.equal(laterRow.data.discount_category, null);

  // Counter cash for the discounted seat accepts the discounted fare.
  const cash = await api("POST", `/api/bookings/${own}/counter-payment`, { token: staff.token, body: { cashReceived: 280 } });
  assert.equal(cash.status, 200, JSON.stringify(cash.data));
});

test("booking 6 seats discounts only the first; the other 5 are regular fare", async () => {
  const p = await createPassenger("Six Seats");
  const { data } = await apply(p, "pwd");
  await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: staff.token });

  const { tripId } = await createTrip({ fare: "350.00" });
  const r = await api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers: ["21", "22", "23", "24", "25", "26"] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const discounted = r.data.bookings.filter((b) => b.discount_category);
  assert.equal(discounted.length, 1);
  assert.equal(discounted[0].seat_number, "21");
  assert.equal(discounted[0].discount_category, "pwd");

  const [[fares]] = await db.query(
    `SELECT SUM(discount_category IS NOT NULL) AS discounted, SUM(discount_category IS NULL) AS regular FROM bookings WHERE trip_id = ? AND passenger_id = ?`,
    [tripId, p.id]
  );
  assert.equal(Number(fares.discounted), 1);
  assert.equal(Number(fares.regular), 5);
});

test("two bookings sent at the same moment can't both get a discounted seat", async () => {
  const p = await createPassenger("Double Tap");
  const { data } = await apply(p, "student");
  await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: staff.token });

  const { tripId } = await createTrip({ fare: "350.00" });
  const results = await Promise.all(
    [["31", "32", "33"], ["34", "35", "36"]].map((seatNumbers) => api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers } }))
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  const [[{ discounted }]] = await db.query(
    `SELECT COUNT(*) AS discounted FROM bookings WHERE trip_id = ? AND passenger_id = ? AND discount_category IS NOT NULL`,
    [tripId, p.id]
  );
  assert.equal(Number(discounted), 1);
});

test("PWD / senior approvals don't expire and can't be re-applied for", async () => {
  const p = await createPassenger("Senior Sam");
  const { data } = await apply(p, "senior");
  const ok = await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: admin.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.expires_at, null);
  assert.equal((await apply(p, "senior")).status, 409);
});

test("an expired student discount stops applying and can be renewed", async () => {
  const p = await createPassenger("Old Student");
  const { data } = await apply(p, "student");
  await api("PATCH", `/api/discounts/${data.application_id}/approve`, { token: staff.token });
  await db.query(`UPDATE commuters SET discount_expires_at = NOW() - INTERVAL 1 DAY WHERE commuter_id = ?`, [p.id]);

  const mine = await api("GET", "/api/discounts/mine", { token: p.token });
  assert.equal(mine.data.active, null);
  assert.equal(mine.data.expired.category, "student");
  assert.equal(mine.data.can_apply, true);

  const { tripId } = await createTrip({ fare: "350.00" });
  const [id] = await book(p, tripId, ["5"]);
  const row = await api("GET", `/api/bookings/${id}`, { token: p.token });
  assert.equal(row.data.discount_category, null);

  assert.equal((await apply(p, "student")).status, 201);
});

test("rejecting needs a reason, notifies the passenger, and lets them resend", async () => {
  const p = await createPassenger("Blurry Photo");
  const { data } = await apply(p, "pwd");
  assert.equal((await api("PATCH", `/api/discounts/${data.application_id}/reject`, { token: staff.token, body: {} })).status, 400);
  const r = await api("PATCH", `/api/discounts/${data.application_id}/reject`, { token: staff.token, body: { reason: "The photo is blurry" } });
  assert.equal(r.status, 200);

  const [[note]] = await db.query(
    `SELECT message FROM notifications WHERE recipient_type = 'passenger' AND recipient_id = ? ORDER BY notification_id DESC LIMIT 1`,
    [p.id]
  );
  assert.match(note.message, /blurry/);
  const mine = await api("GET", "/api/discounts/mine", { token: p.token });
  assert.equal(mine.data.latest.status, "Rejected");
  assert.equal(mine.data.can_apply, true);
  assert.equal((await apply(p, "pwd")).status, 201);
});
