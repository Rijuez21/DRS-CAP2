import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, QrCode, Upload, Smartphone, Landmark, Wallet } from "lucide-react";
import * as api from "../../lib/api";
import InlineAlert from "../../components/common/InlineAlert";
import EmptyState from "../../components/common/EmptyState";
import PageHeading from "../../components/common/PageHeading";
import StatusBadge from "../../components/common/StatusBadge";
import { PrimaryButton, TextAction } from "../../components/common/Buttons";
import Modal from "../../components/admin/Modal";
import { RECEIPT_ACCEPT, readImageFile } from "../../lib/image";
import { formatDateTime, PAYMENT_METHOD_LABELS } from "../../lib/format";

const ICONS = { gcash: Smartphone, bank_transfer: Landmark, qr_ph: QrCode };
const EMPTY = { methodType: "gcash", displayName: "GCash", accountName: "", accountNumber: "", bankName: "", instructions: "", qrImage: null, isActive: false, sortOrder: 0 };

// Payment Methods (admin only). The official accounts passengers are told
// to pay — GCash, bank transfer, QR Ph. Nothing here is pre-filled with
// real details: enter the operator's actual account, and only switch a
// method on once it's correct. There's no payment gateway behind any of
// these; staff confirm each payment in Payment Verification.
export default function PaymentSettings() {
  const [methods, setMethods] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, form }
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function load() {
    return api
      .getPaymentMethods({ all: true })
      .then(setMethods)
      .catch((err) => {
        setError(err.message);
        setMethods([]);
      });
  }
  useEffect(() => {
    load();
  }, []);

  function edit(m) {
    setEditing(
      m
        ? {
            id: m.method_id,
            form: {
              methodType: m.method_type,
              displayName: m.display_name,
              accountName: m.account_name ?? "",
              accountNumber: m.account_number ?? "",
              bankName: m.bank_name ?? "",
              instructions: m.instructions ?? "",
              qrImage: m.qr_image,
              isActive: m.is_active,
              sortOrder: m.sort_order,
            },
          }
        : { form: { ...EMPTY } }
    );
  }

  async function toggle(m) {
    setError("");
    setSuccess("");
    try {
      await api.updatePaymentMethod(m.method_id, { isActive: !m.is_active });
      setSuccess(m.is_active ? `${m.display_name} hidden from passengers.` : `${m.display_name} is now shown to passengers.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <PageHeading
        title="Payment Methods"
        subtitle="The official accounts passengers pay for online bookings. Only active methods are shown at checkout."
        actions={
          <>
            <Link to="/admin/payments" className="text-sm font-semibold text-brand-green-600 hover:underline px-1">
              Payment Verification →
            </Link>
            <PrimaryButton icon={Plus} onClick={() => edit(null)}>
              Add method
            </PrimaryButton>
          </>
        }
      />

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      <p className="text-xs text-gray-600 bg-amber-50 border border-amber-300 rounded-xl p-3">
        Double-check every account name and number before activating — passengers send real money here. Changes apply to new checkouts immediately and are recorded in the audit log.
      </p>

      {methods === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : methods.length === 0 ? (
        <EmptyState icon={Wallet} title="No payment methods yet" description="Add your GCash, bank or QR Ph account. Until one is active, passengers are told to pay at the terminal." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {methods.map((m) => {
            const Icon = ICONS[m.method_type] ?? Wallet;
            return (
              <li key={m.method_id} className={`panel panel-hover p-4 space-y-3 ${m.is_active ? "" : "bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center" aria-hidden="true">
                      <Icon className="w-5 h-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900 truncate">{m.display_name}</p>
                      <p className="text-xs text-gray-500">{PAYMENT_METHOD_LABELS[m.method_type]}</p>
                    </div>
                  </div>
                  <StatusBadge status={m.is_active ? "Active" : "Inactive"} label={m.is_active ? "Active" : "Hidden"} />
                </div>
                <dl className="text-sm space-y-0.5 rounded-lg bg-slate-50 px-3 py-2">
                  {m.bank_name && <p>{m.bank_name}</p>}
                  <p>{m.account_name || <span className="text-gray-400">No account name</span>}</p>
                  <p className="font-mono">{m.account_number || <span className="font-sans text-gray-400">No account number</span>}</p>
                  {m.qr_image && <p className="text-xs text-gray-500 inline-flex items-center gap-1"><QrCode className="w-3 h-3" /> QR uploaded</p>}
                </dl>
                <p className="text-xs text-gray-400">
                  Updated {formatDateTime(m.updated_at)}
                  {m.updated_by_name ? ` by ${m.updated_by_name}` : ""}
                </p>
                <div className="flex justify-end gap-1 border-t border-slate-100 pt-2">
                  <TextAction onClick={() => edit(m)}>
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
                  </TextAction>
                  <TextAction onClick={() => toggle(m)} tone={m.is_active ? "danger" : "primary"}>
                    {m.is_active ? "Hide" : "Activate"}
                  </TextAction>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <MethodForm
          initial={editing.form}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.id) await api.updatePaymentMethod(editing.id, payload);
            else await api.createPaymentMethod(payload);
            setEditing(null);
            setSuccess("Payment method saved.");
            load();
          }}
        />
      )}
    </div>
  );
}

