import { createContext, useContext, useEffect, useState } from "react";
import { setAuthToken, onUnauthorized } from "../lib/api";
import { setSocketToken } from "../lib/socket";

// Shown once on the login page after an automatic sign-out.
export const AUTH_NOTICE_KEY = "drs_auth_notice";

const AuthContext = createContext(null);
const STORAGE_KEY = "drs_auth_user";

export function AuthProvider({ children }) {
  // Stored/held together as one { user, token } object so a page refresh
  // rehydrates both the account info and the JWT api.js needs to send as
  // a Bearer header on requests that now require it.
  const [auth, setAuth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      // Hand the token to api.js right now, during the first render, not
      // only in the effect below: React runs a child's effects BEFORE its
      // parent's, so a page that fetches an authenticated endpoint on mount
      // (FlagBus.jsx does) would otherwise go out with no Bearer header on
      // a page refresh and get a 401. The effect still keeps it in sync on
      // sign-in/sign-out.
      setAuthToken(parsed?.token);
      setSocketToken(parsed?.token);
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (auth) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      setAuthToken(auth.token);
      setSocketToken(auth.token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setAuthToken(null);
      setSocketToken(null);
    }
  }, [auth]);

  // Expired/invalid token anywhere in the app -> sign out with a reason.
  // RequireRole then sends the user to their own login page.
  // Why the user is signed out: "manual" (they tapped Log Out — go home
  // quietly) or null (never logged in, or the session expired — RequireRole
  // sends them to their login page with a reason).
  const [signOutReason, setSignOutReason] = useState(null);

  useEffect(() => {
    onUnauthorized(() => {
      setSignOutReason(null);
      sessionStorage.setItem(AUTH_NOTICE_KEY, "Your session has expired. Please log in again.");
      setAuth(null);
    });
    return () => onUnauthorized(null);
  }, []);

  function signIn(accountFromApi) {
    // accountFromApi is { user: { id, name, email, role }, token } from
    // POST /api/auth/login.
    // Same reason as the initializer above: the page navigated to right
    // after login may fetch before the sync effect runs.
    setAuthToken(accountFromApi.token ?? null);
    setSocketToken(accountFromApi.token ?? null);
    sessionStorage.removeItem(AUTH_NOTICE_KEY);
    setSignOutReason(null);
    setAuth({ user: accountFromApi.user ?? accountFromApi, token: accountFromApi.token ?? null });
  }

  function signOut() {
    setSignOutReason("manual");
    setAuth(null);
  }

  return (
    <AuthContext.Provider value={{ user: auth?.user ?? null, token: auth?.token ?? null, signIn, signOut, signOutReason }}>
      {children}
    </AuthContext.Provider>
  );
}

// The provider and its hook live together (standard React context pattern);
// fast refresh just does a full reload when this file changes.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
