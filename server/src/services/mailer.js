import nodemailer from "nodemailer";

// Outgoing email (payment receipts, password-reset codes). Two ways to send:
//
//   BREVO_API_KEY set -> Brevo's HTTPS API (api.brevo.com). Use this on
//                        Railway: Railway blocks outbound SMTP on non-Pro
//                        plans, so SMTP there just times out.
//   SMTP_HOST set     -> plain SMTP (e.g. Gmail with an App Password). Fine
//                        on a PC or any host that allows port 465/587.
//   neither           -> nothing is sent; the message is printed to the
//                        server console (local development), so a reset
//                        code can still be read there. On a deployed server
//                        only the recipient is logged.
//
// Email is a courtesy copy, never the system of record: the bell
// notification and the in-app receipt page still work when mail is down,
// so sendMail() never throws — it logs and returns false.
const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);

const SENDER_NAME = process.env.MAIL_FROM_NAME || "D' Rising Sun Transport";
// With Brevo this must be a sender verified in the Brevo dashboard.
const SENDER_EMAIL = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || "no-reply@drs.local";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_TIMEOUT_MS = 15_000;

const port = Number(process.env.SMTP_PORT) || 587;
const transport =
  !BREVO_API_KEY && process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 = TLS from the first byte; 587 / 25 upgrade with STARTTLS.
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        connectionTimeout: 20_000,
        // Templates are self-contained; never let message content pull in
        // local files or remote URLs.
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;

export const mailEnabled = Boolean(BREVO_API_KEY || transport);

// Where links in emails point (the deployed frontend). The first
// CORS_ORIGIN is the frontend in every setup this repo documents.
export const APP_URL = (process.env.APP_URL || String(process.env.CORS_ORIGIN ?? "").split(",")[0].trim() || "http://localhost:5173").replace(/\/+$/, "");

// Reset-code subjects start with the code; keep it out of the logs.
const logSubject = (subject) => String(subject).replace(/\b\d{6}\b/g, "******");

async function sendWithBrevo({ to, subject, text, html }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Brevo ${res.status}: ${body?.message ?? res.statusText}`);
  }
}

// message: { to, subject, text, html }
export async function sendMail({ to, subject, text, html }) {
  if (!to) return false;
  if (!mailEnabled) {
    console.log(`[mail] Email not configured — not sent. to=${to} subject="${deployed ? logSubject(subject) : subject}"`);
    if (!deployed) console.log(text);
    return false;
  }
  try {
    if (BREVO_API_KEY) await sendWithBrevo({ to, subject, text, html });
    else await transport.sendMail({ from: { name: SENDER_NAME, address: SENDER_EMAIL }, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`[mail] Sending "${logSubject(subject)}" failed (non-fatal):`, err.message);
    return false;
  }
}
