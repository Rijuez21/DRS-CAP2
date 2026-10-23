import { useMemo } from "react";
import { LifeBuoy } from "lucide-react";

const SEATS_PER_ROW = 4; // 2 seats · aisle · 2 seats
const BACK_ROW_SEATS = 5; // the back bench: 2 · 1 in the aisle · 2

/**
 * Visual, clickable bus seat map.
 *
 * layout: the bus's own seat layout ({ cols, rows: [[{ t, l }]] } — see
 * server/src/services/seatLayout.js), passed when /api/trips/:id/seats says
 * layoutSource "custom". Drawn cell for cell; seat ids are its labels.
 *
 * Without a layout: the original auto layout from totalSeats (seats
 * numbered 1..totalSeats, 2 · aisle · 2 with a 5-seat back bench), exactly
 * as every bus looked before layouts existed.
 *
 * Seat ids are strings in both cases (onToggleSeat gets "7", "1A", ...).
 * Callers render this only once the trip has loaded — it never shows a
 * placeholder bus.
 *
 * occupiedSeatIds: from GET /api/trips/:id/seats (TripDetail refreshes it
 * every 30s and after a seat conflict; WalkInSales after every sale).
 * readOnly: draw only (the Fleet seat layout editor's preview).
 */
export default function SeatMap({ layout, ...props }) {
  return layout ? <LayoutSeatMap layout={layout} {...props} /> : <AutoSeatMap {...props} />;
}

