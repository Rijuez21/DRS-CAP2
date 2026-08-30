export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-12 px-6 rounded-2xl border border-dashed border-slate-200 bg-white/60">
      {Icon && (
        <Icon className="w-8 h-8 text-brand-green-600 mb-1" strokeWidth={1.5} />
      )}
      <p className="font-display font-semibold text-ink-900">{title}</p>
      {description && (
        <p className="text-sm text-ink-600 max-w-xs">{description}</p>
      )}
      {action}
    </div>
  );
}