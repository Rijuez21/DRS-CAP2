import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function AdminLogin() {
  return (
    <AuthShell
      roleLabel="Admin Login"
      headline="Run the whole line from one place."
      tagline="Schedules, fleet, routes, payments and reports for D' Rising Sun."
      audience="team"
    >
      <LoginForm role="admin" redirectPath="/admin/dashboard" />
    </AuthShell>
  );
}
