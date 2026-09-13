import { pool } from "../db/pool.js";

// Security non-functional requirement: "administrators must have audit
// trails for all critical actions." Every admin write route calls this —
// failure to log is swallowed (console.error only) so an audit-log hiccup
// never blocks the actual write it's describing.
export async function logAudit({ staffId, action, entityType, entityId, details }) {
  if (!staffId) return; // no authenticated actor (shouldn't happen behind requireRole, but never block a write over this)
  try {
    await pool.query(
      `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
      [staffId, action, entityType, entityId ?? null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error("Audit log write failed (non-fatal):", err.message);
  }
}
