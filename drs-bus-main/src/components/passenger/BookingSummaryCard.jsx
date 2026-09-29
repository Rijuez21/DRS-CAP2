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
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4 lg:sticky lg:top-6">
      <h2 className="font-display font-semibold text-lg">Your reservation</h2>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">Seats</p>
        <p className={`font-display text-lg font-bold ${count === 0 ? "text-ink-600/60" : ""}`}>
          {count === 0 ? "Tap a seat on the map" : sortedSeats.join(", ")}
        </p>
      </div>

      <label className="block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">Name on ticket</span>
        <input
          value={passengerName}
          onChange={(e) => onPassengerNameChange(e.target.value)}
          maxLength={150}
          placeholder="Your name"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-green-500/40"
        />
      </label>

      <div className="flex items-center justify-between rounded-2xl bg-brand-green-600/10 px-4 py-3">
        <div>
          <p className="text-xs text-ink-600">Total fare</p>
          <p className="font-display text-xl font-bold text-brand-green-600">{total != null ? `₱${total}` : "—"}</p>
        </div>
        {pricePerSeat != null && count > 0 && (
          <p className="text-xs text-ink-600">
            {count} × ₱{pricePerSeat}
          </p>
        )}
      </div>
      <p className="text-xs text-ink-600">No payment yet — after reserving, pay online with QR Ph (GCash, Maya or your bank app) or at the terminal.</p>

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={count === 0 || isSubmitting}
        className="w-full bg-brand-green-600 hover:bg-brand-green-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-display font-semibold rounded-xl py-3 transition-colors"
      >
        {isSubmitting ? "Reserving…" : count === 0 ? "Select a seat to continue" : `Reserve ${count} seat${count === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
