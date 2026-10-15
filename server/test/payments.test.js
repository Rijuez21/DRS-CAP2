// Manual payment verification — integration tests (real server + MySQL).
// Run: npm test   (see test/helpers.js for the database it uses)
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  setup,
  teardown,
  api,
  db,
  createStaff,
  createPassenger,
  createDriver,
  createTrip,
  book,
  proof,
  pngReceipt,
  jpegBytesAsPng,
  gcashRef,
  sleep,
} from "./helpers.js";

let admin;
let staff;
let gcash; // active payment method id
let bank;

async function bookingRow(id) {
  const [[b]] = await db.query(`SELECT * FROM bookings WHERE booking_id = ?`, [id]);
  return b;
}
async function paymentsFor(bookingId) {
  const [rows] = await db.query(`SELECT * FROM payments WHERE booking_id = ? ORDER BY payment_id`, [bookingId]);
  return rows;
}
async function submit(passenger, body) {
  return api("POST", "/api/payments", { token: passenger.token, body });
}
async function verify(token, submissionId, body = {}) {
  return api("PATCH", `/api/payments/submissions/${submissionId}/verify`, {
    token,
    body: { fundsConfirmed: true, amountReceived: "350.00", ...body },
  });
}

before(async () => {
  await setup();
  admin = await createStaff("Ana Admin", "admin");
  staff = await createStaff("Tess Terminal", "terminal_staff");
  const g = await api("POST", "/api/payments/methods", {
    token: admin.token,
    body: { methodType: "gcash", displayName: "GCash", accountName: "PLACEHOLDER ACCOUNT NAME", accountNumber: "0900 000 0000", isActive: true },
  });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  gcash = g.data.method_id;
  const b = await api("POST", "/api/payments/methods", {
    token: admin.token,
    body: { methodType: "bank_transfer", displayName: "Bank transfer", accountName: "PLACEHOLDER", accountNumber: "000-000", bankName: "PLACEHOLDER BANK", isActive: true },
  });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  bank = b.data.method_id;
});

after(teardown);

describe("payment methods configuration", () => {
  test("only admins can create/edit methods; incomplete active methods are refused", async () => {
    const asStaff = await api("POST", "/api/payments/methods", { token: staff.token, body: { methodType: "gcash", displayName: "X" } });
    assert.equal(asStaff.status, 403);
    const incomplete = await api("POST", "/api/payments/methods", { token: admin.token, body: { methodType: "gcash", displayName: "X", isActive: true } });
    assert.equal(incomplete.status, 400);
    const p = await createPassenger();
    const list = await api("GET", "/api/payments/methods", { token: p.token });
    assert.equal(list.status, 200);
    assert.ok(list.data.every((m) => m.is_active === undefined), "passengers don't get admin fields");
    assert.ok(list.data.some((m) => m.method_id === gcash));
  });
});

describe("1. passenger submits valid proof", () => {
  test("creates an UNDER_REVIEW (Pending) payment; booking stays Reserved", async () => {
    const p = await createPassenger("Valid Payer");
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const before = await api("GET", `/api/payments/booking/${bookingId}`, { token: p.token });
    assert.equal(before.data.payment_status, "Awaiting Payment");
    assert.ok(before.data.payment_deadline, "online booking gets a payment deadline");
    assert.match(before.data.booking_reference, /^DRS-\d{4}-\d{5}$/);

    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, "Pending");
    assert.equal(r.data.amount_due, 350);
    assert.equal(r.data.amount_mismatch, false);
    assert.equal((await bookingRow(bookingId)).status, "Reserved", "uploading a receipt never confirms the booking");

    const status = await api("GET", `/api/payments/booking/${bookingId}`, { token: p.token });
    assert.equal(status.data.payment_status, "Pending");
    assert.equal(status.data.can_pay, false);
    const [[sub]] = await db.query(`SELECT receipt_mime, receipt_bytes, receipt_sha256 FROM payment_submissions WHERE submission_id = ?`, [r.data.submission_id]);
    assert.equal(sub.receipt_mime, "image/png");
    assert.equal(sub.receipt_sha256.length, 64);
    // passenger can view their own receipt, as an image, not cacheable
    const img = await api("GET", `/api/payments/submissions/${r.data.submission_id}/receipt`, { token: p.token });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.match(img.headers.get("cache-control"), /no-store/);
    // a second submission while one is under review is refused
    const again = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(again.status, 409);
  });

  test("multi-seat transfer: one submission, due computed server-side", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const ids = await book(p, tripId, ["30", "31"]);
    const r = await submit(p, proof({ bookingIds: ids, methodId: gcash, amount: "700" }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.amount_due, 700);
    assert.equal(r.data.payments.length, 2);
  });
});

