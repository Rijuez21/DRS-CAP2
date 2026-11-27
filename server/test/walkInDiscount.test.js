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

test("several discounted riders in one sale: each seat has its own type and ID", async () => {
  const { tripId } = await createTrip({ hours: 2, fare: "465.00" });
  const r = await sell({
    tripId,
    passengerName: "Dela Cruz family",
    seatNumbers: ["7", "8", "9"],
    cashReceived: 1300,
    seatDiscounts: [
      { seat: "7", category: "student", idNumber: "224232" },
      { seat: "8", category: "senior", idNumber: "OSCA-5521" },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.payment.total, 1209); // 372 + 372 + 465
  assert.equal(r.data.payment.change, 91);
  const bySeat = Object.fromEntries(r.data.bookings.map((b) => [b.seat_number, b.discount_category]));
  assert.deepEqual(bySeat, { 7: "student", 8: "senior", 9: null });

  // A discount on a seat that isn't being sold, or without an ID, is refused.
  const wrongSeat = await sell({ tripId, passengerName: "X", seatNumbers: ["10"], cashReceived: 465, seatDiscounts: [{ seat: "11", category: "pwd", idNumber: "PWD-1" }] });
  assert.equal(wrongSeat.status, 400);
  const noId = await sell({ tripId, passengerName: "X", seatNumbers: ["10"], cashReceived: 465, seatDiscounts: [{ seat: "10", category: "pwd", idNumber: "" }] });
  assert.equal(noId.status, 400);
});

test("exact cash for a discounted single seat is accepted (the bug in the screenshot)", async () => {
  const { tripId } = await createTrip({ hours: 2, fare: "465.00" });
  const r = await sell({ tripId, passengerName: "Juan Dela Cruz", seatNumbers: ["7"], cashReceived: 372, seatDiscounts: [{ seat: "7", category: "student", idNumber: "224232" }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.payment.total, 372);
  assert.equal(r.data.payment.change, 0);
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
