// Loading placeholders shaped like the content that's coming, instead of
// "Loading…" text.
export function SkeletonRows({ columns = 5, rows = 5 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i}>
      {Array.from({ length: columns }, (_, c) => (
        <td key={c} className="px-4 py-3">
          <div className="h-4 rounded bg-slate-200/70 animate-pulse" />
        </td>
      ))}
    </tr>
  ));
}

export function SkeletonCards({ count = 6, className = "h-32" }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`rounded-xl border bg-white p-4 space-y-3 ${className}`}>
          <div className="h-4 w-1/2 rounded bg-slate-200/70 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-slate-200/60 animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-slate-200/60 animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

export function SkeletonList({ count = 4 }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="h-16 rounded-xl border bg-white animate-pulse" />
      ))}
    </ul>
  );
}