function MethodForm({ initial, isNew, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleFile(e) {
    setError("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // No shrinking: re-encoding a QR as JPEG can blur it past scanning.
      set("qrImage", await readImageFile(file, { receipt: true }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const payload = {
        methodType: form.methodType,
        displayName: form.displayName,
        accountName: form.accountName,
        accountNumber: form.accountNumber,
        bankName: form.methodType === "bank_transfer" ? form.bankName : "",
        instructions: form.instructions,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (form.qrImage !== initial.qrImage || isNew) payload.qrImage = form.qrImage;
      await onSave(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isNew ? "Add payment method" : "Edit payment method"}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border bg-white">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-slate-900 text-white font-semibold disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Type</span>
              <select className="input" value={form.methodType} onChange={(e) => set("methodType", e.target.value)}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Name passengers see</span>
              <input className="input" maxLength={100} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="e.g. GCash" />
            </label>
          </div>
          {form.methodType === "bank_transfer" && (
            <label className="space-y-1 text-sm block">
              <span className="font-medium">Bank</span>
              <input className="input" maxLength={100} value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="Bank name" />
            </label>
          )}
          <label className="space-y-1 text-sm block">
            <span className="font-medium">Account name</span>
            <input className="input" maxLength={150} value={form.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder="Exactly as it appears in the app" />
          </label>
          <label className="space-y-1 text-sm block">
            <span className="font-medium">{form.methodType === "gcash" ? "GCash mobile number" : "Account number"}</span>
            <input className="input font-mono" maxLength={60} value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
          </label>
          <label className="space-y-1 text-sm block">
            <span className="font-medium">Instructions</span>
            <textarea
              className="input"
              rows={3}
              maxLength={1000}
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="e.g. Send the exact fare. Put your booking reference in the message. Payments are checked 6 AM – 9 PM."
            />
          </label>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Show to passengers
            </label>
            <label className="flex items-center gap-2">
              Order <input type="number" min={0} max={1000} className="input w-20" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <div className="aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
            {form.qrImage ? (
              <img src={form.qrImage} alt="QR preview" className="w-full h-full object-contain bg-white p-2" />
            ) : (
              <div className="text-center text-gray-400 text-xs px-3">
                <QrCode className="w-8 h-8 mx-auto mb-1" strokeWidth={1.5} /> Optional QR code
              </div>
            )}
          </div>
          <button type="button" onClick={() => fileInput.current?.click()} className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold border rounded-lg py-2 hover:bg-slate-50">
            <Upload className="w-4 h-4" /> {form.qrImage ? "Replace QR" : "Upload QR"}
          </button>
          {form.qrImage && (
            <button type="button" onClick={() => set("qrImage", null)} className="w-full text-xs text-rose-600">
              Remove QR
            </button>
          )}
          <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={handleFile} />
          <p className="text-xs text-gray-500">From your app&apos;s &quot;Receive money&quot; screen. PNG keeps it sharpest — test-scan the preview before saving.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
    </Modal>
  );
}
