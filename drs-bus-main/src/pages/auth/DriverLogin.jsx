import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function DriverLogin() {
  return (
    <AuthShell roleLabel="Driver Login">
      <LoginForm role="driver" redirectPath="/driver/dashboard" />
      <p className="text-center text-sm text-ink-600 mt-5">
        Not a driver?{" "}
        <a
          href="/"
          className="text-brand-green-600 font-medium underline underline-offset-2"
        >
          Choose a different login
        </a>
      </p>
    </AuthShell>
  );
}
