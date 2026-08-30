export default function StatsRow({ stats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-2xl bg-white border border-slate-100 py-4 text-center shadow-sm"
        >
          <p className="font-display text-2xl font-bold text-brand-green-600">
            {s.value ?? "—"}
          </p>
          <p className="text-xs text-ink-600 mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
