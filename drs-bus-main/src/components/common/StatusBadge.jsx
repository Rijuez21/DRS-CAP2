import { ArrowUpCircle, CheckCircle2, Circle, CircleDot, Clock, XCircle } from "lucide-react";

// One badge for every trip and booking status in the system. Before, only
// trip statuses had colours — every booking status (and "In Transit", which
// was misspelled "in progress" here) fell back to the green "scheduled"
// style, so a No-Show looked exactly like a success.
const STATUS_STYLES = {
  // trips
  scheduled: "bg-brand-green-500/15 text-emerald-700",
  boarding: "bg-brand-sunrise-500/15 text-amber-700",
  "in transit": "bg-sky-500/15 text-sky-700",
  completed: "bg-slate-400/15 text-slate-600",
  cancelled: "bg-rose-500/15 text-rose-700",
  // bookings
  reserved: "bg-brand-sunrise-500/15 text-amber-700",
  confirmed: "bg-brand-green-500/15 text-emerald-700",
  boarded: "bg-sky-500/15 text-sky-700",
  "no-show": "bg-rose-500/15 text-rose-700",
  // flags / issues
  pending: "bg-brand-sunrise-500/15 text-amber-700",
  acknowledged: "bg-sky-500/15 text-sky-700",
  open: "bg-rose-500/15 text-rose-700",
  resolved: "bg-slate-400/15 text-slate-600",
  // QR Ph payments ("pending" above covers a payment awaiting review)
  verified: "bg-brand-green-500/15 text-emerald-700",
  rejected: "bg-rose-500/15 text-rose-700",
  "under review": "bg-brand-sunrise-500/15 text-amber-700",
  "awaiting payment": "bg-slate-400/15 text-slate-600",
  "needs resubmission": "bg-orange-500/15 text-orange-700",
  escalated: "bg-violet-500/15 text-violet-700",
  "refund pending": "bg-sky-500/15 text-sky-700",
  refunded: "bg-slate-400/15 text-slate-600",
  mixed: "bg-slate-400/15 text-slate-600",
  // buses, drivers, routes
  active: "bg-brand-green-500/15 text-emerald-700",
  inactive: "bg-slate-400/15 text-slate-600",
  idle: "bg-slate-400/15 text-slate-600",
  maintenance: "bg-brand-sunrise-500/15 text-amber-700",
  "on leave": "bg-brand-sunrise-500/15 text-amber-700",
  suspended: "bg-rose-500/15 text-rose-700",
  // trips on sale
  "sold out": "bg-rose-500/15 text-rose-700",
  full: "bg-rose-500/15 text-rose-700",
};

// Colour is never the only signal: each colour family has its own icon
// (good / waiting / problem / in progress / escalated / neutral).
function StatusIcon({ style }) {
  const cls = "w-3.5 h-3.5 shrink-0";
  if (style.includes("rose")) return <XCircle className={cls} aria-hidden="true" />;
  if (style.includes("brand-green") || style.includes("emerald")) return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (style.includes("sunrise") || style.includes("orange")) return <Clock className={cls} aria-hidden="true" />;
  if (style.includes("sky")) return <CircleDot className={cls} aria-hidden="true" />;
  if (style.includes("violet")) return <ArrowUpCircle className={cls} aria-hidden="true" />;
  return <Circle className={cls} aria-hidden="true" />;
}

// label: optional display text (e.g. payment 'Pending' shown as "Under
// review") — the colour still follows the label.
export default function StatusBadge({ status, label }) {
  if (!status) return null;
  const text = label ?? status;
  const style = STATUS_STYLES[text.toLowerCase()] ?? STATUS_STYLES[status.toLowerCase()] ?? "bg-slate-400/15 text-slate-600";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${style}`}>
      <StatusIcon style={style} />
      {text}
    </span>
  );
}
