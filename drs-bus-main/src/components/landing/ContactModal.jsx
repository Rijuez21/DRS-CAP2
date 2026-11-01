import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Modal from "../admin/Modal";
import { TERMINAL, terminalDirectionsUrl } from "../../lib/terminal";

// ── Contact details: edit these ──────────────────────────────────────────
// Anything left as null is simply not shown. Fill in the real details.
const CONTACT = {
  email: "drisingsuntranspo@gmail.com",
  phone: null, // e.g. "0917 123 4567"
  facebook: null, // e.g. "https://www.facebook.com/YourPage"
  hours: null, // e.g. "Daily, 4:00 AM – 8:00 PM"
};

export default function ContactModal({ onClose }) {
  const telHref = CONTACT.phone ? `tel:${CONTACT.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <Modal title="Contact Us" onClose={onClose}>
      <p className="text-sm text-ink-600">Questions about a trip, a booking, or a payment? Reach us any of these ways.</p>

      <ul className="space-y-3">
        <Row icon={MapPin} label="Terminal">
          <span className="block">{TERMINAL.name}</span>
          <span className="block text-ink-600">{TERMINAL.address}</span>
          <a href={terminalDirectionsUrl()} target="_blank" rel="noreferrer" className="text-brand-green-600 font-semibold underline underline-offset-2">
            Get directions
          </a>
        </Row>

        {CONTACT.hours && (
          <Row icon={Clock} label="Office hours">
            {CONTACT.hours}
          </Row>
        )}

        {CONTACT.phone && (
          <Row icon={Phone} label="Phone">
            <a href={telHref} className="text-brand-green-600 font-semibold underline underline-offset-2">
              {CONTACT.phone}
            </a>
          </Row>
        )}

        <Row icon={Mail} label="Email">
          <a
            href={`mailto:${CONTACT.email}?subject=${encodeURIComponent("D' Rising Sun inquiry")}`}
            className="text-brand-green-600 font-semibold underline underline-offset-2 break-all"
          >
            {CONTACT.email}
          </a>
        </Row>

        {CONTACT.facebook && (
          <Row icon={MessageCircle} label="Facebook">
            <a href={CONTACT.facebook} target="_blank" rel="noreferrer" className="text-brand-green-600 font-semibold underline underline-offset-2">
              Message us on Facebook
            </a>
          </Row>
        )}
      </ul>
    </Modal>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <li className="flex gap-3">
      <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center" aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">{label}</p>
        <div className="text-ink-900">{children}</div>
      </div>
    </li>
  );
}