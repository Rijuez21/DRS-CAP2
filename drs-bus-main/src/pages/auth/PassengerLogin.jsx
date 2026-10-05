import AuthShell from "../../components/auth/AuthShell";
import LoginForm from "../../components/auth/LoginForm";

export default function PassengerLogin() {
  return (
    <AuthShell roleLabel="Passenger Login">
      <LoginForm role="passenger" redirectPath="/passenger/home" showSignUp />
    </AuthShell>
  );
}
