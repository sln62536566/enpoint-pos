const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let factoryApi, centerSource, posSource;

test.before(async () => {
  const factorySource = await fs.readFile(path.join(root, "printer-runtime-factory.js"), "utf8");
  factoryApi = await import(dataUrl(factorySource));
  centerSource = await fs.readFile(path.join(root, "printer-center.js"), "utf8");
  posSource = await fs.readFile(path.join(root, "pos.js"), "utf8");
});

function harness(serial, blockFirst = false) {
  const raw = { vendorId: 71, productId: 81, serialNumber: serial, productName: "Shared Printer" };
  const environment = { navigator: { usb: { getDevices: async () => [raw] } } };
  const drivers = [], transports = [];
  let releaseSend = null;
  const importer = async name => {
    if (name === "./usb-printer-provider.js") return { createUsbPrinterProvider() {
      const state = { connected: true, capability: { packetSize: 64 } };
      const driver = { detect: async () => [], connect: async () => state, getStatus: () => state, onStatusChanged: () => () => {}, disconnects: 0, destroys: 0, async disconnect() { this.disconnects++; return { connected: false }; }, destroy() { this.destroys++; } };
      drivers.push(driver); return driver;
    } };
    if (name === "./print-transport.js") return { createPrintTransport() {
      let busy = false, destroyed = 0, sends = 0;
      const transport = {
        async send(bytes) {
          if (busy) throw Object.assign(new Error("busy"), { code: "TRANSPORT_BUSY" });
          busy = true; sends++;
          try { if (blockFirst && sends === 1) await new Promise(resolve => { releaseSend = resolve; }); return { bytesTransferred: bytes.length }; }
          finally { busy = false; }
        },
        cancel() { return false; }, async flush() {}, isBusy: () => busy, destroy() { destroyed++; }, destroyed: () => destroyed
      };
      transports.push(transport); return transport;
    } };
    throw new Error(name);
  };
  const binding = factoryApi.createUsbDeviceBinding(raw);
  return { binding, environment, importer, drivers, transports, release: () => releaseSend && releaseSend() };
}

test("574 commercial and diagnostic leases share one driver and transport", async () => {
  const h = harness("SHARED-574"), commercial = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment }), diagnostic = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment });
  await commercial.runtimeFor(h.binding); await diagnostic.runtimeFor(h.binding);
  assert.equal(h.drivers.length, 1); assert.equal(h.transports.length, 1);
  await diagnostic.destroy(); await commercial.destroy();
});

test("575 diagnostic release leaves commercial runtime alive and usable", async () => {
  const h = harness("SHARED-575"), commercial = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment }), diagnostic = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment });
  const commercialRuntime = await commercial.runtimeFor(h.binding); await diagnostic.runtimeFor(h.binding);
  await diagnostic.destroy();
  assert.equal(h.drivers[0].disconnects, 0); assert.equal(h.drivers[0].destroys, 0); assert.equal(h.transports[0].destroyed(), 0);
  assert.equal((await commercialRuntime.transport.send(new Uint8Array([1]))).bytesTransferred, 1);
  await commercial.destroy();
});

test("576 only final reference performs teardown exactly once", async () => {
  const h = harness("SHARED-576"), commercial = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment }), diagnostic = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment });
  await commercial.runtimeFor(h.binding); await diagnostic.runtimeFor(h.binding);
  await diagnostic.destroy(); await commercial.destroy();
  assert.equal(h.drivers[0].disconnects, 1); assert.equal(h.drivers[0].destroys, 1); assert.equal(h.transports[0].destroyed(), 1);
});

test("577 diagnostic cannot transfer in parallel while shared transport is busy", async () => {
  const h = harness("SHARED-577", true), commercial = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment }), diagnostic = factoryApi.createPrinterRuntimeFactory({ importer: h.importer, environment: h.environment });
  const commercialRuntime = await commercial.runtimeFor(h.binding), diagnosticRuntime = await diagnostic.runtimeFor(h.binding);
  const active = commercialRuntime.transport.send(new Uint8Array([1]));
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(diagnosticRuntime.transport.send(new Uint8Array([2])), error => error.code === "TRANSPORT_BUSY");
  h.release(); await active; await diagnostic.destroy(); await commercial.destroy();
});

test("578 diagnostic uses runtime lease and visible printer UI text is localized", () => {
  const diagnostic = centerSource.slice(centerSource.indexOf("async function testProfile"), centerSource.indexOf("export const PrinterCenter"));
  assert.match(diagnostic, /createPrinterRuntimeFactory/); assert.match(diagnostic, /runtimeFor\(profile\.deviceBinding\)/); assert.match(diagnostic, /runtime\.transport\.send/); assert.match(diagnostic, /runtimeFactory\.destroy/);
  for (const forbidden of ["createUsbPrinterProvider", "provider.connect", "provider.disconnect", "CommercialPrintQueue", "PrinterOrderBridge", "claimStore", "ordersData", "AutoPrintEngine"]) assert.equal(diagnostic.includes(forbidden), false);
  for (const visibleEnglish of ["Printer Profile", "Queue 狀態", "重新開始 Queue", "清空 Queue", "列印佇列（Queue）", "USB Printer", "Coming Soon", "40×30 Label"]) assert.equal(posSource.includes(visibleEnglish), false);
});
