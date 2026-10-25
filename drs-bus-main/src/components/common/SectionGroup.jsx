import { useState } from "react";
import { ChevronDown } from "lucide-react";

// A titled, collapsible chunk of a list — "everything from Baguio", "this
// departure's bookings". Replaces one long table with sections people can
// scan, and fold away once they are done with them.
//
//   title      main label (e.g. "Baguio City")
//   subtitle   one quiet line under it
//   count      number shown in the pill beside the title
//   aside      anything on the right of the header (a badge, a total)
//   icon       lucide icon for the tile at the left of the header
//   children   the section body
export default function SectionGroup({ id, title, subtitle, count, countLabel, aside, icon: Icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `${id}-body`;

  return (
    <section className="panel overflow-hidden" aria-labelledby={id}>
      <h2 id={id} className="m-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="w-full flex items-center gap-3 px-4 py-3 text-left bg-linear-to-r from-brand-green-500/8 to-transparent hover:from-brand-green-500/14 transition-colors"
        >
          {Icon && (
            <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center" aria-hidden="true">
              <Icon className="w-4.5 h-4.5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-display text-base font-bold text-ink-900 break-words">{title}</span>
              {count != null && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/6 text-xs font-semibold text-slate-600 tabular-nums">
                  {count} {countLabel}
                </span>
              )}
            </span>
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
          {aside && <span className="hidden sm:inline-flex items-center gap-2 shrink-0">{aside}</span>}
          <ChevronDown className={`w-5 h-5 shrink-0 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="border-t border-slate-100">
          {children}
        </div>
      )}
    </section>
  );
}
