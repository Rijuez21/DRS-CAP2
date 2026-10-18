import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, BellOff, BusFront, CalendarClock, CircleCheck, ReceiptText, Wallet, XCircle } from "lucide-react";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useAuth } from "../../context/AuthContext";

const PANEL_WIDTH = 360; // px

// A "payment_verified" notification means that booking now has an official
// receipt. Notifications carry no link column, so the booking is read from
// the message the server writes ("… booking #123 …", routes/payments.js).
function receiptBookingId(n) {
  if (n.type !== "payment_verified") return null;
  return /booking #(\d+)/.exec(n.message)?.[1] ?? null;
}

// Staff payment alerts ("… submission #42 …", routes/payments.js) open
// that payment in Payment Verification.
function reviewSubmissionId(n) {
  if (!String(n.type).startsWith("payment_review")) return null;
  return /submission #(\d+)/.exec(n.message)?.[1] ?? null;
}

// Icon + colour per notification type (types come from the server's
// notify*() calls). Unknown types fall back to a plain bell.
function notificationStyle(type = "") {
  if (type === "payment_verified" || type === "payment_refund") return { Icon: CircleCheck, tone: "bg-emerald-50 text-emerald-600 ring-emerald-100" };
  if (type.startsWith("payment_review")) return { Icon: Wallet, tone: "bg-amber-50 text-amber-600 ring-amber-100" };
  if (type.includes("cancel") || type.includes("declined") || type.includes("rejected")) return { Icon: XCircle, tone: "bg-rose-50 text-rose-600 ring-rose-100" };
  if (type.includes("expired") || type === "seat_released") return { Icon: AlertTriangle, tone: "bg-orange-50 text-orange-600 ring-orange-100" };
  if (type === "schedule_change") return { Icon: CalendarClock, tone: "bg-sky-50 text-sky-600 ring-sky-100" };
  if (type.startsWith("flag")) return { Icon: BusFront, tone: "bg-brand-forest-900/5 text-brand-forest-800 ring-brand-forest-900/10" };
  if (type.startsWith("payment")) return { Icon: Wallet, tone: "bg-emerald-50 text-emerald-600 ring-emerald-100" };
  return { Icon: Bell, tone: "bg-slate-100 text-slate-500 ring-slate-200" };
}

