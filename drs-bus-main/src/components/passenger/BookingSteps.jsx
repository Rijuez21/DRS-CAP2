import { Check } from "lucide-react";

// Where the passenger is in Book Ahead: trip -> seats -> done. Shown on
// TripDetail and BookingConfirmed so a first-time user always knows how
// many steps are left.
const STEPS = ["Choose trip", "Pick seats", "Reserved"];

export default function BookingSteps({ current }) {
  return (
    <ol className="flex items-center gap-2 text-xs font-medium rounded-full bg-white border border-slate-200/80 shadow-sm pl-1.5 pr-3 py-1.5" aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2 min-w-0" aria-current={active ? "step" : undefined}>
            <span
              className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                done
                  ? "bg-brand-green-600 text-white"
                  : active
                  ? "bg-brand-forest-900 text-brand-sunrise-400 ring-4 ring-brand-sunrise-400/25"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={`truncate ${active ? "text-ink-900 font-semibold" : "text-ink-600"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className={`w-4 h-0.5 rounded-full shrink-0 ${done ? "bg-brand-green-600" : "bg-slate-200"}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
