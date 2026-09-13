import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

/** Wrap a layout route with this to require a logged-in user of a given role. */
export default function RequireRole({ role, children }) {
  const { user } = useAuth();

  if (!user || user.role !== role) {
    return <Navigate to="/" replace />;
  }
  return children;
}
