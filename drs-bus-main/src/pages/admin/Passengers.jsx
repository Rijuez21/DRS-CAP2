import { useEffect, useState } from "react";
import { Search, UserRound, Ban, RotateCcw, MailCheck } from "lucide-react";
import * as api from "../../lib/api";
import PageHeading from "../../components/common/PageHeading";
import InlineAlert from "../../components/common/InlineAlert";
import EmptyState from "../../components/common/EmptyState";
import Modal from "../../components/admin/Modal";
import { CancelButton, SubmitButton, TextAction } from "../../components/common/Buttons";
import { formatDate, initials } from "../../lib/format";

// Passenger accounts (GET /api/passengers). Passengers sign themselves up,
// so there's nothing to create here: look someone up, suspend an account
// that's abusing bookings (signed out at once, can't sign in), lift a
// suspension, or confirm an email by hand for someone who can't get the
// code. Search and paging happen on the server.
const STATUS_OPTIONS = [
  { value: "", label: "All passengers" },
  { value: "active", label: "Active" },
  { value: "unverified", label: "Email not confirmed" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
];

function statusOf(p) {
  if (p.closed_at) return { label: "Closed", className: "bg-slate-100 text-slate-600" };
  if (p.suspended_at) return { label: "Suspended", className: "bg-rose-100 text-rose-700" };
  if (!p.email_verified) return { label: "Email not confirmed", className: "bg-amber-100 text-amber-800" };
  return { label: "Active", className: "bg-emerald-100 text-emerald-800" };
}

export default function AdminPassengers() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // what was actually searched
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [suspending, setSuspending] = useState(null); // passenger row
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Search 300 ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    api
      .getPassengers({ q: query, status, page })
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [query, status, page, reloadKey]);

  async function act(p, fn, message) {
    setError("");
    setSuccess("");
    setBusyId(p.commuter_id);
    try {
      await fn();
      setSuccess(message);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmSuspend(e) {
    e.preventDefault();
    const p = suspending;
    if (!reason.trim()) return;
    await act(p, () => api.suspendPassenger(p.commuter_id, reason.trim()), `${p.name} was suspended and signed out.`);
    setSuspending(null);
    setReason("");
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const rows = data?.passengers ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Passengers" subtitle="Look up passenger accounts, suspend an account that's abusing bookings, or confirm an email by hand." />

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search passengers</span>
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input id="passenger-search" className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or mobile…" />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">Status</span>
          <select
            id="passenger-status"
            className="input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {!data ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-white border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={UserRound} title="No passengers found" description={query || status ? "Try a different search or status." : "Passengers appear here once they sign up."} />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const s = statusOf(p);
            const busy = busyId === p.commuter_id;
            return (
              <li key={p.commuter_id} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center text-sm font-bold" aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900 flex flex-wrap items-center gap-2">
                      <span className="truncate">{p.name}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.className}`}>{s.label}</span>
                    </p>
                    <p className="text-sm text-gray-600 break-all">
                      {p.closed_at ? "—" : p.email}
                      {p.phoneno ? ` · ${p.phoneno}` : ""}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.bookings} booking{p.bookings === 1 ? "" : "s"}
                      {p.no_shows > 0 ? ` · ${p.no_shows} no-show${p.no_shows === 1 ? "" : "s"}` : ""}
                      {p.created_at ? ` · joined ${formatDate(p.created_at)?.replace(/^\w+, /, "")}` : ""}
                    </p>
                    {p.suspended_at && p.suspension_reason && <p className="text-xs text-rose-700 mt-0.5">Suspended: {p.suspension_reason}</p>}
                  </div>
                </div>
                {!p.closed_at && (
                  <div className="flex flex-wrap gap-1 sm:justify-end">
                    {!p.email_verified && (
                      <TextAction busy={busy} onClick={() => act(p, () => api.verifyPassengerEmail(p.commuter_id), `${p.name}'s email was confirmed.`)}>
                        <MailCheck className="w-3.5 h-3.5" aria-hidden="true" /> Confirm email
                      </TextAction>
                    )}
                    {p.suspended_at ? (
                      <TextAction busy={busy} onClick={() => act(p, () => api.unsuspendPassenger(p.commuter_id), `${p.name} can sign in again.`)}>
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Lift suspension
                      </TextAction>
                    ) : (
                      <TextAction tone="danger" disabled={busy} onClick={() => setSuspending(p)}>
                        <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Suspend
                      </TextAction>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > data.pageSize && (
        <nav className="flex items-center justify-end gap-3 text-sm" aria-label="Pages">
          <span className="text-gray-600">
            Page {page} of {pageCount} · {data.total} passengers
          </span>
          <button type="button" className="min-h-11 md:min-h-9 px-3 rounded-lg font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </button>
          <button type="button" className="min-h-11 md:min-h-9 px-3 rounded-lg font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>
            Next
          </button>
        </nav>
      )}

      {suspending && (
        <Modal
          title={`Suspend ${suspending.name}?`}
          onClose={() => setSuspending(null)}
          footer={
            <>
              <CancelButton onClick={() => setSuspending(null)} />
              <SubmitButton form="suspend-form" isSaving={busyId === suspending.commuter_id} className="bg-rose-600 hover:bg-rose-500">
                Suspend account
              </SubmitButton>
            </>
          }
        >
          <form id="suspend-form" onSubmit={confirmSuspend} className="space-y-3">
            <p className="text-sm text-gray-600">They&apos;ll be signed out right away and can&apos;t sign in until you lift the suspension. Their existing bookings stay as they are.</p>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Reason (kept in the activity log)</span>
              <textarea id="suspend-reason" required className="input min-h-24" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Repeated fake bookings that were never paid" />
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}
