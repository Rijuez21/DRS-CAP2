import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banknote, UserPlus, Undo2, HandCoins, Minus, Plus, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import InlineAlert from "../../components/common/InlineAlert";
import StatusBadge from "../../components/common/StatusBadge";
import * as api from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";
import { formatPeso } from "../../lib/image";

// Cash collected on board, recorded by the conductor on their own phone (or
// by the driver on a trip without a conductor):
//   - flagged riders who used Flag a Bus, paying when they get on
//   - walk-on riders: anyone who waved the bus down without the app. One
//     tap opens a big-button sheet (how many, where from, where to); the
//     server works out the fare from the route's fare list.
// Walk-ons take seats until the conductor taps "Got off", so "seats left"
// (and Flag a Bus) stay true to what's actually on the bus.
// After the trip, terminal staff check the cash handed over (Remittances).

// The stop where walk-ons last got on, per trip, so the next walk-on at the
// same stop is one tap fewer. Per-phone convenience only.
const lastStopKey = (tripId) => `drs-walkon-board-${tripId}`;
function readLastStop(tripId) {
  try {
    return localStorage.getItem(lastStopKey(tripId));
  } catch {
    return null;
  }
}
function saveLastStop(tripId, stop) {
  try {
    localStorage.setItem(lastStopKey(tripId), stop);
  } catch {
    // private mode / storage blocked: just no default next time
  }
}

// A fresh fare form. rider = a flagged rider's booking, or null for walk-ons
// (who start at the stop the last walk-on got on at).
function newForm(stops, tripId, rider) {
  const last = rider ? null : readLastStop(tripId);
  // Never the last stop: nobody boards where the trip ends.
  const boardIdx = Math.min(Math.max(0, stops.findIndex((s) => s.name === last)), Math.max(0, stops.length - 2));
  return {
    bookingId: rider?.booking_id ?? null,
    name: rider?.passenger_name ?? null,
    boardStop: stops[boardIdx]?.name ?? "",
    dropStop: stops[stops.length - 1]?.name ?? "",
    fareType: "regular",
    count: 1,
  };
}

