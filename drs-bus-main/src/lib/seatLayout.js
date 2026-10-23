// Seat layout helpers for the Fleet seat layout editor. The shape and the
// rules mirror server/src/services/seatLayout.js (the server re-checks
// everything; this is so the admin sees problems before saving):
//
//   { version: 1, cols, rows: [[{ t: "seat", l: "1" }, { t: "aisle" }, ...], ...] }
//   t: seat | aisle | blank | driver | door; seats need a unique label l.

export const MAX_ROWS = 30;
export const MAX_COLS = 7;
export const MAX_SEATS = 120;
export const MAX_LABEL_LENGTH = 10;
const LABEL_PATTERN = /^[A-Za-z0-9-]+$/;

const seat = (l) => ({ t: "seat", l: String(l) });
const cell = (t) => ({ t });
const key = (label) => String(label).trim().toUpperCase();

export const seatLabels = (layout) => layout.rows.flat().filter((c) => c.t === "seat").map((c) => c.l);
export const seatCount = (layout) => layout.rows.reduce((n, row) => n + row.filter((c) => c.t === "seat").length, 0);
export const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The arrangement every bus had before layouts (and still has with none
// saved): 2 · aisle · 2, a short row by the aisle, then the 5-seat back
// bench. Same as the server's legacyLayout and SeatMap's auto layout.
export function legacyLayout(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const hasBack = capacity >= 5;
  const regular = hasBack ? capacity - 5 : capacity;
  const counts = Array.from({ length: Math.floor(regular / 4) }, () => 4);
  if (regular % 4) counts.push(regular % 4);
  if (hasBack) counts.push(5);
  let n = 0;
  const next = () => seat(++n);
  const rows = counts.map((count) => {
    if (count === 5) return Array.from({ length: 5 }, next);
    const left = Math.ceil(count / 2);
    const right = count - left;
    return [
      ...Array.from({ length: 2 - left }, () => cell("blank")),
      ...Array.from({ length: left }, next),
      cell("aisle"),
      ...Array.from({ length: right }, next),
      ...Array.from({ length: 2 - right }, () => cell("blank")),
    ];
  });
  return { version: 1, cols: 5, rows };
}

// Quick-start presets. Seat rows follow a front row with the driver (left)
// and the door (right); seats are numbered 1..N afterwards.
function preset(pattern, seatRows, { backBench = false } = {}) {
  const cols = pattern.length;
  const front = Array.from({ length: cols }, (_, c) => cell(c === 0 ? "driver" : c === cols - 1 ? "door" : pattern[c] === "a" ? "aisle" : "blank"));
  const rows = [front];
  for (let r = 0; r < seatRows; r += 1) rows.push(pattern.map((p) => (p === "s" ? seat("") : cell("aisle"))));
  if (backBench) rows.push(pattern.map(() => seat("")));
  return numberSeats({ version: 1, cols, rows }, "sequential");
}

export const PRESETS = [
  { id: "2x2", label: "2 x 2 (standard)", make: () => preset(["s", "s", "a", "s", "s"], 10) },
  { id: "2x1", label: "2 x 1", make: () => preset(["s", "s", "a", "s"], 10) },
  { id: "3x2", label: "3 x 2", make: () => preset(["s", "s", "s", "a", "s", "s"], 10) },
  { id: "2x2bench", label: "2 x 2 + back bench", make: () => preset(["s", "s", "a", "s", "s"], 10, { backBench: true }) },
  {
    id: "blank",
    label: "Blank grid",
    make: () => ({ version: 1, cols: 5, rows: Array.from({ length: 10 }, () => Array.from({ length: 5 }, () => cell("blank"))) }),
  },
];

// "sequential": 1..N left-to-right, top-to-bottom.
// "byRow": 1A, 1B, 1C... — the row number counts only rows that have seats.
export function numberSeats(layout, mode) {
  let n = 0;
  let seatRow = 0;
  const rows = layout.rows.map((row) => {
    if (!row.some((c) => c.t === "seat")) return row;
    seatRow += 1;
    let letter = 0;
    return row.map((c) => {
      if (c.t !== "seat") return c;
      return seat(mode === "byRow" ? `${seatRow}${String.fromCharCode(65 + letter++)}` : ++n);
    });
  });
  return { ...layout, rows };
}

// A label for a newly painted seat: one above the highest number in use.
export function nextSeatLabel(layout) {
  const used = new Set(seatLabels(layout).map(key));
  let n = Math.max(0, ...seatLabels(layout).map((l) => (/^\d+$/.test(l) ? Number(l) : 0))) + 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

export function setCell(layout, r, c, type) {
  const current = layout.rows[r][c];
  if (current.t === type) return layout;
  const next = type === "seat" ? seat(nextSeatLabel(layout)) : cell(type);
  return { ...layout, rows: layout.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? next : x)) : row)) };
}

