import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import * as api from "../../lib/api";

export default function LoginForm({
  role,
  redirectPath,
  showSignUp = false,
}) {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (mode === "signup" && !name) {
      setError("Enter your name to create an account.");
      return;
    }
    if (!email || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "signup") {
        await api.register({ name, email, password });
      }
      const result = await api.login({ email, password, role });
      signIn(result);
      navigate(redirectPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${role} ${mode} form`}>
      {mode === "signup" && (
        <Field label="Full Name">
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Juan Dela Cruz"
            className="w-full bg-brand-sunrise-400/40 border border-brand-sunrise-500/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-green-600/50 placeholder:text-ink-600/50"
          />
        </Field>
      )}

      <Field label="Email">
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="w-full bg-brand-sunrise-400/40 border border-brand-sunrise-500/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-green-600/50 placeholder:text-ink-600/50"
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full bg-brand-sunrise-400/40 border border-brand-sunrise-500/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-green-600/50 placeholder:text-ink-600/50"
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-brand-green-600 hover:bg-brand-green-500 disabled:opacity-60 transition-colors text-white font-display font-semibold rounded-xl py-3"
      >
        {isSubmitting ? (mode === "signup" ? "Creating account…" : "Signing in…") : mode === "signup" ? "Create Account" : "Sign In"}
      </button>

      {mode === "login" && (
        <div className="text-center text-sm">
          <a
            href="#"
            className="text-ink-900 underline underline-offset-2 hover:text-brand-green-600"
          >
            Forgot password?
          </a>
        </div>
      )}

      {showSignUp ? (
        <p className="text-center text-sm text-ink-600 pt-1">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                className="text-brand-green-600 font-medium underline underline-offset-2"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                className="text-brand-green-600 font-medium underline underline-offset-2"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      ) : (
        <p className="text-center text-xs text-ink-600 pt-1">
          Accounts for this role are created by an administrator.
        </p>
      )}
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-left">
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