export default function FareCollection() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyFareId, setBusyFareId] = useState(null);
  const [form, setForm] = useState(null); // { bookingId?, name?, boardStop, dropStop, fareType, count }
  const [voiding, setVoiding] = useState(null); // { fare, reason }

  useEffect(() => {
    if (!user) return;
    api.getTrips({ driverId: user.id }).then(setTrips).catch((err) => setError(err.message));
  }, [user]);

  // Default to the trip that's on the road (or boarding).
  const active = trips.find((t) => t.status === "In Transit") ?? trips.find((t) => t.status === "Boarding");
  const tripId = searchParams.get("tripId") ?? (active ? String(active.trip_id) : "");
  const wantsWalkOn = searchParams.get("add") === "walkon";

  // Arrived from the dashboard's big "Walk-on passenger" button
  // (?add=walkon): open the sheet as soon as the trip's fare list loads,
  // then drop ?add from the address so a refresh doesn't reopen it.
  const reload = useCallback(() => {
    if (!tripId) return;
    api
      .getTripCollections(tripId)
      .then((d) => {
        setData(d);
        const loadedStops = d?.fare_list?.stops ?? [];
        if (wantsWalkOn && d?.trip?.can_record && loadedStops.length >= 2) {
          setForm(newForm(loadedStops, tripId, null));
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete("add");
            return next;
          }, { replace: true });
        }
      })
      .catch((err) => setError(err.message));
  }, [tripId, wantsWalkOn, setSearchParams]);
  useEffect(reload, [reload]);

  const stops = useMemo(() => data?.fare_list?.stops ?? [], [data]);
  const canRecord = Boolean(data?.trip?.can_record);

  function openForm(rider) {
    setError("");
    setSuccess("");
    setForm(newForm(stops, tripId, rider));
  }

  const preview = useMemo(() => {
    if (!form || !data?.fare_list) return null;
    const a = stops.findIndex((s) => s.name === form.boardStop);
    const b = stops.findIndex((s) => s.name === form.dropStop);
    if (a === -1 || b === -1 || b <= a) return null;
    const key = form.fareType === "discounted" ? "discounted" : "regular";
    const each = Math.max(Math.abs(stops[b][key] - stops[a][key]), data.fare_list.minimum[key]);
    return { each, total: Math.round(each * (form.bookingId ? 1 : Number(form.count) || 0) * 100) / 100 };
  }, [form, stops, data]);

  function setBoardStop(name) {
    // Keep the drop-off after the new boarding stop.
    const a = stops.findIndex((s) => s.name === name);
    const b = stops.findIndex((s) => s.name === form.dropStop);
    setForm({ ...form, boardStop: name, dropStop: b > a ? form.dropStop : stops[stops.length - 1]?.name ?? "" });
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
      if (!form.bookingId) saveLastStop(tripId, form.boardStop);
      setSuccess(
        `Collected ${formatPeso(fare.amount)}${form.name ? ` from ${form.name}` : ` · ${fare.passenger_count} walk-on${fare.passenger_count === 1 ? "" : "s"} to ${fare.drop_stop}`}.` +
          (fare.occupancy?.seats_left === 0 ? " The bus is now full." : "")
      );
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markOff(fare, undo = false) {
    setBusyFareId(fare.fare_id);
    setError("");
    try {
      await api.markWalkOnsOff(fare.fare_id, { undo });
      setSuccess(undo ? "Put back on board." : `${fare.passenger_count} walk-on${fare.passenger_count === 1 ? "" : "s"} got off — seat${fare.passenger_count === 1 ? "" : "s"} free again.`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyFareId(null);
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
  const occ = data?.occupancy;
  const activeFares = (data?.fares ?? []).filter((f) => !f.voided_at);
  // Walk-ons still aboard first (they're the ones with a "Got off" to tap).
  const walkOns = (data?.fares ?? [])
    .filter((f) => !f.booking_id)
    .sort((a, b) => Number(Boolean(a.voided_at || a.alighted_at)) - Number(Boolean(b.voided_at || b.alighted_at)));
  const aboard = walkOns.filter((f) => !f.voided_at && !f.alighted_at);
  const boardIdx = form ? stops.findIndex((st) => st.name === form.boardStop) : -1;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-xl font-bold">Fares &amp; Walk-ons</h1>
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
          {data.trip.my_role === "driver" && data.trip.conductor_id != null && (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900">
              {data.trip.conductor_name} is the conductor on this trip and collects the fares. You can still record one if they can&apos;t.
            </p>
          )}

          <section className="grid grid-cols-3 gap-2">
            <Stat label="Seats left" value={occ?.seats_left ?? "?"} strong={occ?.seats_left > 0} warn={occ?.seats_left === 0} />
            <Stat label="Walk-ons aboard" value={occ?.walk_ons_aboard ?? 0} />
            <Stat label="Cash on board" value={formatPeso(s.collected.on_board)} />
          </section>

          {canRecord && (
            <button
              type="button"
              onClick={() => openForm(null)}
              disabled={stops.length < 2}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-lg font-bold py-4"
            >
              <UserPlus className="w-6 h-6" /> Walk-on passenger
            </button>
          )}
          {canRecord && stops.length < 2 && <p className="text-sm text-rose-700">This route has no fare list yet — ask an admin to set fares in Route Management.</p>}

          {!canRecord && (
            <p className="text-sm bg-slate-50 border rounded-lg px-3 py-2 text-gray-700">
              {data.trip.status === "Completed"
                ? s.remittance
                  ? `Remitted ${formatPeso(s.remittance.remitted)} to ${s.remittance.received_by}.`
                  : `Trip finished. ${s.cash_holder_name ?? "The crew"} hands the cash on board to terminal staff.`
                : "Fares can be recorded once boarding starts."}
              {s.remittance && <span className="ml-2"><StatusBadge status={s.status} /></span>}
            </p>
          )}

          <section className="bg-white rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2"><Banknote className="w-4 h-4 text-emerald-700" /> Walk-on passengers</h2>
              <span className="text-xs text-gray-500">{aboard.length > 0 ? `${aboard.reduce((n, f) => n + f.passenger_count, 0)} aboard` : ""}</span>
            </div>
            {walkOns.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">No walk-on passengers yet. When someone waves the bus down without the app, tap Walk-on passenger.</p>
            ) : (
              <ul className="divide-y">
                {walkOns.map((f) => {
                  const off = Boolean(f.alighted_at);
                  return (
                    <li key={f.fare_id} className={`px-4 py-3 flex items-center gap-3 ${f.voided_at || off ? "opacity-60" : ""}`}>
                      <span className="w-10 h-10 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center text-lg font-bold">{f.passenger_count}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{f.board_stop} → {f.drop_stop}</p>
                        <p className="text-xs text-gray-500">
                          {formatPeso(f.amount)} · {f.fare_type === "discounted" ? "Student / PWD / Senior" : "Regular"} · {formatTime(f.recorded_at)}
                          {off && ` · got off ${formatTime(f.alighted_at)}`}
                          {f.voided_at && ` · removed: ${f.void_reason}`}
                        </p>
                      </div>
                      {canRecord && !f.voided_at && (
                        off ? (
                          <button type="button" onClick={() => markOff(f, true)} disabled={busyFareId === f.fare_id} className="text-xs text-gray-500 underline shrink-0">
                            Undo
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markOff(f)}
                            disabled={busyFareId === f.fare_id}
                            className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold px-3 py-2 rounded-lg border-2 border-emerald-700 text-emerald-800 disabled:opacity-50"
                          >
                            <LogOut className="w-4 h-4" /> Got off
                          </button>
                        )
                      )}
                      {!f.voided_at && !off && canRecord && (
                        <button type="button" onClick={() => setVoiding({ fare: f, reason: "" })} aria-label="Remove entry" title="Remove entry" className="text-gray-400 hover:text-rose-600 shrink-0">
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2"><HandCoins className="w-4 h-4 text-emerald-700" /> Flagged riders (used the app)</h2>
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
                      canRecord && <button type="button" onClick={() => openForm(r)} className="text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg">Collect fare</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-gray-500">{activeFares.length} fare entr{activeFares.length === 1 ? "y" : "ies"} recorded on this trip · {s.passengers.total} passengers carried.</p>
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={form.name ? "Collect fare" : "Walk-on passenger"}>
          <form onSubmit={save} className="bg-white rounded-t-2xl sm:rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto p-4 space-y-4">
            <h2 className="text-lg font-bold">{form.name ? `Collect fare — ${form.name}` : "Walk-on passenger"}</h2>

            {!form.bookingId && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">How many?</p>
                <div className="flex items-center justify-between gap-3">
                  <button type="button" aria-label="One fewer" onClick={() => setForm({ ...form, count: Math.max(1, Number(form.count) - 1) })} className="w-14 h-14 rounded-xl border-2 border-slate-300 flex items-center justify-center">
                    <Minus className="w-6 h-6" />
                  </button>
                  <span className="text-4xl font-bold tabular-nums" aria-live="polite">{form.count}</span>
                  <button type="button" aria-label="One more" onClick={() => setForm({ ...form, count: Math.min(60, Number(form.count) + 1) })} className="w-14 h-14 rounded-xl border-2 border-emerald-700 text-emerald-800 flex items-center justify-center">
                    <Plus className="w-6 h-6" />
                  </button>
                </div>
                {occ?.seats_left != null && Number(form.count) > occ.seats_left && (
                  <p className="text-xs text-amber-700 mt-1">Only {occ.seats_left} seat{occ.seats_left === 1 ? "" : "s"} left — the rest will be standing.</p>
                )}
              </div>
            )}

            <StopPicker label="Got on at" stops={stops} value={form.boardStop} onPick={setBoardStop} isDisabled={(i) => i === stops.length - 1} />
            <StopPicker label="Getting off at" stops={stops} value={form.dropStop} onPick={(name) => setForm({ ...form, dropStop: name })} isDisabled={(i) => i <= boardIdx} />

            <div className="grid grid-cols-2 gap-2 text-sm">
              {[["regular", "Regular"], ["discounted", "Student / PWD / Senior"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, fareType: v })} className={`px-3 py-3 rounded-lg border-2 ${form.fareType === v ? "border-emerald-700 bg-emerald-50 font-semibold" : "border-slate-200"}`}>{l}</button>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setForm(null)} disabled={busy} className="px-4 py-3 text-sm rounded-lg border">Cancel</button>
              <button type="submit" disabled={busy || !preview} className="flex-1 py-3 text-lg font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg">
                {busy ? "Saving…" : preview ? `Collect ${formatPeso(preview.total)}` : "Pick where they get off"}
              </button>
            </div>
            {preview && !form.bookingId && Number(form.count) > 1 && (
              <p className="text-center text-xs text-gray-500">{formatPeso(preview.each)} each × {form.count}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

// Stops as big buttons in route order: quicker than a dropdown on a moving
// bus, and stops that can't be picked (before the boarding stop) are greyed.
function StopPicker({ label, stops, value, onPick, isDisabled }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-700 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {stops.map((st, i) => {
          const disabled = isDisabled(i);
          const selected = st.name === value;
          return (
            <button
              key={st.name}
              type="button"
              disabled={disabled}
              onClick={() => onPick(st.name)}
              aria-pressed={selected}
              className={`px-3 py-2 rounded-lg border-2 text-sm ${selected ? "border-emerald-700 bg-emerald-700 text-white font-semibold" : "border-slate-200"} disabled:opacity-30`}
            >
              {st.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, strong, warn }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? "bg-rose-50 border-rose-200" : "bg-white"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${strong ? "text-emerald-800" : warn ? "text-rose-700" : ""}`}>{value}</p>
    </div>
  );
}
