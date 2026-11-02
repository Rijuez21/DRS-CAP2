import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Bus, CloudUpload, Database, MapPin, MonitorSmartphone, Users } from "lucide-react";
import SiteChrome from "../components/landing/SiteChrome";
import RouteLine from "../components/landing/RouteLine";
import Shot from "../components/landing/Shot";
import { TERMINAL, terminalDirectionsUrl } from "../lib/terminal";

import aboutTerminal from "../assets/about-terminal.jpg";
import aboutTeam from "../assets/about-team.jpg";

// ── Pictures (same steps as on LandingPage.jsx) ───────────────────────────
const SHOTS = {
  terminal: aboutTerminal,
  team: aboutTeam,
};

// ── Our story ─────────────────────────────────────────────────────────────
// Write the company's own history here (when it started, who founded it,
// how the fleet grew). Each string is one paragraph. Keep it true: this is
// the page people read to decide whether to trust you.
const STORY = [
  "D' Rising Sun Transport runs buses out of Baguio City and up the Halsema Highway, one of the highest and most demanding roads in the country. Our passengers are the people who live and work along it: farmers and vendors heading to market, students going home for the weekend, workers commuting to town, and visitors on their way to Sagada and Bontoc.",
  "For years, getting a seat meant going to the terminal early and waiting in line, with no way of knowing whether the next bus was full or where it was on the road. We built our booking and tracking system to change that, so passengers can reserve a seat from home, pay when they board, and follow their bus on a live map.",
];

export default function AboutPage() {
  // Open at the top even when arriving from the bottom of another page.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  const values = [
    { icon: Users, title: "Built around our passengers", text: "Fair fares by distance, discounts for students, PWDs and senior citizens, and payment the way people already pay: cash or e-wallet." },
    { icon: MapPin, title: "Made for mountain roads", text: "Tracking that keeps recording through dead spots and fills in the map once the signal returns." },
    { icon: Bus, title: "Safe, accountable trips", text: "Every bus is monitored live from the terminal, and every booking lands on the trip's passenger list." },
  ];
  const stack = [
    { icon: MonitorSmartphone, title: "One app on any device", text: "Passengers, terminal staff, drivers and management use the same system on a phone or a computer." },
    { icon: CloudUpload, title: "Live updates", text: "Bus locations and seat changes reach every screen within moments, including the terminal counter." },
    { icon: Database, title: "Seats that can't be double-booked", text: "Each seat is locked the moment it's reserved, online or at the counter." },
  ];

  return (
    <SiteChrome>
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-12 pb-12 sm:pt-20">
        <h1 className="font-display font-bold text-4xl sm:text-6xl leading-[1.05] tracking-tight text-brand-forest-900 max-w-3xl">
          We drive the road between Baguio and the Cordillera towns.
        </h1>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <Shot src={SHOTS.terminal} alt="D' Rising Sun bus at the Baguio terminal" aspect="aspect-video" rounded="rounded-3xl" note="Terminal or bus photo — 1200 × 675" />
          <div className="space-y-4 text-lg leading-relaxed text-ink-600">
            {STORY.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white border-y border-brand-forest-900/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-14">
          <h2 className="font-display font-semibold text-2xl sm:text-3xl text-brand-forest-900">The line we run</h2>
          <div className="mt-8">
            <RouteLine />
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-20">
        <h2 className="font-display font-semibold text-3xl sm:text-4xl text-brand-forest-900">What we care about</h2>
        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {values.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="w-12 h-12 rounded-2xl bg-brand-forest-900 text-brand-sunrise-400 flex items-center justify-center">
                <Icon className="w-6 h-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-display font-semibold text-xl text-brand-forest-900">{title}</h3>
              <p className="mt-2 text-ink-600 leading-relaxed">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="hero-forest">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-20 grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="font-display font-semibold text-3xl sm:text-4xl">The system behind the seats</h2>
            <p className="mt-3 text-white/75 max-w-lg">Our booking and tracking platform connects the passenger app, the terminal counter, the drivers on the road and the management office.</p>
            <ul className="mt-8 space-y-5">
              {stack.map(({ icon: Icon, title, text }) => (
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
            </ul>
          </div>
          <Shot src={SHOTS.team} alt="The D' Rising Sun team" aspect="aspect-video" rounded="rounded-3xl" note="Team or crew photo — 1200 × 675" />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-16 sm:py-20 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="font-display font-semibold text-3xl text-brand-forest-900">Visit the terminal</h2>
          <p className="mt-2 text-lg text-ink-600">
            {TERMINAL.name}, {TERMINAL.address}.{" "}
            <a href={terminalDirectionsUrl()} target="_blank" rel="noreferrer" className="font-semibold text-brand-green-600 underline underline-offset-2">
              Get directions
            </a>
          </p>
        </div>
        <Link to="/login/passenger" className="inline-flex items-center justify-center min-h-12 px-6 rounded-full bg-brand-forest-900 hover:bg-brand-forest-800 text-white font-display font-semibold">
          Book a seat
        </Link>
      </section>
    </SiteChrome>
  );
}
