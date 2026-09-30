// stats: [{ label, value, icon? }] — value null shows "—" (still loading).
export default function StatsRow({ stats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map(({ label, value, icon: Icon }) => (
        <div key={label} className="card rounded-2xl p-3.5 sm:p-4 flex flex-col items-center text-center sm:items-start sm:text-left">
          {Icon && (
            <span className="w-8 h-8 rounded-xl bg-brand-green-500/12 text-brand-green-600 flex items-center justify-center mb-2">
              <Icon className="w-4 h-4" />
            </span>
          )}
          <p className="font-display text-2xl font-bold text-ink-900 leading-none">{value ?? "—"}</p>
          <p className="text-[11px] sm:text-xs font-medium text-ink-600 mt-1.5">{label}</p>
        </div>
      ))}
    </div>
  );
}
