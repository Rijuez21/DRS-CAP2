import { useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import EmptyState from "./EmptyState";
import Pagination from "./Pagination";
import { PAGE_SIZES, applyListState, useListState } from "../../hooks/useListState";

const SEARCH_DEBOUNCE_MS = 250;

// The shell every admin/staff list shares, whatever it looks like inside
// (table, cards, agenda, queue): a sticky toolbar (search top-left, filters,
// "More filters", sort, "Showing X of Y"), skeleton / empty / no-results
// states, and paging. DataTable and CardGrid are thin wrappers around it.
//
// fields:  sortable/searchable fields [{ key, label, type?, accessor?, sortValue?, sortable? }]
//          type: "text" (default) | "number" | "date" | "status"
// filters: [{ key, label, options: [{ value, label }], type?: "select" | "chips",
//           defaultValue?, allLabel?, match?(row, value), serverSide?, advanced? }]
//          advanced filters sit behind "More filters" (Hick's Law)
// sortControl: "dropdown" (cards/agenda), "phone" (tables: headers sort on
//          desktop, the dropdown only on phones), or "none"
// paging:  "pages" (10/25/50 + prev/next) or "more" ("Load more")
// children(pageRows, { visible }) renders the items.
export default function ListFrame({
  rows,
  fields = [],
  isLoading = false,
  initialSort = null,
  searchKeys = [],
  searchPlaceholder = "Search…",
  filters = [],
  pageSize = 10,
  paging = "pages",
  sortControl = "dropdown",
  emptyState,
  skeleton,
  toolbar,
  syncUrl = false,
  state: externalState,
  children,
}) {
  const own = useListState({ initialSort, pageSize, filters, syncUrl: !externalState && syncUrl });
  const t = externalState ?? own;

  // The box shows keystrokes right away; the list follows after a pause.
  const [searchInput, setSearchInput] = useState(t.search);
  const [seenSearch, setSeenSearch] = useState(t.search);
  if (t.search !== seenSearch) {
    // changed from outside (back button, "Clear")
    setSeenSearch(t.search);
    setSearchInput(t.search);
  }
  const { search, setSearch } = t;
  useEffect(() => {
    if (searchInput === search) return undefined;
    const id = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput, search, setSearch]);

  const isActive = (f) => t.filters[f.key] !== (f.defaultValue ?? "");
  const basic = filters.filter((f) => !f.advanced);
  const advanced = filters.filter((f) => f.advanced);
  const advancedActive = advanced.filter(isActive).length;
  const [showMore, setShowMore] = useState(advancedActive > 0);

  // A few hundred items at most — cheap enough to redo every render.
  const visible = applyListState(rows, fields, t, { searchKeys, filters });
  const pageCount = Math.max(1, Math.ceil(visible.length / t.pageSize));
  const page = Math.min(t.page, pageCount);
  const pageRows = paging === "more" ? visible.slice(0, page * t.pageSize) : visible.slice((page - 1) * t.pageSize, page * t.pageSize);

  const filtersActive = filters.some(isActive);
  const narrowed = filtersActive || t.search.trim() !== "";
  const sortable = fields.filter((f) => f.sortable !== false && f.key !== "actions");

  function clearSearch() {
    setSearchInput("");
    t.setSearch("");
  }

  const toolbarEl = (
    <div className="sticky top-14 lg:top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-surface/95 backdrop-blur-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {searchKeys.length > 0 && (
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder.replace(/…$/, "")}
              className="input min-h-11 md:min-h-10 pl-9 pr-10 bg-white"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {basic.map((f) => (
          <FilterControl key={f.key} filter={f} value={t.filters[f.key]} onChange={(v) => t.setFilter(f.key, v)} />
        ))}

        {advanced.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="inline-flex items-center gap-1.5 min-h-11 md:min-h-10 px-3 rounded-lg border bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            More filters{advancedActive > 0 && ` (${advancedActive})`}
          </button>
        )}

        {sortControl !== "none" && sortable.length > 0 && (
          <select
            aria-label="Sort by"
            value={t.sortKey ? `${t.sortKey}:${t.sortDir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              t.setSort(key || null, dir);
            }}
            className={`input min-h-11 md:min-h-10 w-auto bg-white ${sortControl === "phone" ? "md:hidden" : ""}`}
          >
            <option value="">Sort: default</option>
            {sortable.map((f) => [
              <option key={`${f.key}:asc`} value={`${f.key}:asc`}>
                {f.label} {sortHint(f, "asc")}
              </option>,
              <option key={`${f.key}:desc`} value={`${f.key}:desc`}>
                {f.label} {sortHint(f, "desc")}
              </option>,
            ])}
          </select>
        )}

        {filtersActive && (
          <button type="button" onClick={t.clearFilters} className="min-h-11 md:min-h-10 px-3 text-sm font-semibold text-gray-600 hover:text-gray-900 rounded-lg hover:bg-slate-100">
            Clear filters
          </button>
        )}

        {!isLoading && rows.length > 0 && (
          <span className="text-xs text-gray-500" aria-live="polite">
            Showing {visible.length} of {rows.length}
          </span>
        )}

        {toolbar && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{toolbar}</div>}
      </div>

      {showMore && advanced.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {advanced.map((f) => (
            <FilterControl key={f.key} filter={f} value={t.filters[f.key]} onChange={(v) => t.setFilter(f.key, v)} />
          ))}
        </div>
      )}
    </div>
  );

  let body;
  if (isLoading) body = skeleton;
  else if (rows.length === 0 && !narrowed) body = <EmptyState {...emptyState} />;
  else if (visible.length === 0) {
    body = (
      <EmptyState
        icon={Search}
        title="No results"
        description={t.search.trim() ? `Nothing matches "${t.search.trim()}" with the current filters.` : "Nothing matches the current filters."}
        action={
          <button type="button" onClick={t.clearAll} className="mt-2 min-h-11 px-4 text-sm font-semibold text-brand-green-600 border border-brand-green-600/40 rounded-lg hover:bg-brand-green-500/10">
            Clear search and filters
          </button>
        }
      />
    );
  } else body = children(pageRows, { visible, state: t });

  const showPaging = !isLoading && (paging === "more" ? visible.length > pageRows.length : visible.length > PAGE_SIZES[0]);

  return (
    <div className="space-y-3">
      {(searchKeys.length > 0 || filters.length > 0 || toolbar || sortControl === "dropdown") && toolbarEl}
      {body}
      {showPaging && (
        <Pagination
          mode={paging}
          page={page}
          pageCount={pageCount}
          pageSize={t.pageSize}
          total={visible.length}
          shown={pageRows.length}
          onPage={t.setPage}
          onPageSize={t.setPageSize}
        />
      )}
    </div>
  );
}

function sortHint(field, dir) {
  if (field.type === "date") return dir === "asc" ? "(oldest first)" : "(newest first)";
  if (field.type === "number") return dir === "asc" ? "(low → high)" : "(high → low)";
  return dir === "asc" ? "(A → Z)" : "(Z → A)";
}

function FilterControl({ filter: f, value, onChange }) {
  if (f.type === "chips") {
    return (
      <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label={f.label}>
        {f.options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`px-3 min-h-10 md:min-h-9 text-sm font-medium rounded-md ${value === o.value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={f.label} className="input min-h-11 md:min-h-10 w-auto bg-white">
      {!f.options.some((o) => o.value === (f.defaultValue ?? "")) && <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>}
      {f.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
