import { useMemo } from "react";
import { LifeBuoy } from "lucide-react";

const SEATS_PER_ROW = 4; // 2 seats · aisle · 2 seats

/**
 * Visual, clickable bus seat map.
 *
 * totalSeats: the bus's real capacity (seats are numbered 1..totalSeats,
 * the same ids the booking API validates). Callers render this only once
 * the trip has loaded — it never shows a placeholder bus.
 *
 * occupiedSeatIds: from GET /api/trips/:id/seats (TripDetail refreshes it
 * every 30s and after a seat conflict; WalkInSales after every sale).
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
    <div className="card p-5">
      {/* the bus body: rounded nose at the top, driver front-left, door front-right */}
      <div className="mx-auto w-fit rounded-t-[2.5rem] rounded-b-2xl border-2 border-slate-200 bg-slate-50/70 px-4 sm:px-5 pt-5 pb-5">
        <div className="flex items-end justify-between mb-5 pb-4 border-b-2 border-dashed border-slate-200">
          <div className="flex flex-col items-center gap-1">
            <div className="w-9 h-9 rounded-full bg-brand-forest-900 flex items-center justify-center shadow-sm">
              <LifeBuoy className="w-4 h-4 text-brand-sunrise-400" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-600">Driver</p>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-600/70 pb-0.5">Door</p>
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
      </div>

      <Legend />
    </div>
  );
}

function Seat({ id, occupiedSeatIds, selectedSeatIds, onToggleSeat, maxSeats }) {
  const isOccupied = occupiedSeatIds.map(String).includes(String(id));
  const isSelected = selectedSeatIds.map(String).includes(String(id));
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
        // taller than wide with a thick bottom edge, so each reads as a seat
        "w-9 h-10 rounded-t-xl rounded-b-md border border-b-4 flex items-center justify-center text-[11px] font-semibold transition",
        isOccupied
          ? SEAT_STYLES.occupied + " cursor-not-allowed"
          : isSelected
          ? SEAT_STYLES.selected + " scale-105"
          : atLimit
          ? "bg-white border-slate-200 text-slate-300 cursor-not-allowed"
          : SEAT_STYLES.available + " hover:border-brand-green-500 hover:text-brand-green-600 hover:-translate-y-0.5",
      ].join(" ")}
    >
      {id}
    </button>
  );
}

const SEAT_STYLES = {
  available: "bg-white border-slate-200 text-ink-600",
  selected: "bg-brand-green-600 border-brand-green-600 border-b-brand-forest-800 text-white shadow-md shadow-brand-green-600/30",
  occupied: "bg-slate-200/70 border-transparent border-b-slate-300 text-slate-400",
};

function Legend() {
  const items = [
    { label: "Available", className: SEAT_STYLES.available },
    { label: "Selected", className: SEAT_STYLES.selected },
    { label: "Occupied", className: SEAT_STYLES.occupied },
  ];

  return (
    <div className="flex items-center justify-center flex-wrap gap-x-5 gap-y-2 mt-5 pt-4 border-t border-slate-100">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
          <span className={`w-4 h-4 rounded-t-md rounded-b-sm border border-b-[3px] ${i.className}`} />
          {i.label}
        </div>
      ))}
    </div>
  );
}
