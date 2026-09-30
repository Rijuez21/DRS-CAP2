import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// The title block every passenger page opens with, so they all line up:
// optional back link, an icon badge, title + one line of context, and an
// optional right-hand slot (a count, a step indicator).
export default function PageHeader({ back, icon: Icon, title, subtitle, aside, children }) {
  return (
    <div className="space-y-3">
      {back && (
        <Link
          to={back.to}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> {back.label}
        </Link>
      )}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <span className="w-11 h-11 shrink-0 rounded-2xl bg-brand-forest-900 flex items-center justify-center shadow-md shadow-brand-forest-900/20">
              <Icon className="w-5 h-5 text-brand-sunrise-400" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight leading-tight">{title}</h1>
            {subtitle && <p className="text-sm text-ink-600 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      {children}
    </div>
  );
}
