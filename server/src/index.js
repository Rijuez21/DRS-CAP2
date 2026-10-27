import express from "express";
import cors from "cors";
import compression from "compression";
import { createServer } from "node:http";
import { Server } from "socket.io";
import "dotenv/config";

import { pingDatabase } from "./db/pool.js";
import { redis } from "./cache/redis.js";
import { buildTripsRouter } from "./routes/trips.js";
import { bookingsRouter, buildFlagRequestsRouter, attachBookingsIo } from "./routes/bookings.js";
import { verifyToken, isDeployed } from "./middleware/auth.js";
import { busRoutesRouter } from "./routes/routes.js";
import { authRouter } from "./routes/auth.js";
import { busesRouter } from "./routes/fleet.js";
import { buildTrackingRouter } from "./routes/tracking.js";
import { driversRouter } from "./routes/drivers.js";
import { staffRouter } from "./routes/staff.js";
import { ownersRouter } from "./routes/owners.js";
import { notificationsRouter } from "./routes/notifications.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { reportsRouter } from "./routes/reports.js";
import { buildPaymentsRouter } from "./routes/payments.js";
import { buildDiscountsRouter } from "./routes/discounts.js";
import { startPaymentSweeper } from "./services/paymentSweeper.js";
import { gpsRouter } from "./routes/gps.js";
import { startGpsGateway } from "./services/gpsGateway.js";

const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");

// Railway (and most hosts) put a proxy in front of the app. Trusting exactly
// one hop makes req.ip the real client address — required for per-IP rate
// limits, which otherwise see every visitor as the same proxy IP. Never
// "true": that would let clients spoof X-Forwarded-For. Override with
// TRUST_PROXY (a hop count) if there are more proxies in front.
const trustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : isDeployed ? 1 : 0;
if (Number.isInteger(trustProxy) && trustProxy > 0) app.set("trust proxy", trustProxy);

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

// Socket.io — per the paper's Table 9, this is what pushes live GPS
// updates to connected clients (LiveTracking.jsx) without polling.
const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

// Socket auth: the client sends its login token in the handshake
// (lib/socket.js). A missing/expired token still connects — anonymous
// sockets may watch public bus positions — but can't join private rooms.
// Before, anyone could join driver:<id> / passenger:<id> and read
// passenger names and pickup pins from Flag a Bus events.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  socket.data.user = null;
  if (typeof token === "string" && token) {
    // Same checks as HTTP: signature, account still exists, same role,
    // not suspended, password unchanged.
    const result = await verifyToken(token).catch(() => ({ error: true }));
    socket.data.user = result.user ?? null;
  }
  next();
});

attachBookingsIo(io);

io.on("connection", (socket) => {
  // A passenger viewing LiveTracking.jsx for bus #7 does:
  //   const socket = io(VITE_API_URL);
  //   socket.emit("subscribe:bus", tripBusId);
  //   socket.on("location:update", (point) => setPosition(point));
  // Live bus positions are for signed-in users (passengers tracking their
  // bus, drivers, staff) — not anonymous scrapers following a bus all day.
  socket.on("subscribe:bus", (busId) => {
    const id = Number(busId);
    if (socket.data.user && Number.isInteger(id) && id > 0) socket.join(`bus:${id}`);
  });
  socket.on("unsubscribe:bus", (busId) => {
    socket.leave(`bus:${busId}`);
  });

  // One shared room for the admin FleetTracking.jsx panel, so it gets
  // every bus's updates without joining a room per bus:
  //   socket.emit("subscribe:fleet");
  //   socket.on("location:update", (point) => movePin(point.busId, point));
  socket.on("subscribe:fleet", () => {
    const role = socket.data.user?.role;
    if (role === "admin" || role === "staff") socket.join("fleet");
  });
  socket.on("unsubscribe:fleet", () => {
    socket.leave("fleet");
  });

  // Admin GPS Tracker page: every tracker message (connection checks, raw
  // log), including trackers not yet assigned to a bus. Admin only.
  socket.on("subscribe:gps", () => {
    if (socket.data.user?.role === "admin") socket.join("gps:admin");
  });
  socket.on("unsubscribe:gps", () => socket.leave("gps:admin"));

  // Notification bell (Phase 0.3): after login, the client joins its own
  // room so notify.js's trip-change events reach only that passenger/driver.
  //   socket.emit("subscribe:notifications", { recipientType: "passenger", recipientId: user.id });
  // Only your own room: a passenger joins passenger:<their id>, a driver
  // driver:<their id>. Anything else is ignored.
  socket.on("subscribe:notifications", ({ recipientType, recipientId } = {}) => {
    const me = socket.data.user;
    // Staff and admins both use recipientType "staff" (staff_accounts ids).
    const myType = me && (me.role === "admin" || me.role === "staff") ? "staff" : me?.role;
    if (me && myType === recipientType && me.id === Number(recipientId)) {
      socket.join(`${recipientType}:${recipientId}`);
    }
  });
  // Payment Verification page: live "something changed, refresh" pings.
  // Staff/admin only — the event carries no passenger data, just a type.
  socket.on("subscribe:payments", () => {
    const role = socket.data.user?.role;
    if (role === "admin" || role === "staff") socket.join("payments:staff");
  });
  socket.on("unsubscribe:payments", () => socket.leave("payments:staff"));
  socket.on("unsubscribe:notifications", ({ recipientType, recipientId } = {}) => {
    if (recipientType && recipientId) socket.leave(`${recipientType}:${recipientId}`);
  });
});

