import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useAuth, AUTH_NOTICE_KEY } from "../../context/AuthContext";
import * as api from "../../lib/api";
import { readIdImage } from "../../lib/discounts";
import { normalizePhMobile } from "../../lib/phone";
import DiscountIdFields from "../passenger/DiscountIdFields";
import ForgotPasswordForm from "./ForgotPasswordForm";
import EmailCodeForm from "./EmailCodeForm";
import PolicyModal from "./PolicyModal";
import FormAlert from "./FormAlert";

// One style for every field on the login / sign-up form. Change it here.
const INPUT_CLASS =
  "w-full bg-white border border-slate-300 rounded-xl px-4 py-3 outline-none transition-colors hover:border-slate-400 focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/25 placeholder:text-ink-600/50 aria-invalid:border-rose-400 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20";

// Sign-up checks, run before anything is sent. Same rules as the server
// (services/passwordPolicy.js), which re-checks everything and has the
// final say. Returns { field: message } for each field that's wrong.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

// Sign-in: checked here instead of by the browser, so every role's login
// page shows the same in-app message (not the browser's own popup).
function loginErrors({ email, password }) {
  const errors = {};
  if (!email) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address, like juan@email.com.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

function signupErrors({ name, email, phone, password, confirmPassword }) {
  const errors = {};
  if (!name) errors.name = "Enter your name to create an account.";
  if (!email) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (!phone.trim()) errors.phone = "Enter your mobile number.";
  else if (!normalizePhMobile(phone)) errors.phone = "Enter a valid Philippine mobile number, e.g. 0917 123 4567.";
  if (!password) errors.password = "Enter a password.";
  else if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = "Use at least 8 characters for the password, with both letters and numbers.";
  } else if (!/[A-Z]/.test(password)) errors.password = "Use at least one capital letter in the password.";
  if (!confirmPassword) errors.confirmPassword = "Enter your password again.";
  else if (confirmPassword !== password) errors.confirmPassword = "The passwords don't match.";
  return errors;
}

