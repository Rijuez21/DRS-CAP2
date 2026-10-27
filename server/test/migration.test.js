// Upgrade path: a database built from the ORIGINAL schema (before payment
// verification), holding legacy payments, is migrated with `npm run
// db:migrate`. Checks nothing is lost, legacy rows are linked, the old QR
// becomes a payment method, re-running is a no-op, and pre-existing
// duplicates stop the unique keys with a clear message instead of failing
// half-way. Uses its own throwaway database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_URL = process.env.TEST_MYSQL_ADMIN_URL || "mysql://drs:drs@127.0.0.1:3307";
if (/rlwy|railway/i.test(ADMIN_URL)) throw new Error("Refusing to run tests against a Railway database");
const DB = "drs_migration_test";
const env = { ...process.env, MYSQL_URL: `${ADMIN_URL}/${DB}`, REDIS_URL: "redis://127.0.0.1:6380/15" };
let conn;
const opened = []; // every connection this file opens, closed in after()

async function freshLegacyDb() {
  const admin = await mysql.createConnection(ADMIN_URL);
  opened.push(admin);
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  conn = await mysql.createConnection(`${ADMIN_URL}/${DB}`);
  opened.push(conn);
  // \r?\n: a Windows checkout has CRLF endings, and "." doesn't match \r, so
  // the comment strip below missed and a ";" inside a comment split a statement.
  const sql = readFileSync(path.join(root, "test/fixtures/legacy-schema.sql"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) await conn.query(statement);
  await conn.query(`INSERT INTO staff_accounts (name, email, password_hash, role) VALUES ('Admin', 'a@t', 'h', 'admin')`);
  await conn.query(`INSERT INTO commuters (name, email, password_hash) VALUES ('Pia', 'p@t', 'h'), ('Quin', 'q@t', 'h')`);
  await conn.query(`INSERT INTO routes (origin, destination, base_fare) VALUES ('Baguio', 'Bontoc', 350.00)`);
  await conn.query(`INSERT INTO drivers (name) VALUES ('D')`);
  await conn.query(`INSERT INTO buses (plate_num, capacity) VALUES ('AAA111', 40)`);
  await conn.query(`INSERT INTO trips (departure_time, bus_id, driver_id, route_id) VALUES (NOW() + INTERVAL 1 DAY, 1, 1, 1)`);
  await conn.query(
    `INSERT INTO bookings (passenger_name, seat_number, status, passenger_id, trip_id) VALUES
     ('Pia', '1', 'Confirmed', 1, 1), ('Pia', '2', 'Confirmed', 1, 1), ('Quin', '3', 'Reserved', 2, 1)`
  );
  await conn.query(`INSERT INTO payment_settings (setting_id, qr_image, label, instructions, updated_by) VALUES (1, 'data:image/png;base64,iVBORw0KGgo=', 'Old QR', 'Pay exact', 1)`);
  await conn.query(
    `INSERT INTO payments (booking_id, amount, reference_number, status, submitted_at, verified_by) VALUES
     (1, 350, '1111 2222 3333', 'Verified', '2026-10-01 10:00:00', 1),
     (2, 350, '1111 2222 3333', 'Verified', '2026-10-01 10:00:00', 1)`
  );
  await conn.query(
    `INSERT INTO payments (booking_id, amount, reference_number, proof_image, status, submitted_at) VALUES
     (3, 350, 'REF-9', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', 'Pending', '2026-10-02 09:00:00')`
  );
}

function migrate() {
  return spawnSync("node", ["src/db/migrate.js"], { cwd: root, env, encoding: "utf8" });
}

before(freshLegacyDb);
after(() => opened.forEach((c) => c.destroy()));

test("upgrades a legacy database without losing data, and is re-runnable", async () => {
  const [[{ n_before: countBefore }]] = await conn.query(`SELECT COUNT(*) AS n_before FROM payments`);
  const first = migrate();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stdout, /linked 3 existing payment row\(s\) to 2 submission\(s\)/);
  const second = migrate();
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /Backfill: linked/);

  const [[{ n_after: countAfter }]] = await conn.query(`SELECT COUNT(*) AS n_after FROM payments`);
  assert.equal(countAfter, countBefore);
  const [rows] = await conn.query(`SELECT payment_id, submission_id, status, proof_image IS NOT NULL AS kept FROM payments ORDER BY payment_id`);
  assert.ok(rows.every((r) => r.submission_id));
  assert.equal(rows[0].submission_id, rows[1].submission_id, "multi-seat transfer grouped");
  assert.equal(rows[2].kept, 1, "legacy proof_image left untouched");
  const [[sub]] = await conn.query(`SELECT amount_due, is_legacy, reference_normalized FROM payment_submissions WHERE submission_id = ?`, [rows[0].submission_id]);
  assert.equal(sub.amount_due, "700.00");
  assert.equal(sub.is_legacy, 1);
  assert.equal(sub.reference_normalized, "111122223333");
  const [claims] = await conn.query(`SELECT * FROM payment_reference_claims`);
  assert.equal(claims.length, 1, "legacy verified reference claimed");
  const [[method]] = await conn.query(`SELECT method_type, account_name, is_active FROM payment_methods`);
  assert.deepEqual({ ...method }, { method_type: "qr_ph", account_name: "Old QR", is_active: 1 });
  const [[b]] = await conn.query(`SELECT payment_deadline FROM bookings WHERE booking_id = 3`);
  assert.equal(b.payment_deadline, null, "existing bookings get no hold (behaviour unchanged)");
  const [cols] = await conn.query(`SHOW INDEX FROM payments WHERE Key_name IN ('uq_payments_open_booking', 'uq_payments_verified_booking')`);
  assert.equal(cols.length, 2);
});