app.use(cors({ origin: allowedOrigins }));

// Security headers for every API response (no extra dependency). The API
// only returns JSON, CSV and receipt images, so the CSP forbids everything:
// even if a response were opened directly in a browser, nothing in it runs.
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/") && !res.get("Cache-Control")) res.set("Cache-Control", "no-store");
  next();
});
// gzip every response over 1 kB (JSON lists compress ~5-10x). Socket.io traffic
// isn't affected, it compresses itself.
app.use(compression());
// QR Ph payments carry images as base64 in the JSON body (the admin's QR,
// a passenger's payment screenshot — up to 5 MB each, ~6.7 MB once base64
// encoded). Express's default 100 kb limit would reject them, so this one
// path gets a larger limit; it runs first, and the general parser below
// skips a body that's already been parsed. Every other route keeps 100 kb.
// The large limit is only for signed-in requests to the payment routes
// that carry images; anonymous requests keep the 100 kb default, so nobody
// can make the server buffer 8 MB bodies without logging in first.
const bigJson = express.json({ limit: "8mb" });
const smallJson = express.json({ limit: "100kb" });
app.use("/api/payments", (req, res, next) => {
  const carriesImage = req.method === "POST" || req.method === "PATCH";
  if (!carriesImage || !(req.headers.authorization || "").startsWith("Bearer ")) return smallJson(req, res, next);
  verifyToken(req.headers.authorization.slice(7))
    .then((r) => (r.user && ["passenger", "admin"].includes(r.user.role) ? bigJson : smallJson)(req, res, next))
    .catch(next);
});
// Same idea for a passenger's discount ID photo (routes/discounts.js):
// only a signed-in passenger's POST gets the larger limit.
app.use("/api/discounts", (req, res, next) => {
  if (req.method !== "POST" || !(req.headers.authorization || "").startsWith("Bearer ")) return smallJson(req, res, next);
  verifyToken(req.headers.authorization.slice(7))
    .then((r) => (r.user?.role === "passenger" ? bigJson : smallJson)(req, res, next))
    .catch(next);
});
app.use(smallJson);

// Health check — hit this first to confirm the Railway DB/Redis connections work.
app.get("/api/health", async (req, res) => {
  const health = { status: "ok", database: "unreachable", redis: "unreachable" };

  // Public endpoint: report up/down only. Error details (host names,
  // ports, driver messages) go to the server log, never to the caller.
  try {
    health.database = (await pingDatabase()) ? "connected" : "unreachable";
  } catch (err) {
    console.error("Health check: database error:", err.message);
  }

  try {
    health.redis = (await redis.ping()) === "PONG" ? "connected" : "unreachable";
  } catch (err) {
    console.error("Health check: redis error:", err.message);
  }

  res.status(health.database === "connected" ? 200 : 503).json(health);
});

app.use("/api/auth", authRouter);
app.use("/api/trips", buildTripsRouter(io));
// Flag a Bus (passenger Mode 2) — must be mounted BEFORE bookingsRouter,
// or GET /api/bookings/flags would hit bookingsRouter's GET /:id first.
// Its "flag:new" / "flag:updated" events go to the existing
// driver:<id> / passenger:<id> rooms joined via "subscribe:notifications"
// above, so no extra socket.on handler is needed here.
app.use("/api/bookings/flags", buildFlagRequestsRouter(io));
app.use("/api/bookings", bookingsRouter);
app.use("/api/routes", busRoutesRouter);
app.use("/api/buses", busesRouter);
app.use("/api/tracking", buildTrackingRouter(io));
app.use("/api/drivers", driversRouter);
app.use("/api/staff", staffRouter);
app.use("/api/owners", ownersRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/payments", buildPaymentsRouter(io));
app.use("/api/discounts", buildDiscountsRouter(io));
app.use("/api/gps", gpsRouter);

// An oversized body (e.g. a screenshot over the payments limit) reaches
// here as a 413 from express.json(); answer in the same { error } shape the
// frontend shows everywhere instead of Express's default HTML page.
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "That upload is too large. Images must be 5 MB or smaller." });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body isn't valid JSON" });
  }
  // Anything else unexpected: log it, answer generically. Express's default
  // handler would send an HTML stack trace whenever NODE_ENV isn't
  // "production" (Railway doesn't set it by default).
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err?.status && err.status < 500 ? err.status : 500).json({ error: err?.status && err.status < 500 ? "Bad request" : "Something went wrong. Please try again." });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Online seat holds: releases unpaid seats past their payment deadline,
// warns passengers first, alerts staff about proofs on trips leaving soon.
startPaymentSweeper(io);

// SinoTrack GPS tracker(s) connect straight to this TCP port (GPS_TCP_PORT,
// default 5013) — see services/gpsGateway.js.
startGpsGateway(io);

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`DRS Bus backend (Express + Socket.io) listening on http://localhost:${port}`);
});


// ayaw mag push ampota