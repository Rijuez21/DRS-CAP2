import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import * as api from "../../lib/api";
import InlineAlert from "../../components/common/InlineAlert";
import PageHeading from "../../components/common/PageHeading";
import { formatDate } from "../../lib/format";

const REPORT_TYPES = [
  { key: "on-time-performance", label: "On-Time Performance" },
  { key: "fleet-utilization", label: "Fleet Utilization" },
  { key: "reservation-trends", label: "Reservation Trends" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthAgoIso = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Phase 5 — a first-class Reporting and Analytics module: date-range
// picker, one chart per report type, and a CSV export button per report
// (PDF isn't wired up — no PDF-rendering library is installed in this
// project yet, so `format=pdf` intentionally 501s on the backend rather
// than silently producing nothing).
export default function ReportsAnalytics() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [reportType, setReportType] = useState(REPORT_TYPES[0].key);
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Filter changes flag "loading" in their handlers (below), so the old
  // report isn't shown as if it matched the new filters.
  function changeFilter(setter) {
    return (value) => {
      setIsLoading(true);
      setError("");
      setter(value);
    };
  }

  useEffect(() => {
    const params = { from, to };
    const loaders = {
      "on-time-performance": api.getOnTimeReport,
      "fleet-utilization": api.getFleetUtilizationReport,
      "reservation-trends": api.getReservationTrendsReport,
    };
    loaders[reportType](params)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [reportType, from, to]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Reports & Analytics" subtitle="Fleet-wide performance, cost, and reservation trends." />

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Report</span>
          <select value={reportType} onChange={(e) => changeFilter(setReportType)(e.target.value)} className="input max-w-xs">
            {REPORT_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">From</span>
          <input type="date" value={from} onChange={(e) => changeFilter(setFrom)(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">To</span>
          <input type="date" value={to} onChange={(e) => changeFilter(setTo)(e.target.value)} className="input" />
        </label>
        {/* A button, not an <a href>: the export needs the admin's login
            header, which a plain link can't send (it always got a 401). */}
        <button
          type="button"
          onClick={async () => {
            setIsExporting(true);
            setExportError("");
            try {
              await api.downloadReportCsv(reportType, { from, to });
            } catch (err) {
              setExportError(err.message);
            } finally {
              setIsExporting(false);
            }
          }}
          disabled={isExporting}
          className="inline-flex items-center gap-1.5 min-h-10 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold px-4 rounded-lg shadow-sm sm:ml-auto"
        >
          <Download className="w-4 h-4" /> {isExporting ? "Preparing…" : "Export CSV"}
        </button>
      </div>
      {exportError && <p role="alert" className="text-sm text-rose-600 font-medium">{exportError}</p>}

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <section className="panel p-4 sm:p-5">
          <h2 className="font-display font-semibold text-ink-900">{REPORT_TYPES.find((r) => r.key === reportType)?.label}</h2>
          <p className="text-xs text-gray-500 mb-3">
            {formatDate(from)} – {formatDate(to)}
          </p>
          {reportType === "on-time-performance" && <OnTimeChart rows={data} />}
          {reportType === "fleet-utilization" && <UtilizationChart rows={data} />}
          {reportType === "reservation-trends" && <TrendsChart data={data} />}
        </section>
      )}
    </div>
  );
}

function OnTimeChart({ rows }) {
  if (!rows?.length) return <EmptyNote />;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={rows.map((r) => ({ ...r, route: `${r.origin} → ${r.destination}` }))}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="route" fontSize={11} interval={0} angle={-15} textAnchor="end" height={70} />
        <YAxis fontSize={12} unit="%" />
        <Tooltip />
        <Bar dataKey="onTimePercentage" name="On-Time %" fill="#2f9e5c" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function UtilizationChart({ rows }) {
  if (!rows?.length) return <EmptyNote />;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="plate_num" fontSize={12} />
        <YAxis fontSize={12} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="tripsRun" name="Trips Run" fill="#2f9e5c" radius={[4, 4, 0, 0]} />
        <Bar dataKey="idleDays" name="Idle Days" fill="#f0a63a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}


function TrendsChart({ data }) {
  if (!data?.byDay?.length) return <EmptyNote />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data.byDay}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tickFormatter={(d) => formatDate(d)} fontSize={12} />
        <YAxis fontSize={12} allowDecimals={false} />
        <Tooltip labelFormatter={(d) => formatDate(d)} />
        <Line type="monotone" dataKey="count" stroke="#2f9e5c" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyNote() {
  return <p className="text-sm text-gray-400 py-10 text-center">No data for this date range.</p>;
}
