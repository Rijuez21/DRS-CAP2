import jwt from "jsonwebtoken";

// Falls back to a dev secret so `npm run dev` still works without an env
// var set locally, same spirit as the Redis/MySQL connection fallbacks —
// set a real JWT_SECRET in production (.env / Railway variables).
export const JWT_SECRET = process.env.JWT_SECRET || "drs-bus-dev-secret";

// Verifies the `Authorization: Bearer <token>` header and attaches the
// decoded { id, role } payload to req.user. Standalone "must be logged in"
// gate, and the building block requireRole() composes below.
export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// requireRole('admin'), requireRole('admin', 'staff'), etc. — authenticates
// first, then rejects if the token's role isn't one of the allowed roles.
// Used on the admin-only writes (bus/route/maintenance/driver/staff
// creation and edits) and the fleet-wide tracking endpoint.
export function requireRole(...roles) {
  return (req, res, next) => {
    authenticate(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: insufficient role" });
      }
      next();
    });
  };
}
