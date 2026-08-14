const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let factory, operator, centerSource;

test.before(async () => {
  const [factorySource, operatorSource] = await Promise.all([
    fs.readFile(path.join(root, "printer-runtime-factory.js"), "utf8"),
    fs.readFile(path.join(root, "printer-settings-operator.js"), "utf8")
  ]);
  factory = await import(dataUrl(factorySource));
  operator = await import(dataUrl(operatorSource));
  centerSource = await fs.readFile(path.join(root, "printer-center.js"), "utf8");
});

const device = (serial, name = "Same Model") => ({ vendorId: 10, productId: 20, serialNumber: serial, productName: name });
const environment = devices => ({ navigator: { usb: { getDevices: async () => devices } } });

test("564 durable binding resolves only exact VID PID serial", async () => {
  const raw = device("SERIAL-A"), binding = factory.createUsbDeviceBinding(raw);
  assert.equal(await factory.resolveUsbDeviceBinding(binding, environment([raw])), raw);
});

test("565 durable binding rejects wrong serial without fallback", async () => {
  const binding = factory.createUsbDeviceBinding(device("SERIAL-A"));
  await assert.rejects(factory.resolveUsbDeviceBinding(binding, environment([device("SERIAL-B")])), error => error.code === "PHYSICAL_TARGET_UNAVAILABLE");
});

test("566 valid current no-serial session resolves its exact object", async () => {
  const raw = device(""), binding = factory.createUsbDeviceBinding(raw);
  assert.equal(await factory.resolveUsbDeviceBinding(binding, environment([raw])), raw);
});

test("567 expired session binding is controlled", async () => {
  const expired = { bindingId: "usb-session:old:device-1", vendorId: 10, productId: 20, serialNumber: "", productName: "Same Model", durable: false, sessionId: "old" };
  await assert.rejects(factory.resolveUsbDeviceBinding(expired, environment([])), error => error.code === "PHYSICAL_TARGET_UNAVAILABLE");
});

test("568 expired session never revives from one identical physical candidate", async () => {
  const expired = { bindingId: "usb-session:old:device-1", vendorId: 10, productId: 20, serialNumber: "", productName: "Same Model", durable: false, sessionId: "old" };
  await assert.rejects(factory.resolveUsbDeviceBinding(expired, environment([device("")])), error => error.code === "PHYSICAL_TARGET_UNAVAILABLE");
});

test("569 identical no-serial devices never satisfy an expired binding by guessing", async () => {
  const expired = { bindingId: "usb-session:old:device-1", vendorId: 10, productId: 20, serialNumber: "", productName: "Same Model", durable: false, sessionId: "old" };
  await assert.rejects(factory.resolveUsbDeviceBinding(expired, environment([device(""), device("")])), error => error.code === "PHYSICAL_TARGET_UNAVAILABLE");
});

test("570 Kitchen and Customer current-session bindings remain isolated", async () => {
  const kitchen = device(""), customer = device("");
  const kitchenBinding = factory.createUsbDeviceBinding(kitchen), customerBinding = factory.createUsbDeviceBinding(customer);
  assert.equal(await factory.resolveUsbDeviceBinding(kitchenBinding, environment([kitchen, customer])), kitchen);
  assert.equal(await factory.resolveUsbDeviceBinding(customerBinding, environment([kitchen, customer])), customer);
  assert.notEqual(kitchenBinding.bindingId, customerBinding.bindingId);
});

test("571 profile save executes update invalidate reload exactly once in order", async () => {
  const calls = [], profileApi = { update(name, changes) { calls.push("update"); return { name, ...changes }; } };
  const bridge = { invalidateConfiguration: async () => (calls.push("invalidate"), { ok: true }), reloadConfiguration: async () => (calls.push("reload"), { ok: true }) };
  const saved = operator.savePrinterProfileAndApply(profileApi, "Kitchen", { copies: 2 }, bridge);
  await saved.completion;
  assert.deepEqual(calls, ["update", "invalidate", "reload"]);
  assert.equal(calls.filter(value => value === "invalidate").length, 1);
  assert.equal(calls.filter(value => value === "reload").length, 1);
});

test("572 reload failure preserves saved profile and is controlled", async () => {
  let stored = null;
  const profileApi = { update(name, changes) { stored = { name, ...changes }; return stored; } };
  const bridge = { invalidateConfiguration: async () => ({ ok: true }), reloadConfiguration: async () => ({ ok: false, code: "CONFIGURATION_RELOAD_FAILED" }) };
  const old = console.warn; console.warn = () => {};
  const saved = operator.savePrinterProfileAndApply(profileApi, "Customer", { paperSize: "80" }, bridge);
  const result = await saved.completion;
  console.warn = old;
  assert.deepEqual(stored, { name: "Customer", paperSize: "80" });
  assert.equal(result.ok, false); assert.equal(result.code, "CONFIGURATION_RELOAD_FAILED");
});

test("573 diagnostic remains outside commercial order ownership", () => {
  const value = centerSource.slice(centerSource.indexOf("async function testProfile"), centerSource.indexOf("export const PrinterCenter"));
  for (const forbidden of ["CommercialPrintQueue", "PrinterOrderBridge", ".handle(", "claimStore", "ordersData", "AutoPrintEngine", "PrintQueue.enqueue"]) assert.equal(value.includes(forbidden), false);
  assert.match(value, /runtimeFor\(profile\.deviceBinding\)/); assert.match(value, /runtime\.transport\.send/);
});
