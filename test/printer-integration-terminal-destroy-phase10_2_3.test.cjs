const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let createPrinterIntegration;
test.before(async () => { const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "printer-integration.js"), "utf8"); createPrinterIntegration = (await import(dataUrl(source) + "#terminal-destroy")).createPrinterIntegration; });

function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function harness(entries) {
  let index = 0; const retired = [];
  const modules = {
    "./print-decision.js": { createDecisionLayer: () => ({ decide: async () => ({ action: "skip", tickets: [] }) }) },
    "./receipt-layout.js": { buildCustomerReceiptLayout() {}, buildKitchenReceiptLayout() {} },
    "./escpos-formatter.js": { formatLayout: () => new Uint8Array() },
    "./print-transport.js": { createPrintTransport: () => ({ send: async () => ({}), destroy() {} }) },
    "./print-pipeline.js": { createPrintPipeline: () => ({ execute: async () => ({ success: true }), destroy() {} }) },
    "./commercial-print-queue.js": { createCommercialPrintQueue: options => ({ close() {}, destroy() { options.pipeline.destroy(); }, isBusy: () => false, getJobs: () => [] }) },
    "./print-policy.js": { createPrintPolicy: () => ({ resolve: async () => ({ tickets: [] }) }), createPolicyRegistry: values => ({ get: name => values[name] || values.default }) },
    "./printer-capability.js": { createCapabilityRegistry: values => ({ get: name => values[name] || null }) },
    "./auto-print-engine.js": { createAutoPrintEngine: () => ({ handle: async () => ({ skipped: true }), close() {} }) },
    "./printer-registry.js": { createPrinterRegistry: printers => ({ get: id => printers.find(item => item.id === id), list: () => printers }) },
    "./printer-router.js": { createPrinterRouter: () => ({ route: () => ({ printer: null }) }) },
    "./print-scheduler.js": { createPrintScheduler: () => ({ schedule: () => ({ ok: false }) }) },
    "./printer-pos-config.js": { async loadPrinterRuntimeConfiguration() { const entry = entries[Math.min(index++, entries.length - 1)]; if (entry.gate) await entry.gate.promise; if (entry.error) throw entry.error; return { enabled: false, code: entry.name, profile: null, profiles: {}, driver: null, printer: null, printers: [], runtimeFactory: { async destroy() { retired.push(entry.name); } } }; } }
  };
  return { integration: createPrinterIntegration({ importer: async name => modules[name], environment: {} }), retired };
}

test("521 failed initialization after destroy remains destroyed", async () => { const gate = deferred(), h = harness([{ name: "init", gate }]); const initializing = h.integration.initialize(); const destroying = h.integration.destroyAsync(); gate.reject(new Error("compose failed")); const [initialized] = await Promise.all([initializing, destroying]); assert.equal(initialized.code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); });
test("522 initialize after failed destroy race is blocked", async () => { const gate = deferred(), h = harness([{ name: "init", gate }]); void h.integration.initialize(); const destroying = h.integration.destroyAsync(); gate.reject(new Error("compose failed")); await destroying; const value = await h.integration.initialize(); assert.equal(value.code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); });
test("523 invalidation after destroy is blocked", async () => { const h = harness([{ name: "A" }]); await h.integration.initialize(); await h.integration.destroyAsync(); const value = h.integration.invalidateConfiguration(); assert.equal(value.code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); });
test("524 failed replacement after destroy remains destroyed", async () => { const gate = deferred(), h = harness([{ name: "A" }, { name: "B", gate }]); await h.integration.initialize(); h.integration.invalidateConfiguration(); const reload = h.integration.reloadConfiguration(); const destroying = h.integration.destroyAsync(); gate.reject(new Error("replacement failed")); const [reloaded] = await Promise.all([reload, destroying]); assert.equal(reloaded.code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); });
test("525 reload after failed destroy race is blocked", async () => { const gate = deferred(), h = harness([{ name: "A" }, { name: "B", gate }]); await h.integration.initialize(); h.integration.invalidateConfiguration(); void h.integration.reloadConfiguration(); const destroying = h.integration.destroyAsync(); gate.reject(new Error("replacement failed")); await destroying; const value = await h.integration.reloadConfiguration(); assert.equal(value.code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); });
test("526 destroyed integration cannot resurrect", async () => { const gate = deferred(), h = harness([{ name: "init", gate }]); void h.integration.initialize(); const destroying = h.integration.destroyAsync(); gate.reject(new Error("late failure")); await destroying; for (let index = 0; index < 3; index++) { assert.equal((await h.integration.initialize()).code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal((await h.integration.reloadConfiguration()).code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal(h.integration.getStatus().status, "destroyed"); } });
test("527 destroy barrier waits pending failure lifecycle", async () => { const gate = deferred(), h = harness([{ name: "init", gate }]); void h.integration.initialize(); let finished = false; const destroying = h.integration.destroyAsync().then(() => { finished = true; }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false); gate.reject(new Error("late failure")); await destroying; assert.equal(finished, true); assert.equal(h.integration.getStatus().status, "destroyed"); });
