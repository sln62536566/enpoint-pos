const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const read = name => fs.readFile(path.join(root, name), "utf8");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let routerApi, factoryApi, integration, config, profile, pos;

test.before(async () => {
  const [routerSource, factorySource] = await Promise.all([read("physical-transport-router.js"), read("printer-runtime-factory.js")]);
  routerApi = await import(dataUrl(routerSource));
  factoryApi = await import(dataUrl(factorySource));
  [integration, config, profile, pos] = await Promise.all([read("printer-integration.js"), read("printer-pos-config.js"), read("printer-profile.js"), read("pos.js")]);
});

function context(printerId) { return { metadata: printerId === undefined ? {} : { printerId } }; }
function transport(name, calls, overrides = {}) {
  let destroyed = 0, busy = false;
  return Object.assign({
    async send(bytes) { busy = true; calls.push(name); busy = false; return { bytesTransferred: bytes.length }; },
    cancel() { return false; }, flush: async () => {}, isBusy: () => busy,
    destroy() { destroyed++; return true; }, destroyed: () => destroyed
  }, overrides);
}

test("467 printerId A dispatches Transport A", async () => { const calls = [], router = routerApi.createPhysicalTransportRouter({ transports: new Map([["A", transport("A", calls)]]) }); await router.send(new Uint8Array([1]), context("A")); assert.deepEqual(calls, ["A"]); });
test("468 printerId B dispatches Transport B", async () => { const calls = [], router = routerApi.createPhysicalTransportRouter({ transports: new Map([["A", transport("A", calls)], ["B", transport("B", calls)]]) }); await router.send(new Uint8Array([1]), context("B")); assert.deepEqual(calls, ["B"]); });
test("469 unknown printerId is controlled", async () => { const router = routerApi.createPhysicalTransportRouter({ transports: {} }); await assert.rejects(router.send(new Uint8Array(), context("missing")), error => error.code === "PHYSICAL_TARGET_UNAVAILABLE"); });
test("470 missing printerId is controlled", async () => { const router = routerApi.createPhysicalTransportRouter({ transports: {} }); await assert.rejects(router.send(new Uint8Array(), context()), error => error.code === "PHYSICAL_TARGET_NOT_FOUND"); });
test("471 dispatch has no default fallback", async () => { const calls = [], router = routerApi.createPhysicalTransportRouter({ transports: { A: transport("A", calls) } }); await assert.rejects(router.send(new Uint8Array(), context("B"))); assert.deepEqual(calls, []); });
test("472 same runtime alias uses one Transport", async () => { const calls = [], shared = transport("shared", calls), router = routerApi.createPhysicalTransportRouter({ transports: { Kitchen: shared, Customer: shared } }); await router.send(new Uint8Array(), context("Kitchen")); await router.send(new Uint8Array(), context("Customer")); assert.deepEqual(calls, ["shared", "shared"]); });
test("473 destroy shared runtime once", () => { const shared = transport("shared", []), router = routerApi.createPhysicalTransportRouter({ transports: { Kitchen: shared, Customer: shared } }); assert.equal(router.destroy(), true); assert.equal(router.destroy(), false); assert.equal(shared.destroyed(), 1); });
test("474 cancel targets only active runtime", async () => { let release, cancelledA = 0, cancelledB = 0; const a = transport("A", [], { send: () => new Promise(resolve => { release = resolve; }), cancel() { cancelledA++; return true; } }), b = transport("B", [], { cancel() { cancelledB++; return true; } }), router = routerApi.createPhysicalTransportRouter({ transports: { A: a, B: b } }); const sending = router.send(new Uint8Array(), context("A")); await new Promise(resolve => setTimeout(resolve, 0)); router.cancel(); release({ bytesTransferred: 0 }); await sending; assert.equal(cancelledA, 1); assert.equal(cancelledB, 0); });
test("475 flush covers unique runtimes once", async () => { let a = 0, b = 0; const first = transport("A", [], { flush: async () => { a++; } }), second = transport("B", [], { flush: async () => { b++; } }), router = routerApi.createPhysicalTransportRouter({ transports: { K: first, C: second, K2: first } }); await router.flush(); assert.deepEqual([a, b], [1, 1]); });
test("476 isBusy reports routed runtime activity", () => { const router = routerApi.createPhysicalTransportRouter({ transports: { A: transport("A", [], { isBusy: () => true }) } }); assert.equal(router.isBusy(), true); });

