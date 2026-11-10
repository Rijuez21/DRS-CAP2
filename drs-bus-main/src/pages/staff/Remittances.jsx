import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Banknote, Users } from "lucide-react";
import InlineAlert from "../../components/common/InlineAlert";
import PageHeading from "../../components/common/PageHeading";
import StatusBadge from "../../components/common/StatusBadge";
import EmptyState from "../../components/common/EmptyState";
import Modal from "../../components/admin/Modal";
import * as api from "../../lib/api";
import { formatTime, formatDateTime } from "../../lib/format";
import { formatPeso } from "../../lib/image";

const todayPh = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

// Conductor cash check, shared by terminal staff (/staff/remittances) and
// admins (/admin/remittances). For each trip of the day: passengers
// carried, the cash recorded on board, and what the conductor handed over.
// Staff record the remittance once per completed trip (they're saved as
// the receiver); a short trip is flagged and admins are alerted. Only an
// admin can correct a recorded amount.
export default function Remittances() {
  const isAdmin = useLocation().pathname.startsWith("/admin");
  const [date, setDate] = useState(todayPh());
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialog, setDialog] = useState(null); // { trip, mode: 'record'|'correct', amount, notes }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getRemittances({ date }).then((r) => setTrips(r.trips)).catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }, [date]);
  useEffect(load, [load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const t = dialog.trip;
      const after = dialog.mode === "record"
        ? await api.recordRemittance(t.trip_id, { amount: dialog.amount, notes: dialog.notes })
        : await api.correctRemittance(t.remittance.remittance_id, { amount: dialog.amount, reason: dialog.notes });
      setSuccess(
        after.status === "Short"
          ? `Recorded ${formatPeso(after.remittance.remitted)} — ${formatPeso(-after.difference)} SHORT of the ${formatPeso(after.expected_remittance)} collected on board. Administrators have been alerted.`
          : `Recorded ${formatPeso(after.remittance.remitted)} for ${t.driver_name}'s trip — ${after.status.toLowerCase()}.`
      );
      setDialog(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totals = trips.reduce(
    (s, t) => ({
      onBoard: s.onBoard + t.collected.on_board,
      remitted: s.remitted + (t.remittance?.remitted ?? 0),
      awaiting: s.awaiting + (t.status === "Awaiting remittance" ? 1 : 0),
      short: s.short + (t.status === "Short" ? 1 : 0),
    }),
    { onBoard: 0, remitted: 0, awaiting: 0, short: 0 }
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Remittances" subtitle="Check the cash each conductor turns over against the fares recorded on board." />

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Trips on</span>
          <input type="date" value={date} onChange={(e) => { setIsLoading(true); setDate(e.target.value); }} className="input" />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-0">
          <Total label="Collected on board" value={formatPeso(totals.onBoard)} />
          <Total label="Remitted" value={formatPeso(totals.remitted)} />
          <Total label="Awaiting remittance" value={totals.awaiting} warn={totals.awaiting > 0} />
          <Total label="Short trips" value={totals.short} bad={totals.short > 0} />
        </div>
      </div>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : trips.length === 0 ? (
        <EmptyState icon={Banknote} title="No trips on this day" description="Pick another date to see its trips." />
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Trip</th>
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2 text-right">Passengers</th>
                <th className="px-3 py-2 text-right">On board</th>
                <th className="px-3 py-2 text-right">Remitted</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {trips.map((t) => (
                <tr key={t.trip_id} className={t.status === "Short" ? "bg-rose-50" : ""}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{formatTime(t.departure_time)} · {t.origin} → {t.destination}</p>
                    <p className="text-xs text-gray-500">{t.bus_number ? `Bus ${t.bus_number} · ` : ""}{t.plate_num} · {t.trip_status}</p>
                  </td>
                  <td className="px-3 py-2">{t.driver_name}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-gray-400" />{t.passengers.total}</span>
                    {t.passengers.walk_on > 0 && <p className="text-xs text-gray-500">{t.passengers.walk_on} walk-on</p>}
                    {t.flagged_unpaid > 0 && <p className="text-xs text-rose-700 font-medium">{t.flagged_unpaid} flagged, no fare</p>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{formatPeso(t.expected_remittance)}</td>
                  <td className="px-3 py-2 text-right">{t.remittance ? formatPeso(t.remittance.remitted) : "—"}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${t.difference < 0 ? "text-rose-700" : t.difference > 0 ? "text-violet-700" : ""}`}>
                    {t.difference == null ? "—" : `${t.difference > 0 ? "+" : ""}${formatPeso(t.difference)}`}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                    {t.remittance && <p className="text-xs text-gray-500 mt-1">by {t.remittance.received_by}, {formatDateTime(t.remittance.received_at)}{t.remittance.corrected_by ? ` · corrected by ${t.remittance.corrected_by}` : ""}</p>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {t.status === "Awaiting remittance" && (
                      <button type="button" onClick={() => setDialog({ trip: t, mode: "record", amount: "", notes: "" })} className="text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded">Record remittance</button>
                    )}
                    {isAdmin && t.remittance && (
                      <button type="button" onClick={() => setDialog({ trip: t, mode: "correct", amount: String(t.remittance.remitted), notes: "" })} className="text-sm font-semibold text-emerald-700 underline">Correct</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <Modal
          title={dialog.mode === "record" ? "Record remittance" : "Correct remittance"}
          onClose={busy ? undefined : () => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} disabled={busy} className="px-4 py-2 text-sm rounded-lg border bg-white">Cancel</button>
              <button type="submit" form="remit-form" disabled={busy || dialog.amount === "" || (dialog.mode === "correct" && !dialog.notes.trim())} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg">
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="remit-form" onSubmit={submit} className="space-y-3 text-sm">
            <p>
              <strong>{dialog.trip.driver_name}</strong> · {formatTime(dialog.trip.departure_time)} {dialog.trip.origin} → {dialog.trip.destination}
            </p>
            <div className="rounded-lg bg-slate-50 px-3 py-2 flex justify-between">
              <span>Fares recorded on board</span>
              <strong>{formatPeso(dialog.trip.expected_remittance)}</strong>
            </div>
            <p className="text-xs text-gray-500">
              {dialog.trip.passengers.total} passengers carried ({dialog.trip.passengers.walk_on} walk-on).{" "}
              {dialog.trip.flagged_unpaid > 0 && <span className="text-rose-700 font-medium">{dialog.trip.flagged_unpaid} flagged rider(s) boarded with no fare recorded.</span>}
            </p>
            <label className="block">Cash received (₱)
              <input type="number" min="0" step="0.01" value={dialog.amount} onChange={(e) => setDialog({ ...dialog, amount: e.target.value })} className="input mt-1" placeholder="Count the cash, then enter it" />
            </label>
            {dialog.amount !== "" && (
              <p className={`font-semibold ${Number(dialog.amount) < dialog.trip.expected_remittance ? "text-rose-700" : "text-emerald-700"}`}>
                {Number(dialog.amount) < dialog.trip.expected_remittance
                  ? `${formatPeso(dialog.trip.expected_remittance - Number(dialog.amount))} short`
                  : Number(dialog.amount) > dialog.trip.expected_remittance
                    ? `${formatPeso(Number(dialog.amount) - dialog.trip.expected_remittance)} over`
                    : "Matches the fares recorded"}
              </p>
            )}
            <label className="block">{dialog.mode === "record" ? "Notes (optional)" : "Reason for the correction"}
              <input value={dialog.notes} onChange={(e) => setDialog({ ...dialog, notes: e.target.value })} maxLength={200} className="input mt-1" />
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Total({ label, value, warn, bad }) {
  return (
    <div className={`rounded-lg border px-3 py-2 bg-white ${bad ? "border-rose-300" : warn ? "border-amber-300" : ""}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-bold ${bad ? "text-rose-700" : ""}`}>{value}</p>
    </div>
  );
}
