import { Armchair, Info } from "lucide-react";

// Book Ahead summary + confirm. The old "Contact Number (optional)" field
// was removed: nothing ever saved it (bookings have no phone column), so it
// quietly promised something the system didn't do.
export default function BookingSummaryCard({
  selectedSeatIds,
  pricePerSeat,
  passengerName,
  onPassengerNameChange,
  onConfirm,
  isSubmitting = false,
  error = "",
}) {
  const count = selectedSeatIds.length;
  const total = pricePerSeat != null ? pricePerSeat * count : null;
  const sortedSeats = [...selectedSeatIds].sort((a, b) => Number(a) - Number(b));

  return (
    <div className="card overflow-hidden lg:sticky lg:top-6">
      <div className="p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Your reservation</h2>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-600 mb-2">Seats</p>
          {count === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ink-600/80 rounded-xl border border-dashed border-slate-200 px-3 py-2.5">
              <Armchair className="w-4 h-4" /> Tap a seat on the map
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sortedSeats.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-lg bg-brand-green-600 text-white px-2.5 py-1 text-sm font-display font-bold">
                  <Armchair className="w-3.5 h-3.5 opacity-80" /> {s}
                </span>
              ))}
            </div>
          )}
        </div>

        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-2">Name on ticket</span>
          <input
            value={passengerName}
            onChange={(e) => onPassengerNameChange(e.target.value)}
            maxLength={150}
            placeholder="Your name"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition focus:bg-white focus:border-brand-green-500 focus:ring-2 focus:ring-brand-green-500/25"
          />
        </label>
      </div>

      <div className="ticket-perforation" aria-hidden="true" />

      <div className="p-5 space-y-4 bg-slate-50/60">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-600">Total fare</p>
            <p className="font-display text-2xl font-bold text-brand-green-600 leading-tight">{total != null ? `₱${total}` : "—"}</p>
          </div>
          {pricePerSeat != null && count > 0 && (
            <p className="text-xs font-medium text-ink-600 pb-1">
              {count} × ₱{pricePerSeat}
            </p>
          )}
        </div>
        <p className="flex gap-2 text-xs text-ink-600">
          <Info className="w-3.5 h-3.5 mt-px shrink-0 text-brand-green-600" />
          No payment yet — after reserving, pay online with QR Ph (GCash, Maya or your bank app) or at the terminal.
        </p>

        {error && (
          <p role="alert" className="text-sm text-rose-600 font-medium">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onConfirm}
          disabled={count === 0 || isSubmitting}
          className="w-full bg-brand-green-600 hover:bg-brand-green-500 active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none text-white font-display font-semibold rounded-xl py-3 shadow-lg shadow-brand-green-600/25 transition"
        >
          {isSubmitting ? "Reserving…" : count === 0 ? "Select a seat to continue" : `Reserve ${count} seat${count === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
