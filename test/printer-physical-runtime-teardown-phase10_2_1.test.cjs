const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let providerModule, factoryModule, printTransportModule, integrationSource;

test.before(async () => {
  const providerSource = await fs.readFile(path.join(root, "usb-printer-provider.js"), "utf8");
  const factorySource = await fs.readFile(path.join(root, "printer-runtime-factory.js"), "utf8");
  const transportSource = await fs.readFile(path.join(root, "print-transport.js"), "utf8");
  providerModule = await import(dataUrl(providerSource) + "#teardown-provider");
  factoryModule = await import(dataUrl(factorySource) + "#teardown-factory");
  printTransportModule = await import(dataUrl(transportSource) + "#teardown-transport");
  integrationSource = await fs.readFile(path.join(root, "printer-integration.js"), "utf8");
});

function usbDevice(serial, options = {}) {
  const calls = [];
  const device = {
    vendorId: 10, productId: 20, serialNumber: serial, productName: serial, manufacturerName: "EnPoint", opened: false,
    configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 2, alternates: [{ alternateSetting: 0, endpoints: [{ direction: "out", endpointNumber: 3, packetSize: 64 }] }] }] }],
    configuration: null,
    async open() { calls.push("open"); if (this.opened) throw Object.assign(new Error("busy"), { name: "InvalidStateError" }); this.opened = true; },
    async selectConfiguration(value) { calls.push("selectConfiguration"); this.configuration = this.configurations.find(item => item.configurationValue === value); },
    async claimInterface() { calls.push("claimInterface"); if (this.claimed) throw Object.assign(new Error("claimed"), { name: "NetworkError" }); this.claimed = true; },
    async releaseInterface() { calls.push("releaseInterface"); if (options.releaseFails) throw new Error("release failed"); this.claimed = false; },
    async close() { calls.push("close"); this.opened = false; this.claimed = false; },
    async transferOut(endpoint, bytes) { calls.push("transferOut"); if (options.transferGate) await options.transferGate.promise; calls.push("transferSettled"); return { status: "ok", bytesWritten: bytes.length }; },
    calls
  };
  return device;
}

function harness(devices) {
  let transportDestroys = 0;
  const environment = { navigator: { usb: { getDevices: async () => devices } } };
  const importer = async name => {
    if (name === "./usb-printer-provider.js") return providerModule;
    if (name === "./print-transport.js") return { createPrintTransport(driver) { let active = null; return {
      async send(bytes) { active = driver.transferChunk(bytes); try { return await active; } finally { active = null; } },
      cancel() { return false; }, flush() { return active || Promise.resolve(); }, isBusy() { return Boolean(active); }, destroy() { transportDestroys++; return true; }
    }; } };
    throw new Error(name);
  };
  return { factory: factoryModule.createPrinterRuntimeFactory({ importer, environment }), binding: device => factoryModule.createUsbDeviceBinding(device), transportDestroys: () => transportDestroys, environment, importer };
}

