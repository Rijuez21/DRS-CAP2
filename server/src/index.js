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
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./middleware/auth.js";
import { busRoutesRouter } from "./routes/routes.js";
import { authRouter } from "./routes/auth.js";
import { busesRouter } from "./routes/fleet.js";
import { buildTrackingRouter } from "./routes/tracking.js";
import { driversRouter } from "./routes/drivers.js";
import { staffRouter } from "./routes/staff.js";
import { notificationsRouter } from "./routes/notifications.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { reportsRouter } from "./routes/reports.js";
import { buildPaymentsRouter } from "./routes/payments.js";

const app = express();
const httpServer = createServer(app);

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
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      socket.data.user = jwt.verify(token, JWT_SECRET);
    } catch {
      socket.data.user = null;
    }
  }
  next();
});

attachBookingsIo(io);

io.on("connection", (socket) => {
  // A passenger viewing LiveTracking.jsx for bus #7 does:
  //   const socket = io(VITE_API_URL);
  //   socket.emit("subscribe:bus", tripBusId);
  //   socket.on("location:update", (point) => setPosition(point));
  socket.on("subscribe:bus", (busId) => {
    socket.join(`bus:${busId}`);
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

  // Notification bell (Phase 0.3): after login, the client joins its own
  // room so notify.js's trip-change events reach only that passenger/driver.
  //   socket.emit("subscribe:notifications", { recipientType: "passenger", recipientId: user.id });
  // Only your own room: a passenger joins passenger:<their id>, a driver
  // driver:<their id>. Anything else is ignored.
  socket.on("subscribe:notifications", ({ recipientType, recipientId } = {}) => {
    const me = socket.data.user;
    if (me && me.role === recipientType && me.id === Number(recipientId)) {
      socket.join(`${recipientType}:${recipientId}`);
    }
  });
  socket.on("unsubscribe:notifications", ({ recipientType, recipientId } = {}) => {
    if (recipientType && recipientId) socket.leave(`${recipientType}:${recipientId}`);
  });
});

app.use(cors({ origin: allowedOrigins }));
// gzip every response over 1 kB (JSON lists compress ~5-10x). Socket.io traffic
// isn't affected, it compresses itself.
app.use(compression());
// QR Ph payments carry images as base64 in the JSON body (the admin's QR,
// a passenger's payment screenshot — up to 5 MB each, ~6.7 MB once base64
// encoded). Express's default 100 kb limit would reject them, so this one
// path gets a larger limit; it runs first, and the general parser below
// skips a body that's already been parsed. Every other route keeps 100 kb.
app.use("/api/payments", express.json({ limit: "8mb" }));
app.use(express.json());

// Health check — hit this first to confirm the Railway DB/Redis connections work.
app.get("/api/health", async (req, res) => {
  const health = { status: "ok", database: "unreachable", redis: "unreachable" };

  try {
    health.database = (await pingDatabase()) ? "connected" : "unreachable";
  } catch (err) {
    health.database = `error: ${err.message}`;
  }

  try {
    health.redis = (await redis.ping()) === "PONG" ? "connected" : "unreachable";
  } catch (err) {
    health.redis = `error: ${err.message}`;
  }

  res.json(health);
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
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/payments", buildPaymentsRouter(io));

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
  next(err);
});

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`DRS Bus backend (Express + Socket.io) listening on http://localhost:${port}`);
});


// ayaw mag push ampota