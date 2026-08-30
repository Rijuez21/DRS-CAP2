import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginForm({
  role,
  redirectPath,
  showSignUp = false,
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: POST /api/auth/login with { email, password, role }
      // On success: store the returned session/token, then navigate(redirectPath)
      // On failure: setError(response.message) and stop here
      navigate(redirectPath);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${role} login form`}>
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
          autoComplete="current-password"
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
        {isSubmitting ? "Signing in…" : "Sign In"}
      </button>

      <div className="text-center text-sm">
        <a
          href="#"
          className="text-ink-900 underline underline-offset-2 hover:text-brand-green-600"
        >
          Forgot password?
        </a>
      </div>

      {showSignUp ? (
        <p className="text-center text-sm text-ink-600 pt-1">
          New here?{" "}
          <a href="#" className="text-brand-green-600 font-medium underline underline-offset-2">
            Sign up
          </a>
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
