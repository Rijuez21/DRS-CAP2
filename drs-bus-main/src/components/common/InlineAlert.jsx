// A lightweight stand-in for a toast: no toast library exists anywhere in
// this codebase yet (every page just shows an inline error/success line —
// see BookingDetails.jsx, LoginForm.jsx), so this keeps that same pattern
// rather than introducing a new dependency for it.
export default function InlineAlert({ type = "error", message, onDismiss }) {
  if (!message) return null;
  const styles = type === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <div role={type === "error" ? "alert" : "status"} className={`flex items-center justify-between gap-3 text-sm font-medium border rounded-lg px-3 py-2 ${styles}`}>
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}