// A rough guide shown while typing. "Too weak" = doesn't meet the rules
// above; beyond that, length (12+) and a symbol each add a step.
const STRENGTH = [
  { label: "Too weak", bar: "bg-rose-500", text: "text-rose-600" },
  { label: "Fair", bar: "bg-amber-500", text: "text-amber-600" },
  { label: "Good", bar: "bg-brand-green-500", text: "text-brand-green-600" },
  { label: "Strong", bar: "bg-brand-green-600", text: "text-brand-green-600" },
];
function passwordStrength(password) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[A-Z]/.test(password)) return 0;
  return 1 + (password.length >= 12 ? 1 : 0) + (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
}

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

  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot" | "verify" (email code after sign-up)
  const [verifyNotice, setVerifyNotice] = useState("");
  const [pendingDiscount, setPendingDiscount] = useState(null); // sign-up ID photo, uploaded once the email is confirmed
  const [resetNotice, setResetNotice] = useState(""); // "Your password has been changed…" after ForgotPasswordForm
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [policyTitle, setPolicyTitle] = useState(null); // open policy window, or null
  // Sign-up only: mobile number, password confirmation (never sent) and consent.
  const [phone, setPhone] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Sign-up only: student / PWD / senior passengers send an ID for the fare discount.
  const [discount, setDiscount] = useState({ type: "regular", idNumber: "", file: null });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({}); // { field: message }, shown under each field (sign in and sign up)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === "signup";

  // onChange for a field: clears that field's error once it's edited.
  const edit = (field, setter) => (e) => {
    setter(e.target.value);
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const errorProps = (field) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `auth-${field}-error` } : {};

  function switchMode(next) {
    setMode(next);
    setError("");
    setFieldErrors({});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    let fullName = name;
    let loginEmail; // set below: trimmed (and lowercased for sign-up)
    if (isSignup) {
      // Trimmed, and the email lowercased, the way the server stores them.
      fullName = name.trim().replace(/\s+/g, " ");
      loginEmail = email.trim().toLowerCase();
      setName(fullName);
      setEmail(loginEmail);
      const errors = signupErrors({ name: fullName, email: loginEmail, phone, password, confirmPassword });
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
      if (!acceptedTerms) {
        setError("Agree to the Terms of Use and Privacy Policy to create an account.");
        return;
      }
    } else {
      loginEmail = email.trim();
      const errors = loginErrors({ email: loginEmail, password });
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
    }
    const wantsDiscount = isSignup && discount.type !== "regular";

    setIsSubmitting(true);
    try {
      // Read the ID photo first, so a bad file is caught before the account exists.
      const idImage = wantsDiscount ? await readIdImage(discount.file) : null;
      if (isSignup) {
        const created = await api.register({ name: fullName, email: loginEmail, phoneno: normalizePhMobile(phone), password, acceptedTerms: true });
        // The account can't sign in until the emailed code is entered;
        // the ID photo waits in state until then.
        if (created.verification_required) {
          setPendingDiscount(wantsDiscount ? { category: discount.type, idNumber: discount.idNumber, idImage } : null);
          setVerifyNotice("");
          setMode("verify");
          return;
        }
      }
      const result = await api.login({ email: loginEmail, password, role });
      await finishSignIn(result, wantsDiscount ? { category: discount.type, idNumber: discount.idNumber, idImage } : null);
    } catch (err) {
      if (err.data?.code === "EMAIL_NOT_VERIFIED") {
        setVerifyNotice(err.message);
        setMode("verify");
        return;
      }
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function finishSignIn(result, discountUpload) {
    signIn(result);
    // The ID upload needs the login token (it's too big for the anonymous
    // sign-up request). The account already exists, so if this fails the
    // passenger lands on their profile to try again from there.
    if (discountUpload) {
      try {
        await api.submitDiscountId(discountUpload);
      } catch (err) {
        navigate("/passenger/discount", { replace: true, state: { discountNotice: `Your account was created, but your ID didn't upload: ${err.message} Send it again below.` } });
        return;
      }
    }
    // Back to the page that asked for login, if it belongs to this role.
    const rolePrefix = redirectPath.split("/")[1];
    navigate(returnTo && returnTo.startsWith(`/${rolePrefix}/`) ? returnTo : redirectPath, { replace: true });
  }

  const strength = isSignup && password ? STRENGTH[passwordStrength(password)] : null;
  const strengthLevel = strength ? STRENGTH.indexOf(strength) : 0;

  if (mode === "verify") {
    return (
      <EmailCodeForm
        email={email.trim().toLowerCase()}
        notice={verifyNotice}
        inputClass={INPUT_CLASS}
        onVerified={(result) => finishSignIn(result, pendingDiscount)}
        onBack={() => {
          setPendingDiscount(null);
          switchMode("login");
        }}
      />
    );
  }

  if (mode === "forgot") {
    return (
      <ForgotPasswordForm
        role={role}
        initialEmail={email}
        inputClass={INPUT_CLASS}
        onCancel={() => switchMode("login")}
        onDone={(message) => {
          setPassword("");
          setResetNotice(message);
          switchMode("login");
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={`${role} ${mode} form`}>
      <div>
        <h2 className="font-display text-2xl font-bold text-ink-900">{isSignup ? "Create your account" : "Sign in"}</h2>
        <p className="text-sm text-ink-600 mt-1">
          {isSignup ? "It only takes a minute. You can add a discount ID now or later." : "Welcome back. Enter your email and password to continue."}
        </p>
      </div>
      {!error && <FormAlert type="info" message={resetNotice || notice} />}
      {isSignup && (
        <Field label="Full Name" error={fieldErrors.name} errorId="auth-name-error">
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={edit("name", setName)}
            placeholder="Juan Dela Cruz"
            maxLength={150}
            className={INPUT_CLASS}
            {...errorProps("name")}
          />
        </Field>
      )}

      <Field label="Email" error={fieldErrors.email} errorId="auth-email-error">
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={edit("email", setEmail)}
          placeholder="you@email.com"
          className={INPUT_CLASS}
          {...errorProps("email")}
        />
      </Field>

      {isSignup && (
        <Field label="Mobile Number" error={fieldErrors.phone} errorId="auth-phone-error">
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={edit("phone", setPhone)}
            placeholder="09XX XXX XXXX"
            maxLength={20}
            className={INPUT_CLASS}
            {...errorProps("phone")}
          />
        </Field>
      )}

      <Field label="Password" error={fieldErrors.password} errorId="auth-password-error">
        {isSignup ? (
          <PasswordInput
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            autoComplete="new-password"
            value={password}
            onChange={edit("password", setPassword)}
            {...errorProps("password")}
          />
        ) : (
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={edit("password", setPassword)}
            placeholder="••••••••"
            maxLength={128}
            className={INPUT_CLASS}
            {...errorProps("password")}
          />
        )}
        {strength && (
          <span className="flex items-center gap-2 mt-1.5" aria-live="polite">
            <span className="flex flex-1 gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-1 flex-1 rounded-full ${i <= strengthLevel ? strength.bar : "bg-slate-200"}`} />
              ))}
            </span>
            <span className={`text-xs font-medium ${strength.text}`}>{strength.label}</span>
          </span>
        )}
        {isSignup && <span className="block text-xs text-ink-600 mt-1">At least 8 characters, with letters, numbers, and one capital letter. Longer, or with a symbol, is stronger.</span>}
      </Field>

      {isSignup && (
        <Field label="Confirm Password" error={fieldErrors.confirmPassword} errorId="auth-confirmPassword-error">
          <PasswordInput
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={edit("confirmPassword", setConfirmPassword)}
            {...errorProps("confirmPassword")}
          />
        </Field>
      )}

      {isSignup && (
        <DiscountIdFields
          value={discount}
          onChange={setDiscount}
          inputClass={INPUT_CLASS}
        />
      )}

      {isSignup && (
        <label className="flex items-start gap-2.5 text-sm text-ink-600 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-brand-green-600"
          />
          <span>
            {" "}
            I agree to the{" "}
             <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); // don't tick the checkbox just by opening the policy
                setPolicyTitle("Terms of Use");
              }}
              className="text-brand-green-600 font-medium underline underline-offset-2"
            >
              Terms of Use
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPolicyTitle("Privacy Policy");
              }}
              className="text-brand-green-600 font-medium underline underline-offset-2"
            >
              Privacy Policy
            </button>
          </span>
        </label>
      )}

      {policyTitle && (
        <PolicyModal
          title={policyTitle}
          onClose={() => setPolicyTitle(null)}
          onAgree={() => {
            setAcceptedTerms(true);
            setPolicyTitle(null);
          }}
        />
      )}

      <FormAlert message={error} />

      <button
        type="submit"
        disabled={isSubmitting || (isSignup && !acceptedTerms)}
        className="w-full bg-brand-forest-900 hover:bg-brand-forest-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-white font-display font-semibold rounded-xl py-3 shadow-sm"
      >
        {isSubmitting ? (isSignup ? "Creating account…" : "Signing in…") : isSignup ? "Create Account" : "Sign In"}
      </button>

      {mode === "login" && (
        <div className="text-center text-sm">
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="text-ink-900 underline underline-offset-2 hover:text-brand-green-600"
          >
            Forgot password?
          </button>
        </div>
      )}

      {showSignUp ? (
        <p className="text-center text-sm text-ink-600 pt-1">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
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
                onClick={() => switchMode("signup")}
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

function Field({ label, error, errorId, children }) {
  return (
    <label className="block text-left">
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-900/70 mb-1.5">
        {label}
      </span>
      {children}
      {error && (
        <span id={errorId} className="flex items-start gap-1.5 text-xs text-rose-700 font-medium mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          {error}
        </span>
      )}
    </label>
  );
}

// Sign-up password box with a show/hide eye. The button sits inside the
// field's <label>, which is fine: clicking a button doesn't focus the input.
function PasswordInput({ visible, onToggle, ...inputProps }) {
  return (
    <span className="relative block">
      <input
        type={visible ? "text" : "password"}
        placeholder="••••••••"
        maxLength={128}
        className={`${INPUT_CLASS} pr-11`}
        {...inputProps}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3.5 text-ink-600 hover:text-ink-900"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </span>
  );
}
