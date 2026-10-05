import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bus, Ticket } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

const SUB_ROLES = [
  { role: "driver", label: "Driver", icon: Bus, redirectPath: "/driver/dashboard" },
  { role: "staff", label: "Terminal Staff", icon: Ticket, redirectPath: "/staff/walk-in" },
];

// One login page for Driver + Terminal Staff (same module, one link:
// /login/staff). The backend still needs to know which table to check
// (drivers vs. staff_accounts), so this small tab picks that — it's not a
// role-selection landing screen, just part of this one login form.
export default function StaffLogin() {
  // ?as=staff opens on the Terminal Staff tab (used when a staff member's
  // session expires), otherwise Driver — the more common login here.
  const [searchParams] = useSearchParams();
  const [subRole, setSubRole] = useState(searchParams.get("as") === "staff" ? "staff" : "driver");
  const active = SUB_ROLES.find((r) => r.role === subRole);

  return (
    <AuthShell roleLabel="Driver / Terminal Staff Login">
      <div className="grid grid-cols-2 gap-2 mb-5 bg-brand-forest-900/5 rounded-xl p-1">
        {SUB_ROLES.map(({ role, label, icon: Icon }) => (
          <button
            key={role}
            type="button"
            onClick={() => setSubRole(role)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
              subRole === role
                ? "bg-white shadow-sm text-brand-forest-900"
                : "text-ink-600 hover:text-brand-forest-900"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <LoginForm key={subRole} role={active.role} redirectPath={active.redirectPath} />
    </AuthShell>
  );
}
