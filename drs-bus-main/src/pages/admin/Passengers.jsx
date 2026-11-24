import { useEffect, useState } from "react";
import { UserRound, Ban, RotateCcw, MailCheck } from "lucide-react";
import * as api from "../../lib/api";
import DataTable from "../../components/common/DataTable";
import PageHeading from "../../components/common/PageHeading";
import InlineAlert from "../../components/common/InlineAlert";
import Modal from "../../components/admin/Modal";
import { CancelButton, SubmitButton } from "../../components/common/Buttons";
import OverflowMenu from "../../components/common/OverflowMenu";
import { initials } from "../../lib/format";

// Passenger accounts (GET /api/passengers). Passengers sign themselves up,
// so there's nothing to create here: look someone up, suspend an account
// that's abusing bookings (signed out at once, can't sign in), lift a
// suspension, or confirm an email by hand for someone who can't get the
// code. Same table, toolbar, sorting and paging as the other admin lists:
// every passenger is loaded (the API hands them out 50 at a time) and
// search / filter / sort / paging happen here.
const STATUS_FILTERS = [
  {
    key: "status",
    label: "Status",
    allLabel: "All statuses",
    options: ["Active", "Email not confirmed", "Suspended", "Closed"].map((v) => ({ value: v, label: v })),
    match: (p, value) => statusOf(p).label === value,
  },
];
const MAX_PAGES = 40; // safety stop: 40 × 50 = 2,000 passengers

function statusOf(p) {
  if (p.closed_at) return { label: "Closed", className: "bg-slate-100 text-slate-600" };
  if (p.suspended_at) return { label: "Suspended", className: "bg-rose-100 text-rose-700" };
  if (!p.email_verified) return { label: "Email not confirmed", className: "bg-amber-100 text-amber-800" };
  return { label: "Active", className: "bg-emerald-100 text-emerald-800" };
}

async function loadAllPassengers() {
  const first = await api.getPassengers({ page: 1 });
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(first.total / first.pageSize)));
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.getPassengers({ page: i + 2 })));
  return [first, ...rest].flatMap((r) => r.passengers);
}

export default function AdminPassengers() {
  const [passengers, setPassengers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [suspending, setSuspending] = useState(null); // passenger row
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadAllPassengers()
      .then((rows) => !cancelled && setPassengers(rows))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function act(p, fn, message) {
    setError("");
    setSuccess("");
    setBusyId(p.commuter_id);
    try {
      await fn();
      setSuccess(message);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmSuspend(e) {
    e.preventDefault();
    const p = suspending;
    if (!reason.trim()) return;
    await act(p, () => api.suspendPassenger(p.commuter_id, reason.trim()), `${p.name} was suspended and signed out.`);
    setSuspending(null);
    setReason("");
  }

  // Row actions sit in the "⋯" menu, like the other admin lists.
  function rowActions(p) {
    if (p.closed_at) return null;
    const busy = busyId === p.commuter_id;
    const items = [];
    if (!p.email_verified) {
      items.push({ label: "Confirm email", icon: MailCheck, disabled: busy, onClick: () => act(p, () => api.verifyPassengerEmail(p.commuter_id), `${p.name}'s email was confirmed.`) });
    }
    if (p.suspended_at) {
      items.push({ label: "Lift suspension", icon: RotateCcw, disabled: busy, onClick: () => act(p, () => api.unsuspendPassenger(p.commuter_id), `${p.name} can sign in again.`) });
    } else {
      items.push({ label: "Suspend account", icon: Ban, tone: "danger", disabled: busy, onClick: () => setSuspending(p) });
    }
    return <OverflowMenu label={`More actions for ${p.name}`} items={items} />;
  }

  // Sortable: name, bookings, no-shows, joined, status. Mobile isn't —
  // ordering by it tells you nothing. Email sits under the name.
  const columns = [
    {
      key: "name",
      header: "Passenger",
      primary: true,
      render: (p) => (
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center text-xs font-bold" aria-hidden="true">
            {initials(p.name)}
          </span>
          <span className="min-w-0">
            <span className="block font-medium truncate">{p.name}</span>
            <span className="block text-xs text-gray-500 truncate">{p.closed_at ? "Account closed" : p.email}</span>
            {p.suspended_at && p.suspension_reason && <span className="block text-xs text-rose-700 truncate">Suspended: {p.suspension_reason}</span>}
          </span>
        </span>
      ),
    },
    { key: "phoneno", header: "Mobile", sortable: false, render: (p) => <span className="text-gray-600 whitespace-nowrap">{p.phoneno ?? "—"}</span> },
    { key: "bookings", header: "Bookings", type: "number", render: (p) => <span className="tabular-nums text-gray-600">{p.bookings}</span> },
    {
      key: "no_shows",
      header: "No-shows",
      type: "number",
      render: (p) => <span className={`tabular-nums ${p.no_shows > 0 ? "text-rose-700 font-semibold" : "text-gray-600"}`}>{p.no_shows}</span>,
    },
    { key: "created_at", header: "Joined", type: "date", render: (p) => <span className="text-gray-600 whitespace-nowrap">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span> },
    {
      key: "status",
      header: "Status",
      accessor: (p) => statusOf(p).label,
      render: (p) => {
        const s = statusOf(p);
        return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${s.className}`}>{s.label}</span>;
      },
    },
    { key: "actions", header: "", render: rowActions },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeading title="Passengers" subtitle="Look up passenger accounts, suspend an account that's abusing bookings, or confirm an email by hand." />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <DataTable
        label="Passengers"
        columns={columns}
        rows={passengers}
        rowKey={(p) => p.commuter_id}
        isLoading={isLoading}
        syncUrl
        initialSort={{ key: "created_at", dir: "desc" }}
        pageSize={25}
        searchKeys={["name", "email", "phoneno"]}
        searchPlaceholder="Search name, email or mobile…"
        filters={STATUS_FILTERS}
        rowClassName={(p) => (p.closed_at ? "opacity-60" : "")}
        minWidth="56rem"
        emptyState={{ icon: UserRound, title: "No passengers yet", description: "Passengers appear here once they sign up." }}
      />

      {suspending && (
        <Modal
          title={`Suspend ${suspending.name}?`}
          onClose={() => setSuspending(null)}
          footer={
            <>
              <CancelButton onClick={() => setSuspending(null)} />
              <SubmitButton form="suspend-form" isSaving={busyId === suspending.commuter_id} className="bg-rose-600 hover:bg-rose-500">
                Suspend account
              </SubmitButton>
            </>
          }
        >
          <form id="suspend-form" onSubmit={confirmSuspend} className="space-y-3">
            <p className="text-sm text-gray-600">They&apos;ll be signed out right away and can&apos;t sign in until you lift the suspension. Their existing bookings stay as they are.</p>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Reason (kept in the activity log)</span>
              <textarea id="suspend-reason" required className="input min-h-24" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Repeated fake bookings that were never paid" />
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}
