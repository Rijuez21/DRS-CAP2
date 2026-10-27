import { Map } from "lucide-react";
import RoleLayout from "./RoleLayout";
import sunLogo from "../../assets/logo-sun.svg";

// Bus owners only track their own buses, so the portal has one page.
const links = [{ to: "tracking", label: "Live Tracking", short: "Tracking", icon: Map, tab: true }];

const theme = {
  sidebar: "bg-linear-to-b from-sky-900 to-slate-950",
  activeLink: "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-brand-sunrise-400)]",
  idleLink: "text-white/70 hover:bg-white/5 hover:text-white",
  muted: "text-white/50",
  tabActive: "text-sky-900",
};

export default function OwnerLayout() {
  return <RoleLayout title="DRS Owner" links={links} theme={theme} logo={sunLogo} />;
}
