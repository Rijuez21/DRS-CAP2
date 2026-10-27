// Passenger sign-up: required Philippine mobile number (one account per
// number) and Terms / Privacy consent. Same harness as security.test.js.
// /register allows 10 requests per IP per hour and every request here comes
// from 127.0.0.1, so this file stays under 10 (setup() flushes the counter).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, db } from "./helpers.js";
import { cleanPhMobile, cleanPhone } from "../src/services/passwordPolicy.js";

before(() => setup());
after(teardown);

const PASSWORD = "Good-pass-123";
let n = 0;
const signup = (extra = {}) => {
  n += 1;
  return api("POST", "/api/auth/register", {
    body: { name: "Maria Santos", email: `signup${n}@test.local`, password: PASSWORD, phoneno: `0918 000 ${String(n).padStart(4, "0")}`, acceptedTerms: true, ...extra },
  });
};

describe("cleanPhMobile", () => {
  test("the three Philippine formats normalize to the same value", () => {
    for (const input of ["09171234567", "0917 123 4567", "0917-123-4567", "+639171234567", "+63 917 123 4567", "639171234567", "63-917-123-4567"]) {
      assert.deepEqual(cleanPhMobile(input), { value: "+639171234567" }, input);
    }
  });

  test("landlines, wrong lengths and other text are refused", () => {
    for (const input of ["", "   ", undefined, null, 9171234567, "0817 123 4567", "0917123456", "091712345678", "+6309171234567", "+1 917 123 4567", "(0917) 123 4567", "call me"]) {
      assert.ok(cleanPhMobile(input).error, String(input));
    }
  });

  test("cleanPhone (staff, driver and owner forms) is unchanged", () => {
    assert.deepEqual(cleanPhone(""), { value: null });
    assert.deepEqual(cleanPhone("(074) 123-4567"), { value: "(074) 123-4567" });
  });
});

describe("POST /api/auth/register", () => {
  test("a mobile number is required and must be a Philippine mobile", async () => {
    const missing = await signup({ phoneno: undefined });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, "Enter your mobile number");
    for (const phoneno of ["0817 123 4567", "12345"]) {
      const r = await signup({ phoneno });
      assert.equal(r.status, 400, phoneno);
      assert.match(r.data.error, /valid Philippine mobile number/);
    }
  });

  test("the Terms / Privacy checkbox must be accepted", async () => {
    for (const acceptedTerms of [undefined, "true"]) {
      const r = await signup({ acceptedTerms });
      assert.equal(r.status, 400, String(acceptedTerms));
      assert.match(r.data.error, /Terms of Use and Privacy Policy/);
    }
    const [[{ count }]] = await db.query(`SELECT COUNT(*) AS count FROM commuters WHERE email LIKE 'signup%@test.local'`);
    assert.equal(count, 0, "nothing refused above was saved");
  });

  test("stores +639…, records consent, and refuses the same number in another format", async () => {
    const ok = await signup({ phoneno: "0917-123 4567" });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.phoneno, "+639171234567");
    const [[row]] = await db.query(`SELECT phoneno, terms_accepted_at FROM commuters WHERE commuter_id = ?`, [ok.data.commuter_id]);
    assert.equal(row.phoneno, "+639171234567");
    assert.ok(row.terms_accepted_at instanceof Date);
    assert.ok(Math.abs(row.terms_accepted_at - Date.now()) < 5 * 60 * 1000, "set to the time of sign-up");

    for (const phoneno of ["+63 917 123 4567", "639171234567"]) {
      const dup = await signup({ phoneno });
      assert.equal(dup.status, 409, phoneno);
      assert.equal(dup.data.error, "An account with that mobile number already exists");
    }

    const login = await api("POST", "/api/auth/login", { body: { email: ok.data.email, password: PASSWORD, role: "passenger" } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.phoneno, "+639171234567");
  });
});
