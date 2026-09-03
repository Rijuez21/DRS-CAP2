import { useState } from "react";
import { Link } from "react-router-dom";
import useScrollReveal from "../hooks/useScrollReveal";
import sunLogo from "../assets/logo-sun.svg";

const stripeStyle = {
  background:
    "repeating-linear-gradient(135deg, #E9EBE4 0px, #E9EBE4 10px, #DFE2D9 10px, #DFE2D9 20px)",
};

export default function LandingPage() {
  useScrollReveal();

  return (
    <div className="bg-surface text-ink-900">
      {/* NAV */}
      <header className="border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <img src={sunLogo} alt="D' Rising Sun logo" className="w-7 h-7" />
            <span className="font-landing font-bold text-xl tracking-tight text-brand-forest-900">
              D&apos; Rising Sun
            </span>
          </span>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-ink-600">
            <a href="#solution" className="hover:text-ink-900">Platform</a>
            <a href="#driver-safety" className="hover:text-ink-900">Safety</a>
            <a href="#stack" className="hover:text-ink-900">Technology</a>
            <a href="#" className="hover:text-ink-900">Docs</a>
          </nav>

          <Link
            to="/select-role"
            className="inline-flex items-center px-4 py-2 rounded text-sm font-semibold text-white bg-brand-green-600 hover:bg-brand-green-500 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* 1. HERO — text reveals first, then mobile mockup, then desktop mockup */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 grid md:grid-cols-2 gap-12 items-center">
        <div data-reveal>
          <h1 className="font-landing font-bold text-4xl sm:text-5xl leading-[1.1] tracking-tight text-brand-forest-900">
            Smart transit for rugged terrains.
          </h1>
          <p className="mt-6 text-lg leading-relaxed max-w-md text-ink-600">
            D&apos; Rising Sun Transport is bringing order to travel across
            the Cordillera — real-time booking, live GIS tracking, and
            offline-proof telemetry, built for our routes through mountain
            terrain and dead zones.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/select-role"
              className="inline-flex items-center px-5 py-3 rounded text-sm font-semibold text-white bg-brand-green-600 hover:bg-brand-green-500 transition-colors"
            >
              Get Started
            </Link>
            <a
              href="#solution"
              className="inline-flex items-center px-5 py-3 rounded text-sm font-semibold border border-slate-200 text-ink-900"
            >
              See the platform
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div
            data-reveal="1"
            style={stripeStyle}
            className="rounded border border-slate-200 aspect-9/16 max-w-55 mx-auto md:mx-0 flex items-center justify-center text-xs text-center p-4 text-ink-600"
          >
            Mobile mockup placeholder
            <br />
            375 × 667 — Passenger booking app
          </div>
          <div
            data-reveal="2"
            style={stripeStyle}
            className="rounded border border-slate-200 aspect-16/10 flex items-center justify-center text-xs text-center p-4 text-ink-600"
          >
            Desktop mockup placeholder
            <br />
            1200 × 750 — Admin fleet dashboard
          </div>
        </div>
      </section>

      {/* 2. THE OPERATIONAL REALITY — heading, then 3 columns cascading left to right */}
      <section className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 data-reveal className="font-landing font-semibold text-2xl sm:text-3xl max-w-xl text-brand-forest-900">
            Regional transit runs on a different set of problems.
          </h2>

          <div className="mt-10 grid md:grid-cols-3">
            <div data-reveal="1" className="pt-6 pr-6 md:border-r border-slate-200">
              <h3 className="font-landing font-semibold text-lg">
                Extreme geography
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                Steep terrain, narrow roads, and real safety risk define
                these routes. The Cordillera Administrative Region records
                18.7 traffic deaths per 100,000 people, against a 12.3
                national average — this isn't a convenience problem, it's a
                safety one.
              </p>
            </div>
            <div data-reveal="2" className="pt-6 md:px-6 border-t md:border-t-0 md:border-r border-slate-200 mt-6 md:mt-0">
              <h3 className="font-landing font-semibold text-lg">
                Connectivity gaps
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                Mountain route dead zones break generic GPS trackers built
                for flat, well-covered cities — leaving operators with gaps
                in the record exactly where visibility matters most.
              </p>
            </div>
            <div data-reveal="3" className="pt-6 md:pl-6 border-t md:border-t-0 border-slate-200 mt-6 md:mt-0">
              <h3 className="font-landing font-semibold text-lg">
                Manual bottlenecks
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                Walk-in counters and text-based dispatching cause terminal
                queues, double-bookings, and quiet revenue leakage that's
                hard to trace after the fact.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CORE VALUE PILLARS — each row: text reveals, then its image */}
      <section id="solution" className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 data-reveal className="font-landing font-semibold text-2xl sm:text-3xl max-w-xl text-brand-forest-900">
            Three systems, working from one shared record.
          </h2>

          {/* Pillar A */}
          <div className="mt-14 grid md:grid-cols-2 gap-10 items-center">
            <div
              data-reveal="1"
              style={stripeStyle}
              className="rounded border border-slate-200 aspect-4/3 flex items-center justify-center text-xs text-center p-4 text-ink-600"
            >
              Screenshot placeholder
              <br />
              960 × 720 — Ticket counter + seat sync view
            </div>
            <div data-reveal>
              <span className="text-xs font-semibold text-brand-green-600">
                Pillar A
              </span>
              <h3 className="font-landing font-semibold text-xl mt-2">
                Double-booking prevention &amp; ticket counter sync
              </h3>
              <p className="mt-3 text-sm leading-relaxed max-w-md text-ink-600">
                Over-the-counter and mobile seat bookings sync in real time,
                so a seat sold at the terminal is instantly unavailable
                online — and passengers can reserve online while paying in
                cash at the terminal.
              </p>
            </div>
          </div>

          {/* Pillar B */}
          <div className="mt-16 grid md:grid-cols-2 gap-10 items-center">
            <div
              data-reveal="1"
              style={stripeStyle}
              className="md:order-2 rounded border border-slate-200 aspect-4/3 flex items-center justify-center text-xs text-center p-4 text-ink-600"
            >
              Screenshot placeholder
              <br />
              960 × 720 — Live map with route ETA
            </div>
            <div data-reveal className="md:order-1">
              <span className="text-xs font-semibold text-brand-green-600">
                Pillar B
              </span>
              <h3 className="font-landing font-semibold text-xl mt-2">
                Live GIS tracking &amp; route ETA monitoring
              </h3>
              <p className="mt-3 text-sm leading-relaxed max-w-md text-ink-600">
                Commuters and managers see the same live bus location and
                route progress bar, on an interactive map that updates as
                the trip moves through its stops.
              </p>
            </div>
          </div>

          {/* Pillar C */}
          <div className="mt-16 grid md:grid-cols-2 gap-10 items-center">
            <div
              data-reveal="1"
              style={stripeStyle}
              className="rounded border border-slate-200 aspect-4/3 flex items-center justify-center text-xs text-center p-4 text-ink-600"
            >
              Diagram placeholder
              <br />
              960 × 720 — Offline buffering to auto-sync flow
            </div>
            <div data-reveal>
              <span className="text-xs font-semibold text-brand-sunrise-500">
                Pillar C — The secret sauce
              </span>
              <h3 className="font-landing font-semibold text-xl mt-2">
                The offline-first telemetry protocol
              </h3>
              <p className="mt-3 text-sm leading-relaxed max-w-md text-ink-600">
                GPS telemetry buffers locally on the driver's Android device
                the moment a dead zone breaks the signal, then auto-syncs
                the instant the device re-enters range — so the trip record
                stays 100% complete, even on routes that drop connectivity
                for miles at a time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. DRIVER SAFETY & COMPLIANCE HUB — text reveals, then its image */}
      <section id="driver-safety" className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-10 items-center">
          <div data-reveal>
            <span className="text-xs font-semibold text-brand-sunrise-500">
              Driver app
            </span>
            <h2 className="font-landing font-semibold text-2xl sm:text-3xl mt-2 text-brand-forest-900">
              A safety checklist that's actually filled out.
            </h2>
            <p className="mt-4 text-sm leading-relaxed max-w-md text-ink-600">
              The driver app stays deliberately simple — no clutter, no
              distraction while a route is active. Before departure,
              drivers work through a mandatory pre-trip checklist covering
              the engine, tires, brakes, and lights, digitizing a compliance
              step that paper checklists let slip.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-center gap-3">
                <span className="w-4 h-4 border border-brand-sunrise-500 rounded-sm" />
                Engine — fluid levels, warning lights
              </li>
              <li className="flex items-center gap-3">
                <span className="w-4 h-4 border border-brand-sunrise-500 rounded-sm" />
                Tires — pressure, tread, visible damage
              </li>
              <li className="flex items-center gap-3">
                <span className="w-4 h-4 border border-brand-sunrise-500 rounded-sm" />
                Brakes — response, wear indicators
              </li>
              <li className="flex items-center gap-3">
                <span className="w-4 h-4 border border-brand-sunrise-500 rounded-sm" />
                Lights — headlights, signals, hazards
              </li>
            </ul>
          </div>

          <div
            data-reveal="1"
            style={stripeStyle}
            className="rounded border border-slate-200 aspect-9/16 max-w-65 mx-auto flex items-center justify-center text-xs text-center p-4 text-ink-600"
          >
            Mobile mockup placeholder
            <br />
            375 × 667 — Pre-trip checklist screen
          </div>
        </div>
      </section>

      {/* 5. ROLE-BASED DASHBOARDS */}
      <RoleTabs />

      {/* 6. TECH STACK — heading, then the 4 cards cascading in sequence */}
      <section id="stack" className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 data-reveal className="font-landing font-semibold text-2xl sm:text-3xl max-w-xl text-brand-forest-900">
            Built on infrastructure that holds up on bad connections.
          </h2>

          <div className="mt-10 grid sm:grid-cols-2 md:grid-cols-4 border-t border-l border-slate-200">
            {[
              ["React + Tailwind CSS", "Responsive interfaces for passengers, staff, and administrators alike."],
              ["Node.js + Express + Socket.io", "Real-time, bidirectional updates between drivers, terminals, and dashboards."],
              ["MySQL + Redis", "ACID-compliant storage with caching, keeping bookings double-booking-proof."],
              ["MQTT", "A lightweight protocol tuned for unstable, cellular-constrained routes."],
            ].map(([title, desc], i) => (
              <div
                key={title}
                data-reveal={String(i + 1)}
                className="p-6 border-r border-b border-slate-200"
              >
                <h3 className="font-landing font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. FINAL CTA — heading, then the button */}
      <section className="bg-brand-forest-900">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 data-reveal className="font-landing font-semibold text-2xl sm:text-3xl text-white max-w-lg mx-auto">
            Ready to see D&apos; Rising Sun in motion?
          </h2>
          <Link
            data-reveal="1"
            to="/select-role"
            className="mt-8 inline-flex items-center px-6 py-3 rounded text-sm font-semibold text-white bg-brand-green-600 hover:bg-brand-green-500 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </section>

      <footer className="bg-brand-forest-900">
        <div className="max-w-6xl mx-auto px-6 py-8 border-t border-white/10 flex flex-col sm:flex-row justify-between gap-4 text-sm text-white/60">
          <span>© 2026 D&apos; Rising Sun Transport. All rights reserved.</span>
          <div className="flex flex-wrap gap-6">
            <a href="#" className="hover:text-white">Developer Docs</a>
            <a href="#" className="hover:text-white">Privacy Statement</a>
            <a href="#" className="hover:text-white">Contact Sales</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function RoleTabs() {
  const panels = {
    passengers: [
      "Intuitive seat selection on a live seat map",
      "Digital receipts with a scannable booking code",
      "Live map view of their bus in transit",
    ],
    staff: [
      "Instant walk-in ticket counter entry",
      "One-tap validation of online bookings",
      "Manifest printing for each departing trip",
    ],
    admins: [
      "Fleet-wide control across every route and vehicle",
      "Route configuration with scheduling conflict prevention",
      "Maintenance logs linked directly to the vehicle record",
    ],
  };
  const [active, setActive] = useState("passengers");
  const tabs = [
    { key: "passengers", label: "Passengers" },
    { key: "staff", label: "Terminal Staff" },
    { key: "admins", label: "Administrators" },
  ];

  return (
    <section className="border-t border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <h2 data-reveal className="font-landing font-semibold text-2xl sm:text-3xl max-w-xl text-brand-forest-900">
          One platform, built for every seat at the terminal.
        </h2>

        <div data-reveal="1" className="mt-8 flex flex-wrap gap-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`px-4 py-2 rounded text-sm font-semibold border transition-colors ${
                active === t.key
                  ? "bg-brand-green-600 text-white border-brand-green-600"
                  : "border-slate-200 text-ink-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-10 items-center">
          <div
            data-reveal="1"
            style={stripeStyle}
            className="rounded border border-slate-200 aspect-4/3 flex items-center justify-center text-xs text-center p-4 text-ink-600 md:order-first"
          >
            Screenshot placeholder
            <br />
            960 × 720 — Role-specific dashboard view
          </div>

          <ul data-reveal="2" className="space-y-3 text-sm leading-relaxed text-ink-600">
            {panels[active].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}