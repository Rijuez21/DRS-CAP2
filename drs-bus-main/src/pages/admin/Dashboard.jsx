import { useEffect, useState } from "react";
import { Bus, CalendarClock, Ticket } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as api from "../../lib/api";
import InlineAlert from "../../components/common/InlineAlert";
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

// Table 4's Dashboard and Reporting: metric cards + recent-activity feed
// (from audit_log) + a trend chart. Reuses recharts rather than adding a
// second charting library (Phase 5's ReportsAnalytics.jsx uses the same one).
export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getDashboardSummary().then(setSummary).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="p-6"><InlineAlert type="error" message={error} /></div>;
  if (!summary) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  const cards = [
    { icon: Bus, label: "Active Fleet", value: summary.activeFleetCount },
    { icon: CalendarClock, label: "Today's Trips", value: summary.todaysTripCount },
    { icon: Ticket, label: "Reservations (This Week)", value: summary.reservationsThisWeek },
  ];

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-gray-500">Fleet, trips, and reservations at a glance.</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ icon: Icon, label, value, alert }) => (
          <div key={label} className={`rounded-xl border p-4 bg-white ${alert ? "border-rose-300" : "border-slate-200"}`}>
            <Icon className={`w-5 h-5 mb-2 ${alert ? "text-rose-600" : "text-emerald-700"}`} />
            <p className={`text-2xl font-bold ${alert ? "text-rose-600" : ""}`}>{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-sm mb-3">Reservations — Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={summary.dailyReservationTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tickFormatter={(d) => formatDate(d)} fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip labelFormatter={(d) => formatDate(d)} />
              <Line type="monotone" dataKey="count" stroke="#2f9e5c" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-sm mb-3">Recent Activity</h2>
          <ul className="space-y-3 text-sm max-h-56 overflow-y-auto">
            {summary.recentActivity.length === 0 && <li className="text-gray-400">No activity yet.</li>}
            {summary.recentActivity.map((a) => (
              <li key={a.audit_id} className="flex flex-col">
                <span>
                  <span className="font-semibold">{a.staff_name}</span> {describeActivity(a)}
                </span>
                <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
