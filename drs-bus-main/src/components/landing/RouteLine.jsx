import { Bus } from "lucide-react";

// The Halsema line drawn to scale, with real km posts and stop names from
// the fare table (server/src/db/data/baguio-bontoc-fare-matrix.json).
// Edit STOPS to show different stops; km sets where each one sits.
const STOPS = [
  { km: 0, name: "Baguio City", note: "Terminal" },
  { km: 53, name: "Highest Point" },
  { km: 57, name: "Baguingey" },
  { km: 73, name: "Buguias Jct." },
  { km: 85, name: "Abatan" },
  { km: 129, name: "Sabangan" },
  { km: 146, name: "Bontoc" },
  { km: 151, name: "Sagada" },
];
const LAST_KM = STOPS[STOPS.length - 1].km;
const pct = (km) => `${(km / LAST_KM) * 100}%`;

export default function RouteLine() {
  return (
    <figure className="m-0" aria-label={`Route map: ${STOPS.map((s) => `${s.name}, km ${s.km}`).join("; ")}`}>
      {/* Desktop / tablet: one horizontal line to scale */}
      <div className="hidden sm:block relative h-36" aria-hidden="true">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-brand-forest-900" />
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px border-t-2 border-dashed border-brand-sunrise-400/70" />
        {STOPS.map((s, i) => {
          // Names alternate above / below the road so close stops don't collide;
          // the first and last stop hug the ends instead of hanging off them.
          const above = i % 2 === 1;
          const edge = i === 0 ? "translate-x-0 items-start" : i === STOPS.length - 1 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center";
          return (
            <div key={s.name} className={`absolute top-0 bottom-0 flex flex-col ${edge}`} style={{ left: pct(s.km) }}>
              <span className={`h-1/2 flex flex-col justify-end pb-4 ${above ? "" : "invisible"}`}>
                <span className="text-xs font-semibold text-brand-forest-900 whitespace-nowrap">{s.name}</span>
                <span className="text-[11px] tabular-nums text-ink-600">km {s.km}</span>
              </span>
              <span className={`h-1/2 flex flex-col justify-start pt-4 ${above ? "invisible" : ""}`}>
                <span className="text-xs font-semibold text-brand-forest-900 whitespace-nowrap">{s.name}</span>
                <span className="text-[11px] tabular-nums text-ink-600">km {s.km}</span>
              </span>
              <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-surface border-[3px] border-brand-forest-900 ${i === 0 ? "left-0" : i === STOPS.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"}`} />
            </div>
          );
        })}
        <span className="route-bus absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-brand-sunrise-500 text-brand-forest-950 flex items-center justify-center shadow-lg shadow-brand-sunrise-500/40 ring-4 ring-surface">
          <Bus className="w-4 h-4" />
        </span>
      </div>

      {/* Phone: the same stops as a vertical line */}
      <ol className="sm:hidden relative pl-8 space-y-3" aria-hidden="true">
        <span className="absolute left-[11px] top-2 bottom-2 w-1.5 rounded-full bg-brand-forest-900" />
        {STOPS.map((s) => (
          <li key={s.name} className="relative flex items-baseline justify-between gap-3">
            <span className="absolute -left-[26px] top-1 w-3.5 h-3.5 rounded-full bg-surface border-[3px] border-brand-forest-900" />
            <span className="text-sm font-semibold text-brand-forest-900">{s.name}</span>
            <span className="text-xs tabular-nums text-ink-600">km {s.km}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
