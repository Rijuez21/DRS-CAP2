import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, UserRound, TriangleAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import { normalizePhMobile } from "../lib/phone";
import { LOGIN_PATH } from "../lib/rolePaths";
import PageHeading from "../components/common/PageHeading";
import InlineAlert from "../components/common/InlineAlert";
import { SubmitButton } from "../components/common/Buttons";

// "Account & Password" in every role's menu (/<role>/account).
//   everyone:   change password (POST /api/auth/change-password)
//   passengers: also edit name + mobile (PATCH /api/auth/me) and close
//               the account (DELETE /api/auth/me)
// Drivers, staff, admins and owners have their details kept by an
// administrator in User Management, so theirs are shown read-only.
export default function AccountSettings() {
  const { user } = useAuth();
  const isPassenger = user?.role === "passenger";
  return (
    <div className="page-enter p-4 sm:p-6 lg:py-10 max-w-2xl mx-auto space-y-6">
      <PageHeading title="Account & Password" subtitle="Your sign-in details and password." />
      {isPassenger ? <ProfileForm /> : <ReadOnlyDetails />}
      <PasswordForm />
      {isPassenger && <CloseAccount />}
    </div>
  );
}

function Section({ icon: Icon, title, children, tone = "default" }) {
  const border = tone === "danger" ? "border-rose-200" : "border-slate-200";
  return (
    <section className={`bg-white rounded-2xl border ${border} p-5 sm:p-6 space-y-4`}>
      <h2 className={`flex items-center gap-2 font-display font-bold ${tone === "danger" ? "text-rose-700" : "text-ink-900"}`}>
        <Icon className="w-5 h-5" aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-900 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-600 mt-1">{hint}</span>}
    </label>
  );
}

function ReadOnlyDetails() {
  const { user } = useAuth();
  return (
    <Section icon={UserRound} title="Your details">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-600">Name</dt>
          <dd className="font-medium">{user?.name}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-600">Email</dt>
          <dd className="font-medium break-all">{user?.email}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-600">To change these, ask an administrator to update your account in User Management.</p>
    </Section>
  );
}

function ProfileForm() {
  const { user, updateAccount } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phoneno ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const cleanName = name.trim().replace(/\s+/g, " ");
    const phoneno = normalizePhMobile(phone);
    if (!cleanName) return setError("Enter your name.");
    if (!phoneno) return setError("Enter a valid Philippine mobile number, e.g. 0917 123 4567.");
    setIsSaving(true);
    try {
      const result = await api.updateMyProfile({ name: cleanName, phoneno });
      updateAccount({ user: result.user });
      setName(result.user.name);
      setPhone(result.user.phoneno ?? "");
      setSuccess("Your details were saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section icon={UserRound} title="Your details">
      <form id="profile-form" onSubmit={save} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full name">
          <input id="profile-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={150} />
        </Field>
        <Field label="Mobile number">
          <input id="profile-phone" className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="09XX XXX XXXX" maxLength={20} />
        </Field>
        <div className="sm:col-span-2 text-sm">
          <span className="text-ink-600">Email: </span>
          <span className="font-medium break-all">{user?.email}</span>
          <span className="block text-xs text-ink-600 mt-0.5">Your email is how you sign in, so it can't be changed here.</span>
        </div>
      </form>
      <InlineAlert type="error" message={error} />
      <InlineAlert type="success" message={success} />
      <div className="flex justify-end">
        <SubmitButton form="profile-form" isSaving={isSaving}>
          Save details
        </SubmitButton>
      </div>
    </Section>
  );
}

function PasswordForm() {
  const { updateAccount } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    // Same rules as the server (services/passwordPolicy.js), which has the final say.
    if (!current) return setError("Enter your current password.");
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) return setError("Use at least 8 characters for the new password, with both letters and numbers.");
    if (!/[A-Z]/.test(next)) return setError("Use at least one capital letter in the new password.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setIsSaving(true);
    try {
      const result = await api.changePassword({ currentPassword: current, newPassword: next });
      updateAccount({ token: result.token });
      setCurrent("");
      setNext("");
      setConfirm("");
      setSuccess(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <Section icon={KeyRound} title="Change password">
      <form id="password-form" onSubmit={save} noValidate className="grid grid-cols-1 gap-4">
        <Field label="Current password">
          <input id="password-current" className="input" type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={128} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="New password" hint="At least 8 characters, with letters, numbers and one capital letter.">
            <input id="password-new" className="input" type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={128} />
          </Field>
          <Field label="Confirm new password">
            <input id="password-confirm" className="input" type={type} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} />
          </Field>
        </div>
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 w-fit">
          {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
          {show ? "Hide passwords" : "Show passwords"}
        </button>
      </form>
      <InlineAlert type="error" message={error} />
      <InlineAlert type="success" message={success} />
      <div className="flex justify-end">
        <SubmitButton form="password-form" isSaving={isSaving}>
          Change password
        </SubmitButton>
      </div>
    </Section>
  );
}

function CloseAccount() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function close(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your password to close your account.");
    setIsSaving(true);
    try {
      const result = await api.closeMyAccount(password);
      signOut();
      navigate(LOGIN_PATH.passenger, { replace: true, state: { notice: result.message } });
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  }

  return (
    <Section icon={TriangleAlert} title="Close account" tone="danger">
      <p className="text-sm text-ink-600">
        Your name, email, mobile number and ID photos are removed and you can&apos;t sign in again. Past bookings and payments are kept without your name,
        because the law requires us to keep accounting records. You can&apos;t close your account while you have an upcoming trip or a payment being
        processed.
      </p>
      <form id="close-form" onSubmit={close} noValidate className="space-y-3">
        <Field label="Your password">
          <input id="close-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-ink-900 cursor-pointer">
          <input id="close-understood" type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 w-4 h-4 accent-rose-600" />
          I understand that closing my account can&apos;t be undone.
        </label>
      </form>
      <InlineAlert type="error" message={error} />
      <div className="flex justify-end">
        <button
          type="submit"
          form="close-form"
          disabled={!understood || isSaving}
          className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
        >
          {isSaving ? "Closing…" : "Close my account"}
        </button>
      </div>
    </Section>
  );
}