describe("2/9. authorization and IDOR protection", () => {
  test("cannot submit proof for another passenger's booking", async () => {
    const owner = await createPassenger("Owner");
    const intruder = await createPassenger("Intruder");
    const { tripId } = await createTrip();
    const [bookingId] = await book(owner, tripId);
    const r = await submit(intruder, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(r.status, 404);
    assert.equal((await paymentsFor(bookingId)).length, 0);
    const status = await api("GET", `/api/payments/booking/${bookingId}`, { token: intruder.token });
    assert.equal(status.status, 404);
  });

  test("passengers can't see other passengers' receipts or staff endpoints", async () => {
    const owner = await createPassenger();
    const other = await createPassenger();
    const driver = await createDriver();
    const { tripId } = await createTrip();
    const [bookingId] = await book(owner, tripId);
    const r = await submit(owner, proof({ bookingIds: [bookingId], methodId: gcash }));
    const sid = r.data.submission_id;
    assert.equal((await api("GET", `/api/payments/submissions/${sid}/receipt`, { token: other.token })).status, 404);
    assert.equal((await api("GET", `/api/payments/submissions/${sid}/receipt`)).status, 401);
    for (const url of ["/api/payments/queue", "/api/payments/summary", `/api/payments/submissions/${sid}`]) {
      assert.equal((await api("GET", url, { token: owner.token })).status, 403, url);
      assert.equal((await api("GET", url, { token: driver.token })).status, 403, url);
      assert.equal((await api("GET", url)).status, 401, url);
    }
    // staff CAN view the receipt
    assert.equal((await api("GET", `/api/payments/submissions/${sid}/receipt`, { token: staff.token })).status, 200);
    // detail view never leaks to the passenger list endpoint
    const mine = await api("GET", "/api/payments/mine", { token: other.token });
    assert.equal(mine.data.length, 0);
  });
});

describe("3. passenger cannot change payment status", () => {
  test("status fields in the body are refused; staff actions are forbidden", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const tampered = await submit(p, { ...proof({ bookingIds: [bookingId], methodId: gcash }), status: "Verified" });
    assert.equal(tampered.status, 400);
    const tamperedAmount = await submit(p, { ...proof({ bookingIds: [bookingId], methodId: gcash }), amountDue: "1.00" });
    assert.equal(tamperedAmount.status, 400);

    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    const sid = r.data.submission_id;
    const [pay] = await paymentsFor(bookingId);
    for (const [method, url] of [
      ["PATCH", `/api/payments/submissions/${sid}/verify`],
      ["PATCH", `/api/payments/submissions/${sid}/reject`],
      ["PATCH", `/api/payments/submissions/${sid}/escalate`],
      ["PATCH", `/api/payments/${pay.payment_id}/refund-request`],
      ["PATCH", `/api/payments/${pay.payment_id}/refund-confirm`],
      ["PATCH", `/api/payments/${pay.payment_id}/verify`],
    ]) {
      const res = await api(method, url, { token: p.token, body: { fundsConfirmed: true, amountReceived: "350", reason: "x", note: "x", refundReference: "x" } });
      assert.equal(res.status, 403, url);
    }
    assert.equal((await paymentsFor(bookingId))[0].status, "Pending");
    // staff can't bare-confirm a Reserved booking through the generic status route either
    const bare = await api("PATCH", `/api/bookings/${bookingId}/status`, { token: staff.token, body: { status: "Confirmed" } });
    assert.equal(bare.status, 409);
  });
});

