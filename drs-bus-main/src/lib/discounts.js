import { readImageFile } from "./image";

// Student / PWD / senior citizen fare discount — mirrors the server's
// services/discounts.js. The server works out every amount actually charged;
// these are only for showing the passenger what to expect.
export const DISCOUNT_RATE = 0.2;
export const DISCOUNT_PERCENT = DISCOUNT_RATE * 100;
export const CATEGORY_LABELS = { student: "Student", pwd: "PWD", senior: "Senior Citizen" };
export const PASSENGER_TYPES = [
  { value: "regular", label: "Regular" },
  { value: "student", label: "Student" },
  { value: "pwd", label: "PWD" },
  { value: "senior", label: "Senior Citizen" },
];
// What each type should upload.
export const ID_HINTS = {
  student: "Your current school ID, or your enrolment form with a photo ID.",
  pwd: "Your PWD ID issued by your city or municipality.",
  senior: "Your OSCA / senior citizen ID, or any government ID showing your birth date.",
};

// Same rounding as the server (ROUND(base_fare * 0.8, 2)).
export function discountedFare(fare) {
  return fare == null ? null : Math.round(Number(fare) * (1 - DISCOUNT_RATE) * 100) / 100;
}

// Total for `count` seats when one of them is discounted.
export function totalWithDiscount(fare, count, discounted) {
  if (fare == null) return null;
  const full = Number(fare) * count;
  return discounted && count > 0 ? Math.round((full - Number(fare) + discountedFare(fare)) * 100) / 100 : full;
}

// Checks the chosen file and turns it into the data: URL the API expects.
// Shrinks big phone photos so the upload stays small; still easily legible.
export async function readIdImage(file) {
  if (!file) throw new Error("Attach a photo of your ID.");
  return readImageFile(file, { shrink: true, receipt: true }).catch((err) => {
    throw new Error(err.message.replace("of the receipt", "of your ID"));
  });
}
