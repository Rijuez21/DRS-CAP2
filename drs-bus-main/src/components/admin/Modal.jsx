import { useEffect, useId } from "react";
import { X } from "lucide-react";

// Shared by every admin add/edit form (FleetManagement, RouteManagement,
// DriverManagement, TripScheduling, UserManagement)
// so each page only has to describe its fields, not reimplement a dialog.
// It's announced as a dialog with its title, the close button is labelled,
// and Escape closes it — none of which the first version did.
// size="lg" widens it for content that needs room (the bus stop pin map);
// every existing form keeps the default narrow dialog.
export default function Modal({ title, onClose, children, footer, size = "md" }) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-white rounded-2xl shadow-xl w-full ${size === "lg" ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 id={titleId} className="font-display font-bold text-lg">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t bg-slate-50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}
