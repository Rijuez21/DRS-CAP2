import { pool } from "../db/pool.js";

// ============================================================================
// Data retention (runs on a timer, index.js). Carries out the retention
// periods promised on the privacy policy page (drs-bus-main/src/pages/
// DataPolicy.jsx) — change both together.
//
//   GPS history              deleted after 1 year
//   discount ID photos       deleted 1 year after the application was
//                            rejected, or after the discount expired
//   read notifications       deleted after 6 months
//   used / expired codes     password-reset and email-confirmation codes,
//                            deleted after 7 days
//   unconfirmed sign-ups     accounts whose email was never confirmed,
//                            deleted after 7 days (they can't have booked)
//
// Deletes in batches so a big backlog never locks a table for long.
// Bookings and payments are NOT touched: they're accounting records.
// ============================================================================

const RUN_EVERY_MS = 6 * 60 * 60 * 1000; // four times a day; each rule is idempotent
const BATCH = 5000;

async function deleteInBatches(sql, params = []) {
  let total = 0;
  for (;;) {
    const [result] = await pool.query(`${sql} LIMIT ${BATCH}`, params);
    total += result.affectedRows;
    if (result.affectedRows < BATCH) return total;
  }
}

export async function runRetentionSweep() {
  const out = {};
  out.gpsPoints = await deleteInBatches(`DELETE FROM location_tracking WHERE timestamp < NOW() - INTERVAL 1 YEAR`);
  // id_image is NOT NULL, so a deleted photo is stored as '' (the image
  // route answers 410 for it).
  const [ids] = await pool.query(
    `UPDATE discount_applications SET id_image = ''
     WHERE id_image <> '' AND (
       (status = 'Rejected' AND reviewed_at < NOW() - INTERVAL 1 YEAR) OR
       (status = 'Approved' AND expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL 1 YEAR)
     )`
  );
  out.idPhotos = ids.affectedRows;
  out.notifications = await deleteInBatches(`DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL 6 MONTH`);
  out.resetCodes = await deleteInBatches(`DELETE FROM password_resets WHERE created_at < NOW() - INTERVAL 7 DAY`);
  out.verificationCodes = await deleteInBatches(`DELETE FROM email_verifications WHERE created_at < NOW() - INTERVAL 7 DAY`);
  // email_verifications rows cascade with the account.
  out.unconfirmedAccounts = await deleteInBatches(
    `DELETE FROM commuters
     WHERE email_verified = FALSE AND closed_at IS NULL AND created_at < NOW() - INTERVAL 7 DAY
       AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.passenger_id = commuters.commuter_id)
       AND NOT EXISTS (SELECT 1 FROM discount_applications da WHERE da.commuter_id = commuters.commuter_id)
       AND NOT EXISTS (SELECT 1 FROM flag_requests fr WHERE fr.passenger_id = commuters.commuter_id)
       AND NOT EXISTS (SELECT 1 FROM payment_submissions ps WHERE ps.passenger_id = commuters.commuter_id)`
  );
  const removed = Object.entries(out).filter(([, n]) => n > 0);
  if (removed.length) console.log(`Retention sweep: ${removed.map(([k, n]) => `${n} ${k}`).join(", ")}`);
  return out;
}

let sweeping = false;
async function sweep() {
  if (sweeping) return; // never overlap runs
  sweeping = true;
  try {
    await runRetentionSweep();
  } catch (err) {
    console.error("Retention sweep failed (non-fatal):", err.message);
  } finally {
    sweeping = false;
  }
}

export function startRetentionSweeper() {
  // First run shortly after start-up, not during it.
  setTimeout(sweep, 60_000).unref?.();
  const timer = setInterval(sweep, RUN_EVERY_MS);
  timer.unref?.();
  return timer;
}
