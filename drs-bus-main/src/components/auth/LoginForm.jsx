import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth, AUTH_NOTICE_KEY } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { readIdImage } from "../../lib/discounts";
import DiscountIdFields from "../passenger/DiscountIdFields";

export default function LoginForm({
  role,
  redirectPath,
  showSignUp = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  // Set by RequireRole when it bounced the user here ("Please log in to
  // continue" / "Your session has expired"); `from` is where to go back to.
  const notice = location.state?.notice ?? "";
  const returnTo = location.state?.from;
  // The notice now lives in router state; drop the stored copy so it isn't
  // shown again on some later, unrelated redirect.
  useEffect(() => {
    sessionStorage.removeItem(AUTH_NOTICE_KEY);
  }, []);

  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Sign-up only: student / PWD / senior passengers send an ID for the fare discount.
  const [discount, setDiscount] = useState({ type: "regular", idNumber: "", file: null });
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
    // Same rule as the server (services/passwordPolicy.js); the server re-checks.
    if (mode === "signup" && (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) {
      setError("Use at least 8 characters for the password, with both letters and numbers.");
      return;
    }
    if (mode === "signup" && !/[A-Z]/.test(password)) {
      setError("Use at least one capital letter in the password.");
      return;
    }
    const wantsDiscount = mode === "signup" && discount.type !== "regular";

    setIsSubmitting(true);
    try {
      // Read the ID photo first, so a bad file is caught before the account exists.
      const idImage = wantsDiscount ? await readIdImage(discount.file) : null;
      if (mode === "signup") {
        await api.register({ name, email, password });
      }
      const result = await api.login({ email, password, role });
      signIn(result);
      // The ID upload needs the login token (it's too big for the anonymous
      // sign-up request). The account already exists, so if this fails the
      // passenger lands on their profile to try again from there.
      if (wantsDiscount) {
        try {
          await api.submitDiscountId({ category: discount.type, idNumber: discount.idNumber, idImage });
        } catch (err) {
          navigate("/passenger/discount", { replace: true, state: { discountNotice: `Your account was created, but your ID didn't upload: ${err.message} Send it again below.` } });
          return;
        }
      }
      // Back to the page that asked for login, if it belongs to this role.
      const rolePrefix = redirectPath.split("/")[1];
      navigate(returnTo && returnTo.startsWith(`/${rolePrefix}/`) ? returnTo : redirectPath, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`${role} ${mode} form`}>
      {notice && !error && (
        <p role="status" className="text-sm font-medium text-brand-forest-900 bg-brand-sunrise-400/30 rounded-xl px-4 py-2.5">
          {notice}
        </p>
      )}
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
          maxLength={128}
          className="w-full bg-brand-sunrise-400/40 border border-brand-sunrise-500/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-green-600/50 placeholder:text-ink-600/50"
        />
        {mode === "signup" && <p className="text-xs text-ink-600 mt-1">At least 8 characters, with letters, numbers, and one capital letter.</p>}
      </Field>

      {mode === "signup" && (
        <DiscountIdFields
          value={discount}
          onChange={setDiscount}
          inputClass="w-full bg-brand-sunrise-400/40 border border-brand-sunrise-500/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-green-600/50 placeholder:text-ink-600/50"
        />
      )}

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
