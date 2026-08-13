const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let finalize;
function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`); assert.ok(start >= 0);
  const brace = source.indexOf("{", start); let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`Unclosed function ${name}`);
}

test.before(async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "pos.js"), "utf8");
  const moduleSource = `${extractFunction(source, "finalizeQrPrinterClaim")}\nexport { finalizeQrPrinterClaim };`;
  finalize = (await import("data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64"))).finalizeQrPrinterClaim;
});

function harness(options = {}) {
  const calls = { complete: 0, fail: 0, clear: 0, schedule: 0, warnings: [] };
  const ownership = {
    identity: { ownerId: "A:1" },
    claimStore: {
      leaseMs: 60000,
      complete: async () => { calls.complete += 1; return options.complete || { ok: true, code: "CLAIM_COMPLETED" }; },
      fail: async () => { calls.fail += 1; return options.fail || { ok: true, code: "CLAIM_FAILED" }; }
    }
  };
  const lifecycle = {
    clearRecovery: () => { calls.clear += 1; },
    scheduleRecovery: () => { calls.schedule += 1; },
    warning: details => { calls.warnings.push(details); }
  };
  return { ownership, lifecycle, calls };
}

const event = { orderId: "qr1" };
const acquired = { claimKey: "claim-1" };
const success = { ok: true, status: "completed", code: "PRINT_COMPLETED" };
const printerFailure = { ok: false, status: "failed", code: "NO_PAPER" };

test("419 successful physical print plus complete failure is isolated", async () => { const h = harness({ complete: { ok: false, code: "CLAIM_STATE_WRITE_FAILED" } }); const result = await finalize(event, h.ownership, acquired, success, h.lifecycle); assert.equal(result.ok, false); assert.equal(result.status, "isolated"); assert.equal(result.code, "CLAIM_STATE_WRITE_FAILED"); assert.equal(h.calls.clear, 0); });
test("420 complete success preserves normal print success", async () => { const h = harness(); const result = await finalize(event, h.ownership, acquired, success, h.lifecycle); assert.equal(result, success); assert.equal(h.calls.complete, 1); assert.equal(h.calls.clear, 1); assert.equal(h.calls.schedule, 0); });
test("421 printer failure plus durable fail preserves printer failure", async () => { const h = harness(); const result = await finalize(event, h.ownership, acquired, printerFailure, h.lifecycle); assert.equal(result, printerFailure); assert.equal(h.calls.fail, 1); assert.equal(h.calls.clear, 1); });
test("422 printer failure plus fail write failure surfaces finalization failure", async () => { const h = harness({ fail: { ok: false, code: "CLAIM_STATE_WRITE_FAILED" } }); const result = await finalize(event, h.ownership, acquired, printerFailure, h.lifecycle); assert.equal(result.status, "isolated"); assert.equal(result.code, "CLAIM_STATE_WRITE_FAILED"); assert.equal(h.calls.schedule, 1); });
test("423 ownership lost during complete is never reported completed", async () => { const h = harness({ complete: { ok: false, code: "CLAIM_OWNERSHIP_LOST" } }); const result = await finalize(event, h.ownership, acquired, success, h.lifecycle); assert.equal(result.ok, false); assert.equal(result.code, "CLAIM_OWNERSHIP_LOST"); assert.equal(h.calls.clear, 0); assert.deepEqual(h.calls.warnings[0], { orderId: "qr1", claimKey: "claim-1", code: "CLAIM_OWNERSHIP_LOST" }); });
test("424 recovery clears only after successful durable finalization", async () => { const failed = harness({ complete: { ok: false, code: "OFFLINE" } }); await finalize(event, failed.ownership, acquired, success, failed.lifecycle); assert.equal(failed.calls.clear, 0); assert.equal(failed.calls.schedule, 1); const completed = harness(); await finalize(event, completed.ownership, acquired, success, completed.lifecycle); assert.equal(completed.calls.clear, 1); assert.equal(completed.calls.schedule, 0); });