function runtimeHarness(devices, statuses = {}) {
  const drivers = [], transfers = [], transports = [];
  const environment = { navigator: { usb: { getDevices: async () => devices, requestDevice: async () => devices[0] } } };
  const importer = async name => {
    if (name === "./usb-printer-provider.js") return { createUsbPrinterProvider({ environment: scoped }) { const device = devices.find(item => item === scoped.usb ? false : false); const state = { selectedDevice: {}, connected: true, capability: { packetSize: 64 } }; const driver = { scoped, detect: async () => [], connect: async () => state, getStatus: () => statuses.fail ? { connected: false, capability: null, lastErrorCode: "PRINTER_NOT_READY" } : state, transferChunk: async bytes => { transfers.push({ scoped, bytes }); return { ok: true, bytesTransferred: bytes.length }; }, onStatusChanged: () => () => {}, destroy() { this.destroyed = (this.destroyed || 0) + 1; } }; drivers.push(driver); return driver; } };
    if (name === "./print-transport.js") return { createPrintTransport(driver) { const value = transport(`T${transports.length + 1}`, [], { send: async bytes => { await driver.transferChunk(bytes); return { bytesTransferred: bytes.length }; } }); transports.push(value); return value; } };
    throw new Error(name);
  };
  return { factory: factoryApi.createPrinterRuntimeFactory({ importer, environment }), drivers, transfers, transports };
}

const device = (serial, name = serial) => ({ vendorId: 1, productId: 2, serialNumber: serial, productName: name, manufacturerName: "EnPoint" });
test("477 serial binding id is stable", () => { const a = factoryApi.createUsbDeviceBinding(device("A")), b = factoryApi.createUsbDeviceBinding(device("A")); assert.equal(a.bindingId, b.bindingId); assert.equal(a.durable, true); });
test("478 binding descriptor has no raw USBDevice", () => { const raw = device("A"), binding = factoryApi.createUsbDeviceBinding(raw); assert.equal(Object.values(binding).includes(raw), false); assert.equal(JSON.stringify(binding).includes("transferOut"), false); });
test("479 no-serial binding is session-only", () => { const binding = factoryApi.createUsbDeviceBinding(device("")); assert.equal(binding.durable, false); assert.equal(binding.sessionId, factoryApi.USB_BINDING_SESSION_ID); });
test("480 no-serial raw object keeps session alias", () => { const raw = device(""), a = factoryApi.createUsbDeviceBinding(raw), b = factoryApi.createUsbDeviceBinding(raw); assert.equal(a.bindingId, b.bindingId); });
test("481 different no-serial objects never collapse", () => { assert.notEqual(factoryApi.createUsbDeviceBinding(device("")).bindingId, factoryApi.createUsbDeviceBinding(device("")).bindingId); });
test("482 same binding creates one driver", async () => { const raw = device("A482"), h = runtimeHarness([raw]), binding = factoryApi.createUsbDeviceBinding(raw); await h.factory.createMappings([{ id: "K", deviceBinding: binding }, { id: "C", deviceBinding: binding }]); assert.equal(h.drivers.length, 1); });
test("483 same binding creates one transport", async () => { const raw = device("A483"), h = runtimeHarness([raw]), binding = factoryApi.createUsbDeviceBinding(raw), result = await h.factory.createMappings([{ id: "K", deviceBinding: binding }, { id: "C", deviceBinding: binding }]); assert.equal(h.transports.length, 1); assert.equal(result.transports.get("K"), result.transports.get("C")); });
test("484 different bindings create separate runtimes", async () => { const a = device("A484"), b = device("B484"), h = runtimeHarness([a, b]), result = await h.factory.createMappings([{ id: "K", deviceBinding: factoryApi.createUsbDeviceBinding(a) }, { id: "C", deviceBinding: factoryApi.createUsbDeviceBinding(b) }]); assert.equal(h.drivers.length, 2); assert.notEqual(result.transports.get("K"), result.transports.get("C")); });
test("485 Kitchen and Customer physically call only their bound drivers", async () => { const a = device("A485"), b = device("B485"), h = runtimeHarness([a, b]), result = await h.factory.createMappings([{ id: "K", deviceBinding: factoryApi.createUsbDeviceBinding(a) }, { id: "C", deviceBinding: factoryApi.createUsbDeviceBinding(b) }]); await result.transports.get("K").send(new Uint8Array([1])); await result.transports.get("C").send(new Uint8Array([2])); const physical = await Promise.all(h.transfers.map(item => item.scoped.usb.getDevices())); assert.equal(physical[0][0], a); assert.equal(physical[1][0], b); });
test("486 missing binding never creates fallback runtime", async () => { const h = runtimeHarness([device("A")]), result = await h.factory.createMappings([{ id: "C", deviceBinding: null }]); assert.equal(result.transports.has("C"), false); assert.equal(result.errors.get("C").code, "PHYSICAL_TARGET_NOT_FOUND"); assert.equal(h.drivers.length, 0); });
test("487 disconnected binding is controlled", async () => { const raw = device("B487"), h = runtimeHarness([raw], { fail: true }), result = await h.factory.createMappings([{ id: "C", deviceBinding: factoryApi.createUsbDeviceBinding(raw) }]); assert.equal(result.transports.has("C"), false); assert.equal(result.errors.get("C").code, "PRINTER_NOT_READY"); });
test("488 one runtime failure does not remove another", async () => { const a = device("A488"), h = runtimeHarness([a]), result = await h.factory.createMappings([{ id: "K", deviceBinding: factoryApi.createUsbDeviceBinding(a) }, { id: "C", deviceBinding: { bindingId: "usb:1:2:B488", vendorId: 1, productId: 2, serialNumber: "B488", durable: true } }]); assert.equal(result.transports.has("K"), true); assert.equal(result.transports.has("C"), false); });
test("489 runtime factory exposes immutable ready printers", async () => { const raw = device("A489"), h = runtimeHarness([raw]), result = await h.factory.createMappings([{ id: "K", deviceBinding: factoryApi.createUsbDeviceBinding(raw) }]); assert.equal(Object.isFrozen(result.printers), true); assert.equal(Object.isFrozen(result.printers[0]), true); });

