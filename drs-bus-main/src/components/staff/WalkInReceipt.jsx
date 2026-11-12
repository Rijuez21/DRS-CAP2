import sunLogo from "../../assets/logo-sun.svg";
import { bookingReference, formatDate, formatPeso, formatTime } from "../../lib/format";

// The walk-in sale's printed receipt — laid out like a counter (thermal)
// receipt, not a screenshot of the page: company header, receipt number,
// date and cashier, the trip, one line per seat with its ticket code, the
// total, cash received and change. `.print-area` makes "Print receipt" put
// only this on paper (index.css), at a width that fits an 80 mm receipt
// printer as well as A4.
//
// sale: { bookings, passengerName, trip, total, cashReceived, change, issuedAt }
// cashier: the signed-in staff member's name.
export default function WalkInReceipt({ sale, cashier }) {
  const { bookings, trip } = sale;
  const issuedAt = sale.issuedAt ?? new Date().toISOString();
  const first = bookings[0];
  const receiptNo = bookingReference(first?.booking_id, issuedAt);
  const perSeat = trip.fare != null ? Number(trip.fare) : null;
  const seats = [...bookings].sort((a, b) => String(a.seat_number).localeCompare(String(b.seat_number), undefined, { numeric: true }));

  return (
    <article
      className="print-area mx-auto w-full max-w-[340px] bg-white text-ink-900 border border-slate-200 shadow-sm rounded-md px-5 py-6 font-mono text-[13px] leading-relaxed"
      aria-label="Walk-in sale receipt"
    >
      {/* Header */}
      <header className="text-center space-y-0.5">
        <img src={sunLogo} alt="" className="w-10 h-10 mx-auto mb-1" />
        <p className="font-sans font-bold text-base tracking-tight">D&apos; RISING SUN TRANSPORT</p>
        <p className="text-[11px] text-ink-600">Baguio – Bontoc Line · Terminal Counter</p>
      </header>

      <Rule />
      <p className="text-center font-sans font-bold tracking-[0.2em]">OFFICIAL RECEIPT</p>
      <p className="text-center text-[11px] text-ink-600">Passenger ticket · cash sale</p>
      <Rule />

      <Line label="Receipt no." value={receiptNo} />
      <Line label="Date" value={`${formatDate(issuedAt)?.replace(/^\w+, /, "")}`} />
      <Line label="Time" value={formatTime(issuedAt)} />
      <Line label="Cashier" value={cashier || "—"} />
      <Line label="Passenger" value={sale.passengerName} />

      <Rule />
      <p className="font-sans font-semibold">
        {trip.origin} → {trip.destination}
      </p>
      <Line label="Departure" value={`${formatDate(trip.departureIso)?.replace(/^\w+, /, "").replace(/, \d{4}$/, "")} ${trip.departureTime ?? formatTime(trip.departureIso) ?? ""}`} />
      <Line label="Bus" value={[trip.busNumber && `No. ${trip.busNumber}`, trip.plateNumber].filter(Boolean).join(" · ") || "—"} />

      <Rule />
      <div className="flex justify-between text-[11px] text-ink-600 uppercase tracking-wider">
        <span>Item</span>
        <span>Amount</span>
      </div>
      {seats.map((b) => (
        <div key={b.booking_id} className="py-0.5">
          <div className="flex justify-between gap-3">
            <span>Bus fare · Seat {b.seat_number}</span>
            <span className="tabular-nums">{perSeat != null ? formatPeso(perSeat) : "—"}</span>
          </div>
          <p className="text-[11px] text-ink-600">Ticket {b.booking_reference ?? bookingReference(b.booking_id, issuedAt)}</p>
        </div>
      ))}

      <Rule />
      <div className="flex justify-between font-sans font-bold text-base">
        <span>
          TOTAL ({seats.length} seat{seats.length === 1 ? "" : "s"})
        </span>
        <span className="tabular-nums">{sale.total != null ? formatPeso(sale.total) : "—"}</span>
      </div>
      {sale.cashReceived != null && <Line label="Cash received" value={formatPeso(sale.cashReceived)} />}
      {sale.change != null && <Line label="Change" value={formatPeso(sale.change)} />}
      <Line label="Payment" value="CASH · PAID" strong />

      <Rule />
      <footer className="text-center text-[11px] text-ink-600 space-y-1">
        <p className="font-sans font-semibold text-ink-900">This receipt is your ticket.</p>
        <p>Show it to the conductor when boarding. Valid only for the trip, date and seat(s) above. Non-transferable.</p>
        <p>Please be at the terminal 15 minutes before departure.</p>
        <p className="pt-1 font-sans">Thank you for riding with us!</p>
      </footer>
    </article>
  );
}

function Line({ label, value, strong = false }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-600 shrink-0">{label}</span>
      <span className={`text-right break-words min-w-0 ${strong ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-2.5 border-t border-dashed border-slate-400" aria-hidden="true" />;
}
