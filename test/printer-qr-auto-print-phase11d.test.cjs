const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const dataModule = source => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
let transition, claimApi, identityApi, pos, adapter, integration, bridge, app, kitchen;

test.before(async () => {
  const [transitionSource, claimSource, identitySource, triggerSource] = await Promise.all([
    "printer-order-transition.js", "printer-claim-store.js", "printer-host-identity.js", "print-trigger.js"
  ].map(name => fs.readFile(path.join(root, name), "utf8")));
  [transition, claimApi, identityApi] = await Promise.all([dataModule(transitionSource), dataModule(claimSource), dataModule(identitySource)]);
  [pos, adapter, integration, bridge, app, kitchen] = await Promise.all(["pos.js", "printer-event-adapter.js", "printer-integration.js", "printer-order-bridge.js", "app.js", "kitchen.js"].map(name => fs.readFile(path.join(root, name), "utf8")));
  const triggerUrl = "data:text/javascript;base64," + Buffer.from(triggerSource).toString("base64");
  adapter = await dataModule(adapter.replace('"./print-trigger.js"', JSON.stringify(triggerUrl)));
});

const qr = (extra = {}) => Object.assign({ id: "o1", orderNumber: "Q-1", storeId: "defaultStore", orderSource: "QR", source: "QR", status: "pending_payment", paymentStatus: "unpaid", paid: false, kitchenStatus: "waiting", confirmed: false, items: [] }, extra);
const eligible = (extra = {}) => qr(Object.assign({ status: "confirmed", paymentStatus: "paid", paid: true, kitchenStatus: "confirmed", confirmed: true }, extra));

function memoryFirebase(initial = {}) {
  const values = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  const runTransaction = (reference, updater) => {
    const operation = tail.then(() => {
      const current = values.has(reference) ? structuredClone(values.get(reference)) : null;
      const next = updater(current);
      if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(current) } };
      values.set(reference, structuredClone(next));
      return { committed: true, snapshot: { val: () => structuredClone(next) } };
    });
    tail = operation.catch(() => {});
    return operation;
  };
  return { values, ref: (_, value) => value, runTransaction };
}

function claimHarness(options = {}) {
  const firebase = options.firebase || memoryFirebase();
  let now = options.now === undefined ? 1000 : options.now;
  const store = claimApi.createPrinterClaimStore({ db: {}, ref: firebase.ref, runTransaction: firebase.runTransaction, clock: () => now, leaseMs: 1000 });
  return { firebase, store, setNow: value => { now = value; } };
}

const candidate = { storeId: "defaultStore", orderId: "o1", orderNumber: "Q-1", businessEventVersion: "qr-confirmed:v1", ticketType: "kitchen", routeGroup: "Kitchen" };
const ownerA = { deviceId: "A", sessionId: "1", ownerId: "A:1" };
const ownerB = { deviceId: "B", sessionId: "1", ownerId: "B:1" };

test("352 initial confirmed QR snapshot is baseline only", () => { const detector = transition.createQrOrderTransitionDetector(); assert.equal(detector.observe({ o1: eligible() }).length, 0); });
test("353 pending to pending has no event", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: qr() }); assert.equal(detector.observe({ o1: qr({ updatedAt: 2 }) }).length, 0); });
test("354 pending to confirmed and paid emits one event", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: qr() }); const events = detector.observe({ o1: eligible() }); assert.equal(events.length, 1); assert.equal(events[0].policy, "qr-order-confirmed"); });
test("355 confirmed to confirmed has no event", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: eligible() }); assert.equal(detector.observe({ o1: eligible({ updatedAt: 2 }) }).length, 0); });
test("356 confirmed to cooking has no duplicate", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: eligible() }); assert.equal(detector.observe({ o1: eligible({ status: "cooking", kitchenStatus: "cooking" }) }).length, 0); });
test("357 POS source never creates QR event", () => { assert.equal(transition.isQrPrintEligible(qr(), eligible({ orderSource: "POS", source: "POS" })), false); });
test("358 cancelled QR never prints", () => { assert.equal(transition.isQrPrintEligible(qr(), eligible({ status: "cancelled", cancelled: true })), false); });
test("359 QR test order follows the same paid confirmation contract", () => { assert.equal(transition.isQrPrintEligible(qr({ isTestOrder: true }), eligible({ isTestOrder: true })), true); });
test("360 paid without confirmation is ineligible", () => assert.equal(transition.isQrPrintEligible(qr(), qr({ paymentStatus: "paid", paid: true })), false));
test("361 confirmation without payment is ineligible", () => assert.equal(transition.isQrPrintEligible(qr(), qr({ confirmed: true })), false));

