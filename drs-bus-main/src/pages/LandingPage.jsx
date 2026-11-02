import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Armchair, ChevronDown, Fan, MapPinned, Navigation, Radio, ShieldCheck, Ticket, Wind, WifiOff, CloudUpload } from "lucide-react";
import useScrollReveal from "../hooks/useScrollReveal";
import * as api from "../lib/api";
import { formatPeso } from "../lib/format";
import { DISCOUNT_PERCENT } from "../lib/discounts";
import SiteChrome from "../components/landing/SiteChrome";
import LandingSearch from "../components/landing/LandingSearch";
import RouteLine from "../components/landing/RouteLine";
import Shot from "../components/landing/Shot";

import heroPhone from "../assets/hero-phone.png";
import trackingMap from "../assets/tracking-map.png";
import busOrdinary from "../assets/bus-ordinary.jpg";
import busAircon from "../assets/bus-aircon.jpg";
import rolePassengers from "../assets/role-passengers.png";
import roleStaff from "../assets/role-staff.png";
import roleAdmins from "../assets/role-admins.png";

// // ── Pictures ───────────────────────────────────────────────────────────────
const SHOTS = {
  heroPhone: heroPhone,
  trackingMap: trackingMap,
  busOrdinary: busOrdinary,
  busAircon: busAircon,
  rolePassengers: rolePassengers,
  roleStaff: roleStaff,
  roleAdmins: roleAdmins,
};

