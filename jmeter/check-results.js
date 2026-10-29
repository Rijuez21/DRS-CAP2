#!/usr/bin/env node
// Reads a JMeter results file (.jtl, CSV) and fails (exit code 1) when the run
// breaks the performance targets. Used by the GitHub Actions load-test job.
//
//   node check-results.js results/load.jtl --maxErrorPct 1 --maxP95 1000
//
const fs = require("fs");

const [, , file, ...rest] = process.argv;
if (!file) {
  console.error("Usage: node check-results.js <results.jtl> [--maxErrorPct 1] [--maxP95 1000]");
  process.exit(2);
}
const opt = { maxErrorPct: 1, maxP95: 1000 };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = Number(rest[i + 1]);

// Minimal CSV line parser (JMeter quotes fields that contain commas).
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const head = parseLine(lines[0]);
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) { console.error(`Column "${name}" not found. Save results as CSV with field names.`); process.exit(2); }
  return i;
};
const [cLabel, cElapsed, cSuccess, cTime] = ["label", "elapsed", "success", "timeStamp"].map(col);

const rows = lines.slice(1).map(parseLine);
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
function stats(list) {
  const ms = list.map((r) => Number(r[cElapsed]));
  const errors = list.filter((r) => r[cSuccess] !== "true").length;
  const times = list.map((r) => Number(r[cTime]));
  const seconds = Math.max(1, (Math.max(...times) - Math.min(...times)) / 1000);
  return {
    samples: list.length,
    avg: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    p90: pct(ms, 90),
    p95: pct(ms, 95),
    max: Math.max(...ms),
    errorPct: Math.round((errors / list.length) * 10000) / 100,
    perSec: Math.round((list.length / seconds) * 10) / 10,
  };
}

const byLabel = {};
for (const r of rows) (byLabel[r[cLabel]] ||= []).push(r);
const table = Object.entries(byLabel).map(([label, list]) => ({ label, ...stats(list) }));
table.push({ label: "TOTAL", ...stats(rows) });
console.table(table);

const total = table.at(-1);
const problems = [];
if (total.errorPct > opt.maxErrorPct) problems.push(`error rate ${total.errorPct}% is above ${opt.maxErrorPct}%`);
if (total.p95 > opt.maxP95) problems.push(`95th percentile ${total.p95} ms is above ${opt.maxP95} ms`);
if (problems.length) {
  console.error("FAILED: " + problems.join("; "));
  process.exit(1);
}
console.log(`PASSED: error rate ${total.errorPct}% (limit ${opt.maxErrorPct}%), p95 ${total.p95} ms (limit ${opt.maxP95} ms)`);
