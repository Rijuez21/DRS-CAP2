import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import * as api from "../../lib/api";

// A private payment receipt. The image is fetched with the login header and
// shown through a temporary object URL (revoked on unmount) — receipts never
// have a public link. onClick lets a parent open it full size.
export default function ReceiptImage({ submissionId, className = "", alt = "Payment receipt", onClick }) {
  const [state, setState] = useState({ url: null, error: "" });

  useEffect(() => {
    if (!submissionId) return undefined;
    let url = null;
    let cancelled = false;
    api
      .fetchReceiptObjectUrl(submissionId)
      .then((u) => {
        url = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setState({ url: u, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setState({ url: null, error: err.message });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [submissionId]);

  if (state.error) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 text-xs text-ink-600 bg-slate-50 rounded-xl p-4 ${className}`}>
        <ImageOff className="w-5 h-5" />
        {state.error}
      </div>
    );
  }
  if (!state.url) return <div className={`bg-slate-100 animate-pulse rounded-xl ${className}`} aria-busy="true" aria-label="Loading receipt" />;
  const img = <img src={state.url} alt={alt} className={`rounded-xl border border-slate-200 bg-white object-contain ${className}`} />;
  return onClick ? (
    <button type="button" onClick={() => onClick(state.url)} className="block cursor-zoom-in" aria-label="Open receipt full size">
      {img}
    </button>
  ) : (
    img
  );
}
