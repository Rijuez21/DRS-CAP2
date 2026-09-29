import { LocateFixed, MapPinOff } from "lucide-react";

// What to show when a feature needs the user's location and doesn't have
// it yet — the explanation before the browser prompt, and the way out when
// it was refused. Used by FlagBus (required) and LiveTracking (optional).
export default function LocationPermissionCard({ status, reason, onRequest, compact = false }) {
  if (status === "ok") return null;

  const isBlocked = status === "denied";
  const isBroken = status === "unavailable" || status === "unsupported";
  const title = isBlocked
    ? "Location is blocked for this site"
    : status === "unsupported"
      ? "This browser can't share your location"
      : status === "unavailable"
        ? "We couldn't get your location"
        : status === "locating"
          ? "Waiting for your location…"
          : "Share your location";
  const help = isBlocked
    ? "Tap the lock or ⓘ icon next to the web address, set Location to Allow, then tap Try again."
    : status === "unsupported"
      ? "Open this page in Chrome, Safari or Firefox on your phone."
      : status === "unavailable"
        ? "Turn on your phone's Location/GPS and step outside or near a window, then try again."
        : status === "locating"
          ? "If your browser is asking, choose Allow."
          : reason;

  return (
    <div role={isBlocked || isBroken ? "alert" : "status"} className={`rounded-2xl border ${isBlocked || isBroken ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"} ${compact ? "p-3" : "p-4"} space-y-2`}>
      <p className="font-semibold text-sm flex items-center gap-2">
        {isBlocked || isBroken ? <MapPinOff className="w-4 h-4 text-rose-600" /> : <LocateFixed className="w-4 h-4 text-brand-green-600" />}
        {title}
      </p>
      {help && <p className="text-sm text-ink-600">{help}</p>}
      {status !== "unsupported" && status !== "locating" && (
        <button
          type="button"
          onClick={onRequest}
          className="bg-brand-green-600 hover:bg-brand-green-500 text-white text-sm font-semibold rounded-xl px-4 py-2"
        >
          {status === "idle" ? "Share my location" : "Try again"}
        </button>
      )}
    </div>
  );
}
