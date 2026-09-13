import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf8").replace(
    /\r\n/g,
    "\n"
  );

  // Strip full-line and trailing "-- comment" text before splitting into
  // statements. This is defensive against special characters (em dashes,
  // curly quotes, etc.) in the schema's explanatory comments causing a
  // parse error depending on the connection's charset — the server only
  // ever sees plain DDL, never the prose.
  const withoutComments = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  // mysql2 needs multipleStatements enabled for a script like this, so run
  // each statement separately instead.
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }

  console.log(`Schema applied: ${statements.length} statements executed.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to initialize schema:", err.message || "(no message)");
  if (err.code) console.error("  code:", err.code);
  if (err.errno) console.error("  errno:", err.errno);
  if (Array.isArray(err.errors)) {
    // AggregateError — mysql2 throws this when a hostname resolves to
    // multiple addresses (e.g. IPv4 + IPv6) and every connection attempt
    // fails. err.message is blank by default on AggregateError; the real
    // reasons are in here.
    console.error("  underlying errors:");
    err.errors.forEach((e, i) => console.error(`    [${i}]`, e.message, e.code ? `(${e.code})` : ""));
  }
  if (!err.message && !err.code && !Array.isArray(err.errors)) {
    console.error("  full error object:", err);
  }
  process.exit(1);
});