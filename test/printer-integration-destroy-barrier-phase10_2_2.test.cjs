const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let createPrinterIntegration;

test.before(async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "printer-integration.js"), "utf8");
  createPrinterIntegration = (await import(dataUrl(source) + "#destroy-barrier")).createPrinterIntegration;
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(configurations) {
  let index = 0;
  const retired = [];
  const modules = {
    "./print-decision.js": { createDecisionLayer: () => ({ decide: async () => ({ action: "skip", tickets: [] }) }) },
    "./receipt-layout.js": { buildCustomerReceiptLayout() {}, buildKitchenReceiptLayout() {} },
    "./escpos-formatter.js": { formatLayout: () => new Uint8Array() },
    "./print-transport.js": { createPrintTransport: () => ({ send: async () => ({}), destroy() { return true; } }) },
    "./print-pipeline.js": { createPrintPipeline: () => ({ execute: async () => ({ success: true }), destroy() { return true; } }) },
    "./commercial-print-queue.js": { createCommercialPrintQueue: options => ({ pipeline: options.pipeline, close() { return true; }, destroy() { this.pipeline.destroy(); return true; }, isBusy: () => false, getJobs: () => [] }) },
    "./print-policy.js": { createPrintPolicy: () => ({ resolve: async () => ({ tickets: [] }) }), createPolicyRegistry: values => ({ get: name => values[name] || values.default }) },
    "./printer-capability.js": { createCapabilityRegistry: values => ({ get: name => values[name] || null }) },
    "./auto-print-engine.js": { createAutoPrintEngine: () => ({ handle: async () => ({ skipped: true }), close() { return true; } }) },
    "./printer-registry.js": { createPrinterRegistry: printers => ({ get: id => printers.find(item => item.id === id) || null, list: () => printers }) },
    "./printer-router.js": { createPrinterRouter: () => ({ route: () => ({ printer: null }) }) },
    "./print-scheduler.js": { createPrintScheduler: () => ({ schedule: () => ({ ok: false }) }) },
    "./printer-pos-config.js": { async loadPrinterRuntimeConfiguration() {
      const entry = configurations[Math.min(index++, configurations.length - 1)];
      if (entry.gate) await entry.gate.promise;
      return { enabled: false, code: entry.name, profile: null, profiles: {}, driver: null, printer: null, printers: [], runtimeFactory: { async destroy() { if (entry.releaseGate) await entry.releaseGate.promise; retired.push(entry.name); return { ok: true }; } } };
    } }
  };
  return { integration: createPrinterIntegration({ importer: async name => modules[name], environment: {} }), retired };
}

test("513 destroyAsync during initialization waits for compose", async () => { const gate = deferred(), h = harness([{ name: "init", gate }]); const initializing = h.integration.initialize(); let finished = false; const destroying = h.integration.destroyAsync().then(() => { finished = true; }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false); gate.resolve(); await Promise.all([initializing, destroying]); assert.deepEqual(h.retired, ["init"]); });
test("514 destroyAsync waits initialization physical retirement", async () => { const composeGate = deferred(), releaseGate = deferred(), h = harness([{ name: "init", gate: composeGate, releaseGate }]); void h.integration.initialize(); const destroying = h.integration.destroyAsync(); composeGate.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); assert.deepEqual(h.retired, []); releaseGate.resolve(); await destroying; assert.deepEqual(h.retired, ["init"]); });
test("515 destroyAsync during reload waits old and replacement", async () => { const replacementGate = deferred(), h = harness([{ name: "A" }, { name: "B", gate: replacementGate }]); await h.integration.initialize(); h.integration.invalidateConfiguration(); const reload = h.integration.reloadConfiguration(); let finished = false; const destroying = h.integration.destroyAsync().then(() => { finished = true; }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false); replacementGate.resolve(); await Promise.all([reload, destroying]); assert.deepEqual(h.retired.sort(), ["A", "B"]); });
test("516 repeated destroyAsync shares terminal barrier", async () => { const gate = deferred(), h = harness([{ name: "A", releaseGate: gate }]); await h.integration.initialize(); const first = h.integration.destroyAsync(), second = h.integration.destroyAsync(); assert.equal(first, second); gate.resolve(); await Promise.all([first, second]); assert.deepEqual(h.retired, ["A"]); });
test("517 destroy plus destroyAsync does not double retire", async () => { const h = harness([{ name: "A" }]); await h.integration.initialize(); assert.equal(h.integration.destroy(), true); assert.equal(h.integration.destroy(), false); await h.integration.destroyAsync(); assert.deepEqual(h.retired, ["A"]); });
test("518 destroy barrier leaves terminal state", async () => { const h = harness([{ name: "A" }]); await h.integration.initialize(); await h.integration.destroyAsync(); assert.equal(h.integration.getStatus().status, "destroyed"); assert.equal((await h.integration.initialize()).code, "PRINTER_INTEGRATION_DESTROYED"); });
