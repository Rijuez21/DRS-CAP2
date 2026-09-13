import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import * as api from "../../lib/api";
import { getSocket } from "../../lib/socket";

// Phase 0.3's Reliability requirement: notify passengers/drivers of
// schedule changes. Dropped into PassengerLayout/DriverLayout — mounted
// once per session, joins this user's own Socket.io room so
// notify.js's "notification:new" events (from trips.js) show up live,
// and marks everything read when the dropdown opens.
export default function NotificationBell({ recipientType, recipientId }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!recipientId) return;
    api.getNotifications(recipientType, recipientId).then(setNotifications).catch(() => {});

    const socket = getSocket();
    socket.emit("subscribe:notifications", { recipientType, recipientId });

    function handleNew(notification) {
      setNotifications((prev) => [notification, ...prev]);
    }
    socket.on("notification:new", handleNew);

    return () => {
      socket.emit("unsubscribe:notifications", { recipientType, recipientId });
      socket.off("notification:new", handleNew);
    };
  }, [recipientType, recipientId]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      <button type="button" onClick={handleOpen} className="relative p-1.5 rounded-full hover:bg-white/10" aria-label="Notifications">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white text-ink-900 rounded-xl shadow-xl border border-slate-100 overflow-hidden z-30">
          <div className="px-4 py-2.5 border-b font-semibold text-sm">Notifications</div>
          <div className="max-h-72 overflow-y-auto divide-y">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 py-6 text-center">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div key={n.notification_id} className="px-4 py-3 text-sm">
                  <p>{n.message}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
