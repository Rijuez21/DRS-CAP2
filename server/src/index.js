import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import "dotenv/config";

import { pingDatabase } from "./db/pool.js";
import { redis } from "./cache/redis.js";
import { buildTripsRouter } from "./routes/trips.js";
import { bookingsRouter } from "./routes/bookings.js";
import { busRoutesRouter } from "./routes/routes.js";
import { authRouter } from "./routes/auth.js";
import { busesRouter, maintenanceRouter } from "./routes/fleet.js";
import { buildTrackingRouter } from "./routes/tracking.js";
import { checklistsRouter } from "./routes/checklists.js";
import { issuesRouter } from "./routes/issues.js";
import { driversRouter } from "./routes/drivers.js";
import { staffRouter } from "./routes/staff.js";
import { notificationsRouter } from "./routes/notifications.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { reportsRouter } from "./routes/reports.js";
import { startMqttListener } from "./services/mqttListener.js";

const app = express();
const httpServer = createServer(app);

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

// Socket.io — per the paper's Table 9, this is what pushes live GPS
// updates to connected clients (LiveTracking.jsx) without polling.
const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

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
    socket.join("fleet");
  });
  socket.on("unsubscribe:fleet", () => {
    socket.leave("fleet");
  });

  // Notification bell (Phase 0.3): after login, the client joins its own
  // room so notify.js's trip-change events reach only that passenger/driver.
  //   socket.emit("subscribe:notifications", { recipientType: "passenger", recipientId: user.id });
  socket.on("subscribe:notifications", ({ recipientType, recipientId } = {}) => {
    if (recipientType && recipientId) socket.join(`${recipientType}:${recipientId}`);
  });
  socket.on("unsubscribe:notifications", ({ recipientType, recipientId } = {}) => {
    if (recipientType && recipientId) socket.leave(`${recipientType}:${recipientId}`);
  });
});

app.use(cors({ origin: allowedOrigins }));
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
app.use("/api/bookings", bookingsRouter);
app.use("/api/routes", busRoutesRouter);
app.use("/api/buses", busesRouter);
app.use("/api/maintenance", maintenanceRouter);
app.use("/api/tracking", buildTrackingRouter(io));
app.use("/api/checklists", checklistsRouter);
app.use("/api/issues", issuesRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/staff", staffRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);

// Optional — only activates if MQTT_BROKER_URL is set (see mqttListener.js).
startMqttListener(io);

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`DRS Bus backend (Express + Socket.io) listening on http://localhost:${port}`);
});
