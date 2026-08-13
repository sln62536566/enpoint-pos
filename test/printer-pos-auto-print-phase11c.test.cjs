const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let pos, integration, adapter, config, loadPosPrinterConfiguration;
test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  [pos, integration, adapter, config] = await Promise.all(["pos.js", "printer-integration.js", "printer-event-adapter.js", "printer-pos-config.js"].map(name => fs.readFile(path.join(root, name), "utf8")));
  loadPosPrinterConfiguration = (await import("data:text/javascript;base64," + Buffer.from(config).toString("base64"))).loadPosPrinterConfiguration;
});

function between(source, startText, endText) { const start = source.indexOf(startText), end = source.indexOf(endText, start); assert.ok(start >= 0 && end > start); return source.slice(start, end); }

test("287 POS trigger is after awaited Firebase set", () => { const submit = between(pos, "async function submitOrderCore", "/* =========================", pos.indexOf("async function submitOrderCore")); assert.ok(submit.indexOf("await set(newOrderRef, order)") < submit.indexOf("void triggerPosOrderPrint(order)")); });
test("288 POS printer trigger is fire and forget", () => assert.match(pos, /await set\(newOrderRef, order\);[\s\S]*?void triggerPosOrderPrint\(order\);/));
test("289 Firebase rejection cannot reach printer trigger", () => { const submit = between(pos, "async function submitOrderCore", "/* =========================", pos.indexOf("async function submitOrderCore")); const write = submit.indexOf("await set(newOrderRef, order)"), trigger = submit.indexOf("triggerPosOrderPrint(order)"); assert.ok(write >= 0 && trigger > write); assert.equal(submit.slice(0, write).includes("triggerPosOrderPrint"), false); });
test("290 printer bridge is dynamically imported", () => { assert.match(pos, /import\("\.\/printer-order-bridge\.js"\)/); assert.doesNotMatch(pos, /^import .*printer-order-bridge/m); });
test("291 dynamic import failure is isolated", () => assert.match(between(pos, "function triggerPosOrderPrint", "/* ========================="), /\.catch\(function\(error\)/));
test("292 bridge result does not enter submit catch", () => assert.doesNotMatch(pos, /await PrinterOrderBridge|await triggerPosOrderPrint/));
test("293 print feature enabled permits trigger", () => assert.match(pos, /function isPrintingEnabled\(\)[\s\S]*?\.print !== false/));
test("294 print feature disabled returns controlled skip", () => assert.match(pos, /if \(!isPrintingEnabled\(\)\) return Promise\.resolve\(\{ ok: true, status: "skipped", code: "PRINT_MODULE_DISABLED" \}\)/));
test("295 POS event uses existing OrderCreated type", () => assert.match(pos, /eventType: "OrderCreated"/));
test("296 POS event carries required identity fields", () => { const trigger = between(pos, "function triggerPosOrderPrint", "/* ========================="); for (const field of ["order:", "orderId:", "orderNumber:", "source:", "storeId:", "businessEventVersion:", "ticketType:", "routeGroup:", "metadata:"]) assert.ok(trigger.includes(field), field); });
test("297 POS event selects POS-only policy", () => assert.match(pos, /policy: "pos-order-created"/));
test("298 paid and unpaid status is preserved in metadata", () => assert.match(pos, /paymentStatus: order\.paymentStatus/));
test("299 test order is explicitly marked", () => { assert.match(pos, /isTestOrder: order\.isTestOrder === true/); assert.match(pos, /test: order\.isTestOrder === true/); });
test("300 event identity remains deterministic", () => assert.match(adapter, /storeId[\s\S]*?orderId[\s\S]*?type[\s\S]*?version[\s\S]*?ticketType[\s\S]*?routeGroup/));
test("301 adapter keeps defensive immutable order", () => { assert.match(adapter, /const order = .*normalizePrinterOrder\(input\.order\)/); assert.match(adapter, /function normalizePrinterOrder[\s\S]*?clone\(input \|\| \{\}\)/); assert.match(adapter, /createPrintTrigger/); });
test("302 orders listener never triggers printing", () => { const listener = between(pos, "onValue(ordersRef", "renderTableButtons"); assert.equal(listener.includes("triggerPosOrderPrint"), false); });
test("303 successful direct submit has exactly one trigger call", () => { const submit = between(pos, "async function submitOrderCore", "/* =========================", pos.indexOf("async function submitOrderCore")); assert.equal((submit.match(/triggerPosOrderPrint\(order\)/g) || []).length, 1); });
test("304 printer failures log without alert", () => { const trigger = between(pos, "function triggerPosOrderPrint", "/* ========================="); assert.match(trigger, /console\.warn/); assert.equal(trigger.includes("alert("), false); });
test("305 logs include order and result diagnostics", () => { const trigger = between(pos, "function triggerPosOrderPrint", "/* ========================="); for (const value of ["orderId", "orderNumber", "code", "status"]) assert.ok(trigger.includes(value)); });
test("306 integration retains the exact POS OrderCreated policy branch", () => assert.match(integration, /isPos = trigger\.type === "OrderCreated" && String\(trigger\.source\)\.toUpperCase\(\) === "POS"/));
test("307 POS policy creates kitchen ticket outside business layer", () => { assert.match(integration, /tickets: \[\{ type: "kitchen"/); const trigger = between(pos, "function triggerPosOrderPrint", "/* ========================="); assert.equal(trigger.includes("printKitchen"), false); });
test("308 browser auto print is controlled unsupported", () => assert.match(config, /profile\.provider === "browser"[\s\S]*?BROWSER_REQUIRES_USER_ACTION/));
test("309 only ready USB configuration creates route", () => { assert.match(config, /profile\.provider !== "usb"/); assert.match(config, /!status\.connected \|\| !status\.capability/); assert.match(config, /id: "pos-kitchen-usb"/); });
test("310 no printer configuration remains controlled", () => assert.match(config, /NO_PRINTER_CONFIGURED/));
test("311 route failure remains engine controlled result", () => assert.match(integration, /const handled = await components\.engine\.handle\(trigger\)[\s\S]*?return result/));
test("312 queue and pipeline remain commercial Core composition", () => { assert.match(integration, /createCommercialPrintQueue/); assert.match(integration, /createPrintPipeline/); });
test("313 manual printing remains lazy legacy path", () => assert.match(pos, /function printOrderTicket[\s\S]*?loadLegacyPrinterModules\(\)[\s\S]*?legacy\.PrinterCenter/));
test("314 printer settings remain lazy legacy path", () => assert.match(pos, /function bindPrinterCenterControls\(\)[\s\S]*?loadLegacyPrinterModules\(\)/));
test("315 POS has no static printer imports", () => { for (const name of ["printer-center", "printer-profile", "print-queue", "printer-order-bridge"]) assert.doesNotMatch(pos, new RegExp(`^import .*${name}`, "m")); });
test("316 QR KDS and claims are absent from POS trigger", () => { const trigger = between(pos, "function triggerPosOrderPrint", "/* ========================="); for (const value of ["printClaims", "transaction(", "onChildAdded", "source: \"QR\""]) assert.equal(trigger.includes(value), false); });
test("317 adapter maps POS aliases into receipt model fields", () => { assert.match(adapter, /order\.storeName/); assert.match(adapter, /item\.quantity \|\| item\.qty/); assert.match(adapter, /item\.unitPrice \|\| item\.price/); });
test("318 disabled auto-print profile is controlled skip", async () => { const value = await loadPosPrinterConfiguration(async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => ({ enabled: true, autoPrint: false, provider: "usb" }) } } : null); assert.equal(value.code, "AUTO_PRINT_DISABLED"); });
test("319 browser profile never opens unattended popup", async () => { const value = await loadPosPrinterConfiguration(async () => ({ PrinterProfile: { getKitchen: () => ({ enabled: true, autoPrint: true, provider: "browser" }) } })); assert.equal(value.code, "BROWSER_REQUIRES_USER_ACTION"); assert.equal(value.enabled, false); });
test("320 unsupported WebUSB is controlled", async () => { const profile = { enabled: true, autoPrint: true, provider: "usb" }; const driver = { detect: async () => {}, getStatus: () => ({ status: "unsupported", selectedDevice: null }) }; const value = await loadPosPrinterConfiguration(async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => profile } } : { initializeUsbProvider: async () => driver }); assert.equal(value.code, "WEBUSB_UNSUPPORTED"); });
test("321 no authorized printer is controlled", async () => { const profile = { enabled: true, autoPrint: true, provider: "usb" }; const driver = { detect: async () => {}, getStatus: () => ({ status: "no_device", selectedDevice: null }) }; const value = await loadPosPrinterConfiguration(async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => profile } } : { initializeUsbProvider: async () => driver }); assert.equal(value.code, "NO_PRINTER_CONFIGURED"); });
test("322 ready USB profile creates Kitchen registry contract", async () => { let connected = false; const profile = { enabled: true, autoPrint: true, provider: "usb", id: "kitchen", name: "Kitchen", paperSize: "80", copies: 2 }; const driver = { detect: async () => {}, connect: async () => { connected = true; }, getStatus: () => connected ? ({ connected: true, selectedDevice: {}, capability: {} }) : ({ connected: false, selectedDevice: {}, capability: null }) }; const value = await loadPosPrinterConfiguration(async name => name.includes("profile") ? { PrinterProfile: { getKitchen: () => profile } } : { initializeUsbProvider: async () => driver }); assert.equal(value.enabled, true); assert.equal(value.driver, driver); assert.equal(value.printer.group, "Kitchen"); assert.equal(value.printer.capability.supportsPaper80, true); });
test("323 integration observes queue completion failures", () => { assert.match(integration, /handled\.completion \? await handled\.completion/); assert.match(integration, /completed\.result\.failed/); });