test("501 runtime retirement calls USB releaseInterface", async () => { const raw = usbDevice("T501"), h = harness([raw]), result = await h.factory.createMappings([{ id: "K", deviceBinding: h.binding(raw) }]); await h.factory.destroy(); assert.ok(raw.calls.includes("releaseInterface")); assert.equal(result.transports.has("K"), true); });
test("502 runtime retirement calls USB close", async () => { const raw = usbDevice("T502"), h = harness([raw]); await h.factory.createMappings([{ id: "K", deviceBinding: h.binding(raw) }]); await h.factory.destroy(); assert.ok(raw.calls.includes("close")); assert.equal(raw.opened, false); });
test("503 release occurs before provider final cleanup", async () => { const raw = usbDevice("T503"), h = harness([raw]); await h.factory.createMappings([{ id: "K", deviceBinding: h.binding(raw) }]); await h.factory.destroy(); assert.ok(raw.calls.indexOf("releaseInterface") < raw.calls.indexOf("close")); assert.equal(h.transportDestroys(), 1); });
test("504 release failure still attempts close", async () => { const raw = usbDevice("T504", { releaseFails: true }), h = harness([raw]); await h.factory.createMappings([{ id: "K", deviceBinding: h.binding(raw) }]); const old = console.warn; console.warn = () => {}; const result = await h.factory.destroy(); console.warn = old; assert.ok(raw.calls.includes("releaseInterface")); assert.ok(raw.calls.includes("close")); assert.equal(result.ok, false); assert.equal(raw.opened, false); });
test("505 shared runtime first release does not disconnect", async () => { const raw = usbDevice("T505"), first = harness([raw]), binding = first.binding(raw), a = await first.factory.createMappings([{ id: "K", deviceBinding: binding }]), secondFactory = factoryModule.createPrinterRuntimeFactory({ importer: first.importer, environment: first.environment }), b = await secondFactory.createMappings([{ id: "K", deviceBinding: binding }]); await a.transports.get("K").destroy(); assert.equal(raw.calls.filter(value => value === "releaseInterface").length, 0); await b.transports.get("K").destroy(); });
test("506 shared runtime final release disconnects once", async () => { const raw = usbDevice("T506"), first = harness([raw]), binding = first.binding(raw), a = await first.factory.createMappings([{ id: "K", deviceBinding: binding }]), secondFactory = factoryModule.createPrinterRuntimeFactory({ importer: first.importer, environment: first.environment }), b = await secondFactory.createMappings([{ id: "C", deviceBinding: binding }]); await a.transports.get("K").destroy(); await b.transports.get("C").destroy(); assert.equal(raw.calls.filter(value => value === "releaseInterface").length, 1); assert.equal(raw.calls.filter(value => value === "close").length, 1); });
test("507 Kitchen Customer alias releases one interface", async () => { const raw = usbDevice("T507"), h = harness([raw]), binding = h.binding(raw); await h.factory.createMappings([{ id: "K", deviceBinding: binding }, { id: "C", deviceBinding: binding }]); await h.factory.destroy(); assert.equal(raw.calls.filter(value => value === "releaseInterface").length, 1); assert.equal(raw.calls.filter(value => value === "close").length, 1); });
test("508 A to B retires A", async () => { const a = usbDevice("A508"), b = usbDevice("B508"), first = harness([a, b]); await first.factory.createMappings([{ id: "K", deviceBinding: first.binding(a) }]); const second = harness([a, b]); await second.factory.createMappings([{ id: "K", deviceBinding: second.binding(b) }]); await first.factory.destroy(); assert.equal(a.opened, false); assert.equal(b.opened, true); await second.factory.destroy(); });
test("509 A to B to A reconnect succeeds", async () => { const a = usbDevice("A509"), b = usbDevice("B509"), first = harness([a, b]); const bindingA = first.binding(a); await first.factory.createMappings([{ id: "K", deviceBinding: bindingA }]); await first.factory.destroy(); const middle = harness([a, b]); await middle.factory.createMappings([{ id: "K", deviceBinding: middle.binding(b) }]); await middle.factory.destroy(); const last = harness([a, b]); const result = await last.factory.createMappings([{ id: "K", deviceBinding: bindingA }]); assert.equal(result.transports.has("K"), true); assert.equal(a.opened, true); assert.equal(a.calls.filter(value => value === "claimInterface").length, 2); await last.factory.destroy(); });
test("510 disable then enable same device reconnects", async () => { const a = usbDevice("A510"), first = harness([a]), binding = first.binding(a); await first.factory.createMappings([{ id: "K", deviceBinding: binding }]); await first.factory.destroy(); assert.equal(a.opened, false); const enabled = harness([a]), result = await enabled.factory.createMappings([{ id: "K", deviceBinding: binding }]); assert.equal(result.transports.has("K"), true); await enabled.factory.destroy(); });
test("511 integration reload awaits runtime retirement", () => { assert.match(integrationSource, /await retire\(previous\)/); assert.match(integrationSource, /await value\.configuration\.runtimeFactory\.destroy\(\)/); });
test("512 integration exposes awaitable destroy lifecycle", () => { assert.match(integrationSource, /function destroyAsync\(\)/); assert.match(integrationSource, /destroyPromise = Promise\.all\(\[/); });
test("519 active transfer teardown does not close prematurely", async () => { const gate = (() => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; })(), raw = usbDevice("T519", { transferGate: gate }), environment = { navigator: { usb: { getDevices: async () => [raw] } } }, importer = async name => name === "./usb-printer-provider.js" ? providerModule : printTransportModule, factory = factoryModule.createPrinterRuntimeFactory({ importer, environment }), mapping = await factory.createMappings([{ id: "K", deviceBinding: factoryModule.createUsbDeviceBinding(raw) }]), sending = mapping.transports.get("K").send(new Uint8Array([1])).catch(() => undefined); const destroying = factory.destroy(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(raw.calls.includes("close"), false); assert.equal(raw.calls.includes("releaseInterface"), false); gate.resolve(); await Promise.all([sending, destroying]); });
test("520 active transfer settles before release and close", async () => { const gate = (() => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; })(), raw = usbDevice("T520", { transferGate: gate }), environment = { navigator: { usb: { getDevices: async () => [raw] } } }, importer = async name => name === "./usb-printer-provider.js" ? providerModule : printTransportModule, factory = factoryModule.createPrinterRuntimeFactory({ importer, environment }), mapping = await factory.createMappings([{ id: "K", deviceBinding: factoryModule.createUsbDeviceBinding(raw) }]), sending = mapping.transports.get("K").send(new Uint8Array([1])).catch(() => undefined), destroying = factory.destroy(); gate.resolve(); await Promise.all([sending, destroying]); assert.ok(raw.calls.indexOf("transferSettled") < raw.calls.indexOf("releaseInterface")); assert.ok(raw.calls.indexOf("releaseInterface") < raw.calls.indexOf("close")); });
