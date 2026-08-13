const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const source = name => fs.readFile(path.join(__dirname, "..", "public", "js", name), "utf8");
let adaptPrinterEvent, createPrinterOrderBridge, createPrinterIntegration, PRINT_TRIGGER_TYPES;

test.before(async () => {
  const triggerSource = await source("print-trigger.js");
  const trigger = await import(dataUrl(triggerSource));
  PRINT_TRIGGER_TYPES = trigger.PRINT_TRIGGER_TYPES;
  const adapterSource = (await source("printer-event-adapter.js")).replace("./print-trigger.js", dataUrl(triggerSource));
  adaptPrinterEvent = (await import(dataUrl(adapterSource))).adaptPrinterEvent;
  createPrinterOrderBridge = (await import(dataUrl(await source("printer-order-bridge.js")))).createPrinterOrderBridge;
  createPrinterIntegration = (await import(dataUrl(await source("printer-integration.js")))).createPrinterIntegration;
});

function coreModules(overrides = {}) {
  let enqueues = 0, destroyed = 0;
  const modules = {
    "./print-decision.js": { createDecisionLayer: () => ({ decide: async () => ({ action: "skip", tickets: [] }) }) },
    "./receipt-layout.js": { buildCustomerReceiptLayout() {}, buildKitchenReceiptLayout() {} },
    "./escpos-formatter.js": { formatLayout: () => new Uint8Array() },
    "./print-transport.js": { createPrintTransport: () => ({ send: async () => ({}), destroy: () => { destroyed++; return true; } }) },
    "./print-pipeline.js": { createPrintPipeline: () => ({ execute: async () => ({ success: true }), destroy: () => true }) },
    "./commercial-print-queue.js": { createCommercialPrintQueue: () => ({ enqueue: () => { enqueues++; return { id: "job", completion: Promise.resolve() }; }, destroy: () => { destroyed++; return true; } }) },
    "./print-policy.js": { createPrintPolicy: () => ({ resolve: async () => ({ tickets: [] }) }), createPolicyRegistry: policies => ({ get: () => policies.default }) },
    "./printer-capability.js": { createCapabilityRegistry: values => ({ get: () => values.default }) },
    "./auto-print-engine.js": { createAutoPrintEngine: () => ({ handle: async trigger => ({ accepted: false, skipped: true, errors: [], trigger }), close: () => true }) },
    "./printer-registry.js": { createPrinterRegistry: () => ({ get: () => null, list: () => [] }) },
    "./printer-router.js": { createPrinterRouter: () => ({ route: () => { throw new Error("must not route under safe policy"); } }) },
    "./print-scheduler.js": { createPrintScheduler: () => ({ schedule: () => { throw new Error("must not schedule under safe policy"); } }) }
  };
  Object.assign(modules, overrides);
  return { importer: async specifier => {
    if (!modules[specifier]) throw Object.assign(new Error(`missing ${specifier}`), { code: "MODULE_NOT_FOUND" });
    return modules[specifier];
  }, enqueues: () => enqueues, destroyed: () => destroyed };
}

function event() { return { eventType: PRINT_TRIGGER_TYPES.ORDER_CREATED, storeId: "store", order: { id: "o1", orderNumber: "P-1", items: [{ name: "Tea" }] }, ticketType: "kitchen", routeGroup: "Kitchen", metadata: { nested: { value: 1 } } }; }

test("261 adapter creates deterministic immutable trigger", () => {
  const a = adaptPrinterEvent(event(), () => 10), b = adaptPrinterEvent(event(), () => 20);
  assert.equal(a.id, b.id); assert.equal(Object.isFrozen(a), true); assert.equal(Object.isFrozen(a.payload.order.items[0]), true);
});
test("262 adapter does not mutate input", () => { const input = event(), before = structuredClone(input); adaptPrinterEvent(input); assert.deepEqual(input, before); });
test("263 adapter defensive copies nested data", () => { const input = event(), trigger = adaptPrinterEvent(input); input.order.items[0].name = "Changed"; input.metadata.nested.value = 2; assert.equal(trigger.payload.order.items[0].name, "Tea"); assert.equal(trigger.metadata.nested.value, 1); });
test("264 adapter exposes claim candidate without claiming", () => { const trigger = adaptPrinterEvent(event()); assert.equal(trigger.metadata.idempotencyCandidate, trigger.id); assert.equal(trigger.metadata.crossDeviceClaimed, false); });
test("265 adapter rejects invalid business event", () => assert.throws(() => adaptPrinterEvent({ type: "Unknown", orderId: "1" })));