describe("4/5/16. staff verification", () => {
  test("verify requires the funds-received confirmation and the received amount", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    const sid = r.data.submission_id;
    const noCheck = await api("PATCH", `/api/payments/submissions/${sid}/verify`, { token: staff.token, body: { amountReceived: "350" } });
    assert.equal(noCheck.status, 400);
    const noAmount = await api("PATCH", `/api/payments/submissions/${sid}/verify`, { token: staff.token, body: { fundsConfirmed: true } });
    assert.equal(noAmount.status, 400);
    assert.equal((await paymentsFor(bookingId))[0].status, "Pending");
    assert.equal((await bookingRow(bookingId)).status, "Reserved");
  });

  test("verified payment confirms the booking, records the reviewer, writes audit logs", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const ref = gcashRef();
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, reference: ref }));
    const sid = r.data.submission_id;
    const ok = await verify(staff.token, sid, { ledgerReference: "GCASH-LEDGER-1" });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.seats[0].booking_confirmed, true);
    const [pay] = await paymentsFor(bookingId);
    assert.equal(pay.status, "Verified");
    assert.equal(pay.verified_by, staff.id);
    assert.equal((await bookingRow(bookingId)).status, "Confirmed");
    const [[claim]] = await db.query(`SELECT * FROM payment_reference_claims WHERE reference_normalized = ?`, [ref]);
    assert.equal(claim.submission_id, sid);
    const [logs] = await db.query(`SELECT * FROM payment_audit_logs WHERE payment_id = ? ORDER BY audit_log_id`, [pay.payment_id]);
    assert.deepEqual(logs.map((l) => l.action), ["submitted", "verified"]);
    assert.equal(logs[0].actor_role, "passenger");
    assert.equal(logs[0].actor_id, p.id);
    assert.equal(logs[1].actor_role, "staff");
    assert.equal(logs[1].actor_id, staff.id);
    assert.equal(logs[1].previous_status, "Pending");
    assert.equal(logs[1].new_status, "Verified");
    const details = typeof logs[1].details === "string" ? JSON.parse(logs[1].details) : logs[1].details;
    assert.equal(details.amountReceivedForTransfer, "350.00");
    assert.ok(!JSON.stringify(logs).includes("base64"), "no receipt data in audit logs");
    // retrying the approval is safe: 409, nothing re-run
    const retry = await verify(staff.token, sid);
    assert.equal(retry.status, 409);
    const [after] = await db.query(`SELECT COUNT(*) AS n FROM payment_audit_logs WHERE payment_id = ? AND action = 'verified'`, [pay.payment_id]);
    assert.equal(after[0].n, 1);
    // receipt endpoint (passenger) shows Verified + reviewer hidden
    const status = await api("GET", `/api/payments/booking/${bookingId}`, { token: p.token });
    assert.equal(status.data.payment.status, "Verified");
    assert.equal(status.data.payment.verified_by, undefined);
    assert.equal(JSON.stringify(status.data).includes("Tess"), false, "no staff names to passengers");
  });
});

describe("6. incorrect amounts", () => {
  test("claimed amount mismatch is flagged; underpayment can't be verified", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, amount: "300.00" }));
    assert.equal(r.status, 201);
    assert.equal(r.data.amount_mismatch, true);
    const q = await api("GET", "/api/payments/queue?status=open", { token: staff.token });
    const row = q.data.find((s) => s.submission_id === r.data.submission_id);
    assert.equal(row.amount_mismatch, true);
    assert.equal(row.amount_claimed, 300);
    assert.equal(row.amount_due, 350);
    const under = await verify(staff.token, r.data.submission_id, { amountReceived: "300.00" });
    assert.equal(under.status, 409);
    assert.match(under.data.error, /less than the fare/);
    assert.equal((await paymentsFor(bookingId))[0].status, "Pending");
  });

  test("money values are validated (no floats, no negatives, max 2 decimals)", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    for (const amount of ["-5", "abc", "350.123", "0", "1e3"]) {
      const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, amount }));
      assert.equal(r.status, 400, amount);
    }
  });
});

describe("7. duplicate transaction references", () => {
  test("same reference by another passenger is flagged and needs acknowledgement; a verified reference can't be reused", async () => {
    const a = await createPassenger("Alice");
    const b = await createPassenger("Bob");
    const { tripId } = await createTrip();
    const [ba] = await book(a, tripId);
    const [bb] = await book(b, tripId);
    const ref = gcashRef();
    const ra = await submit(a, proof({ bookingIds: [ba], methodId: gcash, reference: ref }));
    // Bob types it with spaces/dashes: normalization still matches
    const spaced = `${ref.slice(0, 4)} ${ref.slice(4, 8)}-${ref.slice(8)}`;
    const rb = await submit(b, proof({ bookingIds: [bb], methodId: gcash, reference: spaced }));
    assert.equal(rb.status, 201);

    const q = await api("GET", "/api/payments/queue?status=open", { token: staff.token });
    const row = q.data.find((s) => s.submission_id === rb.data.submission_id);
    assert.ok(row.duplicate_reference_count >= 1, "duplicate flagged in queue");
    const detail = await api("GET", `/api/payments/submissions/${rb.data.submission_id}`, { token: staff.token });
    assert.ok(detail.data.duplicates.some((d) => d.submission_id === ra.data.submission_id && d.same_reference));

    const needAck = await verify(staff.token, ra.data.submission_id);
    assert.equal(needAck.status, 409);
    assert.equal(needAck.data.code, "DUPLICATE_ACK_REQUIRED");
    const okA = await verify(staff.token, ra.data.submission_id, { acknowledgeDuplicate: true });
    assert.equal(okA.status, 200, JSON.stringify(okA.data));

    // Bob's claim of the same real transaction can never be verified now
    const blocked = await verify(staff.token, rb.data.submission_id, { acknowledgeDuplicate: true });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /already verified/);
    assert.equal((await paymentsFor(bb))[0].status, "Pending");
    assert.equal((await bookingRow(bb)).status, "Reserved");

    // and nobody can submit that reference again
    const c = await createPassenger();
    const [bc] = await book(c, tripId);
    const reuse = await submit(c, proof({ bookingIds: [bc], methodId: gcash, reference: ref }));
    assert.equal(reuse.status, 409);
  });

  test("the exact same receipt image on two submissions is flagged", async () => {
    const a = await createPassenger();
    const b = await createPassenger();
    const { tripId } = await createTrip();
    const [ba] = await book(a, tripId);
    const [bb] = await book(b, tripId);
    const image = pngReceipt();
    await submit(a, proof({ bookingIds: [ba], methodId: gcash, receipt: image }));
    const rb = await submit(b, proof({ bookingIds: [bb], methodId: gcash, receipt: image }));
    const detail = await api("GET", `/api/payments/submissions/${rb.data.submission_id}`, { token: staff.token });
    assert.ok(detail.data.duplicates.some((d) => d.same_receipt));
  });
});

