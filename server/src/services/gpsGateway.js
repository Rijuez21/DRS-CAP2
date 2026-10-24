import net from "node:net";
import { pool } from "../db/pool.js";
import { ingestLocation } from "./locationService.js";

// Receives the SinoTrack ST-906L directly — no Traccar in between.
//
// The tracker opens a plain TCP connection to the address set by SMS
// (8040000 <host> <port>) and streams SinoTrack's "h02" protocol. It comes
// in two shapes, and SinoTrack units send both:
//   text    *HQ,<id>,V1,<hhmmss>,<A|V>,<ddmm.mmmm>,<N|S>,<dddmm.mmmm>,<E|W>,<knots>,<course>,<ddmmyy>,<status>,...#
//   binary  '$' + 31 bytes of packed BCD (same fields; layout in parseBinary)
// Field layouts follow Traccar's H02 decoder, the reference implementation.
//
// Positions from a tracker assigned to a bus (buses.gps_device_id) go
// through ingestLocation, exactly like phone points, so every map updates.
// Everything else the admin GPS Tracker page needs to verify the connection
// (connected?, last message, last fix, raw messages) is kept in memory here
// and pushed live to the "gps:admin" Socket.io room.

// Offline after this long silent. The ST-901L-4G reports every 10 s while
// moving but only every 300 s when parked (RCONF "GPRS UPLOAD TIME:10,300"),
// so this must stay above 5 min or a parked bus flickers offline.
const ONLINE_MS = 7 * 60 * 1000;
const LOG_SIZE = 40;
const TRAIL_SIZE = 200;
const MAX_DEVICES = 20; // anyone can open a TCP connection; don't let junk IDs grow memory
const MAX_BUFFER = 4096;
const KNOTS_TO_KMH = 1.852;

const devices = new Map(); // deviceId -> state
const listener = { port: null, running: false, error: null, startedAt: null };
let io = null;

function deviceState(deviceId) {
  let d = devices.get(deviceId);
  if (!d) {
    if (devices.size >= MAX_DEVICES) {
      // Drop the longest-silent unit to make room.
      const oldest = [...devices.values()].sort((a, b) => (a.lastMessageAt ?? 0) - (b.lastMessageAt ?? 0))[0];
      devices.delete(oldest.deviceId);
    }
    d = {
      deviceId,
      connected: false,
      remoteAddress: null,
      connectedAt: null,
      disconnectedAt: null,
      lastMessageAt: null,
      messageCount: 0,
      fix: null, // last decoded position, valid or not
      lastValidFix: null,
      link: null, // signal / satellites / battery from LINK heartbeats
      lastIngest: null, // { at, busId } or { at, error }
      recentFixKeys: [], // last stored fixes, to drop re-sent duplicates
      trail: [],
      log: [],
    };
    devices.set(deviceId, d);
  }
  return d;
}

// ---- Decoding --------------------------------------------------------

function utcDate(ddmmyy, hhmmss) {
  if (!/^\d{6}$/.test(ddmmyy) || !/^\d{6}$/.test(hhmmss)) return null;
  const n = (s, i) => Number(s.slice(i, i + 2));
  const date = new Date(Date.UTC(2000 + n(ddmmyy, 4), n(ddmmyy, 2) - 1, n(ddmmyy, 0), n(hhmmss, 0), n(hhmmss, 2), n(hhmmss, 4)));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ddmm.mmmm / dddmm.mmmm -> decimal degrees
function nmeaToDegrees(value, hemisphere) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const degrees = Math.floor(v / 100);
  const result = degrees + (v - degrees * 100) / 60;
  return hemisphere === "S" || hemisphere === "W" ? -result : result;
}

// Traccar's reading of the 32-bit status word (bits are active-low).
function decodeStatus(status) {
  if (!Number.isFinite(status)) return { ignition: null, alarms: [] };
  const bit = (n) => ((status >>> n) & 1) === 1;
  const alarms = [];
  if (!bit(0)) alarms.push("Vibration");
  if (!bit(1) || !bit(18)) alarms.push("SOS");
  if (!bit(2)) alarms.push("Overspeed");
  if (!bit(19)) alarms.push("Power cut");
  return { ignition: bit(10), alarms, statusHex: status.toString(16).toUpperCase().padStart(8, "0") };
}

