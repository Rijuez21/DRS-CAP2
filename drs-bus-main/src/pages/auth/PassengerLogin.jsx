import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function PassengerLogin() {
  return (
    <AuthShell
      roleLabel="Passenger Login"
      headline="Welcome aboard."
      tagline="Book a seat, follow your bus live, and travel the Baguio–Bontoc line with D' Rising Sun."
    >
      <LoginForm role="passenger" redirectPath="/passenger/home" showSignUp />
    </AuthShell>
  );
}
