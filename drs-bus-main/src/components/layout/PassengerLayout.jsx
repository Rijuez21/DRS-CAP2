import { Home, CalendarClock, Hand, Ticket, User } from "lucide-react";
import RoleLayout from "./RoleLayout";
import sunLogo from "../../assets/logo-sun.svg";

const links = [
  { to: "home", label: "Home", icon: Home, tab: true },
  // The two ride modes get their own top-level tabs so a passenger never
  // has to discover Flag a Bus from inside the booking flow (or vice
  // versa) — they're different situations: at the terminal vs. already
  // on the roadside. "trips" keeps its path; only the label is clearer.
  { to: "trips", label: "Book Ahead", short: "Book", icon: CalendarClock, tab: true },
  { to: "flag", label: "Flag a Bus", short: "Flag Bus", icon: Hand, tab: true },
  { to: "my-bookings", label: "My Bookings", short: "Bookings", icon: Ticket, tab: true },
  { to: "profile", label: "Profile", icon: User, tab: true },
];

const theme = {
  sidebar: "bg-linear-to-b from-brand-forest-900 to-brand-forest-950",
  activeLink: "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-brand-sunrise-400)]",
  idleLink: "text-white/70 hover:bg-white/5 hover:text-white",
  muted: "text-white/50",
  tabActive: "text-brand-forest-900",
  tabBar: "bg-white/90 backdrop-blur-md border-t border-slate-200/70 shadow-[0_-8px_24px_-16px_rgba(18,39,27,0.35)]",
  tabPill: "bg-brand-green-500/15 text-brand-green-600",
  avatar: "bg-brand-sunrise-400 text-brand-forest-950",
};

export default function PassengerLayout() {
  return <RoleLayout title="D' Rising Sun" links={links} theme={theme} bell="passenger" logo={sunLogo} />;
}
