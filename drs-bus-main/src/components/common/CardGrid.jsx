import ListFrame from "./ListFrame";
import { SkeletonCards } from "./Skeletons";

// Card layout for small-to-medium, status-driven lists (staff accounts,
// drivers, buses): one card per item, a "Sort by" dropdown instead of
// headers. Toolbar, states and paging come from ListFrame.
//
// sortFields: [{ key, label, type?, accessor?, sortValue? }]
// renderCard(item) -> the card's content (CardGrid draws the box).
export default function CardGrid({ sortFields = [], renderCard, rowKey, label, cardClassName, ...frameProps }) {
  return (
    <ListFrame {...frameProps} fields={sortFields} sortControl="dropdown" skeleton={<SkeletonCards />}>
      {(pageRows) => (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>
          {pageRows.map((item) => (
            <li key={rowKey(item)} className={`panel panel-hover p-4 flex flex-col gap-3 ${cardClassName?.(item) ?? ""}`}>
              {renderCard(item)}
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  );
}
