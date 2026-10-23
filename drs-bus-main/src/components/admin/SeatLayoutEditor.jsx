import { useRef, useState } from "react";
import { Armchair, MoveHorizontal, Square, LifeBuoy, DoorOpen, ListOrdered, Rows3 } from "lucide-react";
import SeatMap, { DriverCell, DoorCell } from "../passenger/SeatMap";
import {
  MAX_COLS,
  MAX_ROWS,
  PRESETS,
  aisleColumn,
  layoutProblems,
  legacyLayout,
  moveAisle,
  numberSeats,
  renameSeat,
  resize,
  sameLayout,
  seatCount,
  setCell,
} from "../../lib/seatLayout";

const TOOLS = [
  { type: "seat", label: "Seat", icon: Armchair },
  { type: "aisle", label: "Aisle", icon: MoveHorizontal },
  { type: "blank", label: "Blank", icon: Square },
  { type: "driver", label: "Driver", icon: LifeBuoy },
  { type: "door", label: "Door", icon: DoorOpen },
];
const CELL_NAMES = { seat: "seat", aisle: "aisle", blank: "blank", driver: "driver", door: "door" };

// Visual seat layout editor for the Fleet add/edit bus dialog. Controlled:
// `layout` in, `onChange(layout)` out. Pick a tool from the palette, then
// click cells (or click-and-drag with a mouse) to paint them. With the Seat
// tool, clicking an existing seat selects it so its label can be renamed.
// The preview underneath is the passengers' own SeatMap component.
export default function SeatLayoutEditor({ layout, onChange }) {
  const [tool, setTool] = useState("seat");
  const [selected, setSelected] = useState(null); // { r, c } of the seat being renamed
  const painting = useRef(false);
  const { errors, bad } = layoutProblems(layout);
  const total = seatCount(layout);
  const aisle = aisleColumn(layout);
  // A layout identical to the auto one is previewed (and saved) as the auto
  // layout, so the preview shows exactly what passengers will see.
  const looksLegacy = total > 0 && sameLayout(layout, legacyLayout(total));
  const selectedCell = selected && layout.rows[selected.r]?.[selected.c]?.t === "seat" ? layout.rows[selected.r][selected.c] : null;

  function paint(r, c, { fromDrag = false } = {}) {
    const current = layout.rows[r][c];
    if (tool === "seat" && current.t === "seat") {
      if (!fromDrag) setSelected({ r, c });
      return;
    }
    const next = setCell(layout, r, c, tool);
    if (next !== layout) onChange(next);
    if (tool === "seat" && !fromDrag) setSelected({ r, c });
  }

  // Click-and-drag painting with a mouse or pen. Touch keeps plain taps so
  // the grid can still be scrolled with a finger.
  function cellFromPoint(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-cell]");
    if (!el) return null;
    const [r, c] = el.dataset.cell.split("-").map(Number);
    return { r, c };
  }
  function onPointerDown(e) {
    if (e.pointerType === "touch") return;
    painting.current = true;
  }
  function onPointerMove(e) {
    if (!painting.current || e.buttons !== 1) return;
    const hit = cellFromPoint(e);
    if (hit && layout.rows[hit.r][hit.c].t !== tool) paint(hit.r, hit.c, { fromDrag: true });
  }
  const stopPainting = () => {
    painting.current = false;
  };

  return (
    <div className="space-y-4">
      {/* quick start */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Quick start</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelected(null);
                onChange(p.make());
              }}
              className="min-h-9 px-3 rounded-lg border bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* size + aisle */}
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Rows" value={layout.rows.length} min={1} max={MAX_ROWS} onChange={(n) => onChange(resize(layout, n, layout.cols))} />
        <NumberField label="Columns" value={layout.cols} min={1} max={MAX_COLS} onChange={(n) => onChange(resize(layout, layout.rows.length, n))} />
        <label className="block">
          <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Aisle</span>
          <select value={aisle} onChange={(e) => onChange(moveAisle(layout, Number(e.target.value)))} className="input h-10">
            <option value={-1}>None</option>
            {Array.from({ length: layout.cols }, (_, c) => (
              <option key={c} value={c}>
                Column {c + 1}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* palette */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Paint with</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cell type to paint">
          {TOOLS.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={tool === type}
              onClick={() => setTool(type)}
              className={`inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg border text-xs font-semibold ${
                tool === type ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1.5">Click a cell to paint it (drag with a mouse to paint several). With Seat selected, click a seat to rename it.</p>
      </div>

      {/* the grid */}
      <div className="max-w-full overflow-x-auto rounded-lg border bg-slate-50/70 p-3">
        <div
          className="grid gap-1.5 w-fit mx-auto select-none"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, 2.5rem)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopPainting}
          onPointerLeave={stopPainting}
        >
          {layout.rows.map((row, r) =>
            row.map((cell, c) => {
              const id = `${r}-${c}`;
              const isSelected = selected?.r === r && selected?.c === c && cell.t === "seat";
              const isBad = bad.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  data-cell={id}
                  onClick={() => paint(r, c)}
                  aria-label={`Row ${r + 1}, column ${c + 1}, ${cell.t === "seat" ? `seat ${cell.l || "(no label)"}` : CELL_NAMES[cell.t]}`}
                  className={`w-10 h-10 rounded-md flex items-center justify-center text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 ${cellStyle(cell.t)} ${
                    isBad ? "ring-2 ring-rose-500" : isSelected ? "ring-2 ring-brand-green-600" : ""
                  }`}
                >
                  {cell.t === "seat" ? (
                    <span className={`block max-w-full px-0.5 truncate ${String(cell.l).length > 3 ? "text-[9px]" : ""}`}>{cell.l || "?"}</span>
                  ) : cell.t === "driver" ? (
                    <span className="scale-90 pointer-events-none" aria-hidden="true"><DriverCell /></span>
                  ) : cell.t === "door" ? (
                    <span className="scale-90 pointer-events-none" aria-hidden="true"><DoorCell /></span>
                  ) : cell.t === "aisle" ? (
                    <span className="text-slate-300" aria-hidden="true">·</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* rename + numbering */}
      <div className="flex flex-wrap items-end gap-2">
        {selectedCell && (
          <label className="block">
            <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Seat label (row {selected.r + 1}, column {selected.c + 1})
            </span>
            <input
              value={selectedCell.l}
              maxLength={10}
              autoFocus
              onChange={(e) => onChange(renameSeat(layout, selected.r, selected.c, e.target.value.replace(/\s/g, "")))}
              className="input h-10 w-36"
            />
          </label>
        )}
        <button type="button" onClick={() => onChange(numberSeats(layout, "sequential"))} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border bg-white text-xs font-semibold hover:bg-slate-50">
          <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" /> Auto-number (1, 2, 3…)
        </button>
        <button type="button" onClick={() => onChange(numberSeats(layout, "byRow"))} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border bg-white text-xs font-semibold hover:bg-slate-50">
          <Rows3 className="w-3.5 h-3.5" aria-hidden="true" /> Number by row (1A, 1B…)
        </button>
      </div>

      <p className="text-sm font-semibold" aria-live="polite">
        Total seats: <span className="text-brand-green-600">{total}</span>
        <span className="font-normal text-gray-500"> — this is the bus's capacity</span>
      </p>

      {errors.length > 0 && (
        <ul className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 space-y-0.5" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {/* what passengers and staff will see */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Preview — what passengers see</p>
        {total > 0 ? (
          <SeatMap layout={looksLegacy ? undefined : layout} totalSeats={total} readOnly />
        ) : (
          <p className="text-sm text-gray-500">Add seats to see the preview.</p>
        )}
      </div>
    </div>
  );
}

function cellStyle(type) {
  switch (type) {
    case "seat":
      return "bg-white border border-b-4 border-slate-300 text-ink-600 hover:border-brand-green-500";
    case "aisle":
      return "bg-transparent border border-dashed border-slate-200 hover:border-slate-400";
    case "driver":
    case "door":
      return "bg-white/60 border border-slate-200 hover:border-slate-400 overflow-hidden";
    default:
      return "bg-slate-200/60 border border-transparent hover:border-slate-400";
  }
}

// Applied on Enter / leaving the field, not per keystroke: typing "12"
// would otherwise shrink the bus to 1 row (losing seats) on the way.
function NumberField({ label, value, min, max, onChange }) {
  const [draft, setDraft] = useState(null);
  function commit() {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(n) && n !== value) onChange(Math.min(max, Math.max(min, n)));
  }
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // don't submit the bus form
            commit();
          }
        }}
        className="input h-10"
      />
    </label>
  );
}
