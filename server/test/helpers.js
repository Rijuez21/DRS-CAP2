// Test harness: builds a throwaway MySQL database from schema.sql +
// migrate.js, seeds fixtures, and runs the real server (src/index.js) as a
// child process so every test goes through HTTP exactly like the frontend.
//
// Needs a disposable MySQL 8 server. Point TEST_MYSQL_ADMIN_URL at one
// (default mysql://drs:drs@127.0.0.1:3307). NEVER point it at Railway or any
// database with real data — the test database is dropped and recreated.
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_URL = process.env.TEST_MYSQL_ADMIN_URL || "mysql://drs:drs@127.0.0.1:3307";
const DB_NAME = process.env.TEST_MYSQL_DB || "drs_test";
if (/rlwy|railway/i.test(ADMIN_URL)) throw new Error("Refusing to run tests against a Railway database");
export const DB_URL = `${ADMIN_URL}/${DB_NAME}`;
export const PASSWORD = "Test-password-1";

let serverProcess;
export let BASE;
export let db;

export async function setup({ env = {} } = {}) {
  const admin = await mysql.createConnection(ADMIN_URL);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.query(`CREATE DATABASE \`${DB_NAME}\``);
  await admin.end();

  // Redis logical DB 15 for tests, flushed each run (rate-limit counters
  // are keyed by user id, which restarts at 1 in a fresh database).
  const redisUrl = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6380/15";
  const { default: Redis } = await import("ioredis");
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await r.connect().then(() => r.flushdb()).catch(() => {});
  r.disconnect();
  const childEnv = { ...process.env, MYSQL_URL: DB_URL, REDIS_URL: redisUrl, NODE_ENV: "test" };
  execFileSync("node", ["src/db/init.js"], { cwd: root, env: childEnv, stdio: "pipe" });
  execFileSync("node", ["src/db/migrate.js"], { cwd: root, env: childEnv, stdio: "pipe" });

  db = await mysql.createPool({ uri: DB_URL, connectionLimit: 5, timezone: "+08:00" });
  db.pool.on("connection", (c) => c.query("SET time_zone = '+08:00'"));

  const port = 4300 + Math.floor(Math.random() * 500);
  BASE = `http://127.0.0.1:${port}`;
  serverProcess = spawn("node", ["src/index.js"], {
    cwd: root,
    env: {
      ...childEnv,
      PORT: String(port),
      JWT_SECRET: randomBytes(32).toString("hex"),
      PAYMENT_SWEEP_INTERVAL_MS: "300",
      PAYMENT_HOLD_MINUTES: "60",
      PAYMENT_SUBMIT_RATE_LIMIT: "20",
      LOGIN_IP_RATE_LIMIT: "100000", // the suite logs in hundreds of accounts from 127.0.0.1
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  serverProcess.stdout.on("data", (d) => (log += d));
  serverProcess.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server didn't start:\n${log}`);
}

export async function teardown() {
  serverProcess?.kill();
  await db?.end();
}

export async function api(method, url, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

const hash = bcrypt.hashSync(PASSWORD, 4);

export async function createStaff(name, role) {
  const email = `${name.toLowerCase().replace(/\W/g, "")}-${randomBytes(3).toString("hex")}@test.local`;
  const [r] = await db.query(`INSERT INTO staff_accounts (name, email, password_hash, role) VALUES (?, ?, ?, ?)`, [name, email, hash, role]);
  const login = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: role === "admin" ? "admin" : "staff" } });
  return { id: r.insertId, token: login.data.token };
}

export async function createPassenger(name = "Passenger") {
  const email = `${name.toLowerCase().replace(/\W/g, "")}-${randomBytes(3).toString("hex")}@test.local`;
  const [r] = await db.query(`INSERT INTO commuters (name, email, password_hash) VALUES (?, ?, ?)`, [name, email, hash]);
  const login = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: "passenger" } });
  return { id: r.insertId, token: login.data.token, name };
}

export async function createDriver() {
  const email = `driver-${randomBytes(3).toString("hex")}@test.local`;
  const [r] = await db.query(`INSERT INTO drivers (name, email, password_hash) VALUES ('Driver', ?, ?)`, [email, hash]);
  const login = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: "driver" } });
  return { id: r.insertId, token: login.data.token };
}

// A Scheduled trip leaving `hours` from now, fare ₱350.00, 40 seats.
export async function createTrip({ hours = 24, fare = "350.00", capacity = 40, driverId } = {}) {
  const [route] = await db.query(`INSERT INTO routes (origin, destination, distance, base_fare) VALUES ('Baguio', 'Bontoc', 140, ?)`, [fare]);
  const [bus] = await db.query(`INSERT INTO buses (plate_num, capacity) VALUES (?, ?)`, [`T${randomBytes(3).toString("hex")}`, capacity]);
  let driver = driverId;
  if (!driver) {
    const [d] = await db.query(`INSERT INTO drivers (name) VALUES ('Fixture Driver')`);
    driver = d.insertId;
  }
  const [trip] = await db.query(
    `INSERT INTO trips (departure_time, arrival_time, status, bus_id, driver_id, route_id)
     VALUES (NOW() + INTERVAL ? MINUTE, NOW() + INTERVAL ? MINUTE, 'Scheduled', ?, ?, ?)`,
    [Math.round(hours * 60), Math.round(hours * 60) + 240, bus.insertId, driver, route.insertId]
  );
  return { tripId: trip.insertId, routeId: route.insertId };
}

let seatCounter = 0;
export async function book(passenger, tripId, seats = [String(++seatCounter)]) {
  const r = await api("POST", "/api/bookings", { token: passenger.token, body: { tripId, seatNumbers: seats } });
  if (r.status !== 201) throw new Error(`booking failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.bookings.map((b) => b.booking_id);
}

// A unique, valid-looking PNG (correct signature, >1 KB) as a data URL.
export function pngReceipt(size = 3000) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([sig, randomBytes(size)]).toString("base64")}`;
}
export function jpegBytesAsPng() {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(3000)]);
  return `data:image/png;base64,${jpeg.toString("base64")}`;
}

let refCounter = 1000000000000;
export function gcashRef() {
  refCounter += Math.floor(Math.random() * 1000) + 1;
  return String(refCounter);
}

export function proof({ bookingIds, methodId, reference = gcashRef(), amount = "350.00", receipt = pngReceipt(), paidAt = new Date().toISOString(), ...rest }) {
  return { bookingIds, methodId, referenceNumber: reference, amountClaimed: amount, paidAt, receiptImage: receipt, ...rest };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
