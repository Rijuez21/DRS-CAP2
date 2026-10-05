import { Link, Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth, AUTH_NOTICE_KEY } from "../../context/AuthContext";

// Each role's own login page and home, so a bounced user lands somewhere
// that makes sense for them.
const LOGIN_PATH = { passenger: "/login/passenger", driver: "/login/staff", staff: "/login/staff?as=staff", admin: "/login/admin" };
const HOME_PATH = { passenger: "/passenger/home", driver: "/driver/dashboard", staff: "/staff/walk-in", admin: "/admin/dashboard" };
const ROLE_LABEL = { passenger: "passengers", driver: "drivers", staff: "terminal staff", admin: "administrators" };

/**
 * Wrap a layout route with this to require a logged-in user of a given role.
 * Logged out -> that role's login page, with a one-line reason and a way
 * back to the page they wanted. Wrong role -> an explanation with a button
 * to their own home. Before, both cases silently dropped the user on the
 * landing page with no idea why.
 */
export default function RequireRole({ role, children }) {
  const { user, signOut, signOutReason } = useAuth();
  const location = useLocation();

  // They just tapped Log Out: take them home, not to a "please log in" nag.
  if (!user && signOutReason === "manual") {
    return <Navigate to="/" replace />;
  }

  if (!user) {
    // Read only — rendering must not have side effects (React may render
    // twice). LoginForm clears the notice once it has shown it.
    const notice = sessionStorage.getItem(AUTH_NOTICE_KEY) || "Please log in to continue.";
    return (
      <Navigate
        to={LOGIN_PATH[role]}
        replace
        state={{ notice, from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (user.role !== role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div role="alert" className="max-w-sm w-full rounded-3xl bg-white border border-slate-100 shadow-sm p-6 text-center space-y-4">
          <ShieldAlert className="w-10 h-10 mx-auto text-brand-sunrise-500" />
          <div className="space-y-1">
            <h1 className="font-display text-lg font-bold">This page is for {ROLE_LABEL[role]}</h1>
            <p className="text-sm text-ink-600">
              You're logged in as {user.name ?? "a user"} ({ROLE_LABEL[user.role]?.replace(/s$/, "") ?? user.role}).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              to={HOME_PATH[user.role] ?? "/"}
              className="w-full bg-brand-green-600 hover:bg-brand-green-500 text-white font-display font-semibold rounded-xl py-2.5"
            >
              Go to my home
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="w-full border border-slate-200 text-ink-900 font-display font-semibold rounded-xl py-2.5 hover:bg-slate-50"
            >
              Log out and switch account
            </button>
          </div>
        </div>
      </div>
    );
  }
  return children;
}
