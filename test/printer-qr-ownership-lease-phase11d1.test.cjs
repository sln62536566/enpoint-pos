const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const load = source => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
let claimApi, configApi, pos, integration;

test.before(async () => {
  const [claimSource, configSource] = await Promise.all(["printer-claim-store.js", "printer-pos-config.js"].map(name => fs.readFile(path.join(root, name), "utf8")));
  [claimApi, configApi] = await Promise.all([load(claimSource), load(configSource)]);
  [pos, integration] = await Promise.all(["pos.js", "printer-integration.js"].map(name => fs.readFile(path.join(root, name), "utf8")));
});

function firebase() {
  const values = new Map(); let tail = Promise.resolve();
  const runTransaction = (key, update) => {
    const result = tail.then(() => { const current = values.has(key) ? structuredClone(values.get(key)) : null; const next = update(current); if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(current) } }; values.set(key, structuredClone(next)); return { committed: true, snapshot: { val: () => structuredClone(next) } }; });
    tail = result.catch(() => {}); return result;
  };
  return { values, ref: (_, key) => key, runTransaction };
}

function harness() { const db = firebase(); let now = 0; const store = claimApi.createPrinterClaimStore({ db: {}, ref: db.ref, runTransaction: db.runTransaction, leaseMs: 1000, clock: () => now }); return { db, store, time: value => { now = value; } }; }
const event = { storeId: "defaultStore", orderId: "qr1", orderNumber: "Q-1", businessEventVersion: "qr-confirmed:v1", ticketType: "kitchen", routeGroup: "Kitchen" };
const a = { ownerId: "A:1", deviceId: "A", sessionId: "1" }, b = { ownerId: "B:1", deviceId: "B", sessionId: "1" };

test("392 markPrinting renews lease from transition time", async () => { const h = harness(); const c = await h.store.claim(event, a); h.time(700); const value = await h.store.markPrinting(c.claimKey, a.ownerId); assert.equal(value.claim.leaseExpiresAt, 1700); });
test("393 current owner renewLease succeeds", async () => { const h = harness(); const c = await h.store.claim(event, a); h.time(500); const value = await h.store.renewLease(c.claimKey, a.ownerId); assert.equal(value.ok, true); assert.equal(value.claim.leaseExpiresAt, 1500); });
test("394 other owner renewLease reports ownership lost", async () => { const h = harness(); const c = await h.store.claim(event, a); assert.equal((await h.store.renewLease(c.claimKey, b.ownerId)).code, "CLAIM_OWNERSHIP_LOST"); });
test("395 completed claim cannot renew", async () => { const h = harness(); const c = await h.store.claim(event, a); await h.store.complete(c.claimKey, a.ownerId); assert.equal((await h.store.renewLease(c.claimKey, a.ownerId)).ok, false); });
test("396 failed claim cannot renew", async () => { const h = harness(); const c = await h.store.claim(event, a); await h.store.fail(c.claimKey, a.ownerId, { code: "FAIL" }); assert.equal((await h.store.renewLease(c.claimKey, a.ownerId)).ok, false); });
test("397 heartbeat extends expiry", async () => { const h = harness(); const c = await h.store.claim(event, a); h.time(700); await h.store.renewLease(c.claimKey, a.ownerId); assert.equal(h.db.values.get("printerClaims/" + c.claimKey).leaseExpiresAt, 1700); });
test("398 active renewed printing cannot be reclaimed after original expiry", async () => { const h = harness(); const c = await h.store.claim(event, a); await h.store.markPrinting(c.claimKey, a.ownerId); h.time(700); await h.store.renewLease(c.claimKey, a.ownerId); h.time(1100); assert.equal((await h.store.claim(event, b)).acquired, false); });
test("399 crashed printing can be reclaimed after renewed expiry", async () => { const h = harness(); const c = await h.store.claim(event, a); await h.store.markPrinting(c.claimKey, a.ownerId); h.time(700); await h.store.renewLease(c.claimKey, a.ownerId); h.time(1701); assert.equal((await h.store.claim(event, b)).acquired, true); });
test("400 crash recovery increments attempt", async () => { const h = harness(); const c = await h.store.claim(event, a); h.time(700); await h.store.renewLease(c.claimKey, a.ownerId); h.time(1701); assert.equal((await h.store.claim(event, b)).claim.attempt, 2); });
test("401 replaced owner cannot complete", async () => { const h = harness(); const c = await h.store.claim(event, a); h.time(1001); await h.store.claim(event, b); assert.equal((await h.store.complete(c.claimKey, a.ownerId)).code, "CLAIM_OWNERSHIP_LOST"); assert.equal(h.db.values.get("printerClaims/" + c.claimKey).ownerId, b.ownerId); });

