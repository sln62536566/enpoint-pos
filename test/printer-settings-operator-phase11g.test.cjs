const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let api, operatorSource, posSource, centerSource, bridgeSource;
test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  operatorSource = await fs.readFile(path.join(root, "printer-settings-operator.js"), "utf8");
  posSource = await fs.readFile(path.join(root, "pos.js"), "utf8");
  centerSource = await fs.readFile(path.join(root, "printer-center.js"), "utf8");
  bridgeSource = await fs.readFile(path.join(root, "printer-order-bridge.js"), "utf8");
  api = await import("data:text/javascript;base64," + Buffer.from(operatorSource).toString("base64"));
});

const profile = binding => ({ id: "kitchen", provider: "usb", paperSize: "58", copies: 2, autoPrint: true, enabled: true, deviceBinding: binding });
const durable = { bindingId: "usb:1:2:SER", vendorId: 1, productId: 2, serialNumber: "SER", productName: "Printer A", durable: true };
const session = { bindingId: "usb-session:x:1", vendorId: 1, productId: 2, serialNumber: "", productName: "Printer B", durable: false, sessionId: "x" };

test("541 Kitchen unbound status is explicit", () => assert.equal(api.bindingStatus(profile(null)).label, "未綁定"));
test("542 Customer unbound status uses the same truthful model", () => assert.equal(api.printerBindingSummary({ ...profile(null), id: "customer" }, "客人單印表機").status.state, "unbound"));
test("543 durable binding is reported without fake readiness", () => {
  const value = api.bindingStatus(profile(durable));
  assert.equal(value.label, "已綁定");
  assert.doesNotMatch(value.label, /Ready|已連線/);
});
test("544 no-serial binding is session-only with restart warning", () => {
  const value = api.bindingStatus(profile(session));
  assert.equal(value.label, "僅限本次工作階段");
  assert.match(value.warning, /重新開啟/);
});
test("545 binding summary preserves operator identity and settings", () => {
  const value = api.printerBindingSummary(profile(durable), "廚房印表機");
  assert.deepEqual({ name: value.deviceName, vid: value.vendorId, pid: value.productId, serial: value.serialNumber, copies: value.copies }, { name: "Printer A", vid: "0001", pid: "0002", serial: "SER", copies: "2" });
});
test("546 Kitchen and Customer summaries do not share mutable state", () => {
  const kitchen = api.printerBindingSummary(profile(durable), "廚房印表機");
  const customer = api.printerBindingSummary({ ...profile(session), id: "customer" }, "客人單印表機");
  assert.equal(kitchen.status.state, "bound"); assert.equal(customer.status.state, "session"); assert.ok(Object.isFrozen(kitchen));
});
test("547 binding summary rendering includes session warning", () => {
  const values = {}, container = {
    setAttribute(name, value) { values[name] = value; },
    querySelector(selector) { const key = selector.match(/data-binding-([^\]]+)/)[1]; return { set textContent(value) { values[key] = value; } }; }
  };
  api.renderBindingSummary(container, profile(session), "廚房印表機");
  assert.equal(values["data-binding-state"], "session"); assert.equal(values.status, "僅限本次工作階段"); assert.match(values.warning, /序號/);
});
test("548 save apply invalidates then reloads with success feedback", async () => {
  const calls = [], states = [];
  const result = await api.applyPrinterConfiguration({ invalidateConfiguration: async () => (calls.push("invalidate"), { ok: true }), reloadConfiguration: async () => (calls.push("reload"), { ok: true }) }, value => states.push(value.state));
  assert.deepEqual(calls, ["invalidate", "reload"]); assert.deepEqual(states, ["loading", "success"]); assert.equal(result.ok, true);
});
test("549 reload failure is controlled and does not throw", async () => {
  const old = console.warn; console.warn = () => {};
  const result = await api.applyPrinterConfiguration({ invalidateConfiguration: async () => ({ ok: true }), reloadConfiguration: async () => ({ ok: false, code: "CONFIGURATION_RELOAD_FAILED" }) });
  console.warn = old;
  assert.equal(result.ok, false); assert.equal(result.state, "error"); assert.match(result.message, /設定已儲存/);
});
test("550 missing reload bridge is controlled", async () => { const old = console.warn; console.warn = () => {}; const result = await api.applyPrinterConfiguration({}); console.warn = old; assert.equal(result.code, "CONFIGURATION_RELOAD_FAILED"); });
test("551 representative technical errors map to Chinese operator messages", () => {
  for (const code of ["NOT_SUPPORTED", "PERMISSION_DENIED", "DEVICE_DISCONNECTED", "DEVICE_BUSY", "TRANSFER_TIMEOUT", "BINDING_MISSING", "CONFIGURATION_RELOAD_FAILED"]) {
    const value = api.operatorPrinterError({ code });
    assert.equal(value.code, code); assert.doesNotMatch(value.message, /^[A-Z_]+$/);
  }
});
test("552 unknown diagnostic error uses controlled test failure message", () => assert.match(api.operatorPrinterError({ code: "UNKNOWN" }).message, /測試列印失敗/));
test("553 UI exposes profile-specific unbind and test actions", () => {
  assert.match(posSource, /data-profile-unbind/); assert.match(posSource, /profileName === "Kitchen" \? "廚房印表機" : "客人單印表機"/);
});
test("554 unbind updates only the selected profile and reloads", () => {
  assert.match(posSource, /applySavedPrinterConfiguration\(legacy, profileName, \{ deviceBinding: null \}\)/);
  assert.doesNotMatch(posSource, /deviceBinding: null[\s\S]{0,200}?invalidatePrinterIntegrationConfiguration/);
});
test("555 profile save performs invalidate reload feedback chain", () => {
  assert.match(operatorSource, /invalidateConfiguration[\s\S]*?reloadConfiguration[\s\S]*?設定已套用/);
  assert.match(posSource, /savePrinterProfileAndApply/);
});
test("556 unbind and test use existing single-activation touch pattern", () => {
  assert.match(posSource, /addLegacyTapListener\(unbind/); assert.match(posSource, /addLegacyTapListener\(test/);
});
test("557 diagnostic test explicitly targets Kitchen or Customer profile", () => {
  assert.match(centerSource, /function testProfile\(type\)/); assert.match(centerSource, /type === "kitchen" \? "kitchen" : "customer"/);
  assert.match(posSource, /PrinterCenter\.testPrint\(profileName === "Kitchen" \? "kitchen" : "customer"\)/);
});
test("558 diagnostic test owns no commercial queue order or QR claim", () => {
  const value = centerSource.slice(centerSource.indexOf("async function testProfile"), centerSource.indexOf("export const PrinterCenter"));
  for (const forbidden of ["CommercialPrintQueue", "PrinterOrderBridge", "claimStore", "ordersData", "Firebase", "AutoPrintEngine"]) assert.equal(value.includes(forbidden), false);
});
test("563 diagnostic output consumes target paper and copies without an order", () => {
  const value = centerSource.slice(centerSource.indexOf("async function testProfile"), centerSource.indexOf("export const PrinterCenter"));
  assert.match(value, /profile\.paperSize/); assert.match(value, /profile\.copies/); assert.match(value, /runtime\.transport\.send\(bytes/); assert.doesNotMatch(value, /orderNumber|paymentStatus/);
});
test("559 diagnostic test fails before printing when binding is missing", () => assert.match(centerSource, /!profile\.deviceBinding[\s\S]*?BINDING_MISSING/));
test("560 diagnostic delegates identity and ownership to RuntimeFactory", () => assert.match(centerSource, /runtimeFactory\.runtimeFor\(profile\.deviceBinding\)/));
test("561 Operator helper does not import or recreate sealed Core", () => {
  for (const forbidden of ["physical-transport-router", "printer-runtime-factory", "commercial-print-queue", "print-pipeline", "print-scheduler", "printer-router"]) assert.equal(operatorSource.includes(forbidden), false);
});
test("562 bridge exposes isolated explicit reload wiring", () => {
  assert.match(bridgeSource, /function reloadConfiguration\(\)/); assert.match(bridgeSource, /return Object\.freeze\(\{ handle, canHandleQrAutoPrint, invalidateConfiguration, reloadConfiguration \}\)/);
});
