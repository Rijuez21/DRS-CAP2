import { LayoutDashboard, Bus, Map, Route, IdCard, CalendarClock, Ticket, BarChart3, Users, Wallet, QrCode, Satellite } from "lucide-react";
import RoleLayout from "./RoleLayout";
import sunLogo from "../../assets/logo-sun.svg";

// Admin work is mostly desktop, but the four most-checked screens are
// bottom tabs on a phone; everything else is in the menu.
const links = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard, tab: true },
  { to: "trips", label: "Trip Scheduling", short: "Trips", icon: CalendarClock, tab: true },
  { to: "reservations", label: "Reservations", short: "Bookings", icon: Ticket, tab: true },
  { to: "payments", label: "Payment Verification", icon: Wallet },
  { to: "payment-settings", label: "Payment Methods", icon: QrCode },
  { to: "tracking", label: "Live Tracking", short: "Tracking", icon: Map, tab: true },
  { to: "gps", label: "GPS Tracker", icon: Satellite },
  { to: "fleet", label: "Fleet Management", icon: Bus },
  { to: "routes", label: "Route Management", icon: Route },
  { to: "drivers", label: "Driver Management", icon: IdCard },
  { to: "reports", label: "Reports & Analytics", icon: BarChart3 },
  { to: "users", label: "User Management", icon: Users },
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

export default function AdminLayout() {
  return <RoleLayout title="DRS Admin" links={links} theme={theme} bell="staff" logo={sunLogo} />;
}