test("266 integration initialize once", async () => { const core = coreModules(), integration = createPrinterIntegration({ importer: core.importer, environment: {} }); const a = await integration.initialize(), b = await integration.initialize(); assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(integration.getStatus().status, "ready"); });
test("267 concurrent initialize shares lifecycle", async () => { let calls = 0; const core = coreModules(), importer = async name => { calls++; return core.importer(name); }, integration = createPrinterIntegration({ importer, environment: {} }); const results = await Promise.all([integration.initialize(), integration.initialize(), integration.initialize()]); assert.equal(results.every(item => item.ok), true); assert.equal(calls, 12); });
test("268 failed initialize is controlled", async () => { const integration = createPrinterIntegration({ importer: async () => { throw new Error("load"); } }); const value = await integration.initialize(); assert.equal(value.ok, false); assert.equal(value.code, "INITIALIZATION_FAILED"); assert.equal(integration.getStatus().status, "unavailable"); });
test("269 repeated failed initialize does not reload", async () => { let calls = 0; const integration = createPrinterIntegration({ importer: async () => { calls++; throw new Error("load"); } }); await integration.initialize(); await integration.initialize(); assert.equal(calls, 12); });
test("270 destroy before initialize is idempotent", async () => { const integration = createPrinterIntegration({ importer: async () => { throw new Error("unused"); } }); assert.equal(integration.destroy(), true); assert.equal(integration.destroy(), false); assert.equal((await integration.initialize()).code, "PRINTER_INTEGRATION_DESTROYED"); });
test("271 destroy after initialize destroys components", async () => { const core = coreModules(), integration = createPrinterIntegration({ importer: core.importer }); await integration.initialize(); assert.equal(integration.destroy(), true); assert.ok(core.destroyed() >= 2); });
test("272 unsupported WebUSB remains ready optional capability", async () => { const core = coreModules(), integration = createPrinterIntegration({ importer: core.importer, environment: {} }); assert.equal((await integration.initialize()).ok, true); assert.equal(integration.getStatus().ready, true); assert.equal(integration.getStatus().available, false); assert.equal(integration.getStatus().capability, "unsupported"); });
test("273 corrupt component initialization is controlled", async () => { const core = coreModules({ "./printer-registry.js": { createPrinterRegistry: () => { throw new Error("corrupt"); } } }), integration = createPrinterIntegration({ importer: core.importer }); assert.equal((await integration.initialize()).ok, false); });
test("274 default safe handle skips without enqueue", async () => { const core = coreModules(), integration = createPrinterIntegration({ importer: core.importer }); const value = await integration.handle(adaptPrinterEvent(event())); assert.equal(value.code, "DEFAULT_SAFE_SKIP"); assert.equal(core.enqueues(), 0); });

test("275 bridge isolates adapter synchronous throw", async () => { const bridge = createPrinterOrderBridge({ loadAdapter: () => ({ adaptPrinterEvent() { throw Object.assign(new Error("adapter"), { code: "ADAPTER_THROW" }); } }) }); assert.equal((await bridge.handle({})).code, "ADAPTER_THROW"); });
test("276 bridge isolates adapter rejection", async () => { const bridge = createPrinterOrderBridge({ loadAdapter: () => ({ adaptPrinterEvent: async () => { throw new Error("adapter async"); } }) }); assert.equal((await bridge.handle({})).status, "isolated"); });
test("277 bridge isolates module load rejection", async () => { const bridge = createPrinterOrderBridge({ loadAdapter: async () => { throw Object.assign(new Error("404"), { code: "MODULE_NOT_FOUND" }); } }); assert.equal((await bridge.handle({})).code, "MODULE_NOT_FOUND"); });
test("278 bridge isolates integration rejection", async () => { const bridge = createPrinterOrderBridge({ loadAdapter: () => ({ adaptPrinterEvent: () => ({ id: "e1" }) }), loadIntegration: () => ({ PrinterIntegration: { handle: async () => { throw Object.assign(new Error("queue"), { code: "QUEUE_FAILED" }); } } }) }); const value = await bridge.handle({}); assert.equal(value.code, "QUEUE_FAILED"); assert.equal(value.eventId, "e1"); });
test("279 bridge supports fire and isolate without unhandled rejection", async () => { let unhandled = false; const listener = () => { unhandled = true; }; process.once("unhandledRejection", listener); const bridge = createPrinterOrderBridge({ loadAdapter: async () => { throw new Error("load"); } }); void bridge.handle({}); await new Promise(resolve => setTimeout(resolve, 10)); process.removeListener("unhandledRejection", listener); assert.equal(unhandled, false); });

test("280 architecture and POS static dependency guards", async () => {
  for (const name of ["printer-event-adapter.js", "printer-integration.js", "printer-order-bridge.js"]) {
    const value = await source(name);
    for (const forbidden of ["pos.js", "app.js", "kitchen.js", "firebase", "document.", "USBDevice", "endpointNumber"]) assert.equal(value.includes(forbidden), false, `${name} contains ${forbidden}`);
  }
  const pos = await source("pos.js");
  assert.equal(/^import .*printer-center\.js/m.test(pos), false);
  assert.equal(/^import .*printer-profile\.js/m.test(pos), false);
  assert.equal(/^import .*print-queue\.js/m.test(pos), false);
  assert.equal(pos.includes("PrinterOrderBridge.handle"), false);
});
