import { IdCard, Upload } from "lucide-react";
import { PASSENGER_TYPES, ID_HINTS, DISCOUNT_PERCENT } from "../../lib/discounts";
import { RECEIPT_ACCEPT } from "../../lib/image";

// Passenger type + ID photo, shared by sign-up (LoginForm) and the Profile
// discount card. value = { type, idNumber, file }; type "regular" hides the
// ID fields. `types` limits the choices (Profile leaves out "regular").
export default function DiscountIdFields({ value, onChange, inputClass, types = PASSENGER_TYPES }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const needsId = value.type !== "regular";

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">Passenger type</legend>
        <div className="grid grid-cols-2 gap-2">
          {types.map((t) => (
            <label
              key={t.value}
              className={`flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                value.type === t.value ? "bg-brand-green-600 border-brand-green-600 text-white" : "bg-white border-slate-200 text-ink-900 hover:border-brand-green-500"
              }`}
            >
              <input type="radio" name="passenger-type" value={t.value} checked={value.type === t.value} onChange={() => set({ type: t.value })} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsId && (
        <div className="space-y-3 rounded-2xl border border-brand-green-500/25 bg-brand-green-500/5 p-3.5">
          <p className="flex gap-2 text-xs text-ink-600">
            <IdCard className="w-4 h-4 shrink-0 text-brand-green-600" />
            <span>
              Upload a clear photo of your ID. Terminal staff will check it, and once it&apos;s verified you get {DISCOUNT_PERCENT}% off your own seat.
              {value.type === "student" && " Student discounts are valid for one year, then you send your new ID."}
            </span>
          </p>
          <label className="block text-left">
            <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">ID photo</span>
            <span className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm cursor-pointer hover:border-brand-green-500">
              <Upload className="w-4 h-4 shrink-0 text-brand-green-600" />
              <span className="truncate">{value.file ? value.file.name : "Choose a photo (PNG, JPEG or WebP)"}</span>
              <input type="file" accept={RECEIPT_ACCEPT} className="sr-only" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
            </span>
            <span className="block text-xs text-ink-600 mt-1">{ID_HINTS[value.type]}</span>
          </label>
          <label className="block text-left">
            <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">ID number (optional)</span>
            <input type="text" value={value.idNumber} onChange={(e) => set({ idNumber: e.target.value })} maxLength={50} className={inputClass} />
          </label>
        </div>
      )}
    </div>
  );
}

