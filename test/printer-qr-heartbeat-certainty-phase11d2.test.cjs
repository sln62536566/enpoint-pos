const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let createController, claimApi, pos;
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`); assert.ok(start >= 0);
  const brace = source.indexOf("{", start); let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`Unclosed function ${name}`);
}
const load = source => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  [pos, claimApi] = await Promise.all([
    fs.readFile(path.join(root, "pos.js"), "utf8"),
    fs.readFile(path.join(root, "printer-claim-store.js"), "utf8").then(load)
  ]);
  createController = (await load(`${extractFunction(pos, "createQrHeartbeatController")}\nexport { createQrHeartbeatController };`)).createQrHeartbeatController;
});

function controller(results) {
  let calls = 0, callback = null, completed = 0;
  const value = createController({
    renew: async () => { const result = results[Math.min(calls, results.length - 1)]; calls += 1; if (result instanceof Error) throw result; return result; },
    intervalMs: 100,
    setIntervalFn: fn => { callback = fn; return 1; },
    clearIntervalFn: () => { callback = null; }
  });
  return { value, get calls() { return calls; }, complete: () => { completed += 1; }, get completed() { return completed; } };
}

test("414 transient heartbeat failure followed by success restores certainty", async () => { const h = controller([{ ok: false, code: "NETWORK_ERROR" }, { ok: true, code: "CLAIM_PRINTING" }]); await h.value.tick(); assert.equal(h.value.getState().uncertain, true); await h.value.tick(); assert.equal(h.value.getState().uncertain, false); assert.equal(h.value.getState().code, null); });
test("415 recovered certainty plus successful print permits completed claim", async () => { const h = controller([{ ok: false, code: "NETWORK_ERROR" }, { ok: true }, { ok: true }]); await h.value.tick(); await h.value.tick(); const final = await h.value.finish(); if (!final.ownershipLost && !final.uncertain) h.complete(); assert.equal(h.completed, 1); assert.equal(final.code, null); });
test("416 ownership loss remains terminal despite later apparent success", async () => { const h = controller([{ ok: false, code: "CLAIM_OWNERSHIP_LOST" }, { ok: true }]); await h.value.tick(); await h.value.tick(); const final = await h.value.finish(); assert.equal(final.ownershipLost, true); assert.equal(final.code, "CLAIM_OWNERSHIP_LOST"); assert.equal(h.calls, 1); });
test("417 persistent transient uncertainty prevents completed write", async () => { const h = controller([{ ok: false, code: "NETWORK_ERROR" }]); await h.value.tick(); const final = await h.value.finish(); if (!final.ownershipLost && !final.uncertain) h.complete(); assert.equal(final.uncertain, true); assert.equal(h.completed, 0); });
test("418 completed claim blocks later recovery after final confirmation", async () => { const values = new Map(); let now = 0; const runTransaction = async (key, update) => { const current = values.get(key) || null; const next = update(current); if (next === undefined) return { committed: false, snapshot: { val: () => current } }; values.set(key, next); return { committed: true, snapshot: { val: () => next } }; }; const store = claimApi.createPrinterClaimStore({ db: {}, ref: (_, key) => key, runTransaction, leaseMs: 1000, clock: () => now }); const event = { storeId: "s", orderId: "o", businessEventVersion: "v1", ticketType: "kitchen", routeGroup: "Kitchen" }; const first = await store.claim(event, { ownerId: "A" }); await store.renewLease(first.claimKey, "A"); await store.complete(first.claimKey, "A"); now = 5000; const recovery = await store.claim(event, { ownerId: "B" }); assert.equal(recovery.acquired, false); assert.equal(recovery.claim.status, "completed"); });
