// A bus's seat layout: the grid passengers see in SeatMap.jsx and the
// single source of which seat labels can be sold on that bus.
//
//   { version: 1, cols: 5, rows: [[{ t: "seat", l: "1" }, { t: "aisle" }, ...], ...] }
//
// Cell types: seat (needs a label `l`), aisle (walking space), blank (no
// seat, e.g. a wheel arch), driver, door. buses.seat_layout = NULL means the
// bus predates layouts: its seats are "1".."capacity" in the original
// 2 · aisle · 2 arrangement with a 5-seat back bench (legacyLayout below),
// exactly as SeatMap drew it before layouts existed.

export const CELL_TYPES = ["seat", "aisle", "blank", "driver", "door"];
export const MAX_ROWS = 30; // a 120-seat legacy bus (4 per row) needs 30
export const MAX_COLS = 7;
export const MAX_SEATS = 120; // same ceiling as the capacity field
export const MAX_LABEL_LENGTH = 10; // bookings.seat_number is VARCHAR(10)
const LABEL_PATTERN = /^[A-Za-z0-9-]+$/;

// Seat labels are compared the way MySQL compares bookings.seat_number
// (case-insensitive collation), so "1a" and "1A" are the same seat to the
// (trip_id, active_seat_number) lock and must be the same seat here too.
const labelKey = (label) => String(label).trim().toUpperCase();

// mysql2 returns JSON columns already parsed; other drivers return text.
export function readStoredLayout(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

// Returns { layout } (normalized: trimmed labels, only known keys) or
// { error } with a message fit to show the admin.
export function validateSeatLayout(input) {
  const raw = typeof input === "string" ? readStoredLayout(input) : input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Seat layout must be an object with rows" };
  if (raw.version !== undefined && raw.version !== 1) return { error: "Unsupported seat layout version" };
  const { rows } = raw;
  if (!Array.isArray(rows) || rows.length === 0) return { error: "Seat layout needs at least one row" };
  if (rows.length > MAX_ROWS) return { error: `Seat layout can have at most ${MAX_ROWS} rows` };
  if (!Array.isArray(rows[0]) || rows[0].length === 0) return { error: "Seat layout rows can't be empty" };
  const cols = rows[0].length;
  if (cols > MAX_COLS) return { error: `Seat layout can have at most ${MAX_COLS} columns` };
  if (raw.cols !== undefined && raw.cols !== cols) return { error: "Seat layout cols doesn't match the row length" };

  const seen = new Set();
  const outRows = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length !== cols) return { error: `Every row must have ${cols} cells (row ${r + 1} doesn't)` };
    const outRow = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = row[c];
      const where = `row ${r + 1}, column ${c + 1}`;
      if (!cell || typeof cell !== "object" || !CELL_TYPES.includes(cell.t)) {
        return { error: `Unknown cell type at ${where} (use ${CELL_TYPES.join(", ")})` };
      }
      if (cell.t !== "seat") {
        outRow.push({ t: cell.t });
        continue;
      }
      const label = typeof cell.l === "string" || typeof cell.l === "number" ? String(cell.l).trim() : "";
      if (!label) return { error: `The seat at ${where} needs a label` };
      if (label.length > MAX_LABEL_LENGTH) return { error: `Seat label "${label.slice(0, 20)}" is longer than ${MAX_LABEL_LENGTH} characters` };
      if (!LABEL_PATTERN.test(label)) return { error: `Seat label "${label}" may only contain letters, numbers and dashes` };
      const key = labelKey(label);
      if (seen.has(key)) return { error: `Seat label "${label}" is used more than once` };
      seen.add(key);
      outRow.push({ t: "seat", l: label });
    }
    outRows.push(outRow);
  }
  if (seen.size === 0) return { error: "Seat layout needs at least one seat" };
  if (seen.size > MAX_SEATS) return { error: `Seat layout can have at most ${MAX_SEATS} seats` };
  return { layout: { version: 1, cols, rows: outRows } };
}

// Seat labels in reading order (left-to-right, top-to-bottom).
export function getSeatLabels(layout) {
  const labels = [];
  for (const row of layout?.rows ?? []) for (const cell of row) if (cell.t === "seat") labels.push(cell.l);
  return labels;
}

// The pre-layout arrangement, cell for cell: rows of 2 · aisle · 2, a short
// row (seats next to the aisle) for any remainder, then the 5-seat back
// bench whose middle seat sits in the aisle. Seats numbered 1..capacity.
export function legacyLayout(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const BACK = 5;
  const PER_ROW = 4;
  const hasBack = capacity >= BACK;
  const regular = hasBack ? capacity - BACK : capacity;
  const counts = Array.from({ length: Math.floor(regular / PER_ROW) }, () => PER_ROW);
  if (regular % PER_ROW) counts.push(regular % PER_ROW);
  if (hasBack) counts.push(BACK);

  let n = 0;
  const seat = () => ({ t: "seat", l: String(++n) });
  const rows = counts.map((count) => {
    if (count === BACK) return Array.from({ length: 5 }, seat);
    const leftCount = Math.ceil(count / 2);
    const rightCount = count - leftCount;
    const left = [...Array.from({ length: 2 - leftCount }, () => ({ t: "blank" })), ...Array.from({ length: leftCount }, seat)];
    const right = [...Array.from({ length: rightCount }, seat), ...Array.from({ length: 2 - rightCount }, () => ({ t: "blank" }))];
    return [...left, { t: "aisle" }, ...right];
  });
  return { version: 1, cols: 5, rows };
}

// The labels a bus can sell: from its layout, or "1".."capacity" for a
// legacy bus. Accepts a row with capacity + seat_layout (any query that
// selected both).
export function busSeatLabels(bus) {
  const stored = readStoredLayout(bus?.seat_layout);
  if (stored) return getSeatLabels(stored);
  const capacity = bus?.capacity;
  return Number.isInteger(capacity) && capacity > 0 ? Array.from({ length: capacity }, (_, i) => String(i + 1)) : [];
}

// What SeatMap should draw for this bus, and whether it's the admin's own
// design or the generated legacy one.
export function busLayout(bus) {
  const stored = readStoredLayout(bus?.seat_layout);
  if (stored) return { layout: stored, layoutSource: "custom" };
  const generated = legacyLayout(bus?.capacity);
  return { layout: generated, layoutSource: generated ? "legacy" : "none" };
}

// Matches a requested seat to the bus's canonical label (case-insensitive;
// "07" still means seat "7"), or null if the bus has no such seat.
export function matchSeatLabel(value, labels) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const byKey = new Map(labels.map((l) => [labelKey(l), l]));
  return byKey.get(labelKey(text)) ?? (/^\d+$/.test(text) ? byKey.get(String(Number(text))) ?? null : null);
}

// "2" < "10", "1A" < "1B" < "2A" < "10A" — for manifests and seat lists.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const naturalCompare = (a, b) => collator.compare(String(a ?? ""), String(b ?? ""));
