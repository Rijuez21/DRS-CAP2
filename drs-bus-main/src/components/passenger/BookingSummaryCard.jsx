export default function BookingSummaryCard({
  selectedSeatIds,
  pricePerSeat, // TODO: from trip.fare once GET /api/trips/:id is wired up
  passengerName,
  onPassengerNameChange,
  contactNumber,
  onContactNumberChange,
  onConfirm,
}) {
  const total =
    pricePerSeat != null ? pricePerSeat * selectedSeatIds.length : null;

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 space-y-4">
      <h2 className="font-display font-semibold text-lg">Book this Trip</h2>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">
          Selected Seats
        </p>
        <p className="font-display text-lg font-bold">
          {selectedSeatIds.length === 0
            ? "No seats selected"
            : [...selectedSeatIds].sort((a, b) => a - b).join(", ")}
        </p>
      </div>

      <label className="block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">
          Passenger Name{" "}
          <span className="normal-case font-normal text-ink-600/70">(optional)</span>
        </span>
        <input
          value={passengerName}
          onChange={(e) => onPassengerNameChange(e.target.value)}
          placeholder="Name on ticket"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-green-500/40"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink-600 mb-1.5">
          Contact Number{" "}
          <span className="normal-case font-normal text-ink-600/70">(optional)</span>
        </span>
        <input
          value={contactNumber}
          onChange={(e) => onContactNumberChange(e.target.value)}
          placeholder="+63 9XX XXX XXXX"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-green-500/40"
        />
      </label>

      <div className="flex items-center justify-between rounded-2xl bg-brand-green-600/10 px-4 py-3">
        <div>
          <p className="text-xs text-ink-600">Total Price</p>
          <p className="font-display text-xl font-bold text-brand-green-600">
            {total != null ? `₱${total}` : "—"}
          </p>
        </div>
        {pricePerSeat != null && selectedSeatIds.length > 0 && (
          <p className="text-xs text-ink-600">
            {selectedSeatIds.length} × ₱{pricePerSeat}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={selectedSeatIds.length === 0}
        className="w-full bg-brand-green-600 hover:bg-brand-green-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-display font-semibold rounded-xl py-3 transition-colors"
      >
        Confirm Booking
      </button>
    </div>
  );
}