test("402 heartbeat interval is derived below lease", () => { const h = harness(); assert.ok(h.store.heartbeatMs < h.store.leaseMs); assert.equal(h.store.heartbeatMs, Math.floor(h.store.leaseMs / 3)); });
test("403 physical print is wrapped by heartbeat lifecycle", () => { const body = pos.slice(pos.indexOf("async function handleQrPrinterEvent"), pos.indexOf("function clearQrClaimRecovery")); assert.match(body, /startQrClaimHeartbeat[\s\S]*?await bridge\.handle[\s\S]*?await heartbeat\.finish/); });
test("404 ownership loss prevents completed write", () => { const body = pos.slice(pos.indexOf("async function handleQrPrinterEvent"), pos.indexOf("function clearQrClaimRecovery")); assert.ok(body.indexOf("heartbeatState.ownershipLost") < body.indexOf("claimStore.complete")); });
test("405 heartbeat failure is controlled and not rapidly retried", () => { const body = pos.slice(pos.indexOf("function startQrClaimHeartbeat"), pos.indexOf("function processQrPrinterTransitions")); assert.match(body, /setInterval/); assert.match(body, /state\.running/); assert.match(body, /QR printer lease heartbeat failed/); });
test("406 recovery uses one Map timer per claim and cleans before execution", () => { const body = pos.slice(pos.indexOf("function clearQrClaimRecovery"), pos.indexOf("function startQrClaimHeartbeat")); assert.match(body, /clearQrClaimRecovery\(claimKey\)/); assert.match(body, /qrClaimRecoveryTimers\.delete\(claimKey\)[\s\S]*?handleQrPrinterEvent/); });
test("407 renewed live lease can reschedule from latest snapshot", () => { const body = pos.slice(pos.indexOf("function scheduleQrClaimRecovery"), pos.indexOf("function startQrClaimHeartbeat")); assert.match(body, /Number\(claim\.leaseExpiresAt\) - Date\.now\(\)/); assert.match(pos, /scheduleQrClaimRecovery\(event, ownership, acquired\)/); });
test("408 completed and failed claims do not schedule recovery", () => { const body = pos.slice(pos.indexOf("function scheduleQrClaimRecovery"), pos.indexOf("function startQrClaimHeartbeat")); assert.match(body, /claim\.status !== "claimed" && claim\.status !== "printing"/); assert.match(body, /Math\.max\(250,/); });

async function eligibility(status, profile = { enabled: true, autoPrint: true, provider: "usb" }) {
  const importer = async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => profile } } : { initializeUsbProvider: async () => ({ getStatus: () => status }) };
  return configApi.inspectPosPrinterEligibility(importer, { navigator: { usb: {} } });
}
test("409 authorized but no selected Kitchen printer is ineligible", async () => assert.equal((await eligibility({ devices: [{}], selectedDevice: null, connected: false })).code, "NO_PRINTER_CONFIGURED"));
test("410 selected but disconnected printer is ineligible", async () => assert.equal((await eligibility({ selectedDevice: {}, connected: false, capability: null })).code, "PRINTER_NOT_READY"));
test("411 truly ready USB Kitchen route is eligible", async () => { const value = await eligibility({ selectedDevice: {}, connected: true, capability: {} }); assert.equal(value.eligible, true); assert.equal(value.code, "READY"); });
test("412 eligibility inspection performs no detect connect or print", async () => { let sideEffects = 0; const importer = async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => ({ enabled: true, autoPrint: true, provider: "usb" }) } } : { initializeUsbProvider: async () => ({ getStatus: () => ({ selectedDevice: {}, connected: true, capability: {} }), detect: () => sideEffects++, connect: () => sideEffects++, print: () => sideEffects++ }) }; await configApi.inspectPosPrinterEligibility(importer, { navigator: { usb: {} } }); assert.equal(sideEffects, 0); });
test("413 eligibility precedes claim and two eligible hosts still use transaction", () => { const body = pos.slice(pos.indexOf("async function handleQrPrinterEvent"), pos.indexOf("function clearQrClaimRecovery")); assert.ok(body.indexOf("canHandleQrAutoPrint") < body.indexOf("claimStore.claim")); assert.match(integration, /inspectPosPrinterEligibility/); });
