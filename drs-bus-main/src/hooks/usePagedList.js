import { useState } from "react";

// Splits a list into pages for the passenger screens (My Bookings,
// Payments). Returns the rows for the current page plus what the pager
// needs. `anchorId` is the id of the list's heading: changing page scrolls
// back up to it, so the passenger isn't left at the bottom of a shorter page.
export function usePagedList(rows, pageSize, anchorId) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount); // the list can shrink (e.g. a cancelled booking moves sections)
  const start = (current - 1) * pageSize;

  function goTo(next) {
    setPage(Math.min(Math.max(1, next), pageCount));
    if (anchorId) document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return {
    pageRows: rows.slice(start, start + pageSize),
    page: current,
    pageCount,
    total: rows.length,
    from: rows.length ? start + 1 : 0,
    to: Math.min(start + pageSize, rows.length),
    goTo,
  };
}