describe("8. concurrent approvals", () => {
  test("parallel verify requests on one submission process exactly once", async () => {
    const p = await createPassenger();
    const staff2 = await createStaff("Second Reviewer", "terminal_staff");
    const { tripId } = await createTrip();
    const ids = await book(p, tripId, ["20", "21"]);
    const r = await submit(p, proof({ bookingIds: ids, methodId: gcash, amount: "700.00" }));
    const sid = r.data.submission_id;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => verify(i % 2 ? staff.token : staff2.token, sid, { amountReceived: "700.00" }))
    );
    const codes = results.map((x) => x.status).sort();
    assert.equal(codes.filter((c) => c === 200).length, 1, JSON.stringify(codes));
    assert.ok(codes.every((c) => c === 200 || c === 409), JSON.stringify(codes));
    for (const id of ids) {
      const pays = await paymentsFor(id);
      assert.equal(pays.length, 1);
      assert.equal(pays[0].status, "Verified");
      const [[n]] = await db.query(`SELECT COUNT(*) AS n FROM payment_audit_logs WHERE booking_id = ? AND action = 'verified'`, [id]);
      assert.equal(n.n, 1);
      const [[notes]] = await db.query(
        `SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'passenger' AND recipient_id = ? AND type = 'payment_verified' AND message LIKE ?`,
        [p.id, `%#${id} %`]
      );
      assert.equal(notes.n, 1, "passenger notified once per seat");
    }
  });

  test("two different submissions with the same reference verified at once: only one wins", async () => {
    const a = await createPassenger();
    const b = await createPassenger();
    const { tripId } = await createTrip();
    const [ba] = await book(a, tripId);
    const [bb] = await book(b, tripId);
    const ref = gcashRef();
    const ra = await submit(a, proof({ bookingIds: [ba], methodId: gcash, reference: ref }));
    const rb = await submit(b, proof({ bookingIds: [bb], methodId: gcash, reference: ref }));
    const [x, y] = await Promise.all([
      verify(staff.token, ra.data.submission_id, { acknowledgeDuplicate: true }),
      verify(admin.token, rb.data.submission_id, { acknowledgeDuplicate: true }),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const [[claims]] = await db.query(`SELECT COUNT(*) AS n FROM payment_reference_claims WHERE reference_normalized = ?`, [ref]);
    assert.equal(claims.n, 1);
  });
});

describe("9. role restrictions inside staff", () => {
  test("escalated payments are admin-only; refunds are confirmed by admins only", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    const sid = r.data.submission_id;
    assert.equal((await api("PATCH", `/api/payments/submissions/${sid}/escalate`, { token: staff.token, body: {} })).status, 400, "note required");
    const esc = await api("PATCH", `/api/payments/submissions/${sid}/escalate`, { token: staff.token, body: { note: "Amount appears twice in ledger" } });
    assert.equal(esc.status, 200);
    const staffVerify = await verify(staff.token, sid);
    assert.equal(staffVerify.status, 403);
    const adminVerify = await verify(admin.token, sid);
    assert.equal(adminVerify.status, 200, JSON.stringify(adminVerify.data));
    const [[staffNote]] = await db.query(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'staff' AND type = 'payment_review_escalated' AND recipient_id = ?`, [staff.id]);
    assert.equal(staffNote.n, 0, "escalation alerts go to admins only");
    const [[adminNote]] = await db.query(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'staff' AND type = 'payment_review_escalated' AND recipient_id = ?`, [admin.id]);
    assert.ok(adminNote.n >= 1);
  });
});

