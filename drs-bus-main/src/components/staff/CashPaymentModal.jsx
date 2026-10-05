import { useMemo, useState } from "react";
import { Banknote } from "lucide-react";
import Modal from "../admin/Modal";
import { formatPeso } from "../../lib/image";

// Counter payment confirmation, shared by WalkInSales (selling a new
// ticket) and ReservationValidation (collecting the fare for a Reserved
// online booking). Staff type the cash handed over; the dialog shows the
// change and won't confirm an underpayment. The server re-checks the same
// rule, so this is a convenience, not the guard.
//
// props:
//   title        dialog title
//   summary      node describing what is being paid for
//   amountDue    number (the total fare)
//   note         optional warning shown above the input
//   confirmLabel button text, e.g. "Confirm payment & sell"
//   isSaving     disables the buttons while the request runs
//   error        server error to show inside the dialog
//   onConfirm(cashReceived)  called with a number
//   onClose()
export default function CashPaymentModal({ title, summary, amountDue, note, confirmLabel, isSaving, error, onConfirm, onClose }) {
  const [cash, setCash] = useState("");
  const [touched, setTouched] = useState(false);

  const cashNumber = cash === "" ? null : Number(cash);
  const valid = cashNumber != null && Number.isFinite(cashNumber) && cashNumber >= 0;
  const short = valid && cashNumber < amountDue;
  const change = valid && !short ? Math.round((cashNumber - amountDue) * 100) / 100 : null;

  // One-tap amounts for the usual bills: exact, then the next round
  // amounts above the fare.
  const quickAmounts = useMemo(() => {
    const picks = [amountDue];
    for (const step of [50, 100, 500, 1000]) {
      const next = Math.ceil(amountDue / step) * step;
      if (next > amountDue && !picks.includes(next)) picks.push(next);
    }
    return picks.slice(0, 4);
  }, [amountDue]);

  function submit(e) {
    e?.preventDefault();
    setTouched(true);
    if (!valid || short) return;
    onConfirm(cashNumber);
  }

  const inputError = touched && !valid ? "Enter the cash received." : short ? `That's ${formatPeso(amountDue - cashNumber)} short of the fare.` : "";

  return (
    <Modal
      title={title}
      onClose={isSaving ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm rounded-lg border bg-white disabled:opacity-60">
            Back
          </button>
          <button
            type="submit"
            form="cash-payment-form"
            disabled={isSaving || !valid || short}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold disabled:opacity-60"
          >
            {isSaving ? "Confirming…" : confirmLabel}
          </button>
        </>
      }
    >
      <form id="cash-payment-form" onSubmit={submit} className="space-y-4">
        {summary && <div className="text-sm text-gray-600">{summary}</div>}

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <span className="text-sm text-gray-600">Amount due</span>
          <span className="text-2xl font-bold text-gray-900">{formatPeso(amountDue)}</span>
        </div>

        {note && <p className="text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">{note}</p>}

        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Cash received</span>
          <div className="relative">
            <Banknote className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={String(amountDue)}
              autoFocus
              className="input pl-9 w-full text-lg"
            />
          </div>
        </label>

        <div className="flex flex-wrap gap-1.5">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => {
                setCash(String(amt));
                setTouched(true);
              }}
              className="text-xs rounded-full border px-2.5 py-1 hover:bg-slate-50"
            >
              {amt === amountDue ? `Exact ${formatPeso(amt)}` : formatPeso(amt)}
            </button>
          ))}
        </div>

        {inputError && <p className="text-sm text-rose-600">{inputError}</p>}

        {change != null && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
            <span className="text-sm text-emerald-800">Change to give</span>
            <span className="text-xl font-bold text-emerald-800">{formatPeso(change)}</span>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
