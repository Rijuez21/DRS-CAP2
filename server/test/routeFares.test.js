// Route fares (routes/routes.js): the student / PWD / senior special fare is a
// discount, so it may equal the regular fare but never be higher — on
// create, on edit, and when only the regular fare is lowered.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, teardown, api, createStaff } from "./helpers.js";

let admin;
before(async () => {
  await setup();
  admin = await createStaff("Fare Admin", "admin");
});
after(teardown);

const create = (body) => api("POST", "/api/routes", { token: admin.token, body: { origin: "Baguio", destination: "Besao", distance: 150, ...body } });

test("a special fare higher than the regular fare is refused", async () => {
  const r = await create({ baseFare: 515, specialFare: 600 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /can't be higher than the regular fare/);
});

test("equal or lower special fares are fine", async () => {
  assert.equal((await create({ baseFare: 15, specialFare: 15 })).status, 201);
  assert.equal((await create({ baseFare: 515, specialFare: 412 })).status, 201);
});

test("editing can't push the special fare above the regular one, either way round", async () => {
  const made = await create({ baseFare: 515, specialFare: 412 });
  const id = made.data.route_id;
  const raiseSpecial = await api("PATCH", `/api/routes/${id}`, { token: admin.token, body: { specialFare: 600 } });
  assert.equal(raiseSpecial.status, 400);
  const lowerRegular = await api("PATCH", `/api/routes/${id}`, { token: admin.token, body: { baseFare: 400 } });
  assert.equal(lowerRegular.status, 400);
  assert.equal((await api("PATCH", `/api/routes/${id}`, { token: admin.token, body: { baseFare: 450 } })).status, 200);
});
