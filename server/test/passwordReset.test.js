// Forgot password by emailed 6-digit code (routes/auth.js). Same harness as
// payments.test.js. SMTP isn't configured in tests, so no mail leaves the
// machine; the code itself is only ever stored as a bcrypt hash, so each
// test swaps in the hash of a code it knows.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { setup, teardown, api, db, createPassenger, createStaff, PASSWORD, sleep } from "./helpers.js";

before(() => setup());
after(teardown);

const NEW_PASSWORD = "Brand-new-pass-9";

async function emailOf(passenger) {
  const [[row]] = await db.query(`SELECT email FROM commuters WHERE commuter_id = ?`, [passenger.id]);
  return row.email;
}

// The code is issued after the response is sent; wait for the row, then
// replace its hash with one for `code`.
async function requestCode(email, role = "passenger", code = "123456") {
  const [[{ lastId }]] = await db.query(`SELECT COALESCE(MAX(reset_id), 0) AS lastId FROM password_resets`);
  const r = await api("POST", "/api/auth/forgot-password", { body: { email, role } });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50; i += 1) {
    const [[row]] = await db.query(`SELECT reset_id FROM password_resets WHERE reset_id > ? AND used_at IS NULL`, [lastId]);
    if (row) {
      await db.query(`UPDATE password_resets SET code_hash = ? WHERE reset_id = ?`, [bcrypt.hashSync(code, 4), row.reset_id]);
      return row.reset_id;
    }
    await sleep(50);
  }
  throw new Error("No reset code was issued");
}

describe("forgot password", () => {
  test("code -> reset token -> new password; old sessions and password stop working", async () => {
    const p = await createPassenger("Reset Me");
    const email = await emailOf(p);
    await requestCode(email);

    const verify = await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "123456" } });
    assert.equal(verify.status, 200);
    assert.ok(verify.data.resetToken);

    const reset = await api("POST", "/api/auth/reset-password", { body: { resetToken: verify.data.resetToken, password: NEW_PASSWORD } });
    assert.equal(reset.status, 200);

    assert.equal((await api("POST", "/api/auth/login", { body: { email, password: PASSWORD, role: "passenger" } })).status, 401);
    assert.equal((await api("POST", "/api/auth/login", { body: { email, password: NEW_PASSWORD, role: "passenger" } })).status, 200);
    assert.equal((await api("GET", "/api/payments/mine", { token: p.token })).status, 401);

    // The token is single-use.
    const again = await api("POST", "/api/auth/reset-password", { body: { resetToken: verify.data.resetToken, password: "Another-pass-77" } });
    assert.equal(again.status, 400);
  });

  test("unknown email gets the same answer as a real one, and no code", async () => {
    const [[{ before }]] = await db.query(`SELECT COUNT(*) AS before FROM password_resets`);
    const r = await api("POST", "/api/auth/forgot-password", { body: { email: "nobody-here@test.local", role: "passenger" } });
    assert.equal(r.status, 200);
    await sleep(300);
    const [[{ after: count }]] = await db.query(`SELECT COUNT(*) AS after FROM password_resets`);
    assert.equal(count, before);
  });

  test("a code dies after 5 wrong guesses", async () => {
    const p = await createPassenger("Guess Target");
    const email = await emailOf(p);
    await requestCode(email);
    for (let i = 0; i < 5; i += 1) {
      const r = await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "000000" } });
      assert.equal(r.status, 400);
    }
    const right = await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "123456" } });
    assert.equal(right.status, 400);
  });

  test("a newer code replaces the older one", async () => {
    const p = await createPassenger("Two Codes");
    const email = await emailOf(p);
    await requestCode(email, "passenger", "111111");
    await requestCode(email, "passenger", "222222");
    assert.equal((await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "111111" } })).status, 400);
    assert.equal((await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "222222" } })).status, 200);
  });

  test("a code is tied to the role it was requested for", async () => {
    const staff = await createStaff("Desk Staff", "terminal_staff");
    const [[row]] = await db.query(`SELECT email FROM staff_accounts WHERE staff_id = ?`, [staff.id]);
    await requestCode(row.email, "staff");
    const asAdmin = await api("POST", "/api/auth/verify-reset-code", { body: { email: row.email, role: "admin", code: "123456" } });
    assert.equal(asAdmin.status, 400);
    const asStaff = await api("POST", "/api/auth/verify-reset-code", { body: { email: row.email, role: "staff", code: "123456" } });
    assert.equal(asStaff.status, 200);
  });

  test("the new password must pass the password policy", async () => {
    const p = await createPassenger("Weak Choice");
    const email = await emailOf(p);
    await requestCode(email);
    const verify = await api("POST", "/api/auth/verify-reset-code", { body: { email, role: "passenger", code: "123456" } });
    const weak = await api("POST", "/api/auth/reset-password", { body: { resetToken: verify.data.resetToken, password: "short" } });
    assert.equal(weak.status, 400);
  });
});
