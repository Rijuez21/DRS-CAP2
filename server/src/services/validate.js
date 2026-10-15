// Small shared validators for admin/staff forms and device input. Each
// returns { value } or { error } so routes can answer 400 with a clear
// message instead of letting bad data reach MySQL (500) or the business
// rules (e.g. a ₱0 or negative fare that passengers would then "pay").

export function optionalText(value, { max, label, allowEmpty = true }) {
  if (value === undefined || value === null || (allowEmpty && value === "")) return { value: null };
  if (typeof value !== "string" && typeof value !== "number") return { error: `${label} must be text` };
  const text = String(value).trim();
  if (text.length > max) return { error: `${label} must be at most ${max} characters` };
  if (/[<>\u0000-\u001f]/.test(text)) return { error: `${label} contains characters that aren't allowed` };
  return { value: text || null };
}

export function requiredText(value, opts) {
  const r = optionalText(value, { ...opts, allowEmpty: true });
  if (r.error) return r;
  if (!r.value) return { error: `${opts.label} is required` };
  return r;
}

// Money: non-negative, at most 2 decimals, below max (pesos). Returns the
// DECIMAL string. nullable=true lets an explicit null clear the field.
export function money(value, { label, min = 0, max = 100000, nullable = false }) {
  if (value === null || value === "" || value === undefined) return nullable ? { value: null } : { error: `${label} is required` };
  const text = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return { error: `${label} must be an amount like 350 or 350.50` };
  const n = Number(text);
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}` };
  return { value: n.toFixed(2) };
}

export function integer(value, { label, min, max, nullable = false }) {
  if (value === null || value === "" || value === undefined) return nullable ? { value: null } : { error: `${label} is required` };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} must be a whole number from ${min} to ${max}` };
  return { value: n };
}

export function decimal(value, { label, min, max, nullable = true }) {
  if (value === null || value === "" || value === undefined) return nullable ? { value: null } : { error: `${label} is required` };
  if (typeof value === "boolean") return { error: `${label} must be a number` };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be a number from ${min} to ${max}` };
  return { value: n };
}

export function dateTime(value, { label }) {
  if (typeof value !== "string" && !(value instanceof Date)) return { error: `${label} must be a date and time` };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: `${label} must be a valid date and time` };
  const year = d.getFullYear();
  if (year < 2000 || year > 2100) return { error: `${label} is out of range` };
  return { value: d };
}

export function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}

// Escapes % and _ so user search text is matched literally inside LIKE.
export function likeEscape(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Spreadsheet formula injection: a cell starting with = + - @ (or tab/CR)
// is executed by Excel/Sheets. Prefix such values with ' so they stay text.
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
