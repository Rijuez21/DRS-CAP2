import { Loader2 } from "lucide-react";

// One set of buttons for every admin/staff page (Law of Similarity: the
// same action always looks the same). Touch targets are 44px on phones
// (Fitts's Law); desktop rows stay compact.

export function Spinner({ className = "w-4 h-4" }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
}

// The page's one primary action ("Add …"), always top-right of the title.
export function PrimaryButton({ icon: Icon, children, onClick, className = "bg-emerald-700 hover:bg-emerald-600" }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-lg text-white text-sm font-semibold shadow-sm ${className}`}>
      {Icon && <Icon className="w-4 h-4" aria-hidden="true" />} {children}
    </button>
  );
}

// Modal Save: disabled with a spinner while the request runs (Doherty
// Threshold — the click is acknowledged immediately).
export function SubmitButton({ form, isSaving, children = "Save", savingLabel = "Saving…", className = "bg-emerald-700 hover:bg-emerald-600" }) {
  return (
    <button
      type="submit"
      form={form}
      disabled={isSaving}
      aria-busy={isSaving}
      className={`inline-flex items-center justify-center gap-2 min-h-11 px-4 text-sm font-semibold text-white disabled:opacity-60 rounded-lg ${className}`}
    >
      {isSaving && <Spinner />}
      {isSaving ? savingLabel : children}
    </button>
  );
}

export function CancelButton({ onClick, children = "Cancel" }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 px-4 text-sm font-semibold text-gray-600 rounded-lg hover:bg-slate-100">
      {children}
    </button>
  );
}

// Icon-only row action: always has a tooltip + aria-label.
export function IconAction({ icon: Icon, label, onClick, tone = "default", disabled, title }) {
  const hover = tone === "danger" ? "hover:text-rose-600" : "hover:text-emerald-700";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg text-gray-500 hover:bg-slate-100 disabled:opacity-50 ${hover}`}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

// Labelled row action ("Edit", "Open"): preferred over icon-only.
export function TextAction({ children, onClick, tone = "default", disabled, busy = false }) {
  const color = tone === "danger" ? "text-rose-600 hover:bg-rose-50" : tone === "primary" ? "bg-emerald-700 text-white hover:bg-emerald-600" : "text-emerald-700 hover:bg-emerald-50";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 min-h-11 md:min-h-9 px-3 rounded-lg text-sm font-semibold disabled:opacity-50 ${color}`}
    >
      {busy && <Spinner className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}
