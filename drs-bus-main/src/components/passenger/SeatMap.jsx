import { useMemo } from "react";
import { Circle } from "lucide-react";

const SEATS_PER_ROW = 4; // 2 seats · aisle · 2 seats

/**
 * Visual, clickable bus seat map.
 *
 * totalSeats drives the layout only — it's bus capacity, not booking
 * data, so a sensible default (52, standard coach) keeps this usable
 * before the backend is wired up.
 *
 * occupiedSeatIds: TODO — populate from GET /api/trips/:id/seats
 */
export default function SeatMap({
  totalSeats = 52,
  occupiedSeatIds = [],
  selectedSeatIds,
  onToggleSeat,
  maxSeats = 6,
}) {
  const rows = useMemo(() => {
    const fullRows = Math.floor(totalSeats / SEATS_PER_ROW);
    const remainder = totalSeats % SEATS_PER_ROW;
    const layout = Array.from({ length: fullRows }, () => SEATS_PER_ROW);
    if (remainder) layout.push(remainder);
    return layout;
  }, [totalSeats]);

  let seatCounter = 0;

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
      <div className="flex flex-col items-center mb-4">
        <div className="w-9 h-9 rounded-full bg-brand-forest-900 flex items-center justify-center">
          <Circle className="w-3.5 h-3.5 text-brand-sunrise-400 fill-brand-sunrise-400" />
        </div>
        <p className="text-xs text-ink-600 mt-1">Driver</p>
      </div>

      <div className="space-y-2.5">
        {rows.map((count, rowIndex) => {
          const seats = Array.from({ length: count }, () => {
            seatCounter += 1;
            return seatCounter;
          });
          const mid = Math.ceil(count / 2);
          const left = seats.slice(0, mid);
          const right = seats.slice(mid);

          return (
            <div key={rowIndex} className="flex items-center justify-center gap-4">
              <div className="flex gap-2">
                {left.map((id) => (
                  <Seat
                    key={id}
                    id={id}
                    occupiedSeatIds={occupiedSeatIds}
                    selectedSeatIds={selectedSeatIds}
                    onToggleSeat={onToggleSeat}
                    maxSeats={maxSeats}
                  />
                ))}
              </div>
              <div className="w-4" aria-hidden="true" />
              <div className="flex gap-2">
                {right.map((id) => (
                  <Seat
                    key={id}
                    id={id}
                    occupiedSeatIds={occupiedSeatIds}
                    selectedSeatIds={selectedSeatIds}
                    onToggleSeat={onToggleSeat}
                    maxSeats={maxSeats}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Legend />
    </div>
  );
}

function Seat({ id, occupiedSeatIds, selectedSeatIds, onToggleSeat, maxSeats }) {
  const isOccupied = occupiedSeatIds.includes(id);
  const isSelected = selectedSeatIds.includes(id);
  const atLimit = !isSelected && selectedSeatIds.length >= maxSeats;

  return (
    <button
      type="button"
      disabled={isOccupied || atLimit}
      onClick={() => onToggleSeat(id)}
      aria-pressed={isSelected}
      aria-label={`Seat ${id}${
        isOccupied ? ", occupied" : isSelected ? ", selected" : ", available"
      }`}
      className={[
        "w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-colors",
        isOccupied
          ? "bg-slate-100 text-slate-300 cursor-not-allowed"
          : isSelected
          ? "bg-brand-green-600 text-white"
          : atLimit
          ? "bg-white border border-slate-200 text-slate-300 cursor-not-allowed"
          : "bg-white border border-slate-200 text-ink-600 hover:border-brand-green-500 hover:text-brand-green-600",
      ].join(" ")}
    >
      {id}
    </button>
  );
}

function Legend() {
  const items = [
    { label: "Available", className: "border border-slate-200 bg-white" },
    { label: "Selected", className: "bg-brand-green-600" },
    { label: "Occupied", className: "bg-slate-100" },
  ];

  return (
    <div className="flex items-center justify-center gap-4 mt-5 pt-4 border-t border-slate-100">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5 text-xs text-ink-600">
          <span className={`w-3.5 h-3.5 rounded ${i.className}`} />
          {i.label}
        </div>
      ))}
    </div>
  );
}
