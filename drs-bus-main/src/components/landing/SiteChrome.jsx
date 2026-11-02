import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import sunLogo from "../../assets/logo-sun.svg";
import ContactModal from "./ContactModal";

// Header + footer shared by the landing page and the About page, with the
// Contact window built in. `home` marks the landing page: its section links
// jump within the page; from other pages they go back to "/" first.
const SECTION_LINKS = [
  { hash: "routes", label: "Routes & fares" },
  { hash: "tracking", label: "Live tracking" },
  { hash: "how-it-works", label: "How it works" },
];

export default function SiteChrome({ home = false, children }) {
  const [contactOpen, setContactOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sectionHref = (hash) => (home ? `#${hash}` : `/#${hash}`);

  const navItems = (
    <>
      {SECTION_LINKS.map((l) => (
        <a key={l.hash} href={sectionHref(l.hash)} onClick={() => setMenuOpen(false)} className="hover:text-brand-forest-900">
          {l.label}
        </a>
      ))}
      <Link to="/about" onClick={() => setMenuOpen(false)} className="hover:text-brand-forest-900">
        About us
      </Link>
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setContactOpen(true);
        }}
        className="text-left hover:text-brand-forest-900"
      >
        Contact
      </button>
    </>
  );

  return (
    <div className="bg-surface text-ink-900 min-h-screen">
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-brand-forest-900/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <img src={sunLogo} alt="" className="w-8 h-8" />
            <span className="font-display font-bold text-lg text-brand-forest-900">D&apos; Rising Sun</span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-ink-600" aria-label="Main">
            {navItems}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login/passenger"
              className="inline-flex items-center min-h-10 px-4 rounded-full text-sm font-semibold text-white bg-brand-forest-900 hover:bg-brand-forest-800"
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-brand-forest-900/5"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden border-t border-brand-forest-900/10 px-5 py-4 flex flex-col gap-4 text-base font-medium text-ink-600" aria-label="Main">
            {navItems}
          </nav>
        )}
      </header>

      {children}

      <footer className="bg-brand-forest-950 text-white/70">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2">
              <img src={sunLogo} alt="" className="w-8 h-8" />
              <span className="font-display font-bold text-lg text-white">D&apos; Rising Sun Transport</span>
            </Link>
            <p className="mt-3 text-sm max-w-xs">Buses from Baguio City up the Halsema Highway to the towns of the Cordillera.</p>
          </div>
          <div className="text-sm space-y-2.5">
            <p className="font-semibold text-white">Passengers</p>
            <Link to="/login/passenger" className="block hover:text-white">Book a seat</Link>
            <a href={sectionHref("routes")} className="block hover:text-white">Routes &amp; fares</a>
            <button type="button" onClick={() => setContactOpen(true)} className="block hover:text-white">
              Contact us
            </button>
          </div>
          <div className="text-sm space-y-2.5">
            <p className="font-semibold text-white">Company</p>
            <Link to="/about" className="block hover:text-white">About us</Link>
            <Link to="/privacy-policy" className="block hover:text-white">Privacy Statement</Link>
            <Link to="/login/staff" className="block hover:text-white">Staff &amp; driver sign in</Link>
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="max-w-6xl mx-auto px-5 sm:px-6 py-5 text-xs text-white/50">© {new Date().getFullYear()} D&apos; Rising Sun Transport. All rights reserved.</p>
        </div>
      </footer>

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
    </div>
  );
}
