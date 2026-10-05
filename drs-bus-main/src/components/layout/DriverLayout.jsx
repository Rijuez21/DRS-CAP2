import { LayoutDashboard, Bus, CalendarDays, Users, User } from "lucide-react";
import RoleLayout from "./RoleLayout";

// Drivers work from their phones, so the two things done every trip are
// bottom tabs; the rest are one tap away in the menu.
const links = [
  { to: "dashboard", label: "My Trips", short: "Trips", icon: LayoutDashboard, tab: true },
  { to: "manifest", label: "Passenger List", short: "Passengers", icon: Users, tab: true },
  { to: "assigned-bus", label: "Assigned Bus", icon: Bus },
  { to: "route-schedule", label: "Route Schedule", icon: CalendarDays },
  { to: "profile", label: "Profile", icon: User },
];

const theme = {
  sidebar: "bg-emerald-700",
  activeLink: "bg-emerald-900 text-white",
  idleLink: "text-white/85 hover:bg-emerald-600 hover:text-white",
  muted: "text-emerald-200",
  tabActive: "text-emerald-700",
};

export default function DriverLayout() {
  return <RoleLayout title="DRS Driver" links={links} theme={theme} bell="driver" />;
}
