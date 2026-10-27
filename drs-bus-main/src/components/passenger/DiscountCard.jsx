import { useCallback, useEffect, useState } from "react";
import { BadgePercent, Clock, ShieldCheck, CircleX } from "lucide-react";
import DiscountIdFields from "./DiscountIdFields";
import InlineAlert from "../common/InlineAlert";
import * as api from "../../lib/api";
import { formatDate } from "../../lib/format";
import { CATEGORY_LABELS, DISCOUNT_PERCENT, PASSENGER_TYPES, readIdImage } from "../../lib/discounts";

const ID_TYPES = PASSENGER_TYPES.filter((t) => t.value !== "regular");

// Profile: the passenger's student / PWD / senior fare discount — its status,
// and the form to send (or re-send, or renew) an ID for staff to check.
// notice: shown on arrival, e.g. when the ID upload at sign-up failed.
export default function DiscountCard({ notice = "" }) {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(Boolean(notice));
  const [form, setForm] = useState({ type: "student", idNumber: "", file: null });
  const [error, setError] = useState(notice);
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(
    () =>
      api.getMyDiscount().then((data) => {
        setInfo(data);
        // Pre-pick the type they had before (renewing, or fixing a rejected ID).
        const previous = data.latest?.category ?? data.expired?.category;
        if (previous) setForm((f) => ({ ...f, type: previous }));
      }),
    []
  );

  useEffect(() => {
    load().catch((err) => setLoadError(err.message));
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const idImage = await readIdImage(form.file);
      await api.submitDiscountId({ category: form.type, idNumber: form.idNumber, idImage });
      setSuccess("ID sent. Terminal staff will check it — you'll get a notification when it's done.");
      setFormOpen(false);
      setForm((f) => ({ ...f, idNumber: "", file: null }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) return <InlineAlert message={loadError} />;
  if (!info) return null;

  const { active, expired, latest } = info;
  const pending = latest?.status === "Pending";
  const rejected = !active && !pending && latest?.status === "Rejected";

  let icon = BadgePercent;
  let title = "Student, PWD or senior citizen?";
  let body = `Send a photo of your ID. Once staff verify it, you get ${DISCOUNT_PERCENT}% off your own seat.`;
  let tone = "bg-slate-100 text-ink-600";
  if (active) {
    icon = ShieldCheck;
    tone = "bg-brand-green-500/15 text-brand-green-600";
    title = `${CATEGORY_LABELS[active.category]} discount — ${DISCOUNT_PERCENT}% off`;
    body = active.expires_at
      ? `Verified. Valid until ${formatDate(active.expires_at)}. Applies to your own seat when you book online.`
      : "Verified. Applies to your own seat when you book online.";
  } else if (pending) {
    icon = Clock;
    tone = "bg-brand-sunrise-400/30 text-brand-forest-900";
    title = `${CATEGORY_LABELS[latest.category]} ID under review`;
    body = "Terminal staff are checking your ID. You'll get a notification when it's done.";
  } else if (rejected) {
    icon = CircleX;
    tone = "bg-rose-50 text-rose-600";
    title = `${CATEGORY_LABELS[latest.category]} ID not verified`;
    body = `${latest.rejection_reason ?? "Staff couldn't verify it."} Send a new, clear photo to try again.`;
  } else if (expired) {
    icon = Clock;
    tone = "bg-rose-50 text-rose-600";
    title = `${CATEGORY_LABELS[expired.category]} discount expired`;
    body = `It ended on ${formatDate(expired.expires_at)}. Send your current ID to renew it.`;
  }
  const Icon = icon;
  const buttonLabel = active ? "Renew with my new ID" : rejected || expired ? "Send a new ID" : "Apply for the discount";

  return (
    <section className="card p-4 space-y-3" aria-label="Fare discount">
      <div className="flex gap-3">
        <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${tone}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-ink-600">{body}</p>
        </div>
      </div>

      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {info.can_apply && !formOpen && (
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
            setSuccess("");
          }}
          className="w-full rounded-xl border border-brand-green-600 text-brand-green-600 hover:bg-brand-green-500/10 font-display font-semibold text-sm py-2.5"
        >
          {buttonLabel}
        </button>
      )}

      {info.can_apply && formOpen && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <DiscountIdFields value={form} onChange={setForm} types={ID_TYPES} inputClass="input" />
          <InlineAlert message={error} onDismiss={() => setError("")} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className="flex-1 rounded-xl border border-slate-200 font-display font-semibold text-sm py-2.5 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-60 text-white font-display font-semibold text-sm py-2.5"
            >
              {isSubmitting ? "Sending…" : "Send ID"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
