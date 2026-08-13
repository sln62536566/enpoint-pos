const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let createPrinterIntegration, posSource;
test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const integrationSource = await fs.readFile(path.join(root, "printer-integration.js"), "utf8");
  createPrinterIntegration = (await import("data:text/javascript;base64," + Buffer.from(integrationSource).toString("base64"))).createPrinterIntegration;
  posSource = await fs.readFile(path.join(root, "pos.js"), "utf8");
});

const trigger = () => ({ id: "event-1", type: "OrderCreated", source: "POS", policy: "pos-order-created", payload: { order: {} }, metadata: {} });
const disabled = code => ({ enabled: false, code, profile: null, driver: null, printer: null });
const ready = (id, copies = 1, paperSize = "58") => ({
  enabled: true, code: "READY", driver: { transferChunk: async bytes => ({ ok: true, bytesTransferred: bytes.length }), getStatus: () => ({ capability: {} }), onStatusChanged: () => () => {} },
  profile: { id: "kitchen", name: id, provider: "usb", enabled: true, autoPrint: true, copies, paperSize },
  printer: { id, name: id, group: "Kitchen", provider: "usb", priority: 1, enabled: true, capability: { id, supportsEscPos: true, supportsReceipt: true, supportsPaper58: paperSize === "58", supportsPaper80: paperSize === "80" } }
});

function harness(initial) {
  let configuration = initial, configCalls = 0, failNext = null, delayNext = null;
  const queues = [], transports = [], registries = [], plans = [];
  const modules = {
    "./print-decision.js": { createDecisionLayer: resolver => ({ resolver }) },
    "./receipt-layout.js": { buildCustomerReceiptLayout() {}, buildKitchenReceiptLayout() {} },
    "./escpos-formatter.js": { formatLayout: () => new Uint8Array() },
    "./print-transport.js": { createPrintTransport: driver => { const value = { driver, destroyed: false, destroy() { this.destroyed = true; } }; transports.push(value); return value; } },
    "./print-pipeline.js": { createPrintPipeline: options => ({ options, destroy() {} }) },
    "./commercial-print-queue.js": { createCommercialPrintQueue: () => { const value = { busy: false, closed: false, destroyed: false, jobs: [], close() { this.closed = true; }, isBusy() { return this.busy; }, getJobs() { return this.jobs; }, destroy() { this.destroyed = true; } }; queues.push(value); return value; } },
    "./print-policy.js": { createPrintPolicy: resolver => ({ resolve: async triggerValue => resolver ? resolver(triggerValue) : ({ tickets: [] }) }), createPolicyRegistry: values => ({ get: name => values[name] || values.default }) },
    "./printer-capability.js": { createCapabilityRegistry: values => ({ get: name => values[name] || null }) },
    "./printer-registry.js": { createPrinterRegistry: printers => { const value = { printers, get: id => printers.find(item => item.id === id) || null, list: () => printers }; registries.push(value); return value; } },
    "./printer-router.js": { createPrinterRouter: ({ registry }) => ({ registry, route: () => ({ printer: registry.list()[0] || null }) }) },
    "./print-scheduler.js": { createPrintScheduler: ({ registry }) => ({ schedule: plan => { plans.push({ plan, printer: registry.list()[0] || null }); return { ok: true, id: "job", completion: Promise.resolve({ result: { failed: false } }) }; } }) },
    "./auto-print-engine.js": { createAutoPrintEngine: ({ policies, scheduler }) => ({ async handle(value) { const plan = await policies.get(value.policy).resolve(value); if (!plan.tickets.length) return { skipped: true, errors: [] }; const scheduled = scheduler.schedule(plan, value); return { accepted: true, jobId: scheduled.id, completion: scheduled.completion }; }, close() {} }) },
    "./printer-pos-config.js": { async loadPosPrinterConfiguration() { configCalls++; if (delayNext) { const wait = delayNext; delayNext = null; await wait; } if (failNext) { const error = failNext; failNext = null; throw error; } return configuration; } }
  };
  return {
    integration: createPrinterIntegration({ importer: async name => modules[name], environment: { navigator: { usb: {} } } }), queues, transports, registries, plans,
    setConfig(value) { configuration = value; }, get configCalls() { return configCalls; }, fail(error) { failNext = error; }, delay(promise) { delayNext = promise; }
  };
}

