import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function AdminLogin() {
  return (
    <AuthShell roleLabel="Admin Login">
      <LoginForm role="admin" redirectPath="/admin/dashboard" />
    </AuthShell>
  );
}
