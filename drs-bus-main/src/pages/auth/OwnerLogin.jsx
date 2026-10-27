import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function OwnerLogin() {
  return (
    <AuthShell roleLabel="Bus Owner Login">
      <LoginForm role="owner" redirectPath="/owner/tracking" />
    </AuthShell>
  );
}
