import { Home, CalendarClock, Hand, Ticket, User } from "lucide-react";
import RoleLayout from "./RoleLayout";

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
  sidebar: "bg-brand-forest-900",
  activeLink: "bg-white/10 text-white",
  idleLink: "text-white/70 hover:bg-white/5 hover:text-white",
  muted: "text-white/50",
  tabActive: "text-brand-green-600",
};

export default function PassengerLayout() {
  return <RoleLayout title="D' Rising Sun" links={links} theme={theme} bell="passenger" />;
}