test("existing passenger phones are tidied so the unique mobile-number index can be added", async () => {
  await freshLegacyDb();
  await conn.query(
    `INSERT INTO commuters (name, email, phoneno, password_hash) VALUES
     ('Old A', 'a1@t', '0917 123 4567', 'h'), ('Old B', 'b1@t', '+639171234567', 'h'),
     ('Blank 1', 'c1@t', '', 'h'), ('Blank 2', 'c2@t', '  ', 'h'),
     ('Land 1', 'd1@t', '(074) 442-1234', 'h'), ('Land 2', 'd2@t', '(074) 442-1234 ', 'h'),
     ('No phone', 'e1@t', NULL, 'h')`
  );
  const r = migrate();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /cleared a duplicate mobile number on commuter #4, #8/);
  const [rows] = await conn.query(`SELECT email, phoneno, terms_accepted_at FROM commuters WHERE email LIKE '%1@t' OR email LIKE '%2@t' ORDER BY commuter_id`);
  assert.deepEqual(
    rows.map((row) => [row.email, row.phoneno]),
    [["a1@t", "+639171234567"], ["b1@t", null], ["c1@t", null], ["c2@t", null], ["d1@t", "(074) 442-1234"], ["d2@t", null], ["e1@t", null]]
  );
  assert.ok(rows.every((row) => row.terms_accepted_at === null), "older accounts have no recorded consent");
  const [idx] = await conn.query(`SHOW INDEX FROM commuters WHERE Key_name = 'uq_commuters_phoneno' AND Non_unique = 0`);
  assert.equal(idx.length, 1);
  const again = migrate();
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /Passenger phones:/);
});

test("pre-existing duplicate open payments block only the unique keys, with a clear message", async () => {
  await freshLegacyDb();
  await conn.query(`INSERT INTO payments (booking_id, amount, reference_number, status) VALUES (3, 350, 'DUP-1', 'Pending')`);
  const r = migrate();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /booking #3 has 2 payments awaiting review/);
  const [[t]] = await conn.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_audit_logs'`);
  assert.equal(t.n, 1, "everything else still applied");
  await conn.query(`UPDATE payments SET status = 'Rejected', rejection_reason = 'duplicate' WHERE reference_number = 'DUP-1'`);
  const fixed = migrate();
  assert.equal(fixed.status, 0, fixed.stderr);
});