function AutoSeatMap({
  totalSeats = 52,
  occupiedSeatIds = [],
  selectedSeatIds = [],
  onToggleSeat,
  maxSeats = 6,
  readOnly = false,
}) {
  const rows = useMemo(() => {
    const hasBackRow = totalSeats >= BACK_ROW_SEATS;
    const regularSeats = hasBackRow ? totalSeats - BACK_ROW_SEATS : totalSeats;
    const fullRows = Math.floor(regularSeats / SEATS_PER_ROW);
    const remainder = regularSeats % SEATS_PER_ROW;
    const layout = Array.from({ length: fullRows }, () => SEATS_PER_ROW);
    if (remainder) layout.push(remainder);
    if (hasBackRow) layout.push(BACK_ROW_SEATS);
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
            // the back bench puts its middle seat in the aisle
            const isBackRow = count === BACK_ROW_SEATS;
            const mid = isBackRow ? 2 : Math.ceil(count / 2);
            const left = seats.slice(0, mid);
            const aisle = isBackRow ? seats[mid] : null;
            const right = seats.slice(isBackRow ? mid + 1 : mid);

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
                      readOnly={readOnly}
                    />
                  ))}
                </div>
                {aisle ? (
                  // same footprint as the aisle spacer so the columns stay aligned
                  <div className="w-4 flex justify-center">
                    <Seat
                      id={aisle}
                      occupiedSeatIds={occupiedSeatIds}
                      selectedSeatIds={selectedSeatIds}
                      onToggleSeat={onToggleSeat}
                      maxSeats={maxSeats}
                      readOnly={readOnly}
                    />
                  </div>
                ) : (
                  <div className="w-4" aria-hidden="true" />
                )}
                <div className="flex gap-2">
                  {right.map((id) => (
                    <Seat
                      key={id}
                      id={id}
                      occupiedSeatIds={occupiedSeatIds}
                      selectedSeatIds={selectedSeatIds}
                      onToggleSeat={onToggleSeat}
                      maxSeats={maxSeats}
                      readOnly={readOnly}
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

// A custom layout, drawn cell for cell. Columns that never hold a seat,
// driver or door (the aisle) are narrow, like the auto layout's aisle; the
// grid scrolls inside the card on very narrow phones instead of pushing the
// page sideways.
function LayoutSeatMap({ layout, occupiedSeatIds = [], selectedSeatIds = [], onToggleSeat, maxSeats = 6, readOnly = false }) {
  const columns = useMemo(() => {
    const cols = layout.cols ?? layout.rows[0]?.length ?? 0;
    return Array.from({ length: cols }, (_, c) =>
      layout.rows.some((row) => ["seat", "driver", "door"].includes(row[c]?.t)) ? "2.25rem" : "1rem"
    ).join(" ");
  }, [layout]);

  return (
    <div className="card p-5">
      <div className="max-w-full overflow-x-auto">
        <div className="mx-auto w-fit rounded-t-[2.5rem] rounded-b-2xl border-2 border-slate-200 bg-slate-50/70 px-4 sm:px-5 pt-5 pb-5">
          <div className="grid gap-x-2 gap-y-2.5 justify-center items-center" style={{ gridTemplateColumns: columns }}>
            {layout.rows.map((row, r) =>
              row.map((cell, c) => {
                const key = `${r}-${c}`;
                if (cell.t === "seat") {
                  return (
                    <Seat
                      key={key}
                      id={cell.l}
                      occupiedSeatIds={occupiedSeatIds}
                      selectedSeatIds={selectedSeatIds}
                      onToggleSeat={onToggleSeat}
                      maxSeats={maxSeats}
                      readOnly={readOnly}
                    />
                  );
                }
                if (cell.t === "driver") return <DriverCell key={key} />;
                if (cell.t === "door") return <DoorCell key={key} />;
                // aisle and blank: empty space
                return <div key={key} className="h-10" aria-hidden="true" />;
              })
            )}
          </div>
        </div>
      </div>

      <Legend />
    </div>
  );
}

// Also used by the Fleet layout editor, so its grid looks like the real map.
export function DriverCell() {
  return (
    <div className="w-9 h-10 flex items-center justify-center" role="img" aria-label="Driver">
      <div className="w-8 h-8 rounded-full bg-brand-forest-900 flex items-center justify-center shadow-sm">
        <LifeBuoy className="w-4 h-4 text-brand-sunrise-400" aria-hidden="true" />
      </div>
    </div>
  );
}

export function DoorCell() {
  return (
    <div className="w-9 h-10 rounded-md border-2 border-dashed border-slate-300 flex items-center justify-center" role="img" aria-label="Door">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-600/70">Door</span>
    </div>
  );
}

function Seat({ id, occupiedSeatIds, selectedSeatIds, onToggleSeat, maxSeats, readOnly = false }) {
  const seatId = String(id);
  const isOccupied = occupiedSeatIds.map(String).includes(seatId);
  const isSelected = selectedSeatIds.map(String).includes(seatId);
  const atLimit = !isSelected && selectedSeatIds.length >= maxSeats;

  return (
    <button
      type="button"
      disabled={readOnly || isOccupied || atLimit}
      onClick={() => onToggleSeat?.(seatId)}
      title={seatId.length > 3 ? seatId : undefined}
      aria-pressed={isSelected}
      aria-label={`Seat ${id}${
        isOccupied ? ", occupied" : isSelected ? ", selected" : ", available"
      }`}
      className={[
        // taller than wide with a thick bottom edge, so each reads as a seat
        "w-9 h-10 shrink-0 rounded-t-xl rounded-b-md border border-b-4 flex items-center justify-center text-[11px] font-semibold transition",
        isOccupied
          ? SEAT_STYLES.occupied + " cursor-not-allowed"
          : isSelected
          ? SEAT_STYLES.selected + " scale-105"
          : atLimit
          ? "bg-white border-slate-200 text-slate-300 cursor-not-allowed"
          : readOnly
          ? SEAT_STYLES.available
          : SEAT_STYLES.available + " hover:border-brand-green-500 hover:text-brand-green-600 hover:-translate-y-0.5",
      ].join(" ")}
    >
      {/* labels can be up to 10 characters; long ones shrink and clip (full text in title) */}
      <span className={`block max-w-full px-0.5 truncate ${seatId.length > 3 ? "text-[9px]" : ""}`}>{seatId}</span>
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