function timeAgo(value) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days} days ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Phase 0.3's Reliability requirement: notify passengers/drivers of
// schedule changes. Dropped into PassengerLayout/DriverLayout — mounted
// once per session, joins this user's own Socket.io room so
// notify.js's "notification:new" events (from trips.js) show up live,
// and marks everything read when the dropdown opens.
export default function NotificationBell({ recipientType, recipientId }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null); // the panel is portalled to <body>, so it isn't inside containerRef
  const [panelPos, setPanelPos] = useState(null); // { top, left, width } in viewport px
  // Items that were unread when the panel opened. Opening marks everything
  // read, so this keeps them highlighted as "new" while the panel is open.
  const [freshIds, setFreshIds] = useState(() => new Set());

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!recipientId) return;
    api.getNotifications(recipientType, recipientId).then(setNotifications).catch(() => {});

    const socket = getSocket();
    const join = () => socket.emit("subscribe:notifications", { recipientType, recipientId });
    join();

    function handleNew(notification) {
      setNotifications((prev) => [notification, ...prev]);
    }
    // A dropped connection (common on mountain roads) loses room membership
    // on the server. Rejoin, and refetch anything sent while offline —
    // before, the bell simply went quiet until the page was reloaded.
    function handleReconnect() {
      join();
      api.getNotifications(recipientType, recipientId).then(setNotifications).catch(() => {});
    }
    socket.on("notification:new", handleNew);
    socket.on("connect", handleReconnect);

    return () => {
      socket.emit("unsubscribe:notifications", { recipientType, recipientId });
      socket.off("notification:new", handleNew);
      socket.off("connect", handleReconnect);
    };
  }, [recipientType, recipientId]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // The panel is position: fixed and placed against the screen, not the
  // bell. The bell sits at the right edge of a 240px desktop sidebar (or
  // the phone top bar); a right-aligned 288px panel ran off the left of
  // the screen there, and the sidebar's scroll area clipped it. Prefer
  // lining up with the bell's right edge, else its left edge (opening into
  // the page), and always keep a margin from both screen edges.
  const placePanel = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - margin * 2);
    let left = rect.right - width;
    if (left < margin) left = rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    setPanelPos({ top: rect.bottom + margin, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    placePanel();
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [isOpen, placePanel]);

  async function handleOpen() {
    setIsOpen((v) => !v);
    if (!isOpen) setFreshIds(new Set(notifications.filter((n) => !n.read_at).map((n) => n.notification_id)));
    if (!isOpen && unreadCount > 0) {
      try {
        await api.markAllNotificationsRead(recipientType, recipientId);
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      } catch {
        // non-critical — the bell just won't clear until next successful call
      }
    }
  }

  if (!recipientId) return null;

  const newCount = notifications.filter((n) => freshIds.has(n.notification_id) || !n.read_at).length;
  const linkClass =
    "inline-flex items-center gap-1 mt-2 rounded-full bg-brand-green-600/10 px-2.5 py-1 text-xs font-semibold text-brand-green-600 hover:bg-brand-green-600/15 transition";

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        aria-expanded={isOpen}
        className={`relative p-2 rounded-full transition hover:bg-white/10 ${isOpen ? "bg-white/10" : ""}`}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[17px] h-[17px] px-1 flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Portalled to <body>: the desktop sidebar is position: sticky, which
          traps anything inside it in its own stacking layer, so the panel
          painted under the page content no matter its z-index. */}
      {isOpen && panelPos && createPortal(
        <div
          ref={panelRef}
          role="region"
          aria-label="Notifications"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          className="fixed bg-white text-ink-900 rounded-2xl shadow-2xl shadow-slate-900/15 ring-1 ring-slate-900/5 overflow-hidden z-50"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-br from-brand-forest-900 to-brand-forest-800 text-white">
            <div>
              <p className="font-semibold text-[15px] leading-tight">Notifications</p>
              <p className="text-xs text-white/60 mt-0.5">
                {notifications.length === 0 ? "You're all caught up" : newCount > 0 ? `${newCount} new` : "No new notifications"}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
              <Bell className="w-4 h-4 text-brand-sunrise-400" />
            </div>
          </div>

          <div className="max-h-[min(24rem,calc(100vh-9rem))] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center text-center px-6 py-10">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <BellOff className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-ink-900">No notifications yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[16rem]">Trip changes and payment updates will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((n) => {
                  const receiptFor = recipientType === "passenger" ? receiptBookingId(n) : null;
                  const reviewFor = recipientType === "staff" ? reviewSubmissionId(n) : null;
                  const isNew = freshIds.has(n.notification_id) || !n.read_at;
                  const { Icon, tone } = notificationStyle(n.type);
                  return (
                    <li
                      key={n.notification_id}
                      className={`relative flex gap-3 px-5 py-3.5 transition ${isNew ? "bg-brand-green-600/[0.04]" : "hover:bg-slate-50"}`}
                    >
                      {isNew && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-brand-green-500" aria-hidden="true" />}
                      <div className={`shrink-0 w-9 h-9 rounded-full ring-1 flex items-center justify-center ${tone}`}>
                        <Icon className="w-[18px] h-[18px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-snug break-words ${isNew ? "text-ink-900 font-medium" : "text-ink-600"}`}>{n.message}</p>
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
                          <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</time>
                          {isNew && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-brand-green-600">New</span>
                            </>
                          )}
                        </div>
                        {receiptFor && (
                          <Link to={`/passenger/my-bookings/${receiptFor}/receipt`} onClick={() => setIsOpen(false)} className={linkClass}>
                            <ReceiptText className="w-3.5 h-3.5" /> View receipt <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                        {reviewFor && (
                          <Link
                            to={`/${user?.role === "admin" ? "admin" : "staff"}/payments?submission=${reviewFor}`}
                            onClick={() => setIsOpen(false)}
                            className={linkClass}
                          >
                            <Wallet className="w-3.5 h-3.5" /> Open payment <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
