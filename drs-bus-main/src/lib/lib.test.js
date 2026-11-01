// Pure helpers that must agree with the server's rules.
import { describe, test, expect } from "vitest";
import { bookingReference, receiptNumber } from "./format";
import { normalizePhMobile, formatPhMobile } from "./phone";
import { discountedFare, totalWithDiscount } from "./discounts";
import { describeActivity } from "./activity";

test("booking references are DRS-<year>-<5 digits>", () => {
  expect(bookingReference(318, "2026-10-31T10:00:00+08:00")).toBe("DRS-2026-00318");
});

test("receipt numbers are OR- plus six digits", () => {
  expect(receiptNumber(12)).toBe("OR-000012");
});

describe("normalizePhMobile (same rule as the server)", () => {
  test("the three Philippine formats become +639…", () => {
    for (const input of ["09171234567", "0917 123 4567", "0917-123-4567", "+639171234567", "639171234567"]) {
      expect(normalizePhMobile(input)).toBe("+639171234567");
    }
  });
  test("landlines and wrong lengths are refused", () => {
    for (const input of ["", "0817 123 4567", "0917123456", "(074) 123-4567"]) {
      expect(normalizePhMobile(input)).toBeNull();
    }
  });
  test("formatPhMobile spaces a stored number for reading", () => {
    expect(formatPhMobile("+639171234567")).toBe("+63 917 123 4567");
  });
});

describe("fare discount (same rounding as the server)", () => {
  test("20% off, rounded to the centavo", () => {
    expect(discountedFare(350)).toBe(280);
    expect(discountedFare("123.45")).toBe(98.76);
  });
  test("only one seat in a booking gets the discount", () => {
    expect(totalWithDiscount(350, 3, true)).toBe(980);
    expect(totalWithDiscount(350, 3, false)).toBe(1050);
  });
});

describe("describeActivity (activity log wording)", () => {
  test("known actions read as sentences", () => {
    expect(describeActivity({ action: "verify", entity_type: "payment", entity_id: 9 })).toBe("verified payment #9");
    expect(describeActivity({ action: "suspend", entity_type: "passenger", entity_id: 4 })).toBe("suspended passenger #4");
  });
  test("unknown actions still read sensibly", () => {
    expect(describeActivity({ action: "bulk_import", entity_type: "bus_stop" })).toBe("bulk import bus stop");
  });
});
