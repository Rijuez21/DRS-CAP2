// Keeps first-appearance order, so the list's own sort decides which
// chunk comes first and how the items inside it are ordered.
export function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const k = keyOf(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return [...groups.entries()];
}
