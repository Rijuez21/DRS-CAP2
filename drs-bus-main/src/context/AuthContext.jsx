import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { setAuthToken, onUnauthorized, logout as logoutOnServer, checkSession } from "../lib/api";
import { setSocketToken, getSocket } from "../lib/socket";
import { idleMessage } from "../lib/idle";

// Shown once on the login page after an automatic sign-out.
export const AUTH_NOTICE_KEY = "drs_auth_notice";

const AuthContext = createContext(null);

// The session lives in sessionStorage, not localStorage: a refresh keeps you
// signed in, but closing the tab (or the installed app) signs you out.
// Before, the token sat in localStorage and reopening the site days later
// went straight back in.
const STORAGE_KEY = "drs_auth_session";
const LEGACY_STORAGE_KEY = "drs_auth_user"; // localStorage, before the change — removed on load

// sessionStorage is per tab, so a link opened in a new tab would start out
// signed out. Open tabs share the session over this channel instead: a new
// tab asks, any signed-in tab answers. With every tab closed nobody answers,
// and the visitor is signed out.
const CHANNEL_NAME = "drs-auth";
const RESTORE_WAIT_MS = 400; // how long a new tab waits for an answer
const RECHECK_MIN_MS = 30000; // at most one "still signed in?" check per this long

const sameAccount = (a, b) => Boolean(a?.user && b?.user && a.user.id === b.user.id && a.user.role === b.user.role);

