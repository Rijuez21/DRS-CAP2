import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import ListFrame from "./ListFrame";
import { SkeletonCards, SkeletonRows } from "./Skeletons";

// Table layout for high-volume lists people compare and sort (reservations,
// routes). Sortable headers (aria-sort + arrow), sticky header inside its
// own scroll box, and stacked cards below md. Toolbar, states and paging
// come from ListFrame — see its props for filters/search/paging.
//
// columns: [{
//   key, header,
//   render?(row)        cell content (default: row[key])
//   accessor?(row)      raw value for sorting/searching when row[key] isn't it
//   sortValue?(row)     overrides accessor for sorting only
//   type?               "text" (default) | "number" | "date" | "status"
//   sortable?           false to opt out (the "actions" column always is)
//   align?              "right" (numbers default to right)
//   truncate?           clip long text to one line with a title tooltip
//   primary?            card title on phones (default: first column)
//   mobile?             false to leave it off the phone card
//   className?
// }]
export default function DataTable({ columns, rowKey, renderMobileCard, mobile = "cards", onRowClick, rowClassName, label, minWidth = "44rem", ...frameProps }) {
  const useCards = mobile === "cards" || renderMobileCard;
  const fields = columns.map((c) => ({ ...c, label: headerText(c) }));

  return (
    <ListFrame
      {...frameProps}
      fields={fields.filter(isSortable)}
      sortControl={useCards ? "phone" : "none"}
      skeleton={
        <>
          <Shell columns={columns} label={label} minWidth={minWidth} hideOnPhone={useCards}>
            <SkeletonRows columns={columns.length} />
          </Shell>
          {useCards && (
            <div className="md:hidden">
              <SkeletonCards count={3} className="h-24" />
            </div>
          )}
        </>
      }
    >
      {(pageRows, { state }) => (
        <>
          <Shell columns={columns} label={label} minWidth={minWidth} hideOnPhone={useCards} t={state}>
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`align-top even:bg-slate-50/50 hover:bg-brand-green-500/5 ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${cellAlign(c)} ${c.key === "actions" ? "whitespace-nowrap py-1.5" : ""} ${c.className ?? ""}`}>
                    <Cell col={c} row={row} />
                  </td>
                ))}
              </tr>
            ))}
          </Shell>
          {useCards && (
            <ul className="md:hidden space-y-2">
              {pageRows.map((row) => (
                <li key={rowKey(row)}>
                  {renderMobileCard ? renderMobileCard(row) : <AutoCard columns={columns} row={row} onClick={onRowClick} className={rowClassName?.(row)} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ListFrame>
  );
}

const isSortable = (c) => c.sortable !== false && c.key !== "actions";
const isRight = (c) => c.align === "right" || (c.align == null && c.type === "number") || c.key === "actions";
const cellAlign = (c) => (isRight(c) ? "text-right" : "text-left");
const headerText = (c) => (typeof c.header === "string" && c.header ? c.header : c.key);

function Shell({ columns, t, label, minWidth, hideOnPhone, children }) {
  return (
    <div className={`${hideOnPhone ? "hidden md:block" : ""} panel max-h-[70vh] overflow-auto`}>
      <table className="w-full text-sm" style={{ minWidth }} aria-label={label}>
        <thead className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <tr>
            {columns.map((c) => {
              const sortable = t && isSortable(c);
              const active = sortable && t.sortKey === c.key;
              const Icon = active ? (t.sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (t.sortDir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined}
                  className={`sticky top-0 z-10 bg-slate-50 border-b px-4 py-3 whitespace-nowrap ${cellAlign(c)}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => t.toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide rounded hover:text-ink-900 ${active ? "text-ink-900" : ""} ${isRight(c) ? "flex-row-reverse" : ""}`}
                    >
                      {c.header}
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? "text-brand-green-600" : "opacity-40"}`} aria-hidden="true" />
                    </button>
                  ) : c.key === "actions" && !c.header ? (
                    <span className="sr-only">Actions</span>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

function Cell({ col, row }) {
  const content = col.render ? col.render(row) : row[col.key] ?? "—";
  if (!col.truncate) return content;
  const raw = col.accessor ? col.accessor(row) : row[col.key];
  return (
    <div className="truncate max-w-[16rem]" title={raw != null ? String(raw) : undefined}>
      {content}
    </div>
  );
}

// Default phone card built from the columns: title (+ status) on top, the
// rest as label/value pairs, actions along the bottom.
function AutoCard({ columns, row, onClick, className = "" }) {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const status = columns.find((c) => c.type === "status" && c !== primary && c.mobile !== false);
  const actions = columns.find((c) => c.key === "actions");
  const rest = columns.filter((c) => c !== primary && c !== status && c !== actions && c.mobile !== false);
  const render = (c) => (c.render ? c.render(row) : row[c.key] ?? "—");

  return (
    <div className={`panel p-4 space-y-2 ${onClick ? "cursor-pointer" : ""} ${className}`} onClick={onClick ? () => onClick(row) : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium min-w-0 break-words">{render(primary)}</div>
        {status && <div className="shrink-0">{render(status)}</div>}
      </div>
      {rest.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          {rest.map((c) => (
            <div key={c.key} className="min-w-0">
              <dt className="text-xs text-gray-500">{c.header}</dt>
              <dd className="break-words">{render(c)}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions && (
        <div className="flex flex-wrap justify-end gap-1 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          {render(actions)}
        </div>
      )}
    </div>
  );
}
