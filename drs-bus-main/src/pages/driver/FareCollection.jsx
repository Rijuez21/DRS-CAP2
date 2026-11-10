import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banknote, UserPlus, Undo2, HandCoins } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";
import { formatPeso } from "../../lib/image";

// Cash collected on board, recorded by the conductor on the driver's phone:
// flagged riders paying when they get on, and walk-on passengers who board
// along the road without the app. The server works out every fare from the
// route's fare list; this page only previews it. After the trip, terminal
// staff check the cash handed over against this record (Remittances).
export default function FareCollection() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // { bookingId?, name?, boardStop, dropStop, fareType, count }
  const [voiding, setVoiding] = useState(null); // { fare, reason }

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch((err) => setError(err.message));
  }, [user]);

  // Default to the trip that's on the road (or boarding).
  const active = trips.find((t) => t.status === "In Transit") ?? trips.find((t) => t.status === "Boarding");
  const tripId = searchParams.get("tripId") ?? (active ? String(active.trip_id) : "");

  const reload = useCallback(() => {
    if (!tripId) return;
    api.getTripCollections(tripId).then(setData).catch((err) => setError(err.message));
  }, [tripId]);
  useEffect(reload, [reload]);

  const stops = useMemo(() => data?.fare_list?.stops ?? [], [data]);
  const preview = useMemo(() => {
    if (!form || !data?.fare_list) return null;
    const a = stops.findIndex((s) => s.name === form.boardStop);
    const b = stops.findIndex((s) => s.name === form.dropStop);
    if (a === -1 || b === -1 || b <= a) return null;
    const key = form.fareType === "discounted" ? "discounted" : "regular";
    const each = Math.max(Math.abs(stops[b][key] - stops[a][key]), data.fare_list.minimum[key]);
    return { each, total: Math.round(each * (form.bookingId ? 1 : Number(form.count) || 0) * 100) / 100 };
  }, [form, stops, data]);

  function openForm(rider) {
    setError("");
    setSuccess("");
    setForm({
      bookingId: rider?.booking_id ?? null,
      name: rider?.passenger_name ?? null,
      boardStop: stops[0]?.name ?? "",
      dropStop: stops[stops.length - 1]?.name ?? "",
      fareType: "regular",
      count: 1,
    });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fare = await api.recordOnboardFare(tripId, {
        bookingId: form.bookingId,
        boardStop: form.boardStop,
        dropStop: form.dropStop,
        fareType: form.fareType,
        passengerCount: form.bookingId ? 1 : Number(form.count),
      });
      setSuccess(`Recorded ${formatPeso(fare.amount)}${form.name ? ` from ${form.name}` : ` for ${fare.passenger_count} walk-on passenger${fare.passenger_count === 1 ? "" : "s"}`}.`);
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function voidFare(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.voidOnboardFare(voiding.fare.fare_id, voiding.reason);
      setSuccess("Entry removed.");
      setVoiding(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.summary;
  const canRecord = Boolean(data?.trip?.can_record);
  const activeFares = (data?.fares ?? []).filter((f) => !f.voided_at);
  const walkOns = (data?.fares ?? []).filter((f) => !f.booking_id);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-xl font-bold">Fare Collection</h1>
        <p className="text-sm text-gray-500">Record every fare collected on the bus. Hand this cash to terminal staff after the trip.</p>
      </header>

      <select value={tripId} onChange={(e) => { setData(null); setForm(null); setSearchParams(e.target.value ? { tripId: e.target.value } : {}); }} className="input bg-white">
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.trip_id} value={t.trip_id}>
            {formatDate(t.departure_time)?.replace(/, \d{4}$/, "")} {formatTime(t.departure_time)} · {t.origin} → {t.destination} · {t.status}
          </option>
        ))}
      </select>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {data && s && (
        <>
          <section className="grid grid-cols-3 gap-2">
            <Stat label="Cash on board" value={formatPeso(s.collected.on_board)} strong />
            <Stat label="Walk-on riders" value={s.passengers.walk_on} />
            <Stat label="Passengers carried" value={s.passengers.total} />
          </section>

          {!canRecord && (
            <p className="text-sm bg-slate-50 border rounded-lg px-3 py-2 text-gray-700">
              {data.trip.status === "Completed"
                ? s.remittance
                  ? `Remitted ${formatPeso(s.remittance.remitted)} to ${s.remittance.received_by}.`
                  : "Trip finished. Hand the cash on board to terminal staff."
                : "Fares can be recorded once boarding starts."}
              {s.remittance && <span className="ml-2"><StatusBadge status={s.status} /></span>}
            </p>
          )}

          <section className="bg-white rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2"><HandCoins className="w-4 h-4 text-emerald-700" /> Flagged riders</h2>
              {s.flagged_unpaid > 0 && <span className="text-xs font-semibold text-rose-700">{s.flagged_unpaid} boarded, fare not recorded</span>}
            </div>
            {data.flagged_riders.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">No flagged riders on this trip.</p>
            ) : (
              <ul className="divide-y">
                {data.flagged_riders.map((r) => (
                  <li key={r.booking_id} className="px-4 py-3 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center text-sm font-semibold">{r.seat_number}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.passenger_name}</p>
                      <p className="text-xs text-gray-500">{r.status}{r.fare_id ? ` · paid to ${r.drop_stop}` : ""}</p>
                    </div>
                    {r.fare_id ? (
                      <span className="text-sm font-semibold text-emerald-700">{formatPeso(r.amount)}</span>
                    ) : (
                      canRecord && <button type="button" onClick={() => openForm(r)} className="text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded">Collect fare</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2"><Banknote className="w-4 h-4 text-emerald-700" /> Walk-on passengers</h2>
              {canRecord && (
                <button type="button" onClick={() => openForm(null)} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded">
                  <UserPlus className="w-4 h-4" /> Add
                </button>
              )}
            </div>
            {walkOns.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">No walk-on passengers recorded.</p>
            ) : (
              <ul className="divide-y">
                {walkOns.map((f) => (
                  <li key={f.fare_id} className={`px-4 py-3 flex items-center gap-3 ${f.voided_at ? "opacity-50" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{f.passenger_count} × {f.board_stop} → {f.drop_stop}</p>
                      <p className="text-xs text-gray-500">
                        {f.fare_type === "discounted" ? "Student / PWD / Senior" : "Regular"} · {formatPeso(f.fare_each)} each · {formatTime(f.recorded_at)}
                        {f.voided_at && ` · removed: ${f.void_reason}`}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${f.voided_at ? "line-through" : ""}`}>{formatPeso(f.amount)}</span>
                    {!f.voided_at && canRecord && (
                      <button type="button" onClick={() => setVoiding({ fare: f, reason: "" })} aria-label="Remove entry" title="Remove entry" className="text-gray-400 hover:text-rose-600"><Undo2 className="w-4 h-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-gray-500">{activeFares.length} fare entr{activeFares.length === 1 ? "y" : "ies"} recorded on this trip.</p>
        </>
      )}

      {voiding && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Remove entry">
          <form onSubmit={voidFare} className="bg-white rounded-xl w-full max-w-md p-4 space-y-3">
            <h2 className="font-semibold">Remove {formatPeso(voiding.fare.amount)} entry?</h2>
            <p className="text-sm text-gray-600">The entry stays on record as removed, with your reason.</p>
            <input value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} maxLength={150} placeholder="Reason, e.g. entered twice" className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVoiding(null)} disabled={busy} className="px-4 py-2 text-sm rounded border">Keep it</button>
              <button type="submit" disabled={busy || !voiding.reason.trim()} className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded">Remove</button>
            </div>
          </form>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Record fare">
          <form onSubmit={save} className="bg-white rounded-xl w-full max-w-md p-4 space-y-3">
            <h2 className="font-semibold">{form.name ? `Collect fare — ${form.name}` : "Walk-on passengers"}</h2>
            <label className="block text-sm">Boarded at
              <select value={form.boardStop} onChange={(e) => setForm({ ...form, boardStop: e.target.value })} className="input mt-1">
                {stops.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">Getting off at
              <select value={form.dropStop} onChange={(e) => setForm({ ...form, dropStop: e.target.value })} className="input mt-1">
                {stops.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2 text-sm">
              {[["regular", "Regular"], ["discounted", "Student / PWD / Senior"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, fareType: v })} className={`flex-1 px-3 py-2 rounded border ${form.fareType === v ? "border-emerald-700 bg-emerald-50 font-semibold" : "border-slate-300"}`}>{l}</button>
              ))}
            </div>
            {!form.bookingId && (
              <label className="block text-sm">Number of passengers
                <input type="number" min="1" max="60" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} className="input mt-1" />
              </label>
            )}
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              {preview ? (
                <>Fare {formatPeso(preview.each)}{!form.bookingId && ` × ${form.count}`} = <strong className="text-lg">{formatPeso(preview.total)}</strong></>
              ) : (
                <span className="text-rose-700">Getting off must be after boarding on this route.</span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} disabled={busy} className="px-4 py-2 text-sm rounded border">Cancel</button>
              <button type="submit" disabled={busy || !preview} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded">
                {busy ? "Saving…" : preview ? `Record ${formatPeso(preview.total)}` : "Record"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="bg-white rounded-lg border px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-bold ${strong ? "text-lg text-emerald-800" : "text-lg"}`}>{value}</p>
    </div>
  );
}
