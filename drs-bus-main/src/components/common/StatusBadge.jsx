const STATUS_STYLES = {
  scheduled: "bg-brand-green-500/15 text-brand-green-600",
  boarding: "bg-brand-sunrise-500/15 text-brand-sunrise-500",
  "in progress": "bg-sky-500/15 text-sky-600",
  completed: "bg-slate-400/15 text-slate-500",
  cancelled: "bg-rose-500/15 text-rose-600",
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.scheduled;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${style}`}
    >
      {status}
    </span>
  );
}