test("335 disabled configuration reloads to enabled on next event", async () => { const h = harness(disabled("AUTO_PRINT_DISABLED")); await h.integration.initialize(); h.setConfig(ready("A")); h.integration.invalidateConfiguration(); const value = await h.integration.handle(trigger()); assert.equal(value.ok, true); assert.equal(h.configCalls, 2); });
test("336 no printer reloads to configured printer", async () => { const h = harness(disabled("NO_PRINTER_CONFIGURED")); await h.integration.initialize(); h.setConfig(ready("USB")); h.integration.invalidateConfiguration(); await h.integration.handle(trigger()); assert.equal(h.registries.at(-1).list()[0].id, "USB"); });
test("337 printer A is retired and printer B is exclusively routed", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.setConfig(ready("B")); h.integration.invalidateConfiguration(); await h.integration.handle(trigger()); assert.equal(h.plans.at(-1).printer.id, "B"); assert.equal(h.registries.at(-1).list().some(item => item.id === "A"), false); });
test("338 copies update after reload", async () => { const h = harness(ready("A", 1)); await h.integration.initialize(); h.setConfig(ready("A", 2)); h.integration.invalidateConfiguration(); await h.integration.handle(trigger()); assert.equal(h.plans.at(-1).plan.tickets[0].copies, 2); });
test("339 paper capability updates after reload", async () => { const h = harness(ready("A", 1, "58")); await h.integration.initialize(); h.setConfig(ready("A", 1, "80")); h.integration.invalidateConfiguration(); await h.integration.handle(trigger()); assert.deepEqual(Array.from(h.plans.at(-1).plan.requiredCapabilities), ["supportsEscPos", "supportsReceipt", "supportsPaper80"]); });
test("340 disabling auto print reloads to controlled skip", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.setConfig(disabled("AUTO_PRINT_DISABLED")); h.integration.invalidateConfiguration(); const value = await h.integration.handle(trigger()); assert.equal(value.skipped, true); assert.equal(h.plans.length, 0); });
test("341 concurrent reload calls share one replacement", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.setConfig(ready("B")); h.integration.invalidateConfiguration(); await Promise.all([h.integration.reloadConfiguration(), h.integration.reloadConfiguration(), h.integration.handle(trigger())]); assert.equal(h.configCalls, 2); assert.equal(h.registries.length, 2); });
test("342 reload during initialization is serialized", async () => { let release; const gate = new Promise(resolve => { release = resolve; }); const h = harness(ready("A")); h.delay(gate); const initializing = h.integration.initialize(); h.integration.invalidateConfiguration(); const reloading = h.integration.reloadConfiguration(); release(); await Promise.all([initializing, reloading]); assert.equal(h.configCalls, 2); assert.equal(h.integration.getStatus().configurationStale, false); });
test("343 reload after destroy is controlled", async () => { const h = harness(ready("A")); h.integration.destroy(); const value = await h.integration.reloadConfiguration(); assert.equal(value.code, "PRINTER_INTEGRATION_DESTROYED"); });
test("344 failed reload is controlled without unhandled rejection", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.fail(new Error("reload")); h.integration.invalidateConfiguration(); const value = await h.integration.reloadConfiguration(); assert.equal(value.code, "CONFIGURATION_RELOAD_FAILED"); assert.equal(h.integration.getStatus().status, "unavailable"); });
test("345 explicit invalidation permits one unavailable retry", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.fail(new Error("reload")); h.integration.invalidateConfiguration(); await h.integration.reloadConfiguration(); h.setConfig(ready("B")); h.integration.invalidateConfiguration(); const value = await h.integration.handle(trigger()); assert.equal(value.ok, true); assert.equal(h.registries.at(-1).list()[0].id, "B"); });
test("346 active job drains before old components retire", async () => { const h = harness(ready("A")); await h.integration.initialize(); const old = h.queues[0]; old.busy = true; old.jobs = [{ status: "Sending" }]; h.setConfig(ready("B")); h.integration.invalidateConfiguration(); let finished = false; const reload = h.integration.reloadConfiguration().then(() => { finished = true; }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(finished, false); assert.equal(old.destroyed, false); old.busy = false; old.jobs[0].status = "Completed"; await reload; assert.equal(old.destroyed, true); });
test("347 reload leaves one active queue and transport", async () => { const h = harness(ready("A")); await h.integration.initialize(); h.setConfig(ready("B")); h.integration.invalidateConfiguration(); await h.integration.reloadConfiguration(); assert.equal(h.queues.filter(item => !item.destroyed).length, 1); assert.equal(h.transports.filter(item => !item.destroyed).length, 1); });
test("348 settings invalidation is optional and isolated", () => { assert.match(posSource, /function invalidatePrinterIntegrationConfiguration\(\)[\s\S]*?\.catch\(function\(error\)/); assert.doesNotMatch(posSource, /^import .*printer-integration/m); });
test("349 all profile and USB setting changes invalidate configuration", () => { const calls = (posSource.match(/invalidatePrinterIntegrationConfiguration\(\)/g) || []).length; assert.ok(calls >= 7); for (const operation of ["detectUsbPrinter", "requestUsbPrinter", "connectUsbPrinter", "disconnectUsbPrinter", "selectAuthorizedUsbPrinter", "PrinterProfile.update"]) assert.match(posSource, new RegExp(operation)); });
test("350 Firebase success boundary remains unchanged", () => assert.match(posSource, /await set\(newOrderRef, order\);[\s\S]*?void triggerPosOrderPrint\(order\);/));
test("351 setting change during compose discards intermediate replacement", async () => { let release; const gate = new Promise(resolve => { release = resolve; }); const h = harness(ready("A")); await h.integration.initialize(); h.setConfig(ready("B")); h.delay(gate); h.integration.invalidateConfiguration(); const reload = h.integration.reloadConfiguration(); await new Promise(resolve => setTimeout(resolve, 0)); h.setConfig(ready("C")); h.integration.invalidateConfiguration(); release(); await reload; assert.equal(h.registries.at(-1).list()[0].id, "C"); assert.equal(h.queues.filter(item => !item.destroyed).length, 1); });
