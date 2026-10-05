import jwt from "jsonwebtoken";

import "dotenv/config";

// Signs every login token. The fallback below is in the public source code,
// so a server using it lets anyone forge a token — including an admin one.
// Local development may use it (with a warning); a deployed server refuses
// to start until JWT_SECRET is set (Railway -> server service -> Variables).
const DEV_FALLBACK_SECRET = "drs-bus-dev-secret";
const isDeployed = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);
const configured = process.env.JWT_SECRET?.trim();

if (!configured || configured === DEV_FALLBACK_SECRET) {
  if (isDeployed) {
    console.error(
      "FATAL: JWT_SECRET is not set. Add a long random value in Railway -> server service -> Variables, then redeploy.\n" +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
    process.exit(1);
  }
  console.warn("WARNING: JWT_SECRET is not set — using the insecure development secret. Set JWT_SECRET in server/.env.");
} else if (configured.length < 32) {
  console.warn("WARNING: JWT_SECRET is short. Use at least 32 random characters.");
}

export const JWT_SECRET = configured || DEV_FALLBACK_SECRET;

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
// Used on the admin-only writes (bus/route/driver/staff
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
