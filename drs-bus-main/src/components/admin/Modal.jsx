import { X } from "lucide-react";

// Shared by every admin add/edit form (FleetManagement, RouteManagement,
// DriverManagement, TripScheduling, MaintenanceTracking, UserManagement)
// so each page only has to describe its fields, not reimplement a dialog.
export default function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-display font-bold text-lg">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t bg-slate-50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}
