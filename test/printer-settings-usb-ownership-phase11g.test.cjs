const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let factoryApi, factorySource, posSource, centerSource;

test.before(async () => {
  [factorySource, posSource, centerSource] = await Promise.all([
    fs.readFile(path.join(root, "printer-runtime-factory.js"), "utf8"),
    fs.readFile(path.join(root, "pos.js"), "utf8"),
    fs.readFile(path.join(root, "printer-center.js"), "utf8")
  ]);
  factoryApi = await import(dataUrl(factorySource));
});

test("579 POS Settings never calls legacy connectUsbPrinter", () => assert.doesNotMatch(posSource, /PrinterCenter\.connectUsbPrinter\s*\(/));
test("580 POS Settings never calls legacy disconnectUsbPrinter", () => assert.doesNotMatch(posSource, /PrinterCenter\.disconnectUsbPrinter\s*\(/));

test("581 permission selection does not open claim release or close USBDevice", async () => {
  const calls = { request: 0, open: 0, claim: 0, release: 0, close: 0 };
  const raw = { vendorId: 1, productId: 2, serialNumber: "PERMISSION-581", productName: "Printer", open: () => calls.open++, claimInterface: () => calls.claim++, releaseInterface: () => calls.release++, close: () => calls.close++ };
  const environment = { navigator: { usb: { async requestDevice() { calls.request++; return raw; } } } };
  const binding = await factoryApi.requestUsbDeviceBinding([], environment);
  assert.equal(binding.serialNumber, "PERMISSION-581"); assert.deepEqual(calls, { request: 1, open: 0, claim: 0, release: 0, close: 0 });
});

test("582 an already-open commercial Printer A cannot block permission for Printer B", async () => {
  const printerA = { vendorId: 1, productId: 2, serialNumber: "A", opened: true };
  const printerB = { vendorId: 3, productId: 4, serialNumber: "B", opened: false };
  let requested = 0;
  const environment = { navigator: { usb: { async requestDevice() { requested++; return printerB; }, async getDevices() { return [printerA]; } } } };
  const binding = await factoryApi.requestUsbDeviceBinding([], environment);
  assert.equal(requested, 1); assert.equal(binding.serialNumber, "B");
});

test("583 permission result reuses the formal createUsbDeviceBinding contract", async () => {
  const raw = { vendorId: 5, productId: 6, serialNumber: "IDENTITY-583", productName: "Printer" };
  const expected = factoryApi.createUsbDeviceBinding(raw);
  const actual = await factoryApi.requestUsbDeviceBinding([], { navigator: { usb: { requestDevice: async () => raw } } });
  assert.deepEqual(actual, expected); assert.equal(Object.isFrozen(actual), true);
});

test("584 Settings permission and detection own no transport or commercial subsystem", () => {
  const start = factorySource.indexOf("export async function listAuthorizedUsbBindings");
  const end = factorySource.indexOf("export async function resolveUsbDeviceBinding", start);
  const value = factorySource.slice(start, end);
  assert.match(value, /usb\.getDevices/); assert.match(value, /usb\.requestDevice/); assert.match(value, /createUsbDeviceBinding/);
  for (const forbidden of ["open(", "claimInterface", "releaseInterface", ".close(", "PrintTransport", "CommercialPrintQueue", "PrinterOrderBridge", "claimStore"]) assert.equal(value.includes(forbidden), false);
});

test("585 diagnostic shared-runtime ownership remains intact", () => {
  const value = centerSource.slice(centerSource.indexOf("async function testProfile"), centerSource.indexOf("export const PrinterCenter"));
  assert.match(value, /createPrinterRuntimeFactory/); assert.match(value, /runtimeFor\(profile\.deviceBinding\)/); assert.match(value, /runtime\.transport\.send/);
  assert.doesNotMatch(value, /createUsbPrinterProvider|provider\.connect|provider\.disconnect/);
});

test("586 empty permission filters normalize to a wildcard filter", async () => {
  const raw = { vendorId: 1, productId: 2, serialNumber: "FILTER-586" };
  let options;
  await factoryApi.requestUsbDeviceBinding([], { navigator: { usb: { requestDevice: async value => { options = value; return raw; } } } });
  assert.deepEqual(options.filters, [{}]);
});

test("587 undefined permission filters normalize to a wildcard filter", async () => {
  const raw = { vendorId: 1, productId: 2, serialNumber: "FILTER-587" };
  let options;
  await factoryApi.requestUsbDeviceBinding(undefined, { navigator: { usb: { requestDevice: async value => { options = value; return raw; } } } });
  assert.deepEqual(options.filters, [{}]);
});

test("588 explicit permission filters are preserved", async () => {
  const raw = { vendorId: 1, productId: 2, serialNumber: "FILTER-588" };
  const filters = [{ vendorId: 1111, productId: 2222 }];
  let options;
  await factoryApi.requestUsbDeviceBinding(filters, { navigator: { usb: { requestDevice: async value => { options = value; return raw; } } } });
  assert.strictEqual(options.filters, filters);
  assert.deepEqual(options.filters, [{ vendorId: 1111, productId: 2222 }]);
});
