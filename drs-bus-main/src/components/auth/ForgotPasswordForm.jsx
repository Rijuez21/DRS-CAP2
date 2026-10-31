import { useState } from "react";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import * as api from "../../lib/api";

// "Forgot password?" on LoginForm, in three steps:
//   email -> the server emails a 6-digit code (POST /api/auth/forgot-password)
//   code  -> traded for a one-time reset token (POST /verify-reset-code)
//   new password -> POST /reset-password, then back to sign-in.
// The server answers step 1 the same way whether or not the email has an
// account, so this form never says which emails exist.
//
// props:
//   role          same role the login form signs into
//   initialEmail  whatever was typed in the login form
//   inputClass    the login form's field style
//   onDone(message)  password changed — back to sign-in with a notice
//   onCancel()
export default function ForgotPasswordForm({ role, initialEmail = "", inputClass, onDone, onCancel }) {
  const [step, setStep] = useState("email"); // "email" | "code" | "password"
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run(action) {
    setError("");
    setIsSubmitting(true);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function sendCode(e) {
    e?.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(cleaned)) {
      setError("Enter a valid email address.");
      return;
    }
    run(async () => {
      const result = await api.requestPasswordReset({ email: cleaned, role });
      setEmail(cleaned);
      setInfo(result.message);
      setCode("");
      setStep("code");
    });
  }

  function checkCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    run(async () => {
      const result = await api.verifyResetCode({ email, role, code });
      setResetToken(result.resetToken);
      setInfo("");
      setStep("password");
    });
  }

  function savePassword(e) {
    e.preventDefault();
    // Same rules as the server (services/passwordPolicy.js), which has the final say.
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Use at least 8 characters for the password, with both letters and numbers.");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Use at least one capital letter in the password.");
      return;
    }
    if (confirmPassword !== password) {
      setError("The passwords don't match.");
      return;
    }
    run(async () => {
      const result = await api.resetPassword({ resetToken, password });
      onDone(result.message);
    });
  }

  const heading = {
    email: ["Forgot your password?", "Enter the email you sign in with and we'll send you a 6-digit code."],
    code: ["Check your email", `Enter the 6-digit code sent to ${email}.`],
    password: ["Choose a new password", "You'll be signed out on your other devices."],
  }[step];

  const submitLabel = {
    email: isSubmitting ? "Sending code…" : "Send Code",
    code: isSubmitting ? "Checking…" : "Verify Code",
    password: isSubmitting ? "Saving…" : "Change Password",
  }[step];

  return (
    <form
      onSubmit={step === "email" ? sendCode : step === "code" ? checkCode : savePassword}
      noValidate
      className="space-y-4"
      aria-label={`${role} password reset form`}
    >
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to sign in
      </button>
      <div>
        <h2 className="font-display text-2xl font-bold text-ink-900">{heading[0]}</h2>
        <p className="text-sm text-ink-600 mt-1">{heading[1]}</p>
      </div>
      {info && !error && (
        <p role="status" className="text-sm font-medium text-brand-forest-900 bg-brand-sunrise-400/30 rounded-xl px-4 py-2.5">
          {info}
        </p>
      )}

      {step === "email" && (
        <FieldLabel label="Email">
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            maxLength={254}
            className={inputClass}
            autoFocus
          />
        </FieldLabel>
      )}

      {step === "code" && (
        <FieldLabel label="6-digit code">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className={`${inputClass} text-center font-mono text-2xl tracking-[0.5em]`}
            autoFocus
          />
        </FieldLabel>
      )}

      {step === "password" && (
        <>
          <FieldLabel label="New Password">
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                maxLength={128}
                className={`${inputClass} pr-11`}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3.5 text-ink-600 hover:text-ink-900"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </span>
            <span className="block text-xs text-ink-600 mt-1">At least 8 characters, with letters, numbers, and one capital letter.</span>
          </FieldLabel>
          <FieldLabel label="Confirm New Password">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              maxLength={128}
              className={inputClass}
            />
          </FieldLabel>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-rose-600 font-medium">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-brand-forest-900 hover:bg-brand-forest-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-white font-display font-semibold rounded-xl py-3 shadow-sm"
      >
        {submitLabel}
      </button>

      {step === "code" && (
        <p className="text-center text-sm text-ink-600">
          Didn&apos;t get it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => sendCode()}
            disabled={isSubmitting}
            className="text-brand-green-600 font-medium underline underline-offset-2 disabled:opacity-60"
          >
            send a new code
          </button>
          .
        </p>
      )}
    </form>
  );
}

function FieldLabel({ label, children }) {
  return (
    <label className="block text-left">
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
