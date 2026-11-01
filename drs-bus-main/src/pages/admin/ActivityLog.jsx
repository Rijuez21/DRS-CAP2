import { useEffect, useState } from "react";
import { History } from "lucide-react";
import * as api from "../../lib/api";
import PageHeading from "../../components/common/PageHeading";
import InlineAlert from "../../components/common/InlineAlert";
import EmptyState from "../../components/common/EmptyState";
import { describeActivity, entityLabel } from "../../lib/activity";
import { formatDateTime, initials } from "../../lib/format";

// Every staff and admin action the backend records (audit_log), newest
// first, 50 per page — the full version of the Dashboard's
// "Recent activity" feed. Filters by person, action, record type and date.
const EMPTY = { staffId: "", action: "", entityType: "", from: "", to: "" };

// Shows the details the backend stored with an entry (reason, amounts…),
// skipping empty values and long nested data.
function detailText(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && (typeof v !== "object" || Array.isArray(v)))
    .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").replaceAll("_", " ").toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(" · ");
}

export default function ActivityLog() {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getAuditLog({ ...filters, page })
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  const set = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const choices = data?.filters ?? { actions: [], entityTypes: [], staff: [] };
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const isFiltered = Object.values(filters).some(Boolean);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Activity Log" subtitle="Everything staff and admins have done in the system, newest first." />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <label className="col-span-2 lg:col-span-1">
          <span className="block text-xs font-medium text-gray-600 mb-1">Who</span>
          <select id="log-staff" className="input" value={filters.staffId} onChange={set("staffId")}>
            <option value="">Everyone</option>
            {choices.staff.map((s) => (
              <option key={s.staff_id} value={s.staff_id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-gray-600 mb-1">Action</span>
          <select id="log-action" className="input" value={filters.action} onChange={set("action")}>
            <option value="">All actions</option>
            {choices.actions.map((a) => (
              <option key={a} value={a}>
                {a.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-gray-600 mb-1">Record</span>
          <select id="log-entity" className="input" value={filters.entityType} onChange={set("entityType")}>
            <option value="">All records</option>
            {choices.entityTypes.map((t) => (
              <option key={t} value={t}>
                {entityLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-gray-600 mb-1">From</span>
          <input id="log-from" type="date" className="input" value={filters.from} onChange={set("from")} />
        </label>
        <label>
          <span className="block text-xs font-medium text-gray-600 mb-1">To</span>
          <input id="log-to" type="date" className="input" value={filters.to} onChange={set("to")} />
        </label>
      </div>
      {isFiltered && (
        <button
          type="button"
          className="text-sm font-semibold text-emerald-700 hover:underline"
          onClick={() => {
            setFilters(EMPTY);
            setPage(1);
          }}
        >
          Clear filters
        </button>
      )}

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {!data ? (
        <div className="h-64 rounded-2xl bg-white border border-slate-100 animate-pulse" aria-busy="true" />
      ) : data.entries.length === 0 ? (
        <EmptyState icon={History} title="Nothing logged" description={isFiltered ? "No activity matches these filters." : "Staff actions appear here as they happen."} />
      ) : (
        <ol className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {data.entries.map((e) => {
            const extra = detailText(e.details);
            return (
              <li key={e.audit_id} className="flex items-start gap-3 px-4 py-3">
                <span className="w-9 h-9 shrink-0 rounded-full bg-violet-100 text-violet-800 flex items-center justify-center text-xs font-bold" aria-hidden="true">
                  {initials(e.staff_name ?? "?")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">{e.staff_name ?? "Deleted account"}</span> {describeActivity(e)}
                  </p>
                  {extra && <p className="text-xs text-gray-500 mt-0.5 break-words">{extra}</p>}
                </div>
                <time className="text-xs text-gray-500 whitespace-nowrap tabular-nums" dateTime={e.created_at}>
                  {formatDateTime(e.created_at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}

      {data && data.total > data.pageSize && (
        <nav className="flex items-center justify-end gap-3 text-sm" aria-label="Pages">
          <span className="text-gray-600">
            Page {page} of {pageCount} · {data.total} entries
          </span>
          <button type="button" className="min-h-11 md:min-h-9 px-3 rounded-lg font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </button>
          <button type="button" className="min-h-11 md:min-h-9 px-3 rounded-lg font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
