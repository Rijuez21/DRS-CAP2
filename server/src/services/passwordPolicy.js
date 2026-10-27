// One password rule for every account type (passenger sign-up, staff and
// driver accounts created or reset by an admin).
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou",
  "admin123", "staff123", "driver123", "passenger123", "abc12345", "11111111", "00000000", "letmein1",
]);

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // bcrypt only uses the first 72 bytes; this bounds hashing cost

// Returns an error string or null.
export function whyPasswordWeak(password, { email, name } = {}) {
  if (typeof password !== "string") return "Password is required";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for the password`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters for the password`;
  if (Buffer.byteLength(password, "utf8") > 72) return "That password is too long (max 72 bytes)";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Use both letters and numbers in the password";
  if (!/[A-Z]/.test(password)) return "Use at least one capital letter in the password";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common — choose another";
  const local = String(email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return "Don't use your email in the password";
  const first = String(name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) return "Don't use your name in the password";
  return null;
}

// Basic shape checks shared by account forms. Returns { value } or { error }.
export function cleanEmail(value) {
  if (typeof value !== "string") return { error: "Enter a valid email address" };
  const email = value.trim().toLowerCase();
  if (email.length > 150 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(email)) return { error: "Enter a valid email address" };
  return { value: email };
}

export function cleanName(value, max = 150) {
  if (typeof value !== "string") return { error: "Enter a name" };
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter a name" };
  if (name.length > max) return { error: `Keep the name under ${max} characters` };
  if (/[<>\u0000-\u001f]/.test(name)) return { error: "The name contains characters that aren't allowed" };
  return { value: name };
}

export function cleanPhone(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string" && typeof value !== "number") return { error: "Enter a valid phone number" };
  const phone = String(value).trim();
  if (!/^[0-9+()\- ]{7,20}$/.test(phone)) return { error: "Enter a valid phone number" };
  return { value: phone };
}

// Passenger sign-up only (staff, driver and owner forms keep cleanPhone).
// Accepts a Philippine mobile number as 09XXXXXXXXX, 639XXXXXXXXX or
// +639XXXXXXXXX, with spaces or dashes, and stores it as +639XXXXXXXXX so
// one number can't be registered twice in two formats. The frontend has a
// copy of this rule (LoginForm.jsx); this one decides.
export function cleanPhMobile(value) {
  if (typeof value !== "string" || !value.trim()) return { error: "Enter your mobile number" };
  const compact = value.trim().replace(/[\s-]/g, "");
  const match = /^(?:\+?63|0)(9\d{9})$/.exec(compact);
  if (!match) return { error: "Enter a valid Philippine mobile number, e.g. 0917 123 4567" };
  return { value: `+63${match[1]}` };
}
