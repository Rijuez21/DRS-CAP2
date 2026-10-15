import { createHash } from "node:crypto";

// ============================================================================
// Manual payment verification rules — the single source of truth for
// "which payment status may move to which, and who may do it", plus the
// helpers every payment write shares (money in centavos, reference-number
// normalization, receipt image validation).
//
// Status values keep the existing payments.status naming (Title Case,
// matching bookings.status and trips.status). Mapping to the spec's names:
//
//   AWAITING_PAYMENT   -> no payments row yet for a Reserved online booking
//   UNDER_REVIEW       -> 'Pending'   (kept: existing rows already use it)
//   NEEDS_RESUBMISSION -> 'Needs Resubmission'
//   VERIFIED           -> 'Verified'
//   REJECTED           -> 'Rejected'
//   ESCALATED          -> 'Escalated'
//   REFUND_PENDING     -> 'Refund Pending'
//   REFUNDED           -> 'Refunded'
//
// Payment status is deliberately separate from booking status: a Verified
// payment whose booking is later cancelled stays Verified (or moves to
// Refund Pending) — it never silently becomes "unpaid".
// ============================================================================

export const PAYMENT_STATUSES = [
  "Pending",
  "Verified",
  "Rejected",
  "Needs Resubmission",
  "Escalated",
  "Refund Pending",
  "Refunded",
];

// A payment staff still have to decide on. At most one per booking (DB
// unique key payments.open_booking_id), and while one exists the booking's
// seat is never released by the payment-deadline sweeper.
export const OPEN_STATUSES = ["Pending", "Escalated"];

// Money has been confirmed received for these.
export const FUNDS_RECEIVED_STATUSES = ["Verified", "Refund Pending", "Refunded"];

// The passenger may send a new proof for the booking when its latest
// payment is one of these (or there is no payment yet).
export const RESUBMITTABLE_STATUSES = ["Rejected", "Needs Resubmission"];

// Hard cap on proof attempts per booking, so a rejected passenger can't
// flood the review queue. Staff can still collect cash at the counter.
export const MAX_ATTEMPTS_PER_BOOKING = 5;

export const PAYMENT_METHOD_TYPES = ["gcash", "bank_transfer", "qr_ph"];
export const METHOD_LABELS = { gcash: "GCash", bank_transfer: "Bank transfer", qr_ph: "QR Ph" };

// Staff-side transitions. Passengers have NO transitions at all: the only
// thing a passenger can do is create a new 'Pending' row via submission.
//   staff  = terminal staff (role "staff") and admins
//   admin  = admins only
//   system = server-side automation (trip cancelled, duplicate settlement)
const TRANSITIONS = {
  verify: { from: ["Pending", "Escalated"], to: "Verified", roles: { Pending: ["staff", "admin"], Escalated: ["admin"] } },
  reject: { from: ["Pending", "Escalated"], to: "Rejected", roles: { Pending: ["staff", "admin"], Escalated: ["admin"] } },
  request_resubmission: {
    from: ["Pending", "Escalated"],
    to: "Needs Resubmission",
    roles: { Pending: ["staff", "admin"], Escalated: ["admin"] },
  },
  escalate: { from: ["Pending"], to: "Escalated", roles: { Pending: ["staff", "admin"] } },
  refund_request: { from: ["Verified"], to: "Refund Pending", roles: { Verified: ["staff", "admin", "system"] } },
  refund_confirm: { from: ["Refund Pending"], to: "Refunded", roles: { "Refund Pending": ["admin"] } },
  refund_cancel: { from: ["Refund Pending"], to: "Verified", roles: { "Refund Pending": ["admin"] } },
};

export const PAYMENT_ACTIONS = Object.keys(TRANSITIONS);

/**
 * Server-side state-transition validator. Returns an error string (shown to
 * staff as-is) or null when the move is allowed.
 * role: "staff" | "admin" | "passenger" | "driver" | "system"
 */
