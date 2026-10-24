// Pretends to be a SinoTrack tracker so the admin GPS Tracker page can be
// tried without the real ST-906L: connects to the tracker port and sends
// h02 position messages along a short Baguio route, like the device does.
//
//   npm run gps:simulate                          -> localhost:5013, ID 9999999999
//   npm run gps:simulate -- --id 1234567890 --host 1.2.3.4 --port 5013
//   npm run gps:simulate -- --binary              -> binary '$' frames instead of text
//   npm run gps:simulate -- --nofix               -> "V" (no satellite fix) messages
//
// The default ID 9999999999 is not a real tracker. Positions are only saved
// if that ID is assigned to a bus in the GPS Tracker page — leave it
// unassigned to test the connection checks without touching bus data.
import net from "node:net";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const host = opt("host", "127.0.0.1");
const port = Number(opt("port", 5013));
const id = opt("id", "9999999999");
const binary = args.includes("--binary");
const noFix = args.includes("--nofix");
const intervalMs = Number(opt("interval", 3)) * 1000;

// Session Road -> Magsaysay Ave -> La Trinidad (rough points)
const ROUTE = [
  [16.4114, 120.5980], [16.4136, 120.5962], [16.4160, 120.5955], [16.4189, 120.5947],
  [16.4220, 120.5949], [16.4255, 120.5958], [16.4291, 120.5967], [16.4330, 120.5975],
  [16.4372, 120.5980], [16.4410, 120.5987], [16.4452, 120.5993], [16.4490, 120.5990],
];

const pad = (n, w) => String(Math.floor(n)).padStart(w, "0");
const toNmea = (deg, w) => {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  return `${pad(d, w)}${((a - d) * 60).toFixed(4).padStart(7, "0")}`;
};
function stamp(date) {
  return {
    time: `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}`,
    date: `${pad(date.getUTCDate(), 2)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCFullYear() % 100, 2)}`,
  };
}

function textFrame(lat, lon, knots, course) {
  const { time, date } = stamp(new Date());
  const status = "FFFFFBFF";
  return `*HQ,${id},V1,${time},${noFix ? "V" : "A"},${toNmea(lat, 2)},${lat < 0 ? "S" : "N"},${toNmea(lon, 3)},${lon < 0 ? "W" : "E"},${knots.toFixed(2)},${pad(course, 3)},${date},${status},515,03,0,0,6#`;
}

function binaryFrame(lat, lon, knots, course) {
  const { time, date } = stamp(new Date());
  const latDigits = toNmea(lat, 2).replace(".", ""); // ddmmmmmm
  const lonDigits = toNmea(lon, 3).replace(".", ""); // dddmmmmmm
  const flags = (noFix ? 0 : 0x02) | (lat >= 0 ? 0x04 : 0) | (lon >= 0 ? 0x08 : 0);
  const hex =
    "24" + id.padStart(10, "0").slice(-10) + time + date + latDigits + "06" + lonDigits + flags.toString(16) +
    pad(knots, 3) + pad(course, 3) + "FFFFFBFF" + "00".repeat(3);
  return Buffer.from(hex, "hex");
}

function heading(a, b) {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const socket = net.connect(port, host, () => {
  console.log(`Simulated tracker ${id} connected to ${host}:${port} (${binary ? "binary" : "text"} h02). Ctrl+C to stop.`);
  let i = 0;
  const send = () => {
    const a = ROUTE[i % ROUTE.length];
    const b = ROUTE[(i + 1) % ROUTE.length];
    const course = heading(a, b);
    const knots = 14 + Math.random() * 6;
    const frame = binary ? binaryFrame(a[0], a[1], knots, course) : textFrame(a[0], a[1], knots, course);
    socket.write(frame);
    console.log("sent", binary ? frame.toString("hex").toUpperCase() : frame);
    i += 1;
  };
  send();
  setInterval(send, intervalMs);
});
// The server acknowledges each message with "*HQ,<id>,R12,<hhmmss>#".
socket.on("data", (chunk) => console.log("server replied", chunk.toString("latin1")));
socket.on("error", (err) => {
  console.error(`Can't reach ${host}:${port} — ${err.message}. Is the backend running?`);
  process.exit(1);
});
socket.on("close", () => {
  console.log("Connection closed by server.");
  process.exit(0);
});
