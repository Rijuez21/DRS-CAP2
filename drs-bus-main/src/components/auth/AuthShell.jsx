import { Link } from "react-router-dom";
import { ArrowLeft, CalendarClock, MapPinned, ShieldCheck, Ticket } from "lucide-react";
import sunLogo from "../../assets/logo-sun.svg";

// ── Left-panel image ─────────────────────────────────────────────────────
// Leave as null for the built-in forest/sunrise artwork. To use a photo
// instead (a bus on the Halsema, the terminal, a Cordillera view):
//   1. put the file in src/assets/, e.g. src/assets/login-side.jpg
//   2. replace the line below with:
//        import SIDE_IMAGE from "../../assets/login-side.jpg";
//      (and delete `const SIDE_IMAGE = null;`)
// The photo is darkened with a green overlay so the white text stays readable.
const SIDE_IMAGE = null;

const DEFAULT_TAGLINE = "Book a seat, follow your bus live, and travel the Baguio–Bontoc line with D' Rising Sun.";

// Feature list on the brand panel (desktop only). "passenger" for the
// passenger login, "team" for admin / staff / driver / owner logins.
const HIGHLIGHTS = {
  passenger: [
    { icon: Ticket, text: "Reserve seats before you reach the terminal" },
    { icon: MapPinned, text: "Live bus tracking along the route" },
    { icon: ShieldCheck, text: "Your bookings and payments in one account" },
  ],
  team: [
    { icon: CalendarClock, text: "Today's schedules and assignments" },
    { icon: MapPinned, text: "Live map of every bus on the line" },
    { icon: ShieldCheck, text: "Accounts created and managed by the admin" },
  ],
};

// Split login layout: brand panel on the left (a short banner on phones),
// the form on the right. Purely presentational: LoginForm keeps all the
// sign-in / sign-up logic.
//
//   roleLabel  chip above the form ("Passenger Login")
//   headline   big text on the brand panel
//   tagline    one line under the headline
//   audience   "passenger" (default) or "team": which feature list to show
//   roleTag    optional small note under the form
export default function AuthShell({ roleLabel, roleTag, headline = "Welcome aboard.", tagline = DEFAULT_TAGLINE, audience = "passenger", children }) {
  return (
    <div className="min-h-screen bg-surface lg:flex lg:items-center lg:justify-center lg:p-8">
      <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:w-full lg:max-w-5xl lg:rounded-[2rem] lg:overflow-hidden lg:bg-white lg:border lg:border-slate-200 lg:shadow-[0_2px_4px_rgb(18_39_27/0.05),0_40px_80px_-40px_rgb(18_39_27/0.45)]">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <aside className="hero-forest relative flex flex-col justify-between px-6 py-6 sm:px-10 lg:px-14 lg:px-12 lg:py-10 lg:min-h-[620px]">
        {SIDE_IMAGE && (
          <>
            <img src={SIDE_IMAGE} alt="" className="absolute inset-0 -z-20 w-full h-full object-cover" />
            <div className="absolute inset-0 -z-10 bg-linear-to-br from-brand-forest-900/85 via-brand-forest-900/70 to-brand-forest-950/90" />
          </>
        )}

        <Link to="/" className="inline-flex items-center gap-2.5 self-start rounded-lg">
          <img src={sunLogo} alt="" className="w-10 h-10" />
          <span className="font-display text-lg font-bold">D&apos; Rising Sun</span>
        </Link>

        <div className="mt-6 lg:mt-0 max-w-md">
          <h1 className="font-display font-bold leading-tight text-3xl sm:text-4xl lg:text-5xl">{headline}</h1>
          <p className="mt-3 text-sm sm:text-base text-white/75">{tagline}</p>

          <ul className="hidden lg:block mt-8 space-y-3">
            {(HIGHLIGHTS[audience] ?? HIGHLIGHTS.passenger).map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="w-9 h-9 shrink-0 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-brand-sunrise-400" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden lg:block text-xs text-white/50">Serving the Cordillera, Baguio City to Bontoc.</p>
      </aside>

      {/* ── Form panel ──────────────────────────────────────────────── */}
            <main className="flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-10 lg:py-10 lg:bg-white">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-[0_1px_2px_rgb(18_39_27/0.05),0_24px_48px_-28px_rgb(18_39_27/0.35)] p-6 sm:p-8 lg:border-0 lg:shadow-none lg:rounded-none lg:p-0">
            {roleLabel && (
              <span className="inline-flex items-center px-3 py-1 mb-4 rounded-full text-xs font-semibold bg-brand-green-500/12 text-brand-forest-800">
                {roleLabel}
              </span>
            )}
            {children}
          </div>

          {roleTag && <p className="text-center text-xs text-ink-600 mt-4">{roleTag}</p>}

          <Link to="/" className="mt-5 mx-auto flex w-fit items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-brand-forest-900">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to home
          </Link>
        </div>
      </main>
      </div>
    </div>
  );
}