export function renameSeat(layout, r, c, label) {
  return { ...layout, rows: layout.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? seat(label) : x)) : row)) };
}

// More rows copy the last row's shape (new seats get new numbers); fewer
// rows drop from the back. More columns are blank on the right.
export function resize(layout, rowCount, colCount) {
  let next = layout;
  if (colCount !== next.cols) {
    next = {
      ...next,
      cols: colCount,
      rows: next.rows.map((row) => (colCount < row.length ? row.slice(0, colCount) : [...row, ...Array.from({ length: colCount - row.length }, () => cell("blank"))])),
    };
  }
  if (rowCount < next.rows.length) next = { ...next, rows: next.rows.slice(0, rowCount) };
  while (rowCount > next.rows.length) {
    const template = next.rows[next.rows.length - 1] ?? Array.from({ length: next.cols }, () => cell("blank"));
    const used = new Set(seatLabels(next).map(key));
    let n = Number(nextSeatLabel(next));
    const row = template.map((x) => {
      if (x.t !== "seat") return cell(x.t === "driver" || x.t === "door" ? "blank" : x.t);
      while (used.has(String(n))) n += 1;
      return seat(n++);
    });
    next = { ...next, rows: [...next.rows, row] };
  }
  return next;
}

// The aisle column: the column with the most aisle cells (or -1).
export function aisleColumn(layout) {
  let best = -1;
  let bestCount = 0;
  for (let c = 0; c < layout.cols; c += 1) {
    const count = layout.rows.filter((row) => row[c]?.t === "aisle").length;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

// Moving the aisle moves that whole column (seats keep their labels). With
// no aisle yet, the chosen column becomes one; -1 removes it (blank).
export function moveAisle(layout, to) {
  const from = aisleColumn(layout);
  if (to === from) return layout;
  if (to === -1) return { ...layout, rows: layout.rows.map((row) => row.map((x, c) => (c === from && x.t === "aisle" ? cell("blank") : x))) };
  if (from === -1) return { ...layout, rows: layout.rows.map((row) => row.map((x, c) => (c === to && x.t !== "driver" && x.t !== "door" ? cell("aisle") : x))) };
  return {
    ...layout,
    rows: layout.rows.map((row) => {
      const copy = [...row];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    }),
  };
}

// Everything the server would refuse, so Save can say so up front.
// bad: Set of "r-c" for seats to highlight.
export function layoutProblems(layout) {
  const errors = [];
  const bad = new Set();
  const seen = new Map();
  layout.rows.forEach((row, r) =>
    row.forEach((x, c) => {
      if (x.t !== "seat") return;
      const label = String(x.l ?? "").trim();
      if (!label || label.length > MAX_LABEL_LENGTH || !LABEL_PATTERN.test(label)) {
        bad.add(`${r}-${c}`);
        return;
      }
      const k = key(label);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(`${r}-${c}`);
    })
  );
  const emptyOrBad = bad.size;
  if (emptyOrBad) errors.push(`${emptyOrBad} seat${emptyOrBad === 1 ? " has" : "s have"} an empty or invalid label (1–${MAX_LABEL_LENGTH} letters, numbers or dashes).`);
  const dupes = [...seen.entries()].filter(([, cells]) => cells.length > 1);
  if (dupes.length) {
    dupes.forEach(([, cells]) => cells.forEach((id) => bad.add(id)));
    errors.push(`Seat label${dupes.length === 1 ? "" : "s"} used more than once: ${dupes.map(([k]) => k).join(", ")}.`);
  }
  const count = seatCount(layout);
  if (count === 0) errors.push("Add at least one seat.");
  if (count > MAX_SEATS) errors.push(`A bus can have at most ${MAX_SEATS} seats (this layout has ${count}).`);
  return { errors, bad };
}
