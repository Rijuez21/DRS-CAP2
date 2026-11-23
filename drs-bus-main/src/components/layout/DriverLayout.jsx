import { LayoutDashboard, Bus, CalendarDays, Users, User, Banknote } from "lucide-react";
import RoleLayout from "./RoleLayout";
import { useAuth } from "../../context/AuthContext";

// The bus crew app: drivers and conductors sign in here with their own
// accounts. Crew work from their phones, so the things done every trip are
// bottom tabs; the rest are one tap away in the menu. A conductor's day is
// passengers and fares, so those tabs lead.
const DRIVER_LINKS = [
  { to: "dashboard", label: "My Trips", short: "Trips", icon: LayoutDashboard, tab: true },
  { to: "manifest", label: "Passenger List", short: "Passengers", icon: Users, tab: true },
  { to: "fares", label: "Fare Collection", short: "Fares", icon: Banknote, tab: true },
  { to: "assigned-bus", label: "Assigned Bus", icon: Bus },
  { to: "route-schedule", label: "Route Schedule", icon: CalendarDays },
  { to: "profile", label: "Profile", icon: User },
];
const CONDUCTOR_LINKS = [
  { to: "dashboard", label: "My Trips", short: "Trips", icon: LayoutDashboard, tab: true },
  { to: "fares", label: "Fares & Walk-ons", short: "Fares", icon: Banknote, tab: true },
  { to: "manifest", label: "Passenger List", short: "Passengers", icon: Users, tab: true },
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
  const { user } = useAuth();
  const conductor = user?.crewRole === "Conductor";
  return <RoleLayout title={conductor ? "DRS Conductor" : "DRS Driver"} links={conductor ? CONDUCTOR_LINKS : DRIVER_LINKS} theme={theme} bell="driver" />;
}