export function whyPaymentTransitionNotAllowed({ role, action, from }) {
  const rule = TRANSITIONS[action];
  if (!rule) return "Unknown payment action";
  if (role === "passenger" || role === "driver") return "You don't have permission to change payment status";
  if (!rule.from.includes(from)) {
    return `A payment that is ${statusLabel(from)} can't be ${ACTION_PAST[action] ?? action}`;
  }
  const allowedRoles = rule.roles[from] ?? [];
  if (!allowedRoles.includes(role)) {
    if (from === "Escalated") return "Escalated payments can only be resolved by an administrator";
    if (action === "refund_confirm" || action === "refund_cancel") return "Only an administrator can confirm or cancel a refund";
    return "You don't have permission to do that";
  }
  return null;
}

export function transitionTarget(action) {
  return TRANSITIONS[action]?.to ?? null;
}

const ACTION_PAST = {
  verify: "verified",
  reject: "rejected",
  request_resubmission: "sent back for resubmission",
  escalate: "escalated",
  refund_request: "marked for refund",
  refund_confirm: "marked as refunded",
  refund_cancel: "returned to verified",
};

// Passenger-facing label; staff see the same words.
export function statusLabel(status) {
  if (status === "Pending") return "under review";
  return String(status ?? "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Money. DECIMAL columns come back from mysql2 as strings ("550.00"); all
// arithmetic happens in integer centavos so nothing is ever a binary float.
// ---------------------------------------------------------------------------
const MONEY_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;
export const MAX_AMOUNT_CENTAVOS = 100000000; // ₱1,000,000.00 sanity cap

// Parses a user-typed or DB amount. Returns integer centavos, or null when
// it isn't a valid non-negative amount with at most 2 decimals.
export function toCentavos(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : String(value).trim().replace(/,/g, "");
  if (!MONEY_PATTERN.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos <= MAX_AMOUNT_CENTAVOS ? centavos : null;
}

// Integer centavos -> "550.00" (the string form MySQL DECIMAL expects).
export function centavosToDecimal(centavos) {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// For JSON responses: a JS number with at most 2 decimals, derived from the
// exact centavo value (display only — never fed back into arithmetic).
export function centavosToNumber(centavos) {
  return centavos == null ? null : Number(centavosToDecimal(centavos));
}

export function formatPesoCentavos(centavos) {
  return `₱${centavosToNumber(centavos).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Reference numbers. Passengers type these from a phone screen, so spacing,
// dashes and case are noise. The normalized form is what duplicate
// detection and the one-claim-per-transaction unique key compare.
//   gcash:         GCash reference numbers are digits (13 on current
//                  receipts) — accept 8–20 digits so older/InstaPay formats
//                  still pass, but never letters.
//   bank_transfer: bank/InstaPay/PESONet trace numbers, alphanumeric 4–40.
//   qr_ph:         Maya / other QR Ph wallets, alphanumeric 4–40.
// ---------------------------------------------------------------------------
export function normalizeReference(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Returns { display, normalized } or { error }.
export function parseReference(method, raw) {
  const display = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!display) return { error: "Enter the reference number from your payment app or bank receipt" };
  if (display.length > 100) return { error: "The reference number is too long (max 100 characters)" };
  if (!/^[A-Za-z0-9 \-/#.]+$/.test(display)) {
    return { error: "The reference number should only contain letters, numbers, spaces or dashes" };
  }
  const normalized = normalizeReference(display);
  if (method === "gcash") {
    if (!/^\d{8,20}$/.test(normalized)) return { error: "A GCash reference number is 8–20 digits (usually 13). Copy it from the GCash receipt." };
  } else if (normalized.length < 4 || normalized.length > 40) {
    return { error: "The reference number should be 4–40 letters or numbers" };
  }
  return { display, normalized };
}

// ---------------------------------------------------------------------------
// Receipt images. They arrive as base64 data: URLs in the JSON body. The
// declared type is never trusted: the decoded bytes must start with the
// real PNG / JPEG / WebP signature AND match the declared type. GIF/SVG and
// everything else are refused (SVG can carry script; GIF isn't a receipt).
// ---------------------------------------------------------------------------
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MIN_BYTES = 1024; // a real screenshot is never this small
const RECEIPT_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// Returns { mime, base64, bytes, sha256 } or { error }.
export function parseReceiptImage(value) {
  if (value === undefined || value === null || value === "") {
    return { error: "Attach a screenshot or photo of your payment receipt" };
  }
  if (typeof value !== "string") return { error: "The receipt must be an image" };
  // Cheap length check BEFORE decoding: base64 is 4/3 of the byte size.
  if (value.length > Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 64) {
    return { error: "The receipt image is too large. The limit is 5 MB." };
  }
  const match = RECEIPT_DATA_URL.exec(value.replace(/\s+/g, ""));
  if (!match) return { error: "The receipt must be a PNG, JPEG or WebP image" };
  const [, declared, base64] = match;
  const buf = Buffer.from(base64, "base64");
  if (buf.length > RECEIPT_MAX_BYTES) return { error: "The receipt image is too large. The limit is 5 MB." };
  if (buf.length < RECEIPT_MIN_BYTES) return { error: "That image is too small to be a readable receipt" };
  const actual = detectImageType(buf);
  if (!actual) return { error: "That file isn't a valid PNG, JPEG or WebP image" };
  if (actual !== declared) return { error: "The file's contents don't match its image type. Save it again as PNG or JPEG and retry." };
  return {
    mime: actual,
    base64: buf.toString("base64"), // re-encoded from the decoded bytes: canonical, no stray data
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

// ---------------------------------------------------------------------------
// Booking reference shown to passengers and staff, e.g. DRS-2026-00125.
// Derived from the existing auto-increment booking_id (still the real key)
// and the year it was booked, so no new column or backfill is needed.
// parseBookingReference accepts "DRS-2026-00125", "#125" or "125".
// ---------------------------------------------------------------------------
export function bookingReference(bookingId, bookedAt) {
  const year = bookedAt ? new Date(bookedAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric" }) : new Date().getFullYear();
  return `DRS-${year}-${String(bookingId).padStart(5, "0")}`;
}

export function parseBookingReference(text) {
  const t = String(text ?? "").trim().toUpperCase();
  const m = /^(?:DRS-\d{4}-)?#?0*(\d{1,10})$/.exec(t);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Configuration (environment variables, all optional).
// ---------------------------------------------------------------------------
function intEnv(name, fallback, { min = 0, max = 100000 } = {}) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export const paymentConfig = {
  // How long an online booking's seat is held while the passenger pays and
  // uploads proof. 0 disables the hold (seats wait for the terminal, the
  // pre-existing behaviour). Never later than the departure time.
  holdMinutes: intEnv("PAYMENT_HOLD_MINUTES", 60),
  // After staff reject / ask for a new receipt, the passenger gets at least
  // this long (from that moment) to resubmit before the seat is released.
  resubmitMinutes: intEnv("PAYMENT_RESUBMIT_MINUTES", 60),
  // Passengers are warned this many minutes before their deadline.
  expiryWarningMinutes: intEnv("PAYMENT_EXPIRY_WARNING_MINUTES", 15),
  // Staff service level: proofs should be reviewed within this many minutes.
  reviewSlaMinutes: intEnv("PAYMENT_REVIEW_SLA_MINUTES", 30, { min: 1 }),
  // Staff are alerted when a trip departing within this many hours still
  // has an unresolved payment.
  departureAlertHours: intEnv("PAYMENT_DEPARTURE_ALERT_HOURS", 3, { min: 1, max: 72 }),
  sweepIntervalMs: intEnv("PAYMENT_SWEEP_INTERVAL_MS", 60000, { min: 200, max: 3600000 }),
};

// When a new online booking's payment window closes (JS Date), or null when
// holds are disabled.
// A deadline is never less than MIN_WINDOW_MINUTES away, even for a bus that
// is already Boarding past its scheduled time (the passenger still needs a
// moment to pay); otherwise it's capped at departure.
export const MIN_WINDOW_MINUTES = 15;
export function holdDeadline(minutes, departureTime, now = new Date()) {
  const byHold = now.getTime() + minutes * 60000;
  const departure = new Date(departureTime).getTime();
  const floor = now.getTime() + Math.min(minutes, MIN_WINDOW_MINUTES) * 60000;
  return new Date(Math.max(Math.min(byHold, departure), floor));
}

export function initialPaymentDeadline(departureTime, now = new Date()) {
  if (!paymentConfig.holdMinutes) return null;
  return holdDeadline(paymentConfig.holdMinutes, departureTime, now);
}