test("362 first host claim succeeds", async () => { const h = claimHarness(); assert.equal((await h.store.claim(candidate, ownerA)).acquired, true); });
test("363 second host loses the same live claim", async () => { const h = claimHarness(); await h.store.claim(candidate, ownerA); assert.equal((await h.store.claim(candidate, ownerB)).code, "CLAIM_NOT_ACQUIRED"); });
test("364 concurrent hosts have exactly one winner", async () => { const h = claimHarness(); const values = await Promise.all([h.store.claim(candidate, ownerA), h.store.claim(candidate, ownerB)]); assert.equal(values.filter(value => value.acquired).length, 1); });
test("365 unexpired lease cannot be stolen", async () => { const h = claimHarness(); await h.store.claim(candidate, ownerA); h.setNow(1999); assert.equal((await h.store.claim(candidate, ownerB)).acquired, false); });
test("366 expired lease can be reclaimed", async () => { const h = claimHarness(); await h.store.claim(candidate, ownerA); h.setNow(2001); assert.equal((await h.store.claim(candidate, ownerB)).acquired, true); });
test("367 reclaim increments attempt", async () => { const h = claimHarness(); await h.store.claim(candidate, ownerA); h.setNow(2001); assert.equal((await h.store.claim(candidate, ownerB)).claim.attempt, 2); });
test("368 completed claim cannot be acquired again", async () => { const h = claimHarness(); const first = await h.store.claim(candidate, ownerA); await h.store.complete(first.claimKey, ownerA.ownerId); h.setNow(5000); assert.equal((await h.store.claim(candidate, ownerB)).acquired, false); });
test("369 failed claim is conservative and does not auto retry", async () => { const h = claimHarness(); const first = await h.store.claim(candidate, ownerA); await h.store.fail(first.claimKey, ownerA.ownerId, { code: "NO_PAPER" }); h.setNow(5000); assert.equal((await h.store.claim(candidate, ownerB)).acquired, false); });
test("370 Firebase transaction error is controlled", async () => { const store = claimApi.createPrinterClaimStore({ db: {}, ref: () => "x", runTransaction: async () => { throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }); } }); const result = await store.claim(candidate, ownerA); assert.equal(result.code, "NETWORK_ERROR"); assert.equal(result.acquired, false); });
test("371 claim key is deterministic and Firebase safe", () => { const key = claimApi.normalizePrinterClaimKey(Object.assign({}, candidate, { orderId: "a/b.#$[]" })); assert.equal(key, claimApi.normalizePrinterClaimKey(Object.assign({}, candidate, { orderId: "a/b.#$[]" }))); assert.doesNotMatch(key, /[.#$\[\]\/]/); });

test("372 same snapshot replay produces no event", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: qr() }); detector.observe({ o1: eligible() }); assert.equal(detector.observe({ o1: eligible() }).length, 0); });
test("373 reload detector baseline does not replay historical eligible orders", () => { const detector = transition.createQrOrderTransitionDetector(); assert.equal(detector.observe({ o1: eligible() }).length, 0); });
test("374 persistent completed claim blocks a fresh detector candidate", async () => { const h = claimHarness(); const first = await h.store.claim(candidate, ownerA); await h.store.complete(first.claimKey, ownerA.ownerId); const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: qr() }); const event = detector.observe({ o1: eligible() })[0]; assert.ok(event); assert.equal((await h.store.claim(event, ownerB)).acquired, false); });
test("375 reconnect with unchanged state does not duplicate", () => { const detector = transition.createQrOrderTransitionDetector(); detector.observe({ o1: qr() }); detector.observe({ o1: eligible() }); assert.deepEqual(detector.observe({ o1: eligible() }), []); });

