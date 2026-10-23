// Seat layout rules (services/seatLayout.js) and seat-request validation
// against custom labels (services/bookingRules.js). Pure functions — no
// database or server needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateSeatLayout,
  getSeatLabels,
  legacyLayout,
  busSeatLabels,
  busLayout,
  matchSeatLabel,
  naturalCompare,
  MAX_SEATS,
} from "../src/services/seatLayout.js";
import { parseSeatRequest, normalizeSeat, firstFreeSeat } from "../src/services/bookingRules.js";

const S = (l) => ({ t: "seat", l });
const A = { t: "aisle" };
const B = { t: "blank" };
const small = () => ({ version: 1, cols: 5, rows: [[{ t: "driver" }, B, A, B, { t: "door" }], [S("1A"), S("1B"), A, S("1C"), S("1D")], [S("2A"), S("2B"), A, S("2C"), S("2D")]] });

describe("validateSeatLayout", () => {
  test("accepts a well-formed layout and normalizes it", () => {
    const input = small();
    input.rows[1][0] = { t: "seat", l: "  1A ", extra: "dropped" };
    const { layout, error } = validateSeatLayout(input);
    assert.equal(error, undefined);
    assert.equal(layout.cols, 5);
    assert.deepEqual(layout.rows[1][0], { t: "seat", l: "1A" });
    assert.deepEqual(getSeatLabels(layout), ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D"]);
  });

  test("accepts the layout as a JSON string too", () => {
    assert.ok(validateSeatLayout(JSON.stringify(small())).layout);
  });

  const bad = {
    "not an object": () => [1, 2],
    "no rows": () => ({ rows: [] }),
    "rows of different lengths": () => ({ rows: [[S("1"), S("2")], [S("3")]] }),
    "cols disagrees with rows": () => ({ cols: 4, rows: [[S("1"), S("2")]] }),
    "unknown cell type": () => ({ rows: [[S("1"), { t: "toilet" }]] }),
    "seat without label": () => ({ rows: [[S("1"), { t: "seat" }]] }),
    "blank label": () => ({ rows: [[S("1"), S("   ")]] }),
    "label over 10 chars": () => ({ rows: [[S("1"), S("ABCDEFGHIJK")]] }),
    "label with odd characters": () => ({ rows: [[S("1"), S("2;DROP")]] }),
    "duplicate labels": () => ({ rows: [[S("1"), S("1")]] }),
    "duplicate labels differing only in case": () => ({ rows: [[S("1a"), S("1A")]] }),
    "no seats at all": () => ({ rows: [[A, B]] }),
    "too many rows": () => ({ rows: Array.from({ length: 31 }, (_, i) => [S(String(i + 1))]) }),
    "too many columns": () => ({ rows: [Array.from({ length: 8 }, (_, i) => S(String(i + 1)))] }),
    "unsupported version": () => ({ version: 2, rows: [[S("1")]] }),
  };
  for (const [name, make] of Object.entries(bad)) {
    test(`rejects: ${name}`, () => {
      const r = validateSeatLayout(make());
      assert.ok(r.error, `expected an error for ${name}`);
      assert.equal(r.layout, undefined);
    });
  }

  test(`rejects more than ${MAX_SEATS} seats`, () => {
    let n = 0;
    const rows = Array.from({ length: 20 }, () => Array.from({ length: 7 }, () => S(String(++n))));
    assert.match(validateSeatLayout({ rows }).error, /at most 120 seats/);
    for (const r of [19, 18]) rows[r] = Array.from({ length: 7 }, () => B); // 140 -> 126 seats, still too many
    assert.match(validateSeatLayout({ rows }).error, /at most 120 seats/);
    rows[17] = Array.from({ length: 7 }, () => B); // -> 119
    assert.ok(validateSeatLayout({ rows }).layout);
  });
});

describe("legacy fallback (bus without a seat layout)", () => {
  // The row sizes SeatMap.jsx computes for a bus without a layout.
  function oldRowCounts(total) {
    const hasBack = total >= 5;
    const regular = hasBack ? total - 5 : total;
    const rows = Array.from({ length: Math.floor(regular / 4) }, () => 4);
    if (regular % 4) rows.push(regular % 4);
    if (hasBack) rows.push(5);
    return rows;
  }

  test("is seats 1..capacity in the old row arrangement, for every capacity", () => {
    for (let c = 1; c <= 120; c += 1) {
      const layout = legacyLayout(c);
      assert.ok(validateSeatLayout(layout).layout, `capacity ${c} must be a valid layout`);
      assert.deepEqual(getSeatLabels(layout), Array.from({ length: c }, (_, i) => String(i + 1)), `capacity ${c}`);
      assert.deepEqual(layout.rows.map((r) => r.filter((x) => x.t === "seat").length), oldRowCounts(c), `capacity ${c} rows`);
    }
  });

  test("40 seats: 2 · aisle · 2 rows and a 5-seat back bench", () => {
    const layout = legacyLayout(40);
    assert.equal(layout.cols, 5);
    assert.deepEqual(layout.rows[0].map((x) => x.t), ["seat", "seat", "aisle", "seat", "seat"]);
    assert.deepEqual(layout.rows.at(-1).map((x) => x.l), ["36", "37", "38", "39", "40"]);
  });

  test("no capacity on file means no seats", () => {
    assert.equal(legacyLayout(null), null);
    assert.deepEqual(busSeatLabels({ capacity: null, seat_layout: null }), []);
    assert.deepEqual(busLayout({ capacity: null, seat_layout: null }), { layout: null, layoutSource: "none" });
  });

  test("a stored layout wins over capacity; NULL falls back to it", () => {
    assert.deepEqual(busSeatLabels({ capacity: 3, seat_layout: null }), ["1", "2", "3"]);
    assert.equal(busLayout({ capacity: 3, seat_layout: null }).layoutSource, "legacy");
    const stored = { capacity: 8, seat_layout: JSON.stringify(small()) };
    assert.equal(busSeatLabels(stored)[0], "1A");
    assert.equal(busLayout(stored).layoutSource, "custom");
  });
});

describe("seat requests", () => {
  test("legacy bus: same normalization and messages as before", () => {
    assert.deepEqual(parseSeatRequest({ seatNumbers: [" 07 ", "8"] }, 40, 6), { seats: ["7", "8"] });
    assert.deepEqual(parseSeatRequest({ seatNumber: "3" }, { capacity: 40, seat_layout: null }, 6), { seats: ["3"] });
    assert.equal(parseSeatRequest({ seatNumbers: ["41"] }, 40, 6).error, "Seat 41 doesn't exist on this bus (seats 1–40)");
    assert.equal(parseSeatRequest({ seatNumbers: ["0"] }, 40, 6).error, "Seat 0 doesn't exist on this bus (seats 1–40)");
    assert.equal(parseSeatRequest({ seatNumbers: ["banana"] }, 40, 6).error, "Seat banana doesn't exist on this bus (seats 1–40)");
    assert.equal(parseSeatRequest({ seatNumbers: ["5", "05"] }, 40, 6).error, "Seat 5 was selected twice");
    assert.equal(parseSeatRequest({ seatNumbers: [] }, 40, 6).error, "Choose at least one seat");
    assert.equal(parseSeatRequest({ seatNumbers: ["1", "2", "3"] }, 40, 2).error, "You can book up to 2 seats at a time");
    assert.equal(normalizeSeat(" 12 ", 40), "12");
  });

  const bus = { capacity: 8, seat_layout: small() };

  test("custom labels: matched case-insensitively to the bus's own label", () => {
    assert.deepEqual(parseSeatRequest({ seatNumbers: ["1a", " 2D "] }, bus, 6), { seats: ["1A", "2D"] });
    assert.equal(matchSeatLabel("2b", getSeatLabels(small())), "2B");
  });

  test("custom labels: numbers that aren't labels are refused (no 1..capacity range)", () => {
    assert.equal(parseSeatRequest({ seatNumbers: ["3"] }, bus, 6).error, "Seat 3 doesn't exist on this bus");
    assert.equal(parseSeatRequest({ seatNumbers: ["3A"] }, bus, 6).error, "Seat 3A doesn't exist on this bus");
    assert.equal(parseSeatRequest({ seatNumbers: ["1A", "1a"] }, bus, 6).error, "Seat 1A was selected twice");
    assert.equal(parseSeatRequest({ seatNumbers: ["1A", "1B", "1C"] }, bus, 2).error, "You can book up to 2 seats at a time");
  });

  test("first free seat (flag a bus) follows seat-map order", () => {
    assert.equal(firstFreeSeat(bus, new Set(["1A", "1b"])), "1C");
    assert.equal(firstFreeSeat(40, new Set(["1", "2"])), "3");
    assert.equal(firstFreeSeat({ capacity: 2, seat_layout: null }, new Set(["1", "2"])), null);
  });
});

test("natural sort for manifests", () => {
  const sorted = ["10", "2", "1B", "A1", "1", "10A", "1A", "2A"].sort(naturalCompare);
  assert.deepEqual(sorted, ["1", "1A", "1B", "2", "2A", "10", "10A", "A1"]);
});
