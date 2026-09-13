import { createContext, useContext, useEffect, useState } from "react";
import { setAuthToken } from "../lib/api";

const AuthContext = createContext(null);
const STORAGE_KEY = "drs_auth_user";

export function AuthProvider({ children }) {
  // Stored/held together as one { user, token } object so a page refresh
  // rehydrates both the account info and the JWT api.js needs to send as
  // a Bearer header on requests that now require it.
  const [auth, setAuth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (auth) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      setAuthToken(auth.token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setAuthToken(null);
    }
  }, [auth]);

  function signIn(accountFromApi) {
    // accountFromApi is { user: { id, name, email, role }, token } from
    // POST /api/auth/login.
    setAuth({ user: accountFromApi.user ?? accountFromApi, token: accountFromApi.token ?? null });
  }

  function signOut() {
    setAuth(null);
  }

  return (
    <AuthContext.Provider value={{ user: auth?.user ?? null, token: auth?.token ?? null, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
