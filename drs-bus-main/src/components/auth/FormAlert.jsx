import { AlertCircle, Info } from "lucide-react";

// The one message box for every login screen (sign in, sign up, forgot
// password, email code), for all roles. type "error" for a failed attempt,
// "info" for a notice such as "Your session has expired". Renders nothing
// when there's no message.
export default function FormAlert({ type = "error", message }) {
  if (!message) return null;
  const isError = type === "error";
  const Icon = isError ? AlertCircle : Info;
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium ${
        isError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-brand-sunrise-500/30 bg-brand-sunrise-400/20 text-brand-forest-900"
      }`}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
