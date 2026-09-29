import { LayoutDashboard, Bus, Map, Route, IdCard, CalendarClock, Ticket, Wrench, BarChart3, Users, Wallet, QrCode } from "lucide-react";
import RoleLayout from "./RoleLayout";

// Admin work is mostly desktop, but the four most-checked screens are
// bottom tabs on a phone; everything else is in the menu.
const links = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard, tab: true },
  { to: "trips", label: "Trip Scheduling", short: "Trips", icon: CalendarClock, tab: true },
  { to: "reservations", label: "Reservations", short: "Bookings", icon: Ticket, tab: true },
  { to: "payments", label: "Online Payments", icon: Wallet },
  { to: "payment-settings", label: "Payment QR", icon: QrCode },
  { to: "tracking", label: "Live Tracking", short: "Tracking", icon: Map, tab: true },
  { to: "fleet", label: "Fleet Management", icon: Bus },
  { to: "routes", label: "Route Management", icon: Route },
  { to: "drivers", label: "Driver Management", icon: IdCard },
  { to: "maintenance", label: "Maintenance & Issues", icon: Wrench },
  { to: "reports", label: "Reports & Analytics", icon: BarChart3 },
  { to: "users", label: "User Management", icon: Users },
];

const theme = {
  sidebar: "bg-slate-800",
  activeLink: "bg-slate-950 text-white",
  idleLink: "text-white/80 hover:bg-slate-700 hover:text-white",
  muted: "text-slate-400",
  tabActive: "text-slate-900",
};

export default function AdminLayout() {
  return <RoleLayout title="DRS Admin" links={links} theme={theme} />;
}
