import { useCallback, useEffect, useState } from "react";
import { IdCard, Check, X } from "lucide-react";
import PageHeading from "../../components/common/PageHeading";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import ReceiptImage from "../../components/payments/ReceiptImage";
import Modal from "../../components/admin/Modal";
import * as api from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { CATEGORY_LABELS, DISCOUNT_PERCENT } from "../../lib/discounts";

const TABS = ["Pending", "Approved", "Rejected"];
// Common reasons, so staff don't have to type the usual ones.
const QUICK_REASONS = ["The photo is blurry or unreadable", "The ID is expired", "The name doesn't match the account", "This isn't a valid ID for this discount"];

// Student / PWD / senior citizen IDs that passengers sent for the 20% fare
// discount. Shared by terminal staff (/staff/discounts) and admins
// (/admin/discounts). Approving a student ID makes it valid for one year.
export default function DiscountReview() {
  const [tab, setTab] = useState("Pending");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null); // the row being rejected
  const [reason, setReason] = useState("");
  const [zoomUrl, setZoomUrl] = useState(null);

  const load = useCallback(() => {
    return api
      .getDiscountApplications(tab)
      .then(setRows)
      .catch((err) => {
        setRows([]);
        setError(err.message);
      });
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(row) {
    const validity = row.category === "student" ? " It will be valid for one year." : "";
    if (!window.confirm(`Approve ${row.passenger_name}'s ${CATEGORY_LABELS[row.category]} ID?${validity}`)) return;
    setBusyId(row.application_id);
    setError("");
    try {
      const result = await api.approveDiscount(row.application_id);
      setSuccess(
        `${row.passenger_name} now gets ${DISCOUNT_PERCENT}% off${result.expires_at ? ` until ${formatDate(result.expires_at)}` : ""}. They were notified.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(e) {
    e.preventDefault();
    const row = rejecting;
    setBusyId(row.application_id);
    setError("");
    try {
      await api.rejectDiscount(row.application_id, reason);
      setSuccess(`${row.passenger_name}'s ID was rejected. They were told why and can send a new one.`);
      setRejecting(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading
        title="ID Verification"
        subtitle={`Student, PWD and senior citizen IDs for the ${DISCOUNT_PERCENT}% fare discount. Approve only an ID that's real, readable, and matches the passenger's name. Student discounts last one year.`}
      />

      <div className="flex gap-2" role="tablist" aria-label="Status">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              if (t !== tab) setRows(null); // loading skeleton until the new tab's list arrives
              setTab(t);
              setSuccess("");
              setError("");
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === t ? "bg-ink-900 text-white" : "bg-white border border-slate-200 text-ink-600 hover:border-slate-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />
      <InlineAlert message={error} onDismiss={() => setError("")} />

      {rows === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-64 rounded-2xl bg-white border animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={IdCard}
          title={tab === "Pending" ? "No IDs waiting to be checked" : `No ${tab.toLowerCase()} IDs`}
          description={tab === "Pending" ? "New IDs appear here when passengers send them." : null}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <article key={row.application_id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.passenger_name}</p>
                  <p className="text-xs text-ink-600 truncate">{row.passenger_email}</p>
                </div>
                <span className="shrink-0 rounded-full bg-brand-green-500/12 text-brand-green-600 px-3 py-0.5 text-xs font-semibold">
                  {CATEGORY_LABELS[row.category]}
                </span>
              </div>

              <ReceiptImage
                submissionId={row.application_id}
                load={api.fetchDiscountIdObjectUrl}
                alt={`${CATEGORY_LABELS[row.category]} ID of ${row.passenger_name}`}
                className="w-full h-48"
                onClick={setZoomUrl}
              />

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink-600">ID number</dt>
                  <dd className="font-medium">{row.id_number || "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-600">Sent</dt>
                  <dd className="font-medium">{formatDateTime(row.submitted_at)}</dd>
                </div>
                {row.status !== "Pending" && (
                  <div>
                    <dt className="text-ink-600">{row.status} by</dt>
                    <dd className="font-medium">{row.reviewed_by_name ?? "—"}</dd>
                  </div>
                )}
                {row.status === "Approved" && (
                  <div>
                    <dt className="text-ink-600">Valid until</dt>
                    <dd className="font-medium">{row.expires_at ? formatDate(row.expires_at) : "No expiry"}</dd>
                  </div>
                )}
                {row.status === "Rejected" && (
                  <div className="col-span-2">
                    <dt className="text-ink-600">Reason</dt>
                    <dd className="font-medium">{row.rejection_reason}</dd>
                  </div>
                )}
              </dl>

              {row.status === "Pending" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.application_id}
                    onClick={() => {
                      setRejecting(row);
                      setReason("");
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-60 font-semibold text-sm py-2"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.application_id}
                    onClick={() => approve(row)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-60 text-white font-semibold text-sm py-2"
                  >
                    <Check className="w-4 h-4" /> Approve
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {rejecting && (
        <Modal title={`Reject ${rejecting.passenger_name}'s ID`} onClose={() => setRejecting(null)}>
          <form onSubmit={reject} className="space-y-3">
            <p className="text-sm text-ink-600">The passenger sees this reason and can send a new photo.</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-slate-300">
                  {r}
                </button>
              ))}
            </div>
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} rows={3} className="input" placeholder="Reason" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRejecting(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={busyId === rejecting.application_id} className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white px-4 py-2 text-sm font-semibold">
                Reject ID
              </button>
            </div>
          </form>
        </Modal>
      )}

      {zoomUrl && (
        <Modal title="ID photo" size="lg" onClose={() => setZoomUrl(null)}>
          <img src={zoomUrl} alt="ID photo, full size" className="w-full rounded-xl" />
        </Modal>
      )}
    </div>
  );
}
