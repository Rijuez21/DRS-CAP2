import { normalizeReference } from "../services/paymentRules.js";

// ============================================================================
// Manual payment verification — additive migration (run by migrate.js).
// Nothing here drops or rewrites existing data:
//   * new tables: payment_methods, payment_submissions,
//     payment_reference_claims, payment_audit_logs
//   * new nullable columns on payments / bookings
//   * ENUM values APPENDED (metadata-only change, stored indexes untouched)
//   * legacy payments rows are linked to a backfilled submission each
//     (their original proof_image column is left in place, unchanged)
// Rollback steps are in server/README.md ("Rolling back the payment
// verification migration").
// ============================================================================

export const PAYMENT_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS payment_methods (
    method_id INT AUTO_INCREMENT PRIMARY KEY,
    method_type ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    account_name VARCHAR(150) NULL,
    account_number VARCHAR(60) NULL,
    bank_name VARCHAR(100) NULL,
    qr_image LONGTEXT NULL,
    instructions VARCHAR(1000) NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES staff_accounts(staff_id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payment_submissions (
    submission_id INT AUTO_INCREMENT PRIMARY KEY,
    passenger_id INT NOT NULL,
    method_id INT NULL,
    payment_method ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
    reference_number VARCHAR(100) NOT NULL,
    reference_normalized VARCHAR(100) NOT NULL,
    amount_due DECIMAL(10,2) NOT NULL,
    amount_claimed DECIMAL(10,2) NULL,
    paid_at DATETIME NULL,
    receipt_data LONGTEXT NULL,
    receipt_mime VARCHAR(20) NULL,
    receipt_bytes INT NULL,
    receipt_sha256 CHAR(64) NULL,
    amount_received DECIMAL(10,2) NULL,
    ledger_reference VARCHAR(100) NULL,
    assigned_to INT NULL,
    assigned_at TIMESTAMP NULL DEFAULT NULL,
    departure_alert_sent_at TIMESTAMP NULL DEFAULT NULL,
    is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (passenger_id) REFERENCES commuters(commuter_id),
    FOREIGN KEY (method_id) REFERENCES payment_methods(method_id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES staff_accounts(staff_id) ON DELETE SET NULL,
    KEY idx_submissions_reference (reference_normalized),
    KEY idx_submissions_receipt_hash (receipt_sha256),
    KEY idx_submissions_passenger (passenger_id),
    KEY idx_submissions_submitted (submitted_at)
  )`,
  `CREATE TABLE IF NOT EXISTS payment_reference_claims (
    claim_id INT AUTO_INCREMENT PRIMARY KEY,
    payment_method ENUM('gcash', 'bank_transfer', 'qr_ph') NOT NULL,
    reference_normalized VARCHAR(100) NOT NULL,
    submission_id INT NOT NULL,
    claimed_by INT NULL,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reference_claim (payment_method, reference_normalized),
    FOREIGN KEY (submission_id) REFERENCES payment_submissions(submission_id)
  )`,
  `CREATE TABLE IF NOT EXISTS payment_audit_logs (
    audit_log_id INT AUTO_INCREMENT PRIMARY KEY,
    payment_id INT NULL,
    submission_id INT NULL,
    booking_id INT NULL,
    actor_id INT NULL,
    actor_role ENUM('passenger', 'staff', 'admin', 'system') NOT NULL,
    previous_status VARCHAR(30) NULL,
    new_status VARCHAR(30) NULL,
    action VARCHAR(40) NOT NULL,
    reason VARCHAR(500) NULL,
    internal_note VARCHAR(1000) NULL,
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pal_payment (payment_id),
    KEY idx_pal_submission (submission_id),
    KEY idx_pal_booking (booking_id),
    KEY idx_pal_created (created_at)
  )`,
];

export const PAYMENT_ALTER_STATEMENTS = [
  `ALTER TABLE payments MODIFY COLUMN status ENUM('Pending', 'Verified', 'Rejected', 'Needs Resubmission', 'Escalated', 'Refund Pending', 'Refunded') NOT NULL DEFAULT 'Pending'`,
  `ALTER TABLE payments ADD COLUMN submission_id INT NULL`,
  `ALTER TABLE payments ADD CONSTRAINT fk_payments_submission FOREIGN KEY (submission_id) REFERENCES payment_submissions(submission_id)`,
  `CREATE INDEX idx_payments_submission ON payments (submission_id)`,
  `ALTER TABLE payments ADD COLUMN refund_reason VARCHAR(255) NULL`,
  `ALTER TABLE payments ADD COLUMN refund_requested_at TIMESTAMP NULL DEFAULT NULL`,
  `ALTER TABLE payments ADD COLUMN refund_requested_by INT NULL`,
  `ALTER TABLE payments ADD COLUMN refund_reference VARCHAR(100) NULL`,
  `ALTER TABLE payments ADD COLUMN refunded_at TIMESTAMP NULL DEFAULT NULL`,
  `ALTER TABLE payments ADD COLUMN refunded_by INT NULL`,
  `ALTER TABLE payments ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
  `ALTER TABLE bookings ADD COLUMN payment_deadline DATETIME NULL`,
  `ALTER TABLE bookings ADD COLUMN expiry_warned_at TIMESTAMP NULL DEFAULT NULL`,
  `ALTER TABLE bookings ADD COLUMN cancellation_reason VARCHAR(50) NULL`,
  `CREATE INDEX idx_bookings_payment_hold ON bookings (status, payment_deadline)`,
  `ALTER TABLE notifications MODIFY COLUMN recipient_type ENUM('passenger', 'driver', 'staff') NOT NULL`,
];

// Applied only after checkLegacyDuplicates() passes, so a database with
// pre-existing duplicates gets a clear message instead of a half-applied key.
export const PAYMENT_UNIQUE_STATEMENTS = [
  // At most ONE payment awaiting a staff decision per booking.
  `ALTER TABLE payments ADD COLUMN open_booking_id INT GENERATED ALWAYS AS (
     CASE WHEN status IN ('Pending', 'Escalated') THEN booking_id ELSE NULL END
   ) STORED`,
  `ALTER TABLE payments ADD UNIQUE KEY uq_payments_open_booking (open_booking_id)`,
  // At most ONE Verified payment per booking: two concurrent approvals of
  // different submissions for the same seat can't both succeed.
  `ALTER TABLE payments ADD COLUMN verified_booking_id INT GENERATED ALWAYS AS (
     CASE WHEN status = 'Verified' THEN booking_id ELSE NULL END
   ) STORED`,
  `ALTER TABLE payments ADD UNIQUE KEY uq_payments_verified_booking (verified_booking_id)`,
];

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

// Legacy data written before these keys existed could (rarely) break them.
// Report exactly which bookings so an admin can resolve them by hand rather
// than the migration guessing which payment is the "real" one.
export async function checkLegacyDuplicates(pool) {
  const problems = [];
  if (!(await columnExists(pool, "payments", "open_booking_id"))) {
    const [rows] = await pool.query(
      `SELECT booking_id, COUNT(*) AS n FROM payments WHERE status IN ('Pending', 'Escalated') GROUP BY booking_id HAVING n > 1`
    );
    for (const r of rows) problems.push(`booking #${r.booking_id} has ${r.n} payments awaiting review`);
  }
  if (!(await columnExists(pool, "payments", "verified_booking_id"))) {
    const [rows] = await pool.query(
      `SELECT booking_id, COUNT(*) AS n FROM payments WHERE status = 'Verified' GROUP BY booking_id HAVING n > 1`
    );
    for (const r of rows) problems.push(`booking #${r.booking_id} has ${r.n} verified payments`);
  }
  return problems;
}

// Splits a stored data: URL into its parts (legacy proof_image values).
function splitDataUrl(value) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(value ?? "");
  return m ? { mime: m[1], base64: m[2] } : null;
}

// Idempotent: only touches rows that still need it.
export async function backfillPayments(pool, { log = console.log } = {}) {
  const { createHash } = await import("node:crypto");

  // 1. Seed one payment method from the old single-QR setting, so passengers
  //    keep seeing the admin's QR after the upgrade.
  const [[{ methodCount }]] = await pool.query(`SELECT COUNT(*) AS methodCount FROM payment_methods`);
  if (Number(methodCount) === 0) {
    const [[legacy]] = await pool.query(`SELECT qr_image, label, instructions, updated_by FROM payment_settings WHERE setting_id = 1`);
    if (legacy) {
      await pool.query(
        `INSERT INTO payment_methods (method_type, display_name, account_name, qr_image, instructions, is_active, sort_order, updated_by)
         VALUES ('qr_ph', 'QR Ph', ?, ?, ?, TRUE, 0, ?)`,
        [legacy.label, legacy.qr_image, legacy.instructions, legacy.updated_by]
      );
      log("Backfill: created a 'QR Ph' payment method from the existing payment QR.");
    }
  }

  // 2. Give every pre-existing payments row a submission. Rows that were
  //    one multi-seat transfer (same passenger, same reference, same submit
  //    second — how the old POST /api/payments wrote them) share one.
  const [legacyRows] = await pool.query(
    `SELECT p.payment_id, p.amount, p.reference_number, p.status, p.submitted_at, p.verified_by,
            (p.proof_image IS NOT NULL) AS has_proof, bk.passenger_id
     FROM payments p JOIN bookings bk ON bk.booking_id = p.booking_id
     WHERE p.submission_id IS NULL
     ORDER BY p.payment_id`
  );
  if (legacyRows.length === 0) return { submissionsCreated: 0, claimConflicts: 0 };

  const groups = new Map();
  for (const r of legacyRows) {
    const key = `${r.passenger_id}|${normalizeReference(r.reference_number)}|${new Date(r.submitted_at).toISOString()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let submissionsCreated = 0;
  let claimConflicts = 0;
  for (const rows of groups.values()) {
    const first = rows[0];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Re-check under lock: a concurrent run may have done this group.
      const [still] = await conn.query(
        `SELECT payment_id FROM payments WHERE payment_id IN (?) AND submission_id IS NULL FOR UPDATE`,
        [rows.map((r) => r.payment_id)]
      );
      if (still.length === 0) {
        await conn.rollback();
        continue;
      }
      let receipt = null;
      const withProof = rows.find((r) => r.has_proof);
      if (withProof) {
        const [[img]] = await conn.query(`SELECT proof_image FROM payments WHERE payment_id = ?`, [withProof.payment_id]);
        const parts = splitDataUrl(img?.proof_image);
        if (parts) {
          const buf = Buffer.from(parts.base64, "base64");
          receipt = { ...parts, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
        }
      }
      const dueCentavos = rows.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0);
      const [result] = await conn.query(
        `INSERT INTO payment_submissions
           (passenger_id, payment_method, reference_number, reference_normalized, amount_due, amount_claimed,
            receipt_data, receipt_mime, receipt_bytes, receipt_sha256, is_legacy, submitted_at)
         VALUES (?, 'qr_ph', ?, ?, ?, NULL, ?, ?, ?, ?, TRUE, ?)`,
        [
          first.passenger_id,
          first.reference_number,
          normalizeReference(first.reference_number),
          (dueCentavos / 100).toFixed(2),
          receipt?.base64 ?? null,
          receipt?.mime ?? null,
          receipt?.bytes ?? null,
          receipt?.sha256 ?? null,
          first.submitted_at,
        ]
      );
      await conn.query(`UPDATE payments SET submission_id = ? WHERE payment_id IN (?) AND submission_id IS NULL`, [
        result.insertId,
        rows.map((r) => r.payment_id),
      ]);
      // A legacy verified transfer is a real, already-used transaction:
      // claim its reference so it can't be verified again for another seat.
      if (rows.some((r) => r.status === "Verified")) {
        const [claim] = await conn.query(
          `INSERT IGNORE INTO payment_reference_claims (payment_method, reference_normalized, submission_id, claimed_by)
           VALUES ('qr_ph', ?, ?, ?)`,
          [normalizeReference(first.reference_number), result.insertId, first.verified_by ?? null]
        );
        if (claim.affectedRows === 0) claimConflicts += 1;
      }
      await conn.query(
        `INSERT INTO payment_audit_logs (submission_id, actor_role, action, internal_note, details)
         VALUES (?, 'system', 'legacy_backfill', 'Linked pre-existing payment rows to a submission during migration', ?)`,
        [result.insertId, JSON.stringify({ paymentIds: rows.map((r) => r.payment_id) })]
      );
      await conn.commit();
      submissionsCreated += 1;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }
  log(`Backfill: linked ${legacyRows.length} existing payment row(s) to ${submissionsCreated} submission(s).`);
  if (claimConflicts > 0) {
    log(`Backfill WARNING: ${claimConflicts} legacy verified reference(s) were already claimed by another submission — review them in Payment Verification.`);
  }
  return { submissionsCreated, claimConflicts };
}
