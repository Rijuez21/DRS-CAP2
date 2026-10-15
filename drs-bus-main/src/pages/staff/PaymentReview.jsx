import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Wallet, AlertTriangle, RefreshCw, Search, Copy, Clock, PlaneTakeoff, Image as ImageIcon, UserCheck } from "lucide-react";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useAuth } from "../../context/AuthContext";
import EmptyState from "../../components/common/EmptyState";
import InlineAlert from "../../components/common/InlineAlert";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";
import PaymentReviewPanel from "../../components/payments/PaymentReviewPanel";
import { formatPeso } from "../../lib/image";
import { formatDateTime, paymentStatusLabel, PAYMENT_METHOD_LABELS } from "../../lib/format";

const POLL_MS = 30000;
const STATUS_FILTERS = [
  { value: "open", label: "To decide" },
  { value: "Pending", label: "Under review" },
  { value: "Escalated", label: "Escalated" },
  { value: "Needs Resubmission", label: "Needs resubmission" },
  { value: "Verified", label: "Verified" },
  { value: "Rejected", label: "Rejected" },
  { value: "Refund Pending", label: "Refund pending" },
  { value: "Refunded", label: "Refunded" },
  { value: "all", label: "All" },
];
const ACTIVITY_LABELS = {
  submitted: "submitted proof",
  resubmitted: "resubmitted proof",
  verified: "verified",
  rejected: "rejected",
  resubmission_requested: "asked for a new receipt",
  escalated: "escalated",
  assigned: "started reviewing",
  unassigned: "released",
  note: "added a note",
  refund_requested: "requested a refund",
  refund_confirmed: "confirmed a refund",
  refund_cancelled: "cancelled a refund",
  seat_released: "released an unpaid seat",
};