test("490 integration composes target-aware router only for runtime map", () => assert.match(integration, /configuration\.transports instanceof Map[\s\S]*?physical-transport-router\.js/));
test("491 pipeline contract remains unmodified and receives router as transport", () => { assert.match(integration, /createPrintPipeline\(\{[\s\S]*?transport/); assert.doesNotMatch(integration, /pipelineMap|queueMap/); });
test("492 configuration emits physicalBindingId metadata", () => assert.match(config, /metadata: Object\.freeze\(\{ physicalBindingId: printer\.physicalBindingId \}\)/));
test("493 profile persists only normalized descriptor", () => { assert.match(profile, /function normalizeDeviceBinding/); for (const forbidden of ["USBDevice", "driver", "transport", "endpointNumber"]) assert.doesNotMatch(profile, new RegExp(forbidden)); });
test("494 Browser profile clears USB binding", () => assert.match(profile, /deviceBinding: provider === "usb" \? normalizeDeviceBinding\(source\.deviceBinding\) : null/));
test("495 settings exposes per-profile USB binding", () => { assert.match(pos, /data-profile-device-binding/); assert.match(pos, /PrinterProfile\.update\(profileName, \{ deviceBinding: selected \}\)/); });
test("496 Settings binding change invalidates integration", () => assert.match(pos, /deviceBinding: selected[\s\S]*?invalidatePrinterIntegrationConfiguration/));
test("497 global FIFO architecture remains single queue", () => assert.equal((integration.match(/createCommercialPrintQueue\(/g) || []).length, 1));
test("498 prohibited Core contracts remain untouched by integration", () => { for (const value of ["commercial-print-queue", "print-pipeline", "print-transport", "printer-router", "print-scheduler"] ) assert.ok(integration.includes(value)); assert.doesNotMatch(integration, /USBDevice|endpointNumber|claimInterface/); });
test("499 manual and automatic policies retain logical group routing", () => { assert.match(integration, /metadata: \{ group: "Kitchen"/); assert.match(integration, /metadata: \{ group, manual: true, reprint: true \}/); });
test("500 reload compositions reference-count one physical runtime", async () => { const raw = device("RELOAD500"), h = runtimeHarness([raw]), binding = factoryApi.createUsbDeviceBinding(raw), firstFactory = h.factory, secondFactory = factoryApi.createPrinterRuntimeFactory({ importer: firstFactory.runtimeFor ? async name => { if (name === "./usb-printer-provider.js") return { createUsbPrinterProvider() { throw new Error("duplicate runtime"); } }; throw new Error(name); } : null, environment: { navigator: { usb: { getDevices: async () => [raw] } } } }); const first = await firstFactory.createMappings([{ id: "K", deviceBinding: binding }]); const second = await secondFactory.createMappings([{ id: "K", deviceBinding: binding }]); assert.equal(h.drivers.length, 1); await first.transports.get("K").destroy(); assert.equal(h.drivers[0].destroyed || 0, 0); await second.transports.get("K").destroy(); assert.equal(h.drivers[0].destroyed, 1); });
