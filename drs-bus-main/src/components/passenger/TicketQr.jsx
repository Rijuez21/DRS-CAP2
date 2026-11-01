import { useEffect, useState } from "react";
import QRCode from "qrcode";

// The e-ticket's QR code: the booking reference (DRS-2026-00012). It only
// identifies the booking — staff still see its real status from the server
// before letting anyone board.
export default function TicketQr({ value }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 320, errorCorrectionLevel: "M", color: { dark: "#123524", light: "#ffffff" } })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-44 h-44 rounded-xl bg-white border border-slate-200 p-2 flex items-center justify-center">
        {src ? <img src={src} alt={`QR code for booking ${value}`} className="w-full h-full" /> : <span className="text-xs text-ink-600">Making QR…</span>}
      </div>
      <p className="text-xs text-ink-600 text-center">Show this at the terminal. Staff scan it to find your booking.</p>
    </div>
  );
}
