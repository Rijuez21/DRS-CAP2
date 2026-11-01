import Modal from "../admin/Modal";
import { PolicyText } from "../../pages/DataPolicy";

// The Privacy Policy in a pop-up window for the sign-up form.
// Close with X, Escape, a click outside, or "I agree" (which ticks the checkbox).
export default function PolicyModal({ title = "Privacy Policy", onClose, onAgree }) {
  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="min-h-11 px-4 text-sm font-semibold text-gray-600 rounded-lg hover:bg-slate-100">
            Close
          </button>
          {onAgree && (
            <button type="button" onClick={onAgree} className="min-h-11 px-4 text-sm font-semibold text-white rounded-lg bg-brand-forest-900 hover:bg-brand-forest-800">
              I agree
            </button>
          )}
        </>
      }
    >
      <PolicyText />
    </Modal>
  );
}