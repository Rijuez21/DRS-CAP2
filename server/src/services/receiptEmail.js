import { pool } from "../db/pool.js";
import { sendMail, APP_URL } from "./mailer.js";
import { paymentReceiptEmail, receiptNumber } from "./emailTemplates.js";
import { isReservedEmail } from "./bookingRules.js";
import { bookingReference, METHOD_LABELS } from "./paymentRules.js";

// "Payment successful" emails with the receipt, sent alongside the bell
// notification once money is confirmed. Called after the transaction has
// committed; like notify.js, failures are logged and never break the
// request (sendMail itself doesn't throw).

const busLabel = (r) => [r.bus_number && `Bus ${r.bus_number}`, r.plate_num].filter(Boolean).join(" · ") || null;

// Online payment verified by staff (routes/payments.js). One email per
// transfer: a passenger paying for three seats with one GCash transfer gets
// one email listing all three receipts. Only rows still Verified are
// included (a seat that went straight to Refund Pending gets no receipt).
export async function emailPaymentReceipt(paymentIds) {
  if (!paymentIds?.length) return;
  try {
    const [rows] = await pool.query(
      `SELECT p.payment_id, p.booking_id, p.amount, p.reference_number, p.verified_at,
              s.payment_method, pm.display_name AS method_name,
              bk.seat_number, bk.passenger_name, bk.booked_at,
              tr.departure_time, rt.origin, rt.destination, b.bus_number, b.plate_num,
              c.email, c.name AS account_name
       FROM payments p
       JOIN bookings bk ON bk.booking_id = p.booking_id
       JOIN commuters c ON c.commuter_id = bk.passenger_id
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       JOIN buses b ON b.bus_id = tr.bus_id
       LEFT JOIN payment_submissions s ON s.submission_id = p.submission_id
       LEFT JOIN payment_methods pm ON pm.method_id = s.method_id
       WHERE p.payment_id IN (?) AND p.status = 'Verified'
       ORDER BY p.payment_id`,
      [paymentIds]
    );
    if (rows.length === 0 || isReservedEmail(rows[0].email)) return;
    const first = rows[0];
    const { subject, html, text } = paymentReceiptEmail({
      passengerName: first.account_name ?? first.passenger_name,
      methodName: first.method_name ?? METHOD_LABELS[first.payment_method ?? "qr_ph"],
      referenceNumber: first.reference_number,
      paidAt: first.verified_at,
      receiptUrl: rows.length === 1 ? `${APP_URL}/passenger/my-bookings/${first.booking_id}/receipt` : `${APP_URL}/passenger/payments`,
      seats: rows.map((r) => ({
        receiptNo: receiptNumber(r.payment_id),
        bookingReference: bookingReference(r.booking_id, r.booked_at),
        bookingId: r.booking_id,
        origin: r.origin,
        destination: r.destination,
        departureTime: r.departure_time,
        seatNumber: r.seat_number,
        bus: busLabel(r),
        amount: r.amount,
      })),
    });
    await sendMail({ to: first.email, subject, html, text });
  } catch (err) {
    console.error("Receipt email failed (non-fatal):", err.message);
  }
}

// Online booking paid in cash at the terminal (routes/bookings.js
// counter-payment). There's no payments row, so no OR number — the email
// is a payment confirmation for the amount staff recorded.
export async function emailCounterPaymentReceipt(bookingId, fare) {
  try {
    const [[r]] = await pool.query(
      `SELECT bk.booking_id, bk.seat_number, bk.passenger_name, bk.booked_at,
              tr.departure_time, rt.origin, rt.destination, b.bus_number, b.plate_num,
              c.email, c.name AS account_name
       FROM bookings bk
       JOIN commuters c ON c.commuter_id = bk.passenger_id
       JOIN trips tr ON tr.trip_id = bk.trip_id
       JOIN routes rt ON rt.route_id = tr.route_id
       JOIN buses b ON b.bus_id = tr.bus_id
       WHERE bk.booking_id = ?`,
      [bookingId]
    );
    if (!r || isReservedEmail(r.email)) return;
    const { subject, html, text } = paymentReceiptEmail({
      passengerName: r.account_name ?? r.passenger_name,
      methodName: "Cash at the terminal",
      referenceNumber: null,
      paidAt: new Date(),
      receiptUrl: `${APP_URL}/passenger/my-bookings/${r.booking_id}`,
      seats: [
        {
          receiptNo: null,
          bookingReference: bookingReference(r.booking_id, r.booked_at),
          bookingId: r.booking_id,
          origin: r.origin,
          destination: r.destination,
          departureTime: r.departure_time,
          seatNumber: r.seat_number,
          bus: busLabel(r),
          amount: fare,
        },
      ],
    });
    await sendMail({ to: r.email, subject, html, text });
  } catch (err) {
    console.error("Receipt email failed (non-fatal):", err.message);
  }
}
