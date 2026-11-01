import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import * as api from "../../lib/api";

// The step after passenger sign-up (LoginForm.jsx): enter the 6-digit code
// emailed to the new account. A right code signs the passenger in
// (POST /api/auth/verify-email answers like /login with { user, token }).
// Also shown when an unconfirmed account tries to sign in.
//
// props:
//   email        the address the code went to
//   notice       optional line shown above the field
//   inputClass   the login form's field style
//   onVerified({ user, token })
//   onBack()
export default function EmailCodeForm({ email, notice, inputClass, onVerified, onBack }) {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState(notice ?? "");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verify(e) {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.verifyEmail({ email, code });
      await onVerified(result);
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  }

  async function resend() {
    setError("");
    setIsSubmitting(true);
    try {
      const result = await api.resendVerification(email);
      setInfo(result.message);
      setCode("");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={verify} noValidate className="space-y-4" aria-label="Confirm your email">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-brand-green-600 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to sign in
      </button>
      <div>
        <h2 className="font-display text-2xl font-bold text-ink-900">Confirm your email</h2>
        <p className="text-sm text-ink-600 mt-1">
          Enter the 6-digit code we sent to <span className="font-medium text-ink-900 break-all">{email}</span>.
        </p>
      </div>
      {info && !error && (
        <p role="status" className="text-sm font-medium text-brand-forest-900 bg-brand-sunrise-400/30 rounded-xl px-4 py-2.5">
          {info}
        </p>
      )}
      <label className="block text-left">
        <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">6-digit code</span>
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
      </label>
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
        {isSubmitting ? "Checking…" : "Confirm & Sign In"}
      </button>
      <p className="text-center text-sm text-ink-600">
        Didn&apos;t get it? Check your spam folder, or{" "}
        <button
          type="button"
          onClick={resend}
          disabled={isSubmitting}
          className="text-brand-green-600 font-medium underline underline-offset-2 disabled:opacity-60"
        >
          send a new code
        </button>
        .
      </p>
    </form>
  );
}
