// HTML + plain-text bodies for the emails in services/mailer.js. Email
// clients ignore <style> blocks and modern CSS, so everything is inline
// styles on tables (renders the same in Gmail, Outlook and phone apps).
// Every value from the database goes through esc().

const BRAND = "D' Rising Sun Transport";
const C = { forest: "#123524", green: "#2f9e5c", sunrise: "#f4b85c", ink: "#12271b", muted: "#4b5d54", line: "#e2e8f0", surface: "#f6f8f4" };

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export const peso = (n) => `₱${Number(n ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const manilaDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "—";

// Mirrors receiptNumber() in drs-bus-main/src/lib/format.js.
export const receiptNumber = (paymentId) => `OR-${String(paymentId ?? "").padStart(6, "0")}`;

function layout({ preheader, title, body }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.surface};font-family:Arial,Helvetica,sans-serif;color:${C.ink};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${C.line};">
<tr><td style="background:${C.forest};padding:20px 24px;">
  <div style="font-size:18px;font-weight:bold;color:#ffffff;">${BRAND}</div>
  <div style="font-size:12px;color:${C.sunrise};margin-top:2px;">${esc(title)}</div>
</td></tr>
<tr><td style="padding:24px;">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${C.line};font-size:12px;color:${C.muted};text-align:center;">
  This is an automated message from ${BRAND}. Please don't reply to this email.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const row = (label, value, { mono = false } = {}) =>
  `<tr><td style="padding:6px 0;font-size:14px;color:${C.muted};">${esc(label)}</td>
   <td style="padding:6px 0;font-size:14px;font-weight:bold;text-align:right;${mono ? "font-family:Consolas,monospace;" : ""}">${esc(value)}</td></tr>`;

const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr><td style="background:${C.green};border-radius:10px;">
   <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-weight:bold;font-size:14px;text-decoration:none;">${esc(label)}</a>
   </td></tr></table>`;

