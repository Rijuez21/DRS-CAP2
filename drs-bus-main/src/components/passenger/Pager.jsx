import { ChevronLeft, ChevronRight } from "lucide-react";

// Page buttons for the passenger screens: "Showing 6–10 of 23", previous /
// next, and the page numbers (shortened with "…" when there are many).
// Feed it the object from usePagedList(). Hidden when everything fits on
// one page.
export default function Pager({ paged, label = "items" }) {
  const { page, pageCount, total, from, to, goTo } = paged;
  if (pageCount <= 1) return null;

  const arrow =
    "inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 bg-white text-ink-900 hover:border-brand-green-500 disabled:opacity-40 disabled:hover:border-slate-200";

  return (
    <nav className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1" aria-label={`${label} pages`}>
      <p className="text-sm text-ink-600" aria-live="polite">
        Showing {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 1} className={arrow} aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        {pageNumbers(page, pageCount).map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="w-6 text-center text-ink-600" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => goTo(n)}
              aria-current={n === page ? "page" : undefined}
              aria-label={`Page ${n}`}
              className={`w-11 h-11 rounded-xl text-sm font-semibold tabular-nums ${
                n === page ? "bg-brand-forest-900 text-white" : "border border-slate-200 bg-white text-ink-900 hover:border-brand-green-500"
              }`}
            >
              {n}
            </button>
          )
        )}
        <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pageCount} className={arrow} aria-label="Next page">
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

// 1 … 4 5 6 … 12 — first, last, and the pages around the current one.
// Kept short so it fits on a phone.
function pageNumbers(page, count) {
  if (count <= 5) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}
