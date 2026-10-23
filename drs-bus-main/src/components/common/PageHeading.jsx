// Title row shared by the admin and staff pages: title + one line of
// context on the left, the page's one primary action on the right — always
// the same spot (Fitts's + Jakob's Law). Stacks on phones.
export default function PageHeading({ title, subtitle, actions }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="text-sm text-ink-600 mt-0.5 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
