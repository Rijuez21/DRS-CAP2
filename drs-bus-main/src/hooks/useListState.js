import { useState } from "react";
import { useSearchParams } from "react-router-dom";

export const PAGE_SIZES = [10, 25, 50];

// Lifecycle order for type: "status" fields, so sorting by status groups
// items the way staff read them (upcoming -> live -> done) instead of A–Z.
// Anything not listed sorts after these, alphabetically.
const STATUS_ORDER = [
  "scheduled", "boarding", "in transit", "completed",
  "reserved", "confirmed", "boarded", "no-show",
  "active", "on leave", "idle", "maintenance", "suspended", "inactive",
  "cancelled",
];

// Search / sort / filter / page state for any list (table, cards, agenda).
// With syncUrl it lives in the query string (q, sort, dir, page, size, plus
// one param per filter key), so a refresh or the back button keeps it;
// otherwise plain state. A page that needs the state itself (e.g. to send a
// filter to the server) calls this hook and hands the result to the list
// component's `state` prop.
export function useListState({ initialSort = null, pageSize = 10, filters = [], syncUrl = false } = {}) {
  const [params, setParams] = useSearchParams();
  const base = {
    search: "",
    sortKey: initialSort?.key ?? null,
    sortDir: initialSort?.dir ?? "asc",
    page: 1,
    pageSize,
    filters: Object.fromEntries(filters.map((f) => [f.key, f.defaultValue ?? ""])),
  };
  const [local, setLocal] = useState(base);
  const state = syncUrl ? fromParams(params, base) : local;

  function update(patch) {
    if (syncUrl) {
      setParams((prev) => toParams(prev, { ...fromParams(prev, base), ...patch }, base), { replace: true });
    } else {
      setLocal((s) => ({ ...s, ...patch }));
    }
  }

  return {
    ...state,
    defaultFilters: base.filters,
    setSearch: (search) => search !== state.search && update({ search, page: 1 }),
    // asc -> desc -> none
    toggleSort: (key) => {
      if (state.sortKey !== key) update({ sortKey: key, sortDir: "asc", page: 1 });
      else if (state.sortDir === "asc") update({ sortDir: "desc", page: 1 });
      else update({ sortKey: null, sortDir: "asc", page: 1 });
    },
    setSort: (sortKey, sortDir = "asc") => update({ sortKey, sortDir, page: 1 }),
    setFilter: (key, value) => update({ filters: { ...state.filters, [key]: value }, page: 1 }),
    clearFilters: () => update({ filters: base.filters, page: 1 }),
    clearAll: () => update({ filters: base.filters, search: "", page: 1 }),
    setPage: (page) => update({ page }),
    setPageSize: (size) => update({ pageSize: size, page: 1 }),
  };
}

function fromParams(params, base) {
  const sort = params.get("sort");
  const size = Number(params.get("size"));
  const page = Number(params.get("page"));
  return {
    search: params.get("q") ?? "",
    sortKey: sort === "none" ? null : sort ?? base.sortKey,
    sortDir: params.get("dir") === "desc" ? "desc" : params.get("dir") === "asc" ? "asc" : base.sortDir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : base.pageSize,
    filters: Object.fromEntries(Object.entries(base.filters).map(([k, d]) => [k, params.get(k) ?? d])),
  };
}

// Only non-default values are written, so a fresh page has a clean URL.
// Params this list doesn't own (e.g. ?submission=) are left alone.
function toParams(prev, s, base) {
  const next = new URLSearchParams(prev);
  const put = (key, value, def) => (value === def || value === "" || value == null ? next.delete(key) : next.set(key, String(value)));
  put("q", s.search, "");
  if (s.sortKey === base.sortKey && s.sortDir === base.sortDir) {
    next.delete("sort");
    next.delete("dir");
  } else {
    next.set("sort", s.sortKey ?? "none");
    if (s.sortKey) next.set("dir", s.sortDir);
    else next.delete("dir");
  }
  put("page", s.page, 1);
  put("size", s.pageSize, base.pageSize);
  for (const [k, d] of Object.entries(base.filters)) {
    if (s.filters[k] === d) next.delete(k);
    else next.set(k, s.filters[k]);
  }
  return next;
}

// A field's raw value for sorting: sortValue, then accessor, then row[key].
export function fieldValue(field, row) {
  if (field.sortValue) return field.sortValue(row);
  if (field.accessor) return field.accessor(row);
  return row[field.key];
}

const isBlank = (v) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

function compare(a, b, type) {
  switch (type) {
    case "number":
      return Number(a) - Number(b);
    case "date":
      return new Date(a).getTime() - new Date(b).getTime();
    case "status": {
      const ia = STATUS_ORDER.indexOf(String(a).toLowerCase());
      const ib = STATUS_ORDER.indexOf(String(b).toLowerCase());
      if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || 0;
      return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
    }
    default:
      return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  }
}

// Tolerant matching (Postel's Law): case-insensitive, and spaces/dashes
// don't matter ("abc 123" finds "ABC-123"). A query that's mostly digits
// also matches phone numbers written differently ("0917 123 4567" finds
// "+63 917-123-4567").
const squash = (s) => String(s).toLowerCase().replace(/[\s\-_.()]/g, "");
const phoneDigits = (s) => String(s).replace(/\D/g, "").replace(/^(63|0)/, "");
function matches(value, q) {
  if (value == null) return false;
  const text = String(value).toLowerCase();
  if (text.includes(q.lower)) return true;
  if (q.squashed && squash(text).includes(q.squashed)) return true;
  return q.digits.length >= 4 && phoneDigits(text).includes(q.digits);
}

// Search -> filters -> sort, all client-side. Blank values always sort last.
// `fields` are the sortable/searchable fields (table columns, or a card
// list's sort options).
export function applyListState(rows, fields, state, { searchKeys = [], filters = [] }) {
  const raw = state.search.trim();
  let out = rows;

  if (raw && searchKeys.length) {
    const q = { lower: raw.toLowerCase(), squashed: squash(raw), digits: /^[\d\s+\-()]+$/.test(raw) ? phoneDigits(raw) : "" };
    out = out.filter((row) => searchKeys.some((k) => matches(typeof k === "function" ? k(row) : row[k], q)));
  }

  for (const f of filters) {
    const value = state.filters[f.key];
    if (f.serverSide || value === (f.defaultValue ?? "")) continue;
    out = out.filter((row) => (f.match ? f.match(row, value) : String(row[f.key]) === value));
  }

  const field = state.sortKey && fields.find((c) => c.key === state.sortKey && c.sortable !== false);
  if (field) {
    const dir = state.sortDir === "desc" ? -1 : 1;
    out = [...out].sort((ra, rb) => {
      const a = fieldValue(field, ra);
      const b = fieldValue(field, rb);
      if (isBlank(a) || isBlank(b)) return isBlank(a) === isBlank(b) ? 0 : isBlank(a) ? 1 : -1;
      return compare(a, b, field.type) * dir;
    });
  }
  return out;
}

// A per-viewer display preference (e.g. Table vs Cards), remembered in this
// browser. Storage can be unavailable (private mode) — then it just isn't
// remembered.
export function useViewPreference(storageKey, fallback) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? fallback;
    } catch {
      return fallback;
    }
  });
  function set(next) {
    setValue(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* not remembered */
    }
  }
  return [value, set];
}