function readStored() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function openChannel() {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  // Held together as one { user, token } object so a page refresh
  // rehydrates both the account info and the JWT api.js sends as a Bearer
  // header.
  const [auth, setAuth] = useState(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // storage blocked — nothing to clean up
    }
    const stored = readStored();
    // Hand the token to api.js right now, during the first render, not only
    // in the effect below: React runs a child's effects BEFORE its parent's,
    // so a page that fetches an authenticated endpoint on mount (FlagBus.jsx
    // does) would otherwise go out with no Bearer header on a page refresh
    // and get a 401. The effect still keeps it in sync afterwards.
    setAuthToken(stored?.token);
    setSocketToken(stored?.token);
    return stored;
  });
  // True while a new tab waits to hear from the other open tabs. RequireRole
  // shows a loader instead of bouncing to the login page during that moment.
  const [restoring, setRestoring] = useState(() => !auth && typeof BroadcastChannel === "function");

  // Why the user is signed out: "manual" (they tapped Log Out — go home
  // quietly) or null (never logged in, or the session ended — RequireRole
  // sends them to their login page with a reason).
  const [signOutReason, setSignOutReason] = useState(null);

  const authRef = useRef(auth);
  const channelRef = useRef(null);

  useEffect(() => {
    authRef.current = auth;
    try {
      if (auth) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage blocked — the session just won't survive a refresh
    }
    setAuthToken(auth?.token);
    setSocketToken(auth?.token);
  }, [auth]);

  const broadcast = useCallback((message) => {
    try {
      channelRef.current?.postMessage(message);
    } catch {
      // channel closed — other tabs simply aren't told
    }
  }, []);

  // The server refused our token (expired, password changed, account
  // signed in on another device…): sign out and show the reason on the
  // login page. RequireRole then sends the user to their own login page.
  const endSession = useCallback((reason) => {
    if (!authRef.current) return; // already signed out (e.g. a late reply to Log Out)
    setSignOutReason(null);
    sessionStorage.setItem(AUTH_NOTICE_KEY, reason || "Your session has expired. Please log in again.");
    setAuth(null);
  }, []);

  useEffect(() => {
    onUnauthorized(endSession);
    return () => onUnauthorized(null);
  }, [endSession]);

  // Sharing the session between this browser's open tabs.
  useEffect(() => {
    const channel = openChannel();
    channelRef.current = channel;
    if (!channel) {
      // Nobody to ask (the constructor threw): stop waiting straight away.
      const stop = setTimeout(() => setRestoring(false));
      return () => clearTimeout(stop);
    }
    channel.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return;
      const current = authRef.current;
      if (data.type === "request") {
        if (current) channel.postMessage({ type: "session", auth: current });
      } else if (data.type === "session" && data.auth?.token && data.auth?.user) {
        // An open tab answered us, signed in, or got a fresh token (password
        // change). Take it unless this tab is signed in to another account.
        if (!current || (sameAccount(current, data.auth) && current.token !== data.auth.token)) {
          setAuthToken(data.auth.token);
          setSocketToken(data.auth.token);
          setAuth(data.auth);
        }
        setRestoring(false);
      } else if (data.type === "signed-out") {
        // Logged out in another tab: the server session is gone, so this
        // tab's copy of the token is dead too. A notice (inactivity) is
        // shown on the login page here as well.
        if (sameAccount(current, data)) {
          if (typeof data.notice === "string" && data.notice) {
            endSession(data.notice);
          } else {
            setSignOutReason("manual");
            setAuth(null);
          }
        }
      }
    };
    let timer;
    if (!authRef.current) {
      channel.postMessage({ type: "request" });
      timer = setTimeout(() => setRestoring(false), RESTORE_WAIT_MS);
    }
    return () => {
      clearTimeout(timer);
      channel.close();
      channelRef.current = null;
    };
  }, [endSession]);

  // One device per account: signing in on another phone ends this session
  // on the server. A live socket is told at once ("session:revoked"); a tab
  // coming back into view asks. Either way checkSession() gets the 401 and
  // onUnauthorized above signs out with the server's reason. (The event
  // itself is only a hint — this tab may already hold a newer token from
  // another tab, in which case the check simply passes.)
  const token = auth?.token ?? null;
  useEffect(() => {
    if (!token) return undefined;
    let lastCheck = Date.now();
    const recheck = (force) => {
      if (!force && Date.now() - lastCheck < RECHECK_MIN_MS) return;
      lastCheck = Date.now();
      checkSession().catch(() => {});
    };
    const onRevoked = () => recheck(true);
    const onVisible = () => document.visibilityState === "visible" && recheck(false);
    const socket = getSocket();
    socket.on("session:revoked", onRevoked);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      socket.off("session:revoked", onRevoked);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token]);

  function signIn(accountFromApi) {
    // accountFromApi is { user: { id, name, email, role }, token } from
    // POST /api/auth/login.
    const next = { user: accountFromApi.user ?? accountFromApi, token: accountFromApi.token ?? null };
    // Same reason as the initializer above: the page navigated to right
    // after login may fetch before the sync effect runs.
    setAuthToken(next.token);
    setSocketToken(next.token);
    sessionStorage.removeItem(AUTH_NOTICE_KEY);
    setSignOutReason(null);
    setRestoring(false);
    setAuth(next);
    broadcast({ type: "session", auth: next });
  }

  function signOut() {
    const current = authRef.current;
    // Ends the session on the server too. Sent before the token is cleared:
    // api.js attaches the token synchronously when the call is made.
    if (current?.token) logoutOnServer().catch(() => {});
    setSignOutReason("manual");
    setAuth(null);
    if (current?.user) broadcast({ type: "signed-out", user: { id: current.user.id, role: current.user.role } });
  }

  // Inactivity sign-out (components/auth/IdleSignOut.jsx): ends the server
  // session like Log Out, but sends the user to their login page with the
  // reason — in every open tab.
  const signOutForInactivity = useCallback(() => {
    const current = authRef.current;
    if (!current) return;
    const notice = idleMessage(current.user?.role);
    if (current.token) logoutOnServer().catch(() => {});
    broadcast({ type: "signed-out", user: { id: current.user.id, role: current.user.role }, notice });
    endSession(notice);
  }, [broadcast, endSession]);

  // After the Account page changes something: new profile details and/or a
  // fresh token (a password change signs every other device out; this
  // browser's other tabs get the new token).
  function updateAccount({ user, token: nextToken }) {
    const prev = authRef.current;
    if (!prev) return;
    const next = { user: { ...prev.user, ...user }, token: nextToken ?? prev.token };
    if (nextToken) {
      setAuthToken(nextToken);
      setSocketToken(nextToken);
    }
    authRef.current = next;
    setAuth(next);
    broadcast({ type: "session", auth: next });
  }

  return (
    <AuthContext.Provider value={{ user: auth?.user ?? null, token, restoring, signIn, signOut, signOutForInactivity, updateAccount, signOutReason }}>
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
