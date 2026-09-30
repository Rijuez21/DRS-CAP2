import { Ticket, ScanLine, Wallet, CalendarClock } from "lucide-react";
import RoleLayout from "./RoleLayout";

const links = [
  { to: "walk-in", label: "Walk-in Sales", short: "Sell Ticket", icon: Ticket, tab: true },
  { to: "validate", label: "Validate Reservation", short: "Validate", icon: ScanLine, tab: true },
  { to: "payments", label: "Online Payments", short: "Payments", icon: Wallet, tab: true },
  { to: "trips", label: "Trip Schedules", short: "Schedules", icon: CalendarClock, tab: true },
];

const theme = {
  sidebar: "bg-amber-700",
  activeLink: "bg-amber-900 text-white",
  idleLink: "text-white/85 hover:bg-amber-600 hover:text-white",
  muted: "text-amber-100",
  tabActive: "text-amber-700",
};

export default function StaffLayout() {
  return <RoleLayout title="DRS Terminal" links={links} theme={theme} />;
}