// Payment Verification — shared by terminal staff (/staff/payments) and
// admins (/admin/payments). Staff check each transfer against the company's
// real GCash / bank records (outside this app), then record the result.
// One row = one transfer (it may cover several seats). Default order puts
// undecided payments for the soonest departures first; "Oldest first"
// works the queue strictly in arrival order.
export default function PaymentReview() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: "open", method: "", from: "", to: "", routeId: "", departingWithinHours: "", sort: "priority", mine: false });
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // debounced search
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const openId = params.get("submission");

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    api.getRoutes().then(setRoutes).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const queue = api
      .getPaymentQueue({
        status: filters.status,
        method: filters.method || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        routeId: filters.routeId || undefined,
        departingWithinHours: filters.departingWithinHours || undefined,
        sort: filters.sort,
        assigned: filters.mine ? "me" : undefined,
        q: query || undefined,
      })
      .then((data) => {
        setRows(data);
        setError("");
      });
    const sum = api.getPaymentSummary().then(setSummary);
    return Promise.all([queue, sum])
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [filters, query]);

  // Initial load + whenever filters change; refresh on a timer and live
  // whenever the server says something changed (new proof, a decision).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
    load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadRef.current();
    }, POLL_MS);
    const socket = getSocket();
    const join = () => socket.emit("subscribe:payments");
    join();
    let pending = null;
    const onChanged = () => {
      clearTimeout(pending);
      pending = setTimeout(() => loadRef.current(), 400);
    };
    socket.on("payments:changed", onChanged);
    socket.on("connect", join);
    return () => {
      clearInterval(id);
      clearTimeout(pending);
      socket.emit("unsubscribe:payments");
      socket.off("payments:changed", onChanged);
      socket.off("connect", join);
    };
  }, []);

  const setFilter = (key, value) => {
    setIsLoading(true);
    setFilters((f) => ({ ...f, [key]: value }));
  };
  const open = (id) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (id) next.set("submission", String(id));
    else next.delete("submission");
    return next;
  });

  const cards = useMemo(
    () =>
      summary
        ? [
            { label: "Awaiting review", value: summary.awaitingReview, tone: "text-amber-700", filter: "Pending" },
            { label: "Being reviewed", value: summary.underReview, tone: "text-sky-700", filter: "Pending" },
            { label: "Escalated", value: summary.escalated, tone: "text-violet-700", filter: "Escalated" },
            { label: "Needs resubmission", value: summary.needsResubmission, tone: "text-orange-700", filter: "Needs Resubmission" },
            { label: "Verified", value: summary.verified, tone: "text-brand-green-600", filter: "Verified" },
            { label: "Rejected", value: summary.rejected, tone: "text-rose-600", filter: "Rejected" },
            { label: "Refund pending", value: summary.refundPending, tone: "text-sky-700", filter: "Refund Pending" },
          ]
        : [],
    [summary]
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Payment Verification</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            Find each transfer in the official GCash / bank records before verifying. A receipt screenshot alone is never proof of payment.
          </p>
        </div>
        {user?.role === "admin" && (
          <Link to="/admin/payment-settings" className="text-sm font-semibold text-brand-green-600 hover:underline">
            Payment methods →
          </Link>
        )}
      </header>

      {summary && (summary.overdue > 0 || summary.departingSoon > 0) && (
        <div className="flex flex-wrap gap-2">
          {summary.departingSoon > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilter("departingWithinHours", String(summary.departureAlertHours));
                setFilter("status", "open");
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-medium px-3 py-2"
            >
              <PlaneTakeoff className="w-4 h-4" /> {summary.departingSoon} unresolved for trips leaving within {summary.departureAlertHours} h
            </button>
          )}
          {summary.overdue > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilter("status", "open");
                setFilter("sort", "oldest");
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium px-3 py-2"
            >
              <Clock className="w-4 h-4" /> {summary.overdue} waiting longer than the {summary.reviewSlaMinutes}-minute target
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => setFilter("status", c.filter)}
            className={`bg-white rounded-lg border px-3 py-2.5 text-left hover:border-slate-300 ${filters.status === c.filter ? "ring-2 ring-slate-900/10" : ""}`}
          >
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`font-display text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter("status", f.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                filters.status === f.value ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Booking ref, name or transaction ref…"
              aria-label="Search payments"
              className="input pl-9"
            />
          </div>
          <select className="input" value={filters.method} onChange={(e) => setFilter("method", e.target.value)} aria-label="Payment method">
            <option value="">All methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select className="input" value={filters.routeId} onChange={(e) => setFilter("routeId", e.target.value)} aria-label="Route">
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.route_id} value={r.route_id}>
                {r.origin} → {r.destination}
              </option>
            ))}
          </select>
          <select className="input" value={filters.departingWithinHours} onChange={(e) => setFilter("departingWithinHours", e.target.value)} aria-label="Departure">
            <option value="">Any departure</option>
            <option value="3">Departing within 3 h</option>
            <option value="6">Within 6 h</option>
            <option value="24">Within 24 h</option>
            <option value="72">Within 3 days</option>
          </select>
          <select className="input" value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} aria-label="Sort">
            <option value="priority">Departing soonest first</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-gray-500">Submitted from</span>
            <input type="date" className="input w-auto" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-gray-500">to</span>
            <input type="date" className="input w-auto" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={filters.mine} onChange={(e) => setFilter("mine", e.target.checked)} /> Assigned to me
          </label>
          <button type="button" onClick={() => load()} className="ml-auto inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-white border animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={query ? Search : Wallet}
              title={query ? `Nothing matches "${query}"` : filters.status === "open" ? "No payments waiting for a decision" : "No payments here"}
              description={filters.status === "open" && !query ? "New proofs appear here automatically." : "Try other filters."}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
                <table className="w-full text-sm min-w-[56rem]">
                  <thead className="bg-slate-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-3">Booking</th>
                      <th className="px-3 py-3">Passenger</th>
                      <th className="px-3 py-3">Trip · seat</th>
                      <th className="px-3 py-3 text-right">Due / claimed</th>
                      <th className="px-3 py-3">Method · ref</th>
                      <th className="px-3 py-3">Submitted</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.submission_id} className="align-top hover:bg-slate-50/60 cursor-pointer" onClick={() => open(r.submission_id)}>
                        <td className="px-3 py-3">
                          {r.seats.map((s) => (
                            <div key={s.payment_id} className="font-mono text-xs font-semibold whitespace-nowrap">
                              {s.booking_reference}
                            </div>
                          ))}
                          <Flags row={r} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium">{r.passenger_name}</div>
                          <div className="text-xs text-gray-400">{r.passenger_phone || r.passenger_email}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          <div className="whitespace-nowrap">
                            {r.seats[0]?.origin} → {r.seats[0]?.destination}
                          </div>
                          <div className="text-xs text-gray-400 whitespace-nowrap">
                            {formatDateTime(r.earliest_departure)} · Seat {r.seats.map((s) => s.seat_number).join(", ")}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="font-semibold">{formatPeso(r.amount_due)}</div>
                          <div className={`text-xs ${r.amount_mismatch ? "text-amber-700 font-semibold" : "text-gray-400"}`}>{r.amount_claimed != null ? formatPeso(r.amount_claimed) : "—"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-xs text-gray-500">{r.method_name ?? r.method_label}</div>
                          <div className="font-mono text-xs whitespace-nowrap">{r.reference_number}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-600 whitespace-nowrap text-xs">{formatDateTime(r.submitted_at)}</td>
                        <td className="px-3 py-3">
                          <PaymentStatusBadge status={r.status} />
                          {r.assigned_to_name && (
                            <div className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1">
                              <UserCheck className="w-3 h-3" /> {r.assigned_to === user?.id ? "You" : r.assigned_to_name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              open(r.submission_id);
                            }}
                            className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${["Pending", "Escalated"].includes(r.status) ? "bg-brand-green-600 hover:bg-brand-green-500 text-white" : "border bg-white"}`}
                          >
                            {["Pending", "Escalated"].includes(r.status) ? "Review" : "Open"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Phone cards */}
              <ul className="md:hidden space-y-2">
                {rows.map((r) => (
                  <li key={r.submission_id}>
                    <button type="button" onClick={() => open(r.submission_id)} className="w-full text-left bg-white rounded-lg border p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold">{r.seats.map((s) => s.booking_reference).join(", ")}</span>
                        <PaymentStatusBadge status={r.status} />
                      </div>
                      <p className="text-sm font-medium">
                        {r.passenger_name} · {formatPeso(r.amount_due)}
                        {r.amount_mismatch && <span className="text-amber-700"> (claims {formatPeso(r.amount_claimed)})</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.seats[0]?.origin} → {r.seats[0]?.destination} · {formatDateTime(r.earliest_departure)} · {r.method_label} {r.reference_number}
                      </p>
                      <Flags row={r} />
                    </button>
                  </li>
                ))}
              </ul>
              {rows.length >= 300 && <p className="text-xs text-gray-400 mt-2">Showing the first 300 — narrow the filters to see more.</p>}
            </>
          )}
        </div>

        <aside className="bg-white rounded-lg border p-3 h-fit">
          <h2 className="text-sm font-semibold mb-2">Recent activity</h2>
          {!summary?.recentActivity?.length ? (
            <p className="text-xs text-gray-400">Nothing yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {summary.recentActivity.map((a) => (
                <li key={a.audit_log_id}>
                  <button
                    type="button"
                    disabled={!a.submission_id}
                    onClick={() => a.submission_id && open(a.submission_id)}
                    className="text-left hover:underline disabled:no-underline"
                  >
                    <span className="font-medium">{a.actor_name}</span> {ACTIVITY_LABELS[a.action] ?? a.action}
                    {a.submission_id ? ` #${a.submission_id}` : a.booking_id ? ` (booking ${a.booking_id})` : ""}
                    {a.new_status ? ` → ${paymentStatusLabel(a.new_status)}` : ""}
                  </button>
                  <div className="text-gray-400">{formatDateTime(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {openId && (
        <PaymentReviewPanel
          key={openId}
          submissionId={Number(openId)}
          user={user}
          onClose={() => open(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}

function Flags({ row }) {
  const flags = [];
  if (row.duplicate_reference_count > 0) flags.push({ icon: Copy, text: "Duplicate ref", tone: "text-amber-700 bg-amber-50" });
  if (row.duplicate_receipt_count > 0) flags.push({ icon: ImageIcon, text: "Same receipt image", tone: "text-amber-700 bg-amber-50" });
  if (row.amount_mismatch) flags.push({ icon: AlertTriangle, text: "Amount mismatch", tone: "text-amber-700 bg-amber-50" });
  if (row.departing_soon) flags.push({ icon: PlaneTakeoff, text: "Departs soon", tone: "text-rose-700 bg-rose-50" });
  if (row.sla_overdue) flags.push({ icon: Clock, text: "Over review target", tone: "text-orange-700 bg-orange-50" });
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {flags.map(({ icon: Icon, text, tone }) => (
        <span key={text} className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 ${tone}`}>
          <Icon className="w-3 h-3" /> {text}
        </span>
      ))}
    </div>
  );
}
