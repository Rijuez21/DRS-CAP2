import { pool } from "./pool.js";

// For a DB that already has data you don't want to lose (reset-db.js +
// db:init wipes everything). This only ever ADDs — new columns, new
// tables — matching this phase's "extend, don't restructure" constraint.
// Each statement is wrapped individually so re-running this after it's
// already been applied is a harmless no-op (ER_DUP_FIELDNAME /
// ER_TABLE_EXISTS_ERROR are swallowed; anything else is surfaced).
const STATEMENTS = [
  `ALTER TABLE routes ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE drivers ADD COLUMN duty_status ENUM('Active', 'On Leave', 'Suspended') NOT NULL DEFAULT 'Active'`,
  `ALTER TABLE trips ADD COLUMN completed_at TIMESTAMP NULL DEFAULT NULL`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES staff_accounts(staff_id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    recipient_type ENUM('passenger', 'driver') NOT NULL,
    recipient_id INT NOT NULL,
    message VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'schedule_change',
    read_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

const IGNORABLE = new Set(["ER_DUP_FIELDNAME", "ER_TABLE_EXISTS_ERROR"]);

async function main() {
  for (const statement of STATEMENTS) {
    try {
      await pool.query(statement);
      console.log("Applied:", statement.split("\n")[0].slice(0, 70), "...");
    } catch (err) {
      if (IGNORABLE.has(err.code)) {
        console.log("Already applied, skipping:", statement.split("\n")[0].slice(0, 70), "...");
      } else {
        throw err;
      }
    }
  }
  console.log("Migration complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
