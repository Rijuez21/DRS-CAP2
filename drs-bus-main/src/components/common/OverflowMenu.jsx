import { useEffect, useId, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

// The "⋯" menu for rare or destructive row actions (Hick's Law: they stay
// out of the way until asked for). Keyboard: Enter/Space/ArrowDown opens and
// focuses the first item, ArrowUp/ArrowDown move, Escape closes and returns
// focus to the button. The menu is position: fixed so a table's scroll
// container can't clip it.
//
// items: [{ label, onClick, tone?: "danger", icon?, disabled? }]
export default function OverflowMenu({ items, label = "More actions" }) {
  const [pos, setPos] = useState(null); // null = closed
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const visible = items.filter(Boolean);

  function open(focusIndex = 0) {
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 48 * visible.length + 16;
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
      focusIndex,
    });
  }
  const close = (refocus = true) => {
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!pos) return undefined;
    const items = menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])');
    items?.[pos.focusIndex === -1 ? items.length - 1 : pos.focusIndex]?.focus();
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setPos(null);
    };
    const onScroll = () => setPos(null);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pos]);

  function onMenuKey(e) {
    const list = [...menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
    else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === "Home") list[0]?.focus();
    else if (e.key === "End") list[list.length - 1]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
    else return;
    if (e.key !== "Tab") e.preventDefault();
  }

  if (visible.length === 0) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-controls={pos ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) close();
          else open();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            open(e.key === "ArrowUp" ? -1 : 0);
          }
        }}
        className="inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg text-gray-500 hover:bg-slate-100 hover:text-gray-800"
      >
        <MoreVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      {pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", right: pos.right, top: pos.top, bottom: pos.bottom }}
          className="z-[60] min-w-44 rounded-lg border bg-white py-1 shadow-lg"
        >
          {visible.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2 px-3 min-h-11 md:min-h-9 text-left text-sm font-medium disabled:opacity-50 focus:outline-none focus-visible:bg-slate-100 hover:bg-slate-50 ${
                  item.tone === "danger" ? "text-rose-600" : "text-gray-700"
                }`}
              >
                {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