// receipt: {
//   passengerName, methodName, referenceNumber, paidAt, receiptUrl,
//   seats: [{ receiptNo, bookingReference, bookingId, origin, destination, departureTime, seatNumber, bus, amount }]
// }
// receiptNo is null for a cash payment at the terminal (no payments row,
// so no official receipt number).
export function paymentReceiptEmail(receipt) {
  const total = receipt.seats.reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const seatWord = receipt.seats.length === 1 ? "seat" : "seats";
  const subject = `Payment successful — ${receipt.seats.map((s) => s.bookingReference).join(", ")}`;

  const seatBlocks = receipt.seats
    .map(
      (s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface};border-radius:12px;padding:8px 16px;margin-top:12px;">
        ${s.receiptNo ? row("Receipt no.", s.receiptNo, { mono: true }) : ""}
        ${row("Booking reference", s.bookingReference, { mono: true })}
        ${row("Route", `${s.origin} → ${s.destination}`)}
        ${row("Departure", manilaDateTime(s.departureTime))}
        ${row("Seat", s.seatNumber)}
        ${s.bus ? row("Bus", s.bus) : ""}
        ${row("Fare", peso(s.amount))}
      </table>`
    )
    .join("");

  const html = layout({
    preheader: `We received your payment of ${peso(total)}. Your booking is confirmed.`,
    title: receipt.seats[0]?.receiptNo ? "Official e-receipt" : "Payment confirmation",
    body: `
      <div style="display:inline-block;border:2px solid ${C.green};color:${C.green};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:bold;letter-spacing:1px;">PAID</div>
      <h1 style="font-size:22px;margin:14px 0 6px;">Payment successful</h1>
      <p style="font-size:14px;line-height:1.5;color:${C.muted};margin:0;">
        Hi ${esc(receipt.passengerName || "there")}, we received your payment and your ${seatWord} ${receipt.seats.length === 1 ? "is" : "are"} confirmed.
        Keep this email as your receipt.
      </p>
      ${seatBlocks}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px dashed #cbd5e1;padding-top:8px;">
        ${row("Payment method", receipt.methodName || "Online")}
        ${receipt.referenceNumber ? row("Reference no.", receipt.referenceNumber, { mono: true }) : ""}
        ${row("Date paid", manilaDateTime(receipt.paidAt))}
        <tr><td style="padding:10px 0 0;font-size:16px;font-weight:bold;">Total paid</td>
            <td style="padding:10px 0 0;font-size:22px;font-weight:bold;color:${C.green};text-align:right;">${esc(peso(total))}</td></tr>
      </table>
      ${receipt.receiptUrl ? button(receipt.receiptUrl, "View / print receipt") : ""}
      <p style="font-size:13px;line-height:1.5;color:${C.muted};margin:16px 0 0;">
        Show your booking code at the terminal to check in. Thank you for riding with us!
      </p>`,
  });

  const text = [
    `${BRAND} — Payment successful`,
    "",
    `Hi ${receipt.passengerName || "there"}, we received your payment and your ${seatWord} ${receipt.seats.length === 1 ? "is" : "are"} confirmed.`,
    "",
    ...receipt.seats.flatMap((s) => [
      ...(s.receiptNo ? [`Receipt no.: ${s.receiptNo}`] : []),
      `Booking reference: ${s.bookingReference}`,
      `Route: ${s.origin} -> ${s.destination}`,
      `Departure: ${manilaDateTime(s.departureTime)}`,
      `Seat: ${s.seatNumber}`,
      ...(s.bus ? [`Bus: ${s.bus}`] : []),
      `Fare: ${peso(s.amount)}`,
      "",
    ]),
    `Payment method: ${receipt.methodName || "Online"}`,
    ...(receipt.referenceNumber ? [`Reference no.: ${receipt.referenceNumber}`] : []),
    `Date paid: ${manilaDateTime(receipt.paidAt)}`,
    `Total paid: ${peso(total)}`,
    ...(receipt.receiptUrl ? ["", `View / print your receipt: ${receipt.receiptUrl}`] : []),
    "",
    "Show your booking code at the terminal to check in. Thank you for riding with us!",
  ].join("\n");

  return { subject, html, text };
}

// { name, code, minutes }
export function passwordResetEmail({ name, code, minutes }) {
  const subject = `${code} is your ${BRAND} password reset code`;
  const html = layout({
    preheader: `Your password reset code is ${code}. It expires in ${minutes} minutes.`,
    title: "Password reset",
    body: `
      <h1 style="font-size:22px;margin:0 0 6px;">Reset your password</h1>
      <p style="font-size:14px;line-height:1.5;color:${C.muted};margin:0;">
        Hi ${esc(name || "there")}, use this code to reset your password. It expires in ${esc(minutes)} minutes.
      </p>
      <div style="margin:20px 0;padding:16px;text-align:center;background:${C.surface};border-radius:12px;border:1px solid ${C.line};">
        <span style="font-family:Consolas,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:${C.forest};">${esc(code)}</span>
      </div>
      <p style="font-size:13px;line-height:1.5;color:${C.muted};margin:0;">
        Never share this code with anyone — our staff will never ask for it.
        If you didn't ask to reset your password, you can ignore this email; your password won't change.
      </p>`,
  });
  const text = [
    `${BRAND} — Password reset`,
    "",
    `Hi ${name || "there"}, your password reset code is: ${code}`,
    `It expires in ${minutes} minutes.`,
    "",
    "Never share this code with anyone. If you didn't ask to reset your password, ignore this email.",
  ].join("\n");
  return { subject, html, text };
}

// { name, when } — sent after a successful reset, so the owner notices a
// reset they didn't make.
export function passwordChangedEmail({ name, when }) {
  const subject = `Your ${BRAND} password was changed`;
  const html = layout({
    preheader: "Your password was just changed.",
    title: "Security notice",
    body: `
      <h1 style="font-size:22px;margin:0 0 6px;">Your password was changed</h1>
      <p style="font-size:14px;line-height:1.5;color:${C.muted};margin:0;">
        Hi ${esc(name || "there")}, the password for your account was reset on ${esc(manilaDateTime(when))}.
        You've been signed out on all your devices.
      </p>
      <p style="font-size:14px;line-height:1.5;color:${C.muted};margin:12px 0 0;">
        If this wasn't you, reset your password again right away and contact the terminal office.
      </p>`,
  });
  const text = [
    `${BRAND} — Your password was changed`,
    "",
    `Hi ${name || "there"}, the password for your account was reset on ${manilaDateTime(when)}.`,
    "If this wasn't you, reset your password again right away and contact the terminal office.",
  ].join("\n");
  return { subject, html, text };
}
