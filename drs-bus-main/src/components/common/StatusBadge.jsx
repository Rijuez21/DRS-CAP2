// One badge for every trip and booking status in the system. Before, only
// trip statuses had colours — every booking status (and "In Transit", which
// was misspelled "in progress" here) fell back to the green "scheduled"
// style, so a No-Show looked exactly like a success.
const STATUS_STYLES = {
  // trips
  scheduled: "bg-brand-green-500/15 text-brand-green-600",
  boarding: "bg-brand-sunrise-500/15 text-brand-sunrise-500",
  "in transit": "bg-sky-500/15 text-sky-600",
  completed: "bg-slate-400/15 text-slate-500",
  cancelled: "bg-rose-500/15 text-rose-600",
  // bookings
  reserved: "bg-brand-sunrise-500/15 text-brand-sunrise-500",
  confirmed: "bg-brand-green-500/15 text-brand-green-600",
  boarded: "bg-sky-500/15 text-sky-600",
  "no-show": "bg-rose-500/15 text-rose-600",
  // flags / issues
  pending: "bg-brand-sunrise-500/15 text-brand-sunrise-500",
  acknowledged: "bg-sky-500/15 text-sky-600",
  open: "bg-rose-500/15 text-rose-600",
  resolved: "bg-slate-400/15 text-slate-500",
  // QR Ph payments ("pending" above covers a payment awaiting review)
  verified: "bg-brand-green-500/15 text-brand-green-600",
  rejected: "bg-rose-500/15 text-rose-600",
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  const style = STATUS_STYLES[status.toLowerCase()] ?? "bg-slate-400/15 text-slate-500";

  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${style}`}>{status}</span>;
}
