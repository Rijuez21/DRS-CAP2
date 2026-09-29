import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode, Upload } from "lucide-react";
import * as api from "../../lib/api";
import InlineAlert from "../../components/common/InlineAlert";
import { IMAGE_ACCEPT, readImageFile } from "../../lib/image";
import { formatDate, formatTime } from "../../lib/format";

// The one QR Ph code every passenger sees at checkout. It's a static image
// of the operator's own GCash / Maya / bank QR (from the app's "Receive" or
// "My QR" screen) — there's no payment gateway, so payments sent to it are
// verified by staff in Online Payments, not detected automatically.
// Uploading again replaces it for everyone immediately.
export default function PaymentSettings() {
  const [current, setCurrent] = useState(undefined); // undefined = loading, null = none yet
  const [qrImage, setQrImage] = useState(null); // newly picked, not saved yet
  const [label, setLabel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPaymentQr()
      .then((row) => {
        if (cancelled) return;
        setCurrent(row);
        setLabel(row?.label ?? "");
        setInstructions(row?.instructions ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setCurrent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(e) {
    setError("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // No shrinking: re-encoding a QR as JPEG can blur it past scanning.
      setQrImage(await readImageFile(file));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const image = qrImage ?? current?.qrImage;
    if (!image) {
      setError("Choose the QR image to upload first.");
      return;
    }
    setIsSaving(true);
    try {
      const saved = await api.updatePaymentQr({ qrImage: image, label: label.trim(), instructions: instructions.trim() });
      setCurrent({ ...saved, updatedAt: new Date().toISOString() });
      setQrImage(null);
      setSuccess("Saved. Passengers now see this QR at checkout.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  const preview = qrImage ?? current?.qrImage;
  const dirty = Boolean(qrImage) || label.trim() !== (current?.label ?? "") || instructions.trim() !== (current?.instructions ?? "");

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Payment QR</h1>
          <p className="text-sm text-gray-500">The QR Ph code passengers scan to pay for online bookings.</p>
        </div>
        <Link to="/admin/payments" className="text-sm font-semibold text-brand-green-600 hover:underline">
          Review payments →
        </Link>
      </header>

      <InlineAlert type="error" message={error} onDismiss={() => setError("")} />
      <InlineAlert type="success" message={success} onDismiss={() => setSuccess("")} />

      {current === undefined ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="bg-white rounded-lg border p-5 grid gap-6 md:grid-cols-[16rem_1fr]">
          <div className="space-y-3">
            <div className="w-64 max-w-full aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
              {preview ? (
                <img src={preview} alt="Payment QR preview" className="w-full h-full object-contain bg-white p-2" />
              ) : (
                <div className="text-center text-gray-400 text-sm px-4">
                  <QrCode className="w-10 h-10 mx-auto mb-2" strokeWidth={1.5} />
                  No QR uploaded yet — passengers are told to pay at the terminal.
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="w-64 max-w-full inline-flex items-center justify-center gap-2 text-sm font-semibold border rounded-lg py-2 hover:bg-slate-50"
            >
              <Upload className="w-4 h-4" /> {current?.qrImage || qrImage ? "Replace QR image" : "Upload QR image"}
            </button>
            <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handleFile} />
            {qrImage && <p className="text-xs text-amber-700">New image selected — not live until you save.</p>}
            {current?.updatedAt && !qrImage && (
              <p className="text-xs text-gray-400">
                Last changed {formatDate(current.updatedAt)}, {formatTime(current.updatedAt)}
                {current.updatedByName ? ` by ${current.updatedByName}` : ""}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="qr-label" className="text-sm font-medium">
                Account label <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="qr-label"
                className="input w-full"
                maxLength={150}
                placeholder="e.g. GCash — Juan Dela Cruz"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <p className="text-xs text-gray-500">Shown under the QR so passengers can check they're paying the right account.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="qr-instructions" className="text-sm font-medium">
                Instructions <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="qr-instructions"
                className="input w-full"
                rows={3}
                maxLength={500}
                placeholder="e.g. Send the exact fare. Payments are checked 6 AM – 9 PM."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Tips</p>
              <p>Use the QR from your GCash / Maya / bank app's "Receive money" or "My QR" screen, saved as an image. PNG keeps it sharpest.</p>
              <p>Crop it close to the code and test-scan the preview with another phone before saving.</p>
              <p>There's no automatic payment detection — staff must check each reference number in Online Payments.</p>
            </div>
            <button
              type="submit"
              disabled={isSaving || !dirty || !preview}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-5 py-2.5"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