describe("10. receipt file validation", () => {
  test("wrong types, spoofed content, tiny, oversized and missing receipts are refused", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const gif = `data:image/gif;base64,${Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(2000)]).toString("base64")}`;
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg onload='alert(1)'/>".padEnd(2000)).toString("base64")}`;
    const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4".padEnd(2000)).toString("base64")}`;
    const tiny = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString("base64")}`;
    const textAsPng = `data:image/png;base64,${Buffer.from("hello world ".repeat(200)).toString("base64")}`;
    for (const [label, receipt] of [
      ["gif", gif],
      ["svg", svg],
      ["pdf", pdf],
      ["tiny", tiny],
      ["text disguised as png", textAsPng],
      ["jpeg bytes declared png", jpegBytesAsPng()],
      ["missing", null],
    ]) {
      const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, receipt }));
      assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.data)}`);
    }
    const huge = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, receipt: pngReceipt(5.5 * 1024 * 1024) }));
    assert.ok([400, 413].includes(huge.status), String(huge.status));
    assert.equal((await paymentsFor(bookingId)).length, 0);
  });

  test("reference format and payment time are validated per method", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const letters = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, reference: "ABCDEFGHIJ" }));
    assert.equal(letters.status, 400, "GCash refs are digits");
    const future = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, paidAt: new Date(Date.now() + 3600e3).toISOString() }));
    assert.equal(future.status, 400);
    const bankOk = await submit(p, proof({ bookingIds: [bookingId], methodId: bank, reference: "INST-PAY 77AB12" }));
    assert.equal(bankOk.status, 201, JSON.stringify(bankOk.data));
  });
});

