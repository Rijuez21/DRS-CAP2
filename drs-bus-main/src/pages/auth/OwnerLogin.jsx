import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function OwnerLogin() {
  return (
    <AuthShell
      roleLabel="Bus Owner Login"
      headline="Know where your buses are."
      tagline="Follow your fleet live along the Baguio–Bontoc route."
      audience="team"
    >
      <LoginForm role="owner" redirectPath="/owner/tracking" />
    </AuthShell>
  );
}
