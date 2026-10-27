// Employee profiles on staff and driver accounts (admin/UserManagement.jsx).
// Run: npm test   (see test/helpers.js for the database it uses)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, createStaff } from "./helpers.js";

let admin;

before(async () => {
  await setup();
  admin = await createStaff("Ana Admin", "admin");
});
after(teardown);

const profile = {
  employeeNo: "DRS-0042",
  phoneno: "0917 123 4567",
  birthDate: "1990-02-28",
  sex: "Female",
  address: "  12 Session Road,   Baguio City ",
  hireDate: "2024-06-01",
  emergencyContactName: "Juan Cruz",
  emergencyContactPhone: "0918 765 4321",
};

test("a staff account is created with its full employee profile, and it reads back as entered", async () => {
  const r = await api("POST", "/api/staff", {
    token: admin.token,
    body: { name: "Maria Cruz", email: "maria@test.local", password: "Strong-pass-42", role: "terminal_staff", ...profile },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const list = await api("GET", "/api/staff", { token: admin.token });
  const row = list.data.find((s) => s.staff_id === r.data.staff_id);
  assert.equal(row.employee_no, "DRS-0042");
  assert.equal(row.birth_date, "1990-02-28"); // a plain date, not shifted a day by the +08:00 timezone
  assert.equal(row.hire_date, "2024-06-01");
  assert.equal(row.address, "12 Session Road, Baguio City");
  assert.equal(row.sex, "Female");
  assert.equal(row.emergency_contact_phone, "0918 765 4321");

  const edit = await api("PATCH", `/api/staff/${row.staff_id}`, { token: admin.token, body: { address: "", phoneno: "0920 000 1111" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  const after = (await api("GET", "/api/staff", { token: admin.token })).data.find((s) => s.staff_id === row.staff_id);
  assert.equal(after.address, null);
  assert.equal(after.phoneno, "0920 000 1111");
  assert.equal(after.employee_no, "DRS-0042"); // untouched fields stay

  const dup = await api("POST", "/api/staff", {
    token: admin.token,
    body: { name: "Other", email: "other@test.local", password: "Strong-pass-42", role: "terminal_staff", employeeNo: "DRS-0042" },
  });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /employee number/);
});

test("a driver account is created with login, license and employee profile, and can sign in", async () => {
  const r = await api("POST", "/api/drivers", {
    token: admin.token,
    body: { name: "Pedro Santos", email: "pedro@test.local", password: "Strong-pass-42", licenseNumber: "N01-23-456789", licenseExpiry: "2028-05-15", ...profile, employeeNo: "DRV-001" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const row = (await api("GET", `/api/drivers/${r.data.driver_id}`, { token: admin.token })).data;
  assert.equal(row.license_number, "N01-23-456789");
  assert.equal(row.license_expiry, "2028-05-15");
  assert.equal(row.employee_no, "DRV-001");
  assert.equal(row.hire_date, "2024-06-01");
  assert.equal(row.emergency_contact_name, "Juan Cruz");

  const login = await api("POST", "/api/auth/login", { body: { email: "pedro@test.local", password: "Strong-pass-42", role: "driver" } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

test("bad profile values are refused", async () => {
  const base = { name: "Bad Data", email: "bad@test.local", password: "Strong-pass-42", role: "terminal_staff" };
  for (const extra of [{ birthDate: "1990-02-30" }, { birthDate: "2999-01-01" }, { sex: "X" }, { phoneno: "call me" }, { hireDate: "June 1" }, { address: "<script>" }]) {
    const r = await api("POST", "/api/staff", { token: admin.token, body: { ...base, ...extra } });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
  const d = await api("POST", "/api/drivers", { token: admin.token, body: { name: "D", licenseExpiry: "2028-13-01" } });
  assert.equal(d.status, 400);
});
