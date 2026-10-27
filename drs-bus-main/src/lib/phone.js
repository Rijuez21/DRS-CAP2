// Philippine mobile numbers for passenger sign-up. Same rule as the server's
// cleanPhMobile (server/src/services/passwordPolicy.js), which has the final
// say: 09XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX, spaces or dashes allowed,
// stored as +639XXXXXXXXX. Returns the stored form, or null if invalid.
export function normalizePhMobile(value) {
  const match = /^(?:\+?63|0)(9\d{9})$/.exec(String(value ?? "").trim().replace(/[\s-]/g, ""));
  return match ? `+63${match[1]}` : null;
}

// "+639171234567" -> "+63 917 123 4567"; anything else is shown as stored.
export function formatPhMobile(value) {
  const match = /^\+63(9\d{2})(\d{3})(\d{4})$/.exec(value ?? "");
  return match ? `+63 ${match[1]} ${match[2]} ${match[3]}` : value;
}