test("376 host device id persists and session id changes", () => { const map = new Map(); const storage = { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) }; let index = 0; const crypto = { randomUUID: () => String(++index) }; const a = identityApi.createPrinterHostIdentity({ storage, crypto }); const b = identityApi.createPrinterHostIdentity({ storage, crypto }); assert.equal(a.deviceId, b.deviceId); assert.notEqual(a.sessionId, b.sessionId); });
test("377 adapter preserves explicit cross-device claim", () => { const value = adapter.adaptPrinterEvent({ eventType: "PaymentCompleted", order: { id: "o1" }, source: "QR", policy: "qr-order-confirmed", metadata: { crossDeviceClaimed: true } }); assert.equal(value.metadata.crossDeviceClaimed, true); });
test("378 adapter defaults unclaimed events to false", () => { const value = adapter.adaptPrinterEvent({ eventType: "PaymentCompleted", order: { id: "o1" }, source: "QR" }); assert.equal(value.metadata.crossDeviceClaimed, false); });
test("379 QR policy requires PaymentCompleted QR and cross-device claim", () => { assert.match(integration, /trigger\.type === "PaymentCompleted"[\s\S]*?toUpperCase\(\) === "QR"[\s\S]*?crossDeviceClaimed === true/); });
test("380 disabled module exits before bridge and claim", () => { const body = pos.slice(pos.indexOf("async function handleQrPrinterEvent"), pos.indexOf("function processQrPrinterTransitions")); assert.ok(body.indexOf("!isPrintingEnabled()") < body.indexOf("loadPrinterOrderBridge()")); assert.ok(body.indexOf("!isPrintingEnabled()") < body.indexOf("claimStore.claim")); });
test("381 local printer eligibility runs before transaction claim", () => { const body = pos.slice(pos.indexOf("async function handleQrPrinterEvent"), pos.indexOf("function processQrPrinterTransitions")); assert.ok(body.indexOf("canHandleQrAutoPrint") < body.indexOf("claimStore.claim")); });
test("382 KDS and QR client do not own printer claims", () => { for (const source of [kitchen, app]) { assert.doesNotMatch(source, /printer-claim-store|printer-order-bridge|printer-integration|runTransaction\([^)]*printerClaims/); } });
test("383 claim success drives exactly one bridge handle in a two-host race", async () => { const h = claimHarness(); let calls = 0; const host = async owner => { const value = await h.store.claim(candidate, owner); if (value.acquired) calls += 1; }; await Promise.all([host(ownerA), host(ownerB)]); assert.equal(calls, 1); });

test("384 printer failure records failed without touching order", async () => { const h = claimHarness(); const order = eligible(); const before = structuredClone(order); const acquired = await h.store.claim(candidate, ownerA); await h.store.fail(acquired.claimKey, ownerA.ownerId, { code: "PRINT_FAILED" }); assert.deepEqual(order, before); assert.equal(h.firebase.values.get("printerClaims/" + acquired.claimKey).status, "failed"); });
test("385 printer success records completed", async () => { const h = claimHarness(); const acquired = await h.store.claim(candidate, ownerA); await h.store.markPrinting(acquired.claimKey, ownerA.ownerId); await h.store.complete(acquired.claimKey, ownerA.ownerId); assert.equal(h.firebase.values.get("printerClaims/" + acquired.claimKey).status, "completed"); });
test("386 claim path is independent from orders schema", () => { assert.match(pos, /createPrinterClaimStore/); assert.equal(claimApi.normalizePrinterClaimKey(candidate).startsWith("orders/"), false); assert.doesNotMatch((claimApi.createPrinterClaimStore + ""), /orders\//); });
test("387 bridge and integration failures are isolated from snapshot chain", () => { assert.match(pos, /handleQrPrinterEvent\(event, ownership\)\.catch/); assert.match(pos, /QR printer snapshot isolated/); assert.match(bridge, /function handle\(event\)[\s\S]*?\.catch/); });
test("388 POS local direct auto-print boundary remains unchanged", () => assert.match(pos, /await set\(newOrderRef, order\);[\s\S]*?void triggerPosOrderPrint\(order\);/));
test("389 POS listener uses transition processing rather than printing every order", () => { const listener = pos.slice(pos.indexOf("onValue(ordersRef"), pos.indexOf("renderTableButtons")); assert.match(listener, /processQrPrinterTransitions\(nextOrdersData\)/); assert.doesNotMatch(listener, /forEach[\s\S]*?triggerPosOrderPrint/); });
test("390 forbidden production files remain outside Phase 11D wiring", () => { assert.doesNotMatch(kitchen, /printerClaims|qr-order-confirmed/); assert.doesNotMatch(app, /printerClaims|qr-order-confirmed/); });
test("391 a losing live claimant schedules lease-expiry recovery", () => { assert.match(pos, /function scheduleQrClaimRecovery[\s\S]*?leaseExpiresAt[\s\S]*?setTimeout/); assert.match(pos, /qrClaimRecoveryTimers = new Map/); });
