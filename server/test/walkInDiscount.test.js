// Walk-in sales with a student / PWD / senior discount (routes/bookings.js
// POST /walk-in): staff check the rider's ID at the counter, the rider's own
// seat is 20% off, companions pay regular fare, and the trip's terminal cash
// (services/collections.js) counts what was actually charged.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, createStaff, createTrip } from "./helpers.js";

let staff;
before(async () => {
  await setup();
  staff = await createStaff("Counter Staff", "staff");
});
after(teardown);

const sell = (body) => api("POST", "/api/bookings/walk-in", { token: staff.token, body });

test("the rider's own seat is 20% off; other seats are regular", async () => {
  const { tripId } = await createTrip({ hours: 2, fare: "350.00" });
  const r = await sell({ tripId, passengerName: "Ana Student", seatNumbers: ["1", "2"], cashReceived: 700, discountCategory: "student", discountIdNumber: "2024-11873" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.payment.total, 630); // 280 + 350
  assert.equal(r.data.payment.change, 70);
  assert.deepEqual(r.data.bookings.map((b) => b.discount_category), ["student", null]);
});

test("every student in line gets their discount (walk-ins share one placeholder account)", async () => {
  const { tripId } = await createTrip({ hours: 2, fare: "350.00" });
  for (const seat of ["5", "6"]) {
    const r = await sell({ tripId, passengerName: `Student ${seat}`, seatNumbers: [seat], cashReceived: 280, discountCategory: "student", discountIdNumber: `ID-${seat}` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.payment.total, 280);
  }
  const summary = await api("GET", `/api/collections/trips/${tripId}`, { token: staff.token });
  assert.equal(summary.data.summary.collected.terminal, 560, "terminal cash counts the discounted fares");
});

test("a discount needs the ID number, and short cash is refused", async () => {
  const { tripId } = await createTrip({ hours: 2, fare: "350.00" });
  const noId = await sell({ tripId, passengerName: "No ID", seatNumbers: ["9"], cashReceived: 280, discountCategory: "senior" });
  assert.equal(noId.status, 400);
  const bad = await sell({ tripId, passengerName: "Bad", seatNumbers: ["9"], cashReceived: 280, discountCategory: "vip", discountIdNumber: "123" });
  assert.equal(bad.status, 400);
  const short = await sell({ tripId, passengerName: "Short", seatNumbers: ["9"], cashReceived: 270, discountCategory: "pwd", discountIdNumber: "PWD-001" });
  assert.equal(short.status, 400);
  assert.match(short.data.error, /less than the total fare/);
});