function parseText(text) {
  // text is the whole frame, "*HQ,....#"
  const parts = text.replace(/^\*/, "").replace(/#$/, "").split(",");
  const deviceId = parts[1]?.trim();
  const type = parts[2]?.trim() ?? "";
  if (parts[0] !== "HQ" || !deviceId || !/^[0-9A-Za-z]{1,32}$/.test(deviceId)) return null;
  const out = { deviceId, type };

  if (type !== "LINK") {
    // Position reports come under several types: V1 is the usual one, but
    // the ST-901L-4G sends V8, and V4 is a command reply that echoes the
    // position after its own fields. So any type may carry a fix — find it
    // by its "<hhmmss>,<A|V>" marker rather than by type or a fixed index.
    let i = 3;
    while (i < parts.length && !(/^\d{6}$/.test(parts[i]) && /^[AV]$/.test(parts[i + 1] ?? ""))) i += 1;
    if (i < parts.length - 9) {
      const [time, validity, lat, ns, lon, ew, speed, course, date, status] = parts.slice(i, i + 10);
      const latitude = nmeaToDegrees(lat, ns);
      const longitude = nmeaToDegrees(lon, ew);
      const fixTime = utcDate(date, time);
      if (latitude !== null && longitude !== null && fixTime) {
        out.fix = {
          valid: validity === "A",
          latitude,
          longitude,
          time: fixTime.toISOString(),
          speedKmh: Math.round(Number(speed || 0) * KNOTS_TO_KMH * 10) / 10,
          course: Number(course || 0),
          ...decodeStatus(parseInt(status, 16)),
        };
      }
    }
  } else if (type === "LINK") {
    // *HQ,<id>,LINK,<hhmmss>,<gsm>,<satellites>,<battery %>,...
    out.link = { gsm: Number(parts[4]), satellites: Number(parts[5]), battery: Number(parts[6]) };
  }
  return out;
}

function parseBinary(buf) {
  // Byte layout (BCD = two decimal digits per byte):
  //   0 '$' | 1-5 id | 6-8 hhmmss | 9-11 ddmmyy | 12-15 lat ddmmmmmm
  //   16 battery | 17-21 lon dddmmmmmm + flags nibble | 22-24 speed(3) course(3)
  //   25-28 status word
  const hex = buf.toString("hex");
  const at = (from, len) => hex.slice(from * 2, from * 2 + len);
  const deviceId = at(1, 10);
  const time = at(6, 6);
  const date = at(9, 6);
  const latHex = at(12, 8);
  const lonHex = at(17, 10);
  if (!/^\d+$/.test(deviceId + time + date + latHex + lonHex.slice(0, 9))) return deviceId ? { deviceId, type: "binary" } : null;
  const flags = parseInt(lonHex[9], 16);
  let latitude = Number(latHex.slice(0, 2)) + Number(latHex.slice(2)) / 10000 / 60;
  let longitude = Number(lonHex.slice(0, 3)) + Number(lonHex.slice(3, 9)) / 10000 / 60;
  if (!(flags & 0x04)) latitude = -latitude;
  if (!(flags & 0x08)) longitude = -longitude;
  const speedCourse = at(22, 6);
  const fixTime = utcDate(date, time);
  return {
    deviceId,
    type: "binary",
    fix: fixTime && {
      valid: Boolean(flags & 0x02),
      latitude,
      longitude,
      time: fixTime.toISOString(),
      speedKmh: Math.round(Number(speedCourse.slice(0, 3)) * KNOTS_TO_KMH * 10) / 10,
      course: Number(speedCourse.slice(3, 6)),
      battery: Math.min(100, Math.round((buf[16] * 100) / 6)),
      ...decodeStatus(buf.readUInt32BE(25)),
    },
  };
}

// Splits the TCP stream into frames. Returns [frames, leftover].
function splitFrames(buffer) {
  const frames = [];
  let rest = buffer;
  while (rest.length > 0) {
    const marker = rest[0];
    if (marker === 0x2a /* * */) {
      const end = rest.indexOf(0x23 /* # */);
      if (end === -1) break;
      frames.push({ kind: "text", data: rest.subarray(0, end + 1) });
      rest = rest.subarray(end + 1);
    } else if (marker === 0x24 /* $ */) {
      // Same rule as Traccar: a 45-byte "long" frame when exactly that much
      // arrived, otherwise the standard 32-byte one.
      const length = rest.length === 45 ? 45 : 32;
      if (rest.length < length) break;
      frames.push({ kind: "binary", data: rest.subarray(0, length) });
      rest = rest.subarray(length);
    } else {
      // Noise between frames (line breaks, keep-alive bytes) — skip to the next marker.
      const next = rest.findIndex((b) => b === 0x2a || b === 0x24);
      rest = next === -1 ? Buffer.alloc(0) : rest.subarray(next);
    }
  }
  return [frames, rest];
}

// ---- Handling --------------------------------------------------------

function publicState(d) {
  const now = Date.now();
  return {
    deviceId: d.deviceId,
    connected: d.connected,
    online: Boolean(d.lastMessageAt && now - d.lastMessageAt < ONLINE_MS),
    remoteAddress: d.remoteAddress,
    connectedAt: d.connectedAt && new Date(d.connectedAt).toISOString(),
    disconnectedAt: d.disconnectedAt && new Date(d.disconnectedAt).toISOString(),
    lastMessageAt: d.lastMessageAt && new Date(d.lastMessageAt).toISOString(),
    messageCount: d.messageCount,
    fix: d.fix,
    lastValidFix: d.lastValidFix,
    link: d.link,
    lastIngest: d.lastIngest,
  };
}

function emit(d) {
  io?.to("gps:admin").emit("gps:device", publicState(d));
}

async function handleFrame(frame, socket, conn) {
  const raw = frame.kind === "text" ? frame.data.toString("latin1") : frame.data.toString("hex").toUpperCase();
  let parsed;
  try {
    parsed = frame.kind === "text" ? parseText(raw) : parseBinary(frame.data);
  } catch {
    parsed = null;
  }
  if (!parsed) return;

  // Acknowledge every text message. The ST-901L-4G re-sends the same
  // record every ~2 s until it gets "*HQ,<id>,R12,<hhmmss>#" back (seen in
  // the field: one V8 record repeated ~41,000 times overnight), so without
  // this it never moves on to newer positions. The time echoes the
  // message's own time field, as in SinoTrack/Traccar logs.
  if (frame.kind === "text" && parsed.type !== "LINK") {
    const msgTime = raw.split(",")[3];
    const time = /^\d{6}$/.test(msgTime ?? "") ? msgTime : new Date().toISOString().slice(11, 19).replace(/:/g, "");
    if (!socket.destroyed) socket.write(`*HQ,${parsed.deviceId},R12,${time}#`);
  }

  const d = deviceState(parsed.deviceId);
  if (conn.deviceId !== parsed.deviceId) {
    conn.deviceId = parsed.deviceId;
    d.connectedAt = conn.openedAt;
  }
  d.connected = true;
  d.remoteAddress = socket.remoteAddress?.replace(/^::ffff:/, "") ?? null;
  d.lastMessageAt = Date.now();
  d.messageCount += 1;
  d.log.unshift({ at: new Date().toISOString(), type: parsed.type, raw: raw.slice(0, 300) });
  d.log.length = Math.min(d.log.length, LOG_SIZE);
  if (parsed.link) d.link = parsed.link;

  if (parsed.fix) {
    d.fix = parsed.fix;
    const { valid, time, latitude, longitude } = parsed.fix;
    // A re-sent record (same time and place) is only stored once.
    const key = `${time}|${latitude}|${longitude}`;
    if (valid && !d.recentFixKeys.includes(key)) {
      d.recentFixKeys.push(key);
      if (d.recentFixKeys.length > 50) d.recentFixKeys.shift();
      // Stored records uploaded after a signal gap arrive out of order;
      // "current position" only ever moves forward in time.
      if (!d.lastValidFix || time >= d.lastValidFix.time) d.lastValidFix = parsed.fix;
      d.trail.push({ latitude, longitude, time });
      if (d.trail.length > TRAIL_SIZE) d.trail.shift();
      await recordFix(d, parsed.fix);
    }
  }
  emit(d);
}

// Store + broadcast a valid fix if this tracker belongs to a bus.
async function recordFix(d, fix) {
  try {
    const [[bus]] = await pool.query(`SELECT bus_id FROM buses WHERE gps_device_id = ?`, [d.deviceId]);
    if (!bus) {
      d.lastIngest = { at: new Date().toISOString(), error: "Not assigned to a bus" };
      return;
    }
    const time = new Date(fix.time).getTime();
    const now = Date.now();
    // A fix more than 2 min old is one the tracker stored while it had no
    // signal and is uploading now — shown as "buffered", like the phone's.
    // A tracker clock wildly off (no GPS time yet) falls back to now.
    const sane = time > now - 48 * 3600 * 1000 && time < now + 10 * 60 * 1000;
    await ingestLocation(io, {
      busId: bus.bus_id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      timestamp: sane ? fix.time : new Date().toISOString(),
      syncStatus: sane && time < now - 2 * 60 * 1000 ? "buffered" : "synced",
      source: "device",
      // Only the newest fix moves the bus on the live maps.
      live: fix === d.lastValidFix,
    });
    d.lastIngest = { at: new Date().toISOString(), busId: bus.bus_id };
  } catch (err) {
    console.error("GPS tracker: failed to record position:", err.message);
    d.lastIngest = { at: new Date().toISOString(), error: "Server could not save the position" };
  }
}

export function startGpsGateway(socketIo) {
  io = socketIo;
  const setting = process.env.GPS_TCP_PORT ?? "5013";
  if (setting === "off" || setting === "0") return;
  const port = Number(setting);

  const server = net.createServer((socket) => {
    const conn = { deviceId: null, openedAt: Date.now() };
    let buffer = Buffer.alloc(0);
    socket.setKeepAlive(true, 60000);
    socket.setTimeout(30 * 60 * 1000, () => socket.destroy()); // half-open connections

    // Frames are handled one at a time, in order.
    let queue = Promise.resolve();
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_BUFFER) buffer = Buffer.alloc(0); // not a tracker
      const [frames, rest] = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) queue = queue.then(() => handleFrame(frame, socket, conn)).catch(() => {});
    });
    socket.on("close", () => {
      const d = conn.deviceId && devices.get(conn.deviceId);
      if (d && d.connectedAt === conn.openedAt) {
        d.connected = false;
        d.disconnectedAt = Date.now();
        emit(d);
      }
    });
    socket.on("error", () => {});
  });

  server.on("error", (err) => {
    listener.running = false;
    listener.error = err.code === "EADDRINUSE" ? `Port ${port} is already in use` : err.message;
    console.error(`GPS tracker listener: ${listener.error}`);
  });
  server.listen(port, () => {
    listener.port = port;
    listener.running = true;
    listener.error = null;
    listener.startedAt = new Date().toISOString();
    console.log(`GPS tracker listener (SinoTrack h02) on TCP port ${port}`);
  });
}

// ---- Read side for routes/gps.js ------------------------------------

export function getListener() {
  return { ...listener, port: listener.port ?? Number(process.env.GPS_TCP_PORT ?? 5013) };
}

export function getDevice(deviceId) {
  const d = devices.get(deviceId);
  return d ? { ...publicState(d), trail: d.trail, log: d.log } : null;
}

export function listDevices() {
  return [...devices.values()].map(publicState);
}

export const GPS_ONLINE_MS = ONLINE_MS;
export const _test = { parseText, parseBinary, splitFrames };
