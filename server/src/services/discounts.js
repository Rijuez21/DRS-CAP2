import { detectImageType } from "./paymentRules.js";

// Student / PWD / senior citizen fare discount. A passenger submits an ID,
// terminal staff or an admin check it, and once approved the passenger's
// online seat is booked at 20% off. Students have to renew every year;
// PWD and senior citizen discounts don't expire.
export const DISCOUNT_RATE = 0.2;
export const DISCOUNT_CATEGORIES = ["student", "pwd", "senior"];
export const CATEGORY_LABELS = { student: "Student", pwd: "PWD", senior: "Senior Citizen" };
export const STUDENT_VALIDITY_DAYS = 365;
// A student may send next year's ID this many days before the current one lapses.
export const RENEWAL_WINDOW_DAYS = 30;

// The fare due on one booking row (aliases bk = bookings, rt = routes):
// base fare, less the discount that seat was booked with.
export const FARE_DUE_SQL = `ROUND(rt.base_fare * IF(bk.discount_category IS NULL, 1, ${1 - DISCOUNT_RATE}), 2)`;

// A commuters row's discount, if it's still valid right now.
export function activeDiscount(commuter, now = new Date()) {
  if (!commuter?.discount_category) return null;
  if (commuter.discount_expires_at && new Date(commuter.discount_expires_at) <= now) return null;
  return { category: commuter.discount_category, verified_at: commuter.discount_verified_at, expires_at: commuter.discount_expires_at };
}

export function expiryFor(category, approvedAt = new Date()) {
  if (category !== "student") return null;
  return new Date(approvedAt.getTime() + STUDENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

// Why this passenger can't send an ID right now, or null.
export function whyCannotApply(commuter, now = new Date()) {
  const active = activeDiscount(commuter, now);
  if (!active) return null;
  if (!active.expires_at) return `You already have a verified ${CATEGORY_LABELS[active.category]} discount.`;
  const renewFrom = new Date(active.expires_at).getTime() - RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() < renewFrom) {
    return `Your ${CATEGORY_LABELS[active.category]} discount is valid until ${new Date(active.expires_at).toLocaleDateString("en-PH", { dateStyle: "long" })}. You can renew it in the last ${RENEWAL_WINDOW_DAYS} days.`;
  }
  return null;
}

// The ID photo: PNG / JPEG / WebP data: URL, checked against its real bytes.
const ID_MAX_BYTES = 5 * 1024 * 1024;
const ID_MIN_BYTES = 1024;
const ID_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function parseIdImage(value) {
  if (value === undefined || value === null || value === "") return { error: "Attach a photo of your ID" };
  if (typeof value !== "string") return { error: "The ID must be an image" };
  if (value.length > Math.ceil((ID_MAX_BYTES * 4) / 3) + 64) return { error: "The ID photo is too large. The limit is 5 MB." };
  const match = ID_DATA_URL.exec(value.replace(/\s+/g, ""));
  if (!match) return { error: "The ID photo must be a PNG, JPEG or WebP image" };
  const [, declared, base64] = match;
  const buf = Buffer.from(base64, "base64");
  if (buf.length > ID_MAX_BYTES) return { error: "The ID photo is too large. The limit is 5 MB." };
  if (buf.length < ID_MIN_BYTES) return { error: "That image is too small to read the ID" };
  if (detectImageType(buf) !== declared) return { error: "That file isn't a valid PNG, JPEG or WebP image" };
  return { image: `data:${declared};base64,${buf.toString("base64")}`, mime: declared, buf };
}

export function parseIdNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { value: null };
  const v = String(value).trim();
  if (v.length > 50) return { error: "The ID number is too long" };
  return { value: v };
}
