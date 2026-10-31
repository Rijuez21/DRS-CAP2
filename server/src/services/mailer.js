import nodemailer from "nodemailer";

// Outgoing email (payment receipts, password-reset codes) over plain SMTP —
// any provider works: a Gmail account with an App Password, Brevo,
// Mailtrap, SendGrid's SMTP relay, ... Configured by SMTP_* in .env.
//
// Email is a courtesy copy, never the system of record: the bell
// notification and the in-app receipt page still work when mail is down,
// so sendMail() never throws — it logs and returns false.
//
// With SMTP_HOST unset (local development) nothing is sent; the message is
// printed to the server console instead, so a reset code can still be read
// there. On a deployed server only the recipient + subject are logged.
const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);

const port = Number(process.env.SMTP_PORT) || 587;
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = TLS from the first byte; 587 / 25 upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Templates are self-contained; never let message content pull in
      // local files or remote URLs.
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  : null;

const FROM = process.env.MAIL_FROM || (process.env.SMTP_USER ? `"D' Rising Sun Transport" <${process.env.SMTP_USER}>` : "no-reply@drs.local");

export const mailEnabled = Boolean(transport);

// Where links in emails point (the deployed frontend). The first
// CORS_ORIGIN is the frontend in every setup this repo documents.
export const APP_URL = (process.env.APP_URL || String(process.env.CORS_ORIGIN ?? "").split(",")[0].trim() || "http://localhost:5173").replace(/\/+$/, "");

// message: { to, subject, text, html }
export async function sendMail({ to, subject, text, html }) {
  if (!to) return false;
  if (!transport) {
    console.log(`[mail] SMTP not configured — not sent. to=${to} subject="${subject}"`);
    if (!deployed) console.log(text);
    return false;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`[mail] Sending "${subject}" failed (non-fatal):`, err.message);
    return false;
  }
}