describe("11. seat hold and expiry", () => {
  test("unpaid booking past its deadline is released; proof can't be submitted after", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId, ["40"]);
    await db.query(`UPDATE bookings SET payment_deadline = NOW() - INTERVAL 1 MINUTE WHERE booking_id = ?`, [bookingId]);
    const late = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(late.status, 409, "deadline enforced even before the sweeper runs");
    await sleep(1200);
    const b = await bookingRow(bookingId);
    assert.equal(b.status, "Cancelled");
    assert.equal(b.cancellation_reason, "payment_expired");
    const [[log]] = await db.query(`SELECT * FROM payment_audit_logs WHERE booking_id = ? AND action = 'seat_released'`, [bookingId]);
    assert.equal(log.actor_role, "system");
    // the seat is free again
    const other = await createPassenger();
    const r = await api("POST", "/api/bookings", { token: other.token, body: { tripId, seatNumbers: ["40"] } });
    assert.equal(r.status, 201);
  });

  test("a seat with proof under review is NOT released when the timer runs out, and is never auto-approved", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    await db.query(`UPDATE bookings SET payment_deadline = NOW() - INTERVAL 5 MINUTE WHERE booking_id = ?`, [bookingId]);
    await sleep(1200);
    assert.equal((await bookingRow(bookingId)).status, "Reserved");
    assert.equal((await paymentsFor(bookingId))[0].status, "Pending");
  });

  test("passenger is warned before expiry; staff alerted about proofs on trips departing soon", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip({ hours: 1 });
    const [b1, b2] = await book(p, tripId, ["35", "36"]);
    await db.query(`UPDATE bookings SET payment_deadline = NOW() + INTERVAL 5 MINUTE WHERE booking_id = ?`, [b1]);
    const r = await submit(p, proof({ bookingIds: [b2], methodId: gcash }));
    await sleep(1200);
    assert.ok((await bookingRow(b1)).expiry_warned_at);
    const [[warn]] = await db.query(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND recipient_type = 'passenger' AND type = 'booking_expiring'`, [p.id]);
    assert.equal(warn.n, 1);
    const [[sub]] = await db.query(`SELECT departure_alert_sent_at FROM payment_submissions WHERE submission_id = ?`, [r.data.submission_id]);
    assert.ok(sub.departure_alert_sent_at);
    const summary = await api("GET", "/api/payments/summary", { token: staff.token });
    assert.ok(summary.data.departingSoon >= 1);
  });

  test("verification of a booking cancelled meanwhile records the money and opens a refund", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    const cancel = await api("PATCH", `/api/bookings/${bookingId}/status`, { token: p.token, body: { status: "Cancelled" } });
    assert.equal(cancel.status, 200);
    const v = await verify(staff.token, r.data.submission_id);
    assert.equal(v.status, 200);
    assert.equal(v.data.seats[0].refund, "cancelled");
    assert.equal((await paymentsFor(bookingId))[0].status, "Refund Pending");
    assert.equal((await bookingRow(bookingId)).status, "Cancelled", "a cancelled booking is never reopened");
  });
});

describe("12. no overbooking", () => {
  test("concurrent bookings of one seat: exactly one succeeds", async () => {
    const { tripId } = await createTrip();
    const passengers = await Promise.all(Array.from({ length: 10 }, () => createPassenger()));
    const results = await Promise.all(passengers.map((p) => api("POST", "/api/bookings", { token: p.token, body: { tripId, seatNumbers: ["12"] } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
    const [[n]] = await db.query(`SELECT COUNT(*) AS n FROM bookings WHERE trip_id = ? AND seat_number = '12' AND status <> 'Cancelled'`, [tripId]);
    assert.equal(n.n, 1);
  });
});

describe("13. rejection and resubmission", () => {
  test("rejected payment can be resubmitted; history kept; deadline extended; attempt cap enforced", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    await db.query(`UPDATE bookings SET payment_deadline = NOW() + INTERVAL 2 MINUTE WHERE booking_id = ?`, [bookingId]);
    const r1 = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    const noReason = await api("PATCH", `/api/payments/submissions/${r1.data.submission_id}/reject`, { token: staff.token, body: {} });
    assert.equal(noReason.status, 400);
    const rej = await api("PATCH", `/api/payments/submissions/${r1.data.submission_id}/reject`, { token: staff.token, body: { reason: "Reference not found in our GCash account" } });
    assert.equal(rej.status, 200);
    const extended = await bookingRow(bookingId);
    assert.ok(new Date(extended.payment_deadline) > new Date(Date.now() + 30 * 60000), "fresh window to resubmit");
    const status = await api("GET", `/api/payments/booking/${bookingId}`, { token: p.token });
    assert.equal(status.data.payment.status, "Rejected");
    assert.equal(status.data.payment.rejection_reason, "Reference not found in our GCash account");
    assert.equal(status.data.can_pay, true);

    const r2 = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(r2.status, 201);
    const resub = await api("PATCH", `/api/payments/submissions/${r2.data.submission_id}/request-resubmission`, { token: staff.token, body: { reason: "Screenshot is blurry" } });
    assert.equal(resub.status, 200);
    const s2 = await api("GET", `/api/payments/booking/${bookingId}`, { token: p.token });
    assert.equal(s2.data.payment.status, "Needs Resubmission");
    assert.equal(s2.data.history.length, 2);
    const [[log]] = await db.query(`SELECT action FROM payment_audit_logs WHERE submission_id = ? AND action <> 'submitted' AND action <> 'resubmitted'`, [r2.data.submission_id]);
    assert.equal(log.action, "resubmission_requested");

    // attempts 3..5 then the cap
    for (let i = 3; i <= 5; i += 1) {
      const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
      assert.equal(r.status, 201, `attempt ${i}`);
      await api("PATCH", `/api/payments/submissions/${r.data.submission_id}/reject`, { token: staff.token, body: { reason: "No" } });
    }
    const capped = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(capped.status, 409);
    assert.match(capped.data.error, /limit/);
  });
});

describe("14. verified payments are final", () => {
  test("a verified payment can't be rejected, sent back, escalated or resubmitted", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    await verify(staff.token, r.data.submission_id);
    for (const action of ["reject", "request-resubmission", "escalate"]) {
      const res = await api("PATCH", `/api/payments/submissions/${r.data.submission_id}/${action}`, { token: admin.token, body: { reason: "x", note: "x" } });
      assert.equal(res.status, 409, action);
    }
    assert.equal((await paymentsFor(bookingId))[0].status, "Verified");
    const again = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    assert.equal(again.status, 409);
    // cash can't be collected again at the counter either
    const counter = await api("POST", `/api/bookings/${bookingId}/counter-payment`, { token: staff.token, body: { cashReceived: 350 } });
    assert.equal(counter.status, 409);
  });
});

describe("15. refunds", () => {
  test("refund request (staff) cancels the held seat when confirmed; refund confirmation is admin-only and recorded", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    await verify(staff.token, r.data.submission_id);
    const [pay] = await paymentsFor(bookingId);
    const needCancel = await api("PATCH", `/api/payments/${pay.payment_id}/refund-request`, { token: staff.token, body: { reason: "Passenger can't travel" } });
    assert.equal(needCancel.status, 409);
    const req = await api("PATCH", `/api/payments/${pay.payment_id}/refund-request`, { token: staff.token, body: { reason: "Passenger can't travel", cancelBooking: true } });
    assert.equal(req.status, 200, JSON.stringify(req.data));
    assert.equal((await bookingRow(bookingId)).status, "Cancelled");
    assert.equal((await paymentsFor(bookingId))[0].status, "Refund Pending");
    const staffConfirm = await api("PATCH", `/api/payments/${pay.payment_id}/refund-confirm`, { token: staff.token, body: { refundReference: "R1" } });
    assert.equal(staffConfirm.status, 403);
    const noRef = await api("PATCH", `/api/payments/${pay.payment_id}/refund-confirm`, { token: admin.token, body: {} });
    assert.equal(noRef.status, 400);
    const done = await api("PATCH", `/api/payments/${pay.payment_id}/refund-confirm`, { token: admin.token, body: { refundReference: "GCASH-REFUND-778" } });
    assert.equal(done.status, 200);
    const final = (await paymentsFor(bookingId))[0];
    assert.equal(final.status, "Refunded");
    assert.equal(final.refund_reference, "GCASH-REFUND-778");
    assert.equal(final.refunded_by, admin.id);
    const twice = await api("PATCH", `/api/payments/${pay.payment_id}/refund-confirm`, { token: admin.token, body: { refundReference: "X" } });
    assert.equal(twice.status, 409);
    const [logs] = await db.query(`SELECT action, actor_role FROM payment_audit_logs WHERE payment_id = ? ORDER BY audit_log_id`, [pay.payment_id]);
    assert.deepEqual(logs.map((l) => l.action), ["submitted", "verified", "refund_requested", "refund_confirmed"]);
    assert.equal(logs[3].actor_role, "admin");
  });

  test("operator cancelling a trip opens refunds for verified payments", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const r = await submit(p, proof({ bookingIds: [bookingId], methodId: gcash }));
    await verify(staff.token, r.data.submission_id);
    const cancel = await api("PATCH", `/api/trips/${tripId}/status`, { token: admin.token, body: { status: "Cancelled" } });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
    const pay = (await paymentsFor(bookingId))[0];
    assert.equal(pay.status, "Refund Pending");
    assert.equal(pay.refund_reason, "Trip cancelled by the operator");
  });
});

describe("17. existing features still work", () => {
  test("walk-in sale, counter cash payment, passenger cancel, trip listing, seat map", async () => {
    const { tripId } = await createTrip();
    const walkIn = await api("POST", "/api/bookings/walk-in", { token: staff.token, body: { tripId, passengerName: "Walk In", seatNumbers: ["1"], cashReceived: 400 } });
    assert.equal(walkIn.status, 201, JSON.stringify(walkIn.data));
    assert.equal(walkIn.data.bookings[0].status, "Confirmed");
    assert.equal(walkIn.data.bookings[0].payment_deadline, null, "walk-ins have no online hold");

    const p = await createPassenger();
    const [bookingId] = await book(p, tripId, ["2"]);
    const cash = await api("POST", `/api/bookings/${bookingId}/counter-payment`, { token: staff.token, body: { cashReceived: 350 } });
    assert.equal(cash.status, 200, JSON.stringify(cash.data));
    assert.equal((await bookingRow(bookingId)).status, "Confirmed");

    const [b2] = await book(p, tripId, ["3"]);
    const pend = await submit(p, proof({ bookingIds: [b2], methodId: gcash }));
    const blockedCash = await api("POST", `/api/bookings/${b2}/counter-payment`, { token: staff.token, body: { cashReceived: 350 } });
    assert.equal(blockedCash.status, 409, "no double charge while online proof is under review");
    assert.ok(pend.data.submission_id);

    const [b3] = await book(p, tripId, ["4"]);
    const c = await api("PATCH", `/api/bookings/${b3}/status`, { token: p.token, body: { status: "Cancelled" } });
    assert.equal(c.status, 200);

    const trips = await api("GET", "/api/trips?scope=bookable");
    assert.equal(trips.status, 200);
    const seats = await api("GET", `/api/trips/${tripId}/seats`);
    assert.deepEqual(seats.data.bookedSeats.sort(), ["1", "2", "3"]);
    const search = await api("GET", `/api/bookings/search?q=DRS-2026-${String(bookingId).padStart(5, "0")}`, { token: staff.token });
    assert.equal(search.status, 200);
    assert.ok(search.data.some((b) => b.booking_id === bookingId));
    const old = await api("PATCH", `/api/payments/1/verify`, { token: staff.token });
    assert.equal(old.status, 410, "retired endpoint can't bypass the checks");
  });
});

describe("staff queue & dashboard", () => {
  test("filters, search by booking reference, priority sort and summary counts", async () => {
    const p = await createPassenger("Zed Searchable");
    const soon = await createTrip({ hours: 2 });
    const later = await createTrip({ hours: 48 });
    const [bLater] = await book(p, later.tripId);
    const [bSoon] = await book(p, soon.tripId);
    const rLater = await submit(p, proof({ bookingIds: [bLater], methodId: gcash }));
    const rSoon = await submit(p, proof({ bookingIds: [bSoon], methodId: bank, reference: "BANKREF9" + Date.now() }));
    const prio = await api("GET", "/api/payments/queue?status=open&sort=priority", { token: staff.token });
    const order = prio.data.map((s) => s.submission_id);
    assert.ok(order.indexOf(rSoon.data.submission_id) < order.indexOf(rLater.data.submission_id), "departing sooner first");
    const oldest = await api("GET", "/api/payments/queue?status=open&sort=oldest", { token: staff.token });
    const o = oldest.data.map((s) => s.submission_id);
    assert.ok(o.indexOf(rLater.data.submission_id) < o.indexOf(rSoon.data.submission_id), "oldest first");
    const byMethod = await api("GET", "/api/payments/queue?status=all&method=bank_transfer", { token: staff.token });
    assert.ok(byMethod.data.every((s) => s.payment_method === "bank_transfer"));
    const byRoute = await api("GET", `/api/payments/queue?status=all&routeId=${soon.routeId}`, { token: staff.token });
    assert.deepEqual(byRoute.data.map((s) => s.submission_id), [rSoon.data.submission_id]);
    const departing = await api("GET", "/api/payments/queue?status=open&departingWithinHours=3", { token: staff.token });
    assert.ok(departing.data.some((s) => s.submission_id === rSoon.data.submission_id));
    assert.ok(!departing.data.some((s) => s.submission_id === rLater.data.submission_id));
    const ref = rSoon.data.payments[0].booking_id;
    const bySearch = await api("GET", `/api/payments/queue?status=all&q=${encodeURIComponent(`DRS-2026-${String(ref).padStart(5, "0")}`)}`, { token: staff.token });
    assert.ok(bySearch.data.some((s) => s.submission_id === rSoon.data.submission_id));
    const byName = await api("GET", `/api/payments/queue?status=all&q=Searchable`, { token: staff.token });
    assert.equal(byName.data.length, 2);
    const bad = await api("GET", "/api/payments/queue?status=Bogus", { token: staff.token });
    assert.equal(bad.status, 400);

    const assign = await api("PATCH", `/api/payments/submissions/${rLater.data.submission_id}/assign`, { token: staff.token, body: { assign: true } });
    assert.equal(assign.status, 200);
    const taken = await api("PATCH", `/api/payments/submissions/${rLater.data.submission_id}/assign`, { token: admin.token, body: { assign: true } });
    assert.equal(taken.status, 409);
    const sum = await api("GET", "/api/payments/summary", { token: staff.token });
    assert.ok(sum.data.underReview >= 1);
    assert.ok(sum.data.awaitingReview >= 1);
    assert.ok(Array.isArray(sum.data.recentActivity));
    const note = await api("POST", `/api/payments/submissions/${rLater.data.submission_id}/notes`, { token: staff.token, body: { note: "Called passenger" } });
    assert.equal(note.status, 201);
    const detail = await api("GET", `/api/payments/submissions/${rLater.data.submission_id}`, { token: staff.token });
    assert.ok(detail.data.history.some((h) => h.action === "note" && h.internal_note === "Called passenger"));
    // internal notes never reach the passenger
    const mine = await api("GET", "/api/payments/mine", { token: p.token });
    assert.ok(!JSON.stringify(mine.data).includes("Called passenger"));
  });

  test("staff get in-app notifications and can read them", async () => {
    const list = await api("GET", "/api/notifications", { token: staff.token });
    assert.equal(list.status, 200);
    assert.ok(list.data.some((n) => n.type === "payment_review_new"));
  });
});

describe("rate limiting", () => {
  test("payment submission is rate limited per passenger", async () => {
    const p = await createPassenger();
    const { tripId } = await createTrip();
    const [bookingId] = await book(p, tripId);
    const codes = [];
    for (let i = 0; i < 24; i += 1) codes.push((await submit(p, proof({ bookingIds: [bookingId], methodId: gcash, amount: "abc" }))).status);
    assert.ok(codes.includes(429), JSON.stringify(codes));
  });
});
