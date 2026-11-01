import { Spinner } from "./Buttons";

// Shown while a page's code downloads (pages load on demand — see
// routes/AppRoutes.jsx). Usually a blink on a good connection.
export default function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center gap-2 text-sm text-ink-600" role="status" aria-live="polite">
      <Spinner /> Loading…
    </div>
  );
}
