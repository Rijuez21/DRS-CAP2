import { useEffect, useState } from "react";
import { Bus, CalendarClock, Ticket } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as api from "../../lib/api";
import InlineAlert from "../../components/common/InlineAlert";
import PageHeading from "../../components/common/PageHeading";
import EmptyState from "../../components/common/EmptyState";
import { initials } from "../../lib/format";
import { formatDate } from "../../lib/format";

// The backend logs raw action codes (create, update, delete, status_change,
// walk_in_sale, counter_payment, verify, reject, pin, unpin) against entity
// types (bus, driver, route, trip, staff, booking, payment, payment_qr).
// Gluing "d" onto the code used to produce "verifyd", "pind", "walk_in_saled"
// — so each code gets its own phrase here, with a readable fallback for any
// code added to the backend later.
const ENTITY_LABEL = {
  bus: "bus",
  driver: "driver",
  route: "route",
  trip: "trip",
  staff: "staff account",
  booking: "booking",
  payment: "payment",
  payment_qr: "payment QR code",
};

function describeActivity({ action, entity_type: entityType, entity_id: entityId }) {
  const entity = ENTITY_LABEL[entityType] ?? (entityType ?? "record").replaceAll("_", " ");
  const ref = entityId ? ` #${entityId}` : "";
  switch (action) {
    case "create": return `added ${entity}${ref}`;
    case "update": return `updated ${entity}${ref}`;
    case "delete": return `deleted ${entity}${ref}`;
    case "status_change": return `changed the status of ${entity}${ref}`;
    case "walk_in_sale": return `sold a walk-in ticket (${entity}${ref})`;
    case "counter_payment": return `took a counter payment for ${entity}${ref}`;
    case "verify": return `verified ${entity}${ref}`;
    case "reject": return `rejected ${entity}${ref}`;
    case "pin": return `pinned the stop on ${entity}${ref}`;
    case "unpin": return `removed the pinned stop from ${entity}${ref}`;
    default: return `${String(action ?? "changed").replaceAll("_", " ")} ${entity}${ref}`;
  }
}

const shortDay = (d) => new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

// Table 4's Dashboard and Reporting: metric cards + recent-activity feed
// (from audit_log) + a trend chart. Reuses recharts rather than adding a
// second charting library (Phase 5's ReportsAnalytics.jsx uses the same one).
export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getDashboardSummary().then(setSummary).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="p-4 sm:p-6"><InlineAlert type="error" message={error} /></div>;
  if (!summary) return <div className="p-4 sm:p-6 text-sm text-gray-500">Loading…</div>;

  const cards = [
    { icon: Bus, label: "Active Fleet", value: summary.activeFleetCount, tone: "bg-brand-green-500/15 text-emerald-700" },
    { icon: CalendarClock, label: "Today's Trips", value: summary.todaysTripCount, tone: "bg-sky-500/15 text-sky-700" },
    { icon: Ticket, label: "Reservations (This Week)", value: summary.reservationsThisWeek, tone: "bg-brand-sunrise-500/20 text-amber-700" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeading title="Dashboard" subtitle="Fleet, trips, and reservations at a glance." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {cards.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="panel p-4 flex items-center gap-4">
            <span className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center ${tone}`}>
              <Icon className="w-6 h-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-3xl font-bold tabular-nums leading-none text-ink-900">{value}</p>
              <p className="text-xs text-gray-500 mt-1.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <section className="panel p-4 sm:p-5">
          <h2 className="font-display font-semibold text-ink-900">Reservations</h2>
          <p className="text-xs text-gray-500 mb-3">Bookings made each day, last 7 days</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={summary.dailyReservationTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip labelFormatter={(d) => formatDate(d)} />
              <Line type="monotone" dataKey="count" stroke="#2f9e5c" strokeWidth={2.5} dot={{ r: 3, fill: "#2f9e5c" }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="panel p-4 sm:p-5">
          <h2 className="font-display font-semibold text-ink-900">Recent activity</h2>
          <p className="text-xs text-gray-500 mb-3">What staff changed lately</p>
          {summary.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="space-y-3 text-sm max-h-64 overflow-y-auto pr-1">
              {summary.recentActivity.map((a) => (
                <li key={a.audit_id} className="flex items-start gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-full bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center text-[11px] font-bold" aria-hidden="true">
                    {initials(a.staff_name)}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span>
                      <span className="font-semibold">{a.staff_name}</span> {describeActivity(a)}
                    </span>
                    <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