// ── Popular routes ─────────────────────────────────────────────────────────
// `stop` must match a destination in Route Management (case doesn't matter).
// Fares and distance come live from the fare table; a card whose stop isn't
// found is left out. `hours` is the usual travel time — leave null to show an
// estimate from the distance (AVERAGE_KMH, mountain-road speed).
const POPULAR = [
  { stop: "BONTOC", name: "Bontoc", province: "Mountain Province", hours: null },
  { stop: "SAGADA", name: "Sagada", province: "Mountain Province", hours: null },
  { stop: "BAGUINGEY", name: "Baguinge", province: "Benguet", hours: null },
  { stop: "TABUK", name: "Tabuk", province: "Kalinga", hours: null },
];
const AVERAGE_KMH = 28;
// Grid width follows how many cards were found, so there's never an empty slot.
const COLS = { 1: "lg:grid-cols-2", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

export default function LandingPage() {
  useScrollReveal();
  const [routes, setRoutes] = useState([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);

  useEffect(() => {
    // Public endpoint: the same fare table the passenger app uses.
    api
      .getRoutes()
      .then(setRoutes)
      .catch(() => setRoutes([]))
      .finally(() => setRoutesLoaded(true));
  }, []);

  return (
    <SiteChrome home>
      <Hero routes={routes} />
      <TheLine />
      <Tracking />
      <HowItWorks />
      <FleetAndSafety />
      <PopularRoutes routes={routes} loaded={routesLoaded} />
      <ForTheTerminal />
      <Faq />
      <FinalCta />
    </SiteChrome>
  );
}

/* ── 1. Hero + booking ─────────────────────────────────────────────────── */
function Hero({ routes }) {
  return (
    <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-10 pb-14 sm:pt-16 sm:pb-20 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="max-w-xl">
        <h1 className="font-display font-bold text-[2.5rem] leading-[1.05] sm:text-6xl tracking-tight text-brand-forest-900">
          Skip the terminal line. Book your seat from home.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-600 max-w-lg">
          Reserve a seat on a D&apos; Rising Sun bus from Baguio City to the towns of Benguet, Mountain Province and Ifugao — on your phone, before you leave the house.
        </p>
        <div className="mt-8">
          <LandingSearch routes={routes} />
        </div>
      </div>

      <div className="hidden lg:block w-[300px]">
        <Shot src={SHOTS.heroPhone} alt="Booking a seat in the D' Rising Sun app" aspect="aspect-11/22" rounded="rounded-[2.25rem]" className="shadow-[0_40px_80px_-40px_rgb(18_39_27/0.5)] border-8! border-brand-forest-900!" note="Phone screenshot — 375 × 667" />
      </div>
    </section>
  );
}

/* ── The route, drawn to scale ─────────────────────────────────────────── */
function TheLine() {
  return (
    <section className="border-y border-brand-forest-900/10 bg-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 sm:py-14">
        <h2 className="font-display font-semibold text-2xl sm:text-3xl text-brand-forest-900 max-w-2xl">151 km of mountain road, from the Baguio terminal to Sagada.</h2>
        <p className="mt-3 text-ink-600 max-w-2xl">Every stop along the Halsema Highway has its own fare, so you pay for the distance you actually ride.</p>
        <div className="mt-10">
          <RouteLine />
        </div>
      </div>
    </section>
  );
}

/* ── 2. Live tracking ──────────────────────────────────────────────────── */
function Tracking() {
  const offline = [
    { icon: WifiOff, title: "Signal drops", text: "The bus enters a dead spot on a high stretch of road." },
    { icon: Radio, title: "Location keeps recording", text: "GPS points are saved on the driver's device while there's no network." },
    { icon: CloudUpload, title: "Back in range, it catches up", text: "The saved points are sent on their own, so the trip has no gaps." },
  ];
  return (
    <section id="tracking" className="hero-forest scroll-mt-16">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-24 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div data-reveal>
          <h2 className="font-display font-semibold text-3xl sm:text-4xl leading-tight">Know where your bus is before you leave the house.</h2>
          <p className="mt-4 text-white/75 text-lg leading-relaxed max-w-lg">
            Open your booking and see the bus on a live map, moving along the route, and how far it still is from you. Wait indoors instead of on the roadside.
          </p>

          <h3 className="mt-10 font-display font-semibold text-lg text-brand-sunrise-400">Built for the mountains</h3>
          <ol className="mt-4 space-y-4">
            {offline.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-brand-sunrise-400" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-white/70">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div data-reveal="1">
          <Shot src={SHOTS.trackingMap} alt="Live map showing a D' Rising Sun bus on its route" className="shadow-2xl shadow-black/30" note="Live tracking screenshot — 960 × 720" />
        </div>
      </div>
    </section>
  );
}

/* ── 3. How it works ───────────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    {
      title: "Search and choose a trip",
      text: "Pick where you're starting and where you're getting off. Trips from Baguio City run to stops across Benguet, Mountain Province and Ifugao.",
    },
    {
      title: "Reserve your seat",
      text: "See which seats are still free and tap the one you want. It's held for you alone, so nobody else can book it, and you get a confirmation code with your trip details.",
      extra: (
        <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-forest-900 text-white px-3 py-2 text-sm font-semibold tabular-nums">
          <Ticket className="w-4 h-4 text-brand-sunrise-400" aria-hidden="true" /> DRS-2026-00042
        </span>
      ),
    },
    {
      title: "Pay and board",
      text: "Show your confirmation at the terminal or to the conductor, pay your fare, and take your seat. Your online booking is already on the trip's passenger list.",
    },
  ];
  return (
    <section id="how-it-works" className="scroll-mt-16 max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
      <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900 max-w-xl">Three steps from your couch to your seat.</h2>
      <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((s, i) => (
          <li key={s.title} data-reveal={String(i + 1)} className="relative border-t-4 border-brand-forest-900 pt-6">
            <span className="font-display font-bold text-5xl text-brand-sunrise-500 leading-none" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="mt-4 font-display font-semibold text-xl text-brand-forest-900">{s.title}</h3>
            <p className="mt-2 text-ink-600 leading-relaxed">{s.text}</p>
            {s.extra}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── 4. Fleet & safety ─────────────────────────────────────────────────── */
function FleetAndSafety() {
  const buses = [
    {
      key: "busOrdinary",
      icon: Wind,
      name: "Ordinary",
      text: "Open-window buses that run the line every day — the everyday ride for workers, students and market-goers.",
    },
    {
      key: "busAircon",
      icon: Fan,
      name: "Air-conditioned",
      text: "A closed, cooled cabin for the long climb to Bontoc and Sagada.",
    },
  ];
  return (
    <section className="bg-white border-y border-brand-forest-900/10">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
        <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900 max-w-2xl">Ordinary or air-conditioned. You&apos;ll know which before you book.</h2>
        <p className="mt-3 text-ink-600 max-w-2xl">We run both kinds of bus. Every trip shows its bus type next to the departure time, so there are no surprises at the terminal.</p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {buses.map(({ key, icon: Icon, name, text }) => (
            <article key={key} data-reveal className="rounded-3xl border border-brand-forest-900/10 bg-surface p-3">
              <Shot src={SHOTS[key]} alt={`${name} D' Rising Sun bus`} note={`Photo of an ${name.toLowerCase()} bus — 960 × 720`} />
              <div className="p-4 flex gap-4">
                <span className="w-11 h-11 shrink-0 rounded-2xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display font-semibold text-xl text-brand-forest-900">{name}</h3>
                  <p className="mt-1 text-ink-600">{text}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-3xl bg-brand-forest-900 text-white p-6 sm:p-8 grid gap-8 md:grid-cols-[auto_1fr_1fr] md:items-start">
          <ShieldCheck className="w-10 h-10 text-brand-sunrise-400" aria-hidden="true" />
          <div>
            <h3 className="font-display font-semibold text-lg">Every bus is GPS-monitored</h3>
            <p className="mt-1 text-white/70">Our team sees each bus live on the map for the whole trip, from the terminal to the last stop.</p>
          </div>
          <div>
            <h3 className="font-display font-semibold text-lg">Checked before every departure</h3>
            <p className="mt-1 text-white/70">Drivers complete a digital pre-trip safety checklist — engine, tires and brakes — before each trip leaves.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 5. Popular routes & fares ─────────────────────────────────────────── */
function PopularRoutes({ routes, loaded }) {
  const cards = POPULAR.map((p) => {
    const r = routes.find((x) => String(x.destination).toUpperCase() === p.stop.toUpperCase());
    return r ? { ...p, route: r } : null;
  }).filter(Boolean);

  return (
    <section id="routes" className="scroll-mt-16 max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
      <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900 max-w-xl">Popular trips from Baguio City</h2>
      <p className="mt-3 text-ink-600 max-w-2xl">
        Fares come straight from our fare table. Students, PWDs and senior citizens get {DISCOUNT_PERCENT}% off with a verified ID.
      </p>

      {!loaded ? (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {POPULAR.map((p) => (
            <div key={p.stop} className="h-56 rounded-3xl bg-white border border-brand-forest-900/10 animate-pulse" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-brand-forest-900/20 bg-white/60 p-6 text-ink-600">
          Fares couldn&apos;t be loaded right now. Sign in to see every route and fare.
        </p>
      ) : (
        <ul className={`mt-10 grid gap-4 sm:grid-cols-2 ${COLS[cards.length] ?? "lg:grid-cols-4"}`}>
          {cards.map(({ stop, name, province, hours, route }) => {
            const km = route.distance != null ? Number(route.distance) : null;
            const travel = hours ?? (km ? Math.max(1, Math.round((km / AVERAGE_KMH) * 2) / 2) : null);
            const params = new URLSearchParams({ origin: route.origin, destination: route.destination });
            return (
              <li key={stop} className="rounded-3xl bg-white border border-brand-forest-900/10 p-5 flex flex-col">
                <p className="text-sm text-ink-600">{province}</p>
                <h3 className="font-display font-bold text-2xl text-brand-forest-900">{name}</h3>
                <p className="mt-4 font-display font-bold text-3xl text-brand-forest-900 tabular-nums">{formatPeso(route.base_fare)}</p>
                <p className="text-sm text-ink-600">
                  {route.special_fare != null ? `${formatPeso(route.special_fare)} student / special fare` : "Regular fare"}
                </p>
                <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <dt className="text-ink-600">Distance</dt>
                    <dd className="font-semibold tabular-nums">{km != null ? `${km} km` : "—"}</dd>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <dt className="text-ink-600">Travel time</dt>
                    <dd className="font-semibold tabular-nums">{travel != null ? `about ${travel} hr` : "—"}</dd>
                  </div>
                </dl>
                <Link
                  to={`/passenger/trips?${params}`}
                  className="mt-5 inline-flex items-center justify-center min-h-11 rounded-xl border-2 border-brand-forest-900 text-brand-forest-900 font-semibold hover:bg-brand-forest-900 hover:text-white transition-colors"
                >
                  See trips to {name}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── For the terminal (role tabs) ──────────────────────────────────────── */
function ForTheTerminal() {
  const panels = {
    passengers: {
      icon: Armchair,
      lines: ["Pick your exact seat on a live seat map", "A digital receipt with your booking code", "Follow your bus live on the map"],
    },
    staff: {
      icon: Ticket,
      lines: ["Sell walk-in tickets at the counter", "Check online bookings in one tap", "Print the passenger list for each trip"],
    },
    admins: {
      icon: MapPinned,
      lines: ["See every bus and route at a glance", "Schedule trips without double-assigning a bus or driver", "Reports on trips, fleet use and bookings"],
    },
  };
  const tabs = [
    { key: "passengers", label: "Passengers", shot: SHOTS.rolePassengers },
    { key: "staff", label: "Terminal staff", shot: SHOTS.roleStaff },
    { key: "admins", label: "Management", shot: SHOTS.roleAdmins },
  ];
  const [active, setActive] = useState("passengers");
  const tab = tabs.find((t) => t.key === active);
  const Icon = panels[active].icon;

  return (
    <section className="bg-white border-y border-brand-forest-900/10">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
        <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900 max-w-2xl">One system for everyone at the terminal.</h2>
        <p className="mt-3 text-ink-600 max-w-2xl">The seat you book online is the same seat the counter sees, so it can&apos;t be sold twice.</p>

        <div className="mt-8 inline-flex flex-wrap gap-1 rounded-full bg-surface border border-brand-forest-900/10 p-1" role="tablist" aria-label="Who uses it">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              onClick={() => setActive(t.key)}
              className={`px-4 min-h-10 rounded-full text-sm font-semibold transition-colors ${active === t.key ? "bg-brand-forest-900 text-white" : "text-ink-600 hover:text-brand-forest-900"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-10 md:grid-cols-2 md:items-center" role="tabpanel">
          <Shot src={tab.shot} alt={`${tab.label} view of D' Rising Sun`} note={`${tab.label} screenshot — 960 × 720`} />
          <div>
            <Icon className="w-8 h-8 text-brand-green-600" aria-hidden="true" />
            <ul className="mt-4 space-y-3">
              {panels[active].lines.map((line) => (
                <li key={line} className="flex gap-3 text-lg text-brand-forest-900">
                  <Navigation className="w-4 h-4 mt-1.5 shrink-0 rotate-90 text-brand-sunrise-500" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ───────────────────────────────────────────────────────────────── */
function Faq() {
  const items = [
    {
      q: "Do I pay online?",
      a: "No. Booking online reserves your seat. You pay at the terminal or when you board, in cash or by e-wallet.",
    },
    {
      q: "Do I need an account to book?",
      a: "Yes. Sign up with your email so your bookings, receipts and live tracking are all in one place.",
    },
    {
      q: "Is there a discount for students, PWDs and senior citizens?",
      a: `Yes, ${DISCOUNT_PERCENT}% off your own seat. Upload a photo of your ID when you sign up or later from your profile; it applies once terminal staff verify it.`,
    },
    {
      q: "What if the bus loses signal in the mountains?",
      a: "Its location keeps being recorded on the driver's device and is sent as soon as the bus is back in range, so the map catches up on its own.",
    },
  ];
  return (
    <section className="max-w-3xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
      <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900">Questions passengers ask</h2>
      <div className="mt-8 divide-y divide-brand-forest-900/10 border-y border-brand-forest-900/10">
        {items.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold text-lg text-brand-forest-900">
              {q}
              <ChevronDown className="w-5 h-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="mt-3 text-ink-600 leading-relaxed">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── Final call to action ──────────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="px-5 sm:px-6 pb-16 sm:pb-24">
      <div className="hero-forest max-w-6xl mx-auto rounded-[2rem] px-6 py-14 sm:px-12 sm:py-20">
        <h2 className="font-display font-bold text-3xl sm:text-5xl max-w-2xl leading-tight">Reserve your seat before the line forms.</h2>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/login/passenger" className="inline-flex items-center min-h-12 px-6 rounded-full bg-brand-sunrise-500 hover:bg-brand-sunrise-400 text-brand-forest-950 font-display font-semibold">
            Book a seat
          </Link>
          <a href="#routes" className="inline-flex items-center min-h-12 px-6 rounded-full border border-white/30 hover:bg-white/10 font-semibold">
            See routes &amp; fares
          </a>
        </div>
      </div>
    </section>
  );
}
