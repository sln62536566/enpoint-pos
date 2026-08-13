const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..", "public", "js");
const read = name => fs.readFile(path.join(root, name), "utf8");
const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let pos, integrationSource, configSource, adapter, layout, model;

test.before(async () => {
  const [triggerSource, adapterRaw, modelSource, layoutRaw] = await Promise.all([
    read("print-trigger.js"), read("printer-event-adapter.js"), read("receipt-model.js"), read("receipt-layout.js")
  ]);
  pos = await read("pos.js");
  integrationSource = await read("printer-integration.js");
  configSource = await read("printer-pos-config.js");
  adapter = await import(dataUrl(adapterRaw.replace("./print-trigger.js", dataUrl(triggerSource))));
  model = await import(dataUrl(modelSource));
  layout = await import(dataUrl(layoutRaw.replace("./receipt-model.js", dataUrl(modelSource))));
});

function between(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} boundary`);
  return source.slice(first, last);
}

function lines(receipt) { return receipt.nodes.filter(node => node.type === "line").map(node => node.value).join("\n"); }

test("435 manual Kitchen entry uses the printer bridge", () => assert.match(between(pos, "function triggerManualOrderPrint", "function executeManualOrderPrint"), /PrinterOrderBridge\.handle\(printerEvent\)/));
test("436 manual trigger uses ManualReprint", () => assert.match(pos, /eventType: "ManualReprint"/));
test("437 manual event identity is unique per action", () => { assert.match(pos, /crypto\.randomUUID/); assert.match(pos, /manualPrintSequence \+= 1/); });
test("438 manual event includes explicit identity contract", () => { const value = between(pos, "function triggerManualOrderPrint", "function executeManualOrderPrint"); for (const field of ["eventId:", "order:", "orderId:", "orderNumber:", "source:", "ticketType:", "routeGroup:", "policy:", "businessEventVersion:", "metadata:"]) assert.match(value, new RegExp(field)); });
test("439 manual metadata is explicit", () => { for (const field of ["manual: true", "reprint: true", "requestedBy: \"POS\"", "requestedAt:", "originalOrderSource:"]) assert.ok(pos.includes(field), field); });
test("440 manual Kitchen route is Kitchen", () => assert.match(pos, /ticketType === "customer" \? "Customer" : "Kitchen"/));
test("441 manual Customer route is Customer", () => assert.match(pos, /printerCapability: "manual-" \+ routeGroup\.toLowerCase\(\)/));
test("442 printOrderTicket no longer directly invokes PrinterCenter", () => assert.doesNotMatch(between(pos, "function printOrderTicket", "window.printOrderTicket"), /PrinterCenter/));
test("443 USB manual path does not load legacy modules", () => { const value = between(pos, "function executeManualOrderPrint", "function reprintLastManualOrder"); assert.match(value, /profile\.provider === "browser"[\s\S]*?loadLegacyPrinterModules/); assert.doesNotMatch(value.slice(value.indexOf('profile.provider !== "usb"')), /loadLegacyPrinterModules/); });
test("444 Browser manual fallback remains PrinterCenter", () => assert.match(pos, /legacy\.PrinterCenter\.printCustomer\(order\)[\s\S]*?legacy\.PrinterCenter\.printKitchen\(order\)/));
test("445 disabled profile is controlled", () => assert.match(pos, /code: "PROFILE_DISABLED"/));
test("446 manual print ignores autoPrint", () => assert.doesNotMatch(between(pos, "function executeManualOrderPrint", "function reprintLastManualOrder"), /autoPrint/));
test("447 unsupported manual provider is controlled", () => assert.match(pos, /code: "PROVIDER_UNSUPPORTED"/));
test("448 manual failure is isolated to result handling", () => assert.match(pos, /code: error && error\.code \|\| "MANUAL_PRINT_FAILED"/));
test("449 manual path does not write order state", () => assert.doesNotMatch(between(pos, "function createManualPrintEventId", "function loadQrPrinterOwnership"), /\b(set|update)\s*\(\s*ref\(/));
test("450 manual event has no QR claim marker", () => assert.doesNotMatch(between(pos, "function triggerManualOrderPrint", "function executeManualOrderPrint"), /crossDeviceClaimed|printerClaims|claim/));
test("451 existing one-second double tap protection remains", () => assert.match(between(pos, "function printOrderTicket", "window.printOrderTicket"), /nowTime - lastPrintOrderAt < 1000/));
test("452 reprint-last has explicit manual history", () => { assert.match(pos, /lastManualPrintRequest/); assert.match(pos, /code: "NO_MANUAL_PRINT_HISTORY"/); });
test("453 settings retain PrinterCenter ownership", () => assert.match(between(pos, "function bindLoadedPrinterCenterControls", "function bindPrinterProfileCard"), /PrinterCenter\.testPrint|PrinterCenter\.detectPrinter/));
test("454 legacy queue remains settings-only", () => { const manual = between(pos, "function createManualPrintEventId", "function loadQrPrinterOwnership"); assert.doesNotMatch(manual, /PrintQueue/); assert.match(pos, /bindLoadedPrinterCenterControls\(legacy\)[\s\S]*?var PrintQueue = legacy\.PrintQueue/); });
test("455 integration registers manual policy", () => assert.match(integrationSource, /"manual-print": manualPolicy/));
test("456 manual policy requires explicit manual reprint", () => assert.match(integrationSource, /trigger\.type !== "ManualReprint" \|\| metadata\.manual !== true/));
test("457 manual policy reads Customer independently", () => assert.match(integrationSource, /configuration\.profiles\[group\]/));
test("458 manual policy uses profile copies and paper", () => { assert.match(integrationSource, /copies: profile\.copies/); assert.match(integrationSource, /paper: profile\.paperSize/); });
test("459 Customer capability requires receipt and ESC POS", () => assert.match(integrationSource, /requiredCapabilities: \["supportsEscPos", "supportsReceipt"/));
test("460 manual and auto share one commercial queue", () => { assert.equal((integrationSource.match(/createCommercialPrintQueue\(/g) || []).length, 1); assert.match(integrationSource, /createAutoPrintEngine\(\{ policies, capabilities, scheduler \}\)/); });
test("461 runtime config maps both profiles", () => { assert.match(configSource, /getKitchen\(\).*getCustomer\(\)/s); assert.match(configSource, /printers: Object\.freeze\(printers\)/); });
test("462 runtime config enables manual USB without autoPrint", () => { const value = between(configSource, "export async function loadPrinterRuntimeConfiguration", "  return Object.freeze"); assert.match(value, /profiles\[key\]\.enabled === true && profiles\[key\]\.provider === "usb"/); assert.doesNotMatch(value.slice(0, value.indexOf("const kitchen")), /autoPrint/); });
test("463 existing auto eligibility still requires autoPrint", () => { assert.match(configSource, /kitchen\.autoPrint === true/); assert.match(configSource, /autoEnabled/); });
test("464 Kitchen fidelity survives manual adapter", () => { const trigger = adapter.adaptPrinterEvent({ eventType: "ManualReprint", eventId: "manual:o:k:1", orderId: "o", order: { id: "o", items: [{ itemName: "Tea", qty: 1, customOptions: [{ groupId: "size", groupName: "Size", name: "Large", modules: { print: true } }], note: "hot" }], note: "rush", paymentStatus: "unpaid", isTestOrder: true }, source: "POS", ticketType: "kitchen", routeGroup: "Kitchen", policy: "manual-print", metadata: { manual: true, reprint: true } }); const value = lines(layout.buildKitchenReceiptLayout(trigger.payload.order)); for (const expected of ["Tea", "Large", "hot", "rush"]) assert.match(value, new RegExp(expected)); assert.equal(trigger.metadata.crossDeviceClaimed, false); });
test("465 Customer receipt content has manual fidelity", () => { const value = lines(layout.buildCustomerReceiptLayout({ store: "Shop", orderNumber: "C1", orderType: "Takeout", table: "2", paymentStatus: "paid", items: [{ name: "Tea", quantity: 2, unitPrice: 10, details: ["Large"], note: "warm" }], subtotal: 20, total: 20, orderNote: "call", orderLookupUrl: "https://shop/order/C1" })); for (const expected of ["Shop", "C1", "Takeout", "Table: 2", "Payment: paid", "Tea x2 20", "Large", "warm", "Total: 20", "call", "https://shop/order/C1"]) assert.match(value, new RegExp(expected)); });
test("466 Customer lookup uses URL fallback while Browser QR remains", () => { assert.match(pos, /orderLookupUrl: getCustomerOrderUrl\(order\)/); assert.match(pos, /getQrCodeUrl\(order\)/); assert.doesNotMatch(integrationSource, /printer-claim-store|printer-host-identity/); });
