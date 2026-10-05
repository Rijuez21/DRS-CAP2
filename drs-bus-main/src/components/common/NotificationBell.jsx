import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Bell, ReceiptText } from "lucide-react";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";

const PANEL_WIDTH = 288; // px — Tailwind w-72

// A "payment_verified" notification means that booking now has an official
// receipt. Notifications carry no link column, so the booking is read from
// the message the server writes ("… booking #123 …", routes/payments.js).
function receiptBookingId(n) {
  if (n.type !== "payment_verified") return null;
  return /booking #(\d+)/.exec(n.message)?.[1] ?? null;
}

// Phase 0.3's Reliability requirement: notify passengers/drivers of
// schedule changes. Dropped into PassengerLayout/DriverLayout — mounted
// once per session, joins this user's own Socket.io room so
// notify.js's "notification:new" events (from trips.js) show up live,
// and marks everything read when the dropdown opens.
export default function NotificationBell({ recipientType, recipientId }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null); // the panel is portalled to <body>, so it isn't inside containerRef
  const [panelPos, setPanelPos] = useState(null); // { top, left, width } in viewport px

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

  return (
    <div className="relative" ref={containerRef}>
      <button ref={buttonRef} type="button" onClick={handleOpen} aria-expanded={isOpen} className="relative p-1.5 rounded-full hover:bg-white/10" aria-label="Notifications">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
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
          className="fixed bg-white text-ink-900 rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50"
        >
          <div className="px-4 py-2.5 border-b font-semibold text-sm">Notifications</div>
          <div className="max-h-[min(18rem,calc(100vh-8rem))] overflow-y-auto divide-y">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 py-6 text-center">No notifications yet.</p>
            ) : (
              notifications.map((n) => {
                const receiptFor = receiptBookingId(n);
                return (
                  <div key={n.notification_id} className="px-4 py-3 text-sm">
                    <p>{n.message}</p>
                    {receiptFor && (
                      <Link
                        to={`/passenger/my-bookings/${receiptFor}/receipt`}
                        onClick={() => setIsOpen(false)}
                        className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold text-brand-green-600 hover:underline"
                      >
                        <ReceiptText className="w-3.5 h-3.5" /> View receipt
                      </Link>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
