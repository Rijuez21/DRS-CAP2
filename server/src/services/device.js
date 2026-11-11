// Which browser a login came from — for the "this account is signed in on
// another device" warning (services/sessions.js, routes/auth.js). Pure
// helpers, no database.

// The random id the browser keeps for itself (drs-bus-main lib/api.js).
// Anything else is ignored.
export function cleanDeviceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

const OS = [
  [/Android/i, "Android"],
  [/iPhone/i, "iPhone"],
  [/iPad/i, "iPad"],
  [/Windows/i, "Windows"],
  [/CrOS/, "Chromebook"],
  [/Macintosh|Mac OS X/i, "Mac"],
  [/Linux/i, "Linux"],
];
// Order matters: Edge, Opera and Samsung Internet also say "Chrome", and
// Chrome also says "Safari".
const BROWSERS = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
];

// "Chrome on Android". A rough guess from the User-Agent is all it needs.
export function describeDevice(userAgent) {
  const ua = String(userAgent ?? "");
  const os = OS.find(([re]) => re.test(ua))?.[1] ?? null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "another device";
}
