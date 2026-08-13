const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let createPrinterIntegration;
test.before(async () => { const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "printer-integration.js"), "utf8"); createPrinterIntegration = (await import(dataUrl(source) + "#compose-rollback")).createPrinterIntegration; });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(entries, failure = {}) {
  let configIndex = 0, activeName = ""; const destroyed = [], released = [], closed = [], warnings = [];
  const fails = kind => failure[kind] === true || failure[kind] === activeName;
  const modules = {
    "./print-decision.js": { createDecisionLayer: () => ({ decide: async () => ({ action: "skip", tickets: [] }) }) },
    "./receipt-layout.js": { buildCustomerReceiptLayout() {}, buildKitchenReceiptLayout() {} },
    "./escpos-formatter.js": { formatLayout: () => new Uint8Array() },
    "./print-transport.js": { createPrintTransport: () => ({ send: async () => ({}), destroy() { destroyed.push("legacy-transport"); } }) },
    "./physical-transport-router.js": failure.router ? null : { createPhysicalTransportRouter: () => ({ send: async () => ({}), destroy() { destroyed.push("router"); } }) },
    "./print-pipeline.js": { createPrintPipeline() { if (fails("pipeline")) throw Object.assign(new Error("pipeline failed"), { code: "PIPELINE_CONSTRUCTION_FAILED" }); return { execute: async () => ({ success: true }), destroy() { destroyed.push("pipeline"); } }; } },
    "./commercial-print-queue.js": { createCommercialPrintQueue(options) { if (fails("queue")) throw Object.assign(new Error("queue failed"), { code: "QUEUE_CONSTRUCTION_FAILED" }); return { close() {}, destroy() { destroyed.push("queue"); options.pipeline.destroy(); }, isBusy: () => false, getJobs: () => [] }; } },
    "./print-policy.js": { createPrintPolicy: () => ({ resolve: async () => ({ tickets: [] }) }), createPolicyRegistry: values => ({ get: name => values[name] || values.default }) },
    "./printer-capability.js": { createCapabilityRegistry: values => ({ get: name => values[name] }) },
    "./auto-print-engine.js": { createAutoPrintEngine() { if (fails("engine")) throw Object.assign(new Error("engine failed"), { code: "ENGINE_CONSTRUCTION_FAILED" }); return { handle: async () => ({ skipped: true }), close() { destroyed.push("engine"); } }; } },
    "./printer-registry.js": { createPrinterRegistry(printers) { if (fails("registry")) throw Object.assign(new Error("registry failed"), { code: "REGISTRY_CONSTRUCTION_FAILED" }); return { get: id => printers.find(item => item.id === id), list: () => printers }; } },
    "./printer-router.js": { createPrinterRouter: () => ({ route: () => ({ printer: null }) }) },
    "./print-scheduler.js": { createPrintScheduler: () => ({ schedule: () => ({ ok: false }) }) },
    "./printer-pos-config.js": { async loadPrinterRuntimeConfiguration() { const entry = entries[Math.min(configIndex++, entries.length - 1)]; activeName = entry.name; if (entry.gate) await entry.gate.promise; return { enabled: false, code: entry.name, profile: null, profiles: {}, printer: null, printers: [], transports: new Map(), runtimeFactory: { async destroy() { destroyed.push(entry.name); released.push(entry.name); closed.push(entry.name); if (entry.cleanupError) throw Object.assign(new Error("cleanup failed"), { code: "RELEASE_FAILED" }); return { ok: true }; } } }; } }
  };
  const importer = async name => { if (name === "./physical-transport-router.js" && failure.router) throw Object.assign(new Error("router import failed"), { code: "ROUTER_IMPORT_FAILED" }); return modules[name]; };
  return { integration: createPrinterIntegration({ importer, environment: {} }), destroyed, released, closed, warnings };
}

