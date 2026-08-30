import { Link } from "react-router-dom";
import { UserRound, Bus, ShieldCheck } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";

const roles = [
  {
    to: "/login/passenger",
    label: "Passenger",
    icon: UserRound,
    desc: "Book trips and track your bus",
  },
  {
    to: "/login/driver",
    label: "Driver",
    icon: Bus,
    desc: "View trips and manage your route",
  },
  {
    to: "/login/admin",
    label: "Admin",
    icon: ShieldCheck,
    desc: "Manage fleet, routes, and staff",
  },
];

export default function RoleSelect() {
  return (
    <AuthShell roleTag="Select how you'd like to sign in">
      <div className="space-y-3">
        {roles.map(({ to, label, icon: Icon, desc }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-2xl bg-white border border-slate-100 p-4 hover:border-brand-green-500/50 hover:shadow-md transition"
          >
            <span className="w-10 h-10 rounded-xl bg-brand-forest-900 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-brand-sunrise-400" />
            </span>
            <span>
              <span className="block font-display font-semibold text-ink-900">
                {label}
              </span>
              <span className="block text-xs text-ink-600">{desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}
