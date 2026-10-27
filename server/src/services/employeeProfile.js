import { cleanName, cleanPhone } from "./passwordPolicy.js";

// The HR details an admin records for every employee account — terminal
// staff, admins and drivers alike (admin/UserManagement.jsx). Shared so
// routes/staff.js and routes/drivers.js validate them the same way.
//
// Every field is optional: an account can be created before all of it is on
// hand, and "" clears a field back to NULL.

const SEXES = ["Male", "Female"];

// body key -> column, for the fields both tables have.
export const PROFILE_COLUMNS = {
  employeeNo: "employee_no",
  phoneno: "phoneno",
  birthDate: "birth_date",
  sex: "sex",
  address: "address",
  hireDate: "hire_date",
  emergencyContactName: "emergency_contact_name",
  emergencyContactPhone: "emergency_contact_phone",
};

// SELECT list for those columns. Dates go out as plain YYYY-MM-DD strings:
// mysql2 would otherwise turn a DATE into a midnight-+08:00 Date that
// serialises as the previous day in UTC.
export const PROFILE_SELECT = `employee_no, phoneno, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date, sex, address,
  DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date, emergency_contact_name, emergency_contact_phone`;

const blank = (v) => v === null || v === "";

// Returns { value } (a real calendar date as YYYY-MM-DD, or null) or { error }.
export function cleanDate(value, label) {
  if (blank(value)) return { value: null };
  const s = String(value).trim();
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: `${label} must be a valid date (YYYY-MM-DD)` };
  }
  return { value: s };
}

function cleanText(value, label, max) {
  if (blank(value)) return { value: null };
  if (typeof value !== "string") return { error: `${label} must be text` };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) return { error: `Keep the ${label.toLowerCase()} under ${max} characters` };
  if (/[<>\u0000-\u001f]/.test(text)) return { error: `The ${label.toLowerCase()} contains characters that aren't allowed` };
  return { value: text || null };
}

const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // Philippine date

const CLEANERS = {
  employeeNo: (v) => cleanText(v, "Employee number", 30),
  phoneno: (v) => cleanPhone(v),
  birthDate: (v) => {
    const r = cleanDate(v, "Birth date");
    if (r.value && r.value > today()) return { error: "Birth date can't be in the future" };
    return r;
  },
  sex: (v) => (blank(v) ? { value: null } : SEXES.includes(v) ? { value: v } : { error: `Sex must be one of: ${SEXES.join(", ")}` }),
  address: (v) => cleanText(v, "Address", 255),
  hireDate: (v) => cleanDate(v, "Hire date"),
  emergencyContactName: (v) => (blank(v) ? { value: null } : cleanName(v)),
  emergencyContactPhone: (v) => cleanPhone(v),
};

// Validates whichever profile fields are present in `body` (undefined =
// leave alone). Returns { columns: { column: value }, error }.
export function cleanProfile(body = {}) {
  const columns = {};
  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (body[key] === undefined) continue;
    const r = CLEANERS[key](body[key]);
    if (r.error) return { columns, error: r.error };
    columns[column] = r.value;
  }
  return { columns, error: null };
}