test("528 router import failure rolls back runtime factory", async () => { const h = harness([{ name: "R528" }], { router: true }), value = await h.integration.initialize(); assert.equal(value.error.code, "ROUTER_IMPORT_FAILED"); assert.deepEqual(h.destroyed, ["R528"]); });
test("529 late failure releases and closes physical runtime", async () => { const h = harness([{ name: "R529" }], { pipeline: true }); await h.integration.initialize(); assert.deepEqual(h.released, ["R529"]); assert.deepEqual(h.closed, ["R529"]); });
test("530 pipeline construction failure rolls back runtime", async () => { const h = harness([{ name: "R530" }], { pipeline: true }), value = await h.integration.initialize(); assert.equal(value.code, "INITIALIZATION_FAILED"); assert.deepEqual(h.destroyed, ["R530"]); });
test("531 queue construction failure destroys partial pipeline and runtime", async () => { const h = harness([{ name: "R531" }], { queue: true }); await h.integration.initialize(); assert.deepEqual(h.destroyed, ["pipeline", "R531"]); });
test("532 engine construction failure destroys queue pipeline and runtime", async () => { const h = harness([{ name: "R532" }], { engine: true }); await h.integration.initialize(); assert.deepEqual(h.destroyed, ["queue", "pipeline", "R532"]); });
test("533 failed initialization owns no remaining runtime", async () => { const h = harness([{ name: "R533" }], { registry: true }); await h.integration.initialize(); assert.equal(h.destroyed.filter(value => value === "R533").length, 1); assert.equal(h.integration.getStatus().status, "unavailable"); });
test("534 failed reload rolls back replacement runtime", async () => { const h = harness([{ name: "A534" }, { name: "B534" }], { engine: "B534" }); await h.integration.initialize(); h.integration.invalidateConfiguration(); const value = await h.integration.reloadConfiguration(); assert.equal(value.code, "CONFIGURATION_RELOAD_FAILED"); assert.ok(h.destroyed.includes("B534")); });
test("535 reload replacement partial failure leaves no B orphan", async () => { const h = harness([{ name: "A535" }, { name: "B535" }], { queue: "B535" }); await h.integration.initialize(); h.integration.invalidateConfiguration(); await h.integration.reloadConfiguration(); assert.equal(h.destroyed.filter(value => value === "B535").length, 1); assert.equal(h.integration.getStatus().status, "unavailable"); });
test("536 partial compose failure after destroy remains terminal", async () => { const gate = deferred(), h = harness([{ name: "R536", gate }], { pipeline: true }); void h.integration.initialize(); const destroying = h.integration.destroyAsync(); gate.resolve(); await destroying; assert.equal(h.integration.getStatus().status, "destroyed"); assert.deepEqual(h.destroyed, ["R536"]); });
test("537 destroy barrier waits partial rollback", async () => { const gate = deferred(), cleanupGate = deferred(), entry = { name: "R537", gate }, h = harness([entry], { pipeline: true }); void h.integration.initialize(); let finished = false; const destroying = h.integration.destroyAsync().then(() => { finished = true; }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false); gate.resolve(); await destroying; assert.equal(finished, true); assert.deepEqual(h.destroyed, ["R537"]); cleanupGate.resolve(); });
test("538 failed partial composition cannot resurrect", async () => { const gate = deferred(), h = harness([{ name: "R538", gate }], { queue: true }); void h.integration.initialize(); const destroying = h.integration.destroyAsync(); gate.resolve(); await destroying; assert.equal((await h.integration.initialize()).code, "PRINTER_INTEGRATION_DESTROYED"); assert.equal((await h.integration.reloadConfiguration()).code, "PRINTER_INTEGRATION_DESTROYED"); });
test("539 cleanup error preserves original compose error", async () => { const h = harness([{ name: "R539", cleanupError: true }], { pipeline: true }), old = console.warn; console.warn = () => {}; const value = await h.integration.initialize(); console.warn = old; assert.equal(value.error.code, "PIPELINE_CONSTRUCTION_FAILED"); });
test("540 cleanup failure emits teardown diagnostic", async () => { const h = harness([{ name: "R540", cleanupError: true }], { pipeline: true }), warnings = [], old = console.warn; console.warn = (...args) => warnings.push(args); await h.integration.initialize(); console.warn = old; assert.equal(warnings.some(args => JSON.stringify(args).includes("RELEASE_FAILED")), true); });
