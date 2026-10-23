import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES } from "../../hooks/useListState";

// Bottom-right, like Gmail/Sheets (Jakob's Law): rows per page, where you
// are, previous/next. mode "more" is a "Load more" button instead (agenda).
export default function Pagination({ mode = "pages", page, pageCount, pageSize, total, shown, onPage, onPageSize }) {
  if (mode === "more") {
    if (shown >= total) return null;
    return (
      <div className="flex justify-center">
        <button type="button" onClick={() => onPage(page + 1)} className="min-h-11 px-5 rounded-lg border bg-white text-sm font-semibold hover:bg-slate-50">
          Load more ({total - shown} more)
        </button>
      </div>
    );
  }

  const btn = "inline-flex items-center gap-1 min-h-11 md:min-h-10 px-3 rounded-lg border bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white";
  return (
    <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-gray-600" aria-label="Pagination">
      <label className="flex items-center gap-2">
        <span>Rows per page</span>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="input min-h-11 md:min-h-10 w-auto bg-white">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <span aria-live="polite">
            Page {page} of {pageCount}
          </span>
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={btn} aria-label="Previous page">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">Prev</span>
          </button>
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} className={btn} aria-label="Next page">
            <span className="hidden sm:inline">Next</span> <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}
