import { createPortal } from "react-dom";
import Modal from "../admin/Modal";

// In-app replacement for window.confirm(), which shows the browser's own
// box headed with the site's address ("…trycloudflare.com says") and can't
// be styled. The safe choice has focus, so Enter or Escape never gives
// something up by accident; while `busy` the dialog can't be dismissed.
//
// Rendered into <body>: inside a .page-enter page the animation's leftover
// transform would pin the "fixed" overlay to the (tall) page instead of the
// screen, and z-[2000] keeps it above Leaflet's map panes (z-index 400–1000).
//
// props:
//   title          the question, e.g. "Cancel this booking?"
//   children       what happens if they go ahead
//   confirmLabel   e.g. "Cancel booking"
//   cancelLabel    e.g. "Keep my booking"
//   busyLabel      shown on the confirm button while `busy`
//   tone           "danger" (default) or "primary"
//   onConfirm()  / onCancel()
export default function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Go back", busyLabel, tone = "danger", busy = false, onConfirm, onCancel }) {
  const close = busy ? undefined : onCancel;
  return createPortal(
    <div className="relative z-[2000]">
      <Modal
        title={title}
        onClose={close}
        footer={
          <>
            <button
              type="button"
              autoFocus
              onClick={close}
              disabled={busy}
              className="min-h-11 px-4 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-ink-900 hover:bg-slate-50 disabled:opacity-60"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`min-h-11 px-4 text-sm font-semibold rounded-lg text-white disabled:opacity-60 ${
                tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-green-600 hover:bg-brand-green-500"
              }`}
            >
              {busy && busyLabel ? busyLabel : confirmLabel}
            </button>
          </>
        }
      >
        <div className="text-sm text-ink-600 space-y-2">{children}</div>
      </Modal>
    </div>,
    document.body
  );
}
