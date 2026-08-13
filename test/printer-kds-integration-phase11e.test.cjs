const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let kitchen, kitchenHtml, pos;

test.before(async () => {
  const root = path.join(__dirname, "..", "public");
  [kitchen, kitchenHtml, pos] = await Promise.all([
    fs.readFile(path.join(root, "js", "kitchen.js"), "utf8"),
    fs.readFile(path.join(root, "kitchen.html"), "utf8"),
    fs.readFile(path.join(root, "js", "pos.js"), "utf8")
  ]);
});

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} boundary`);
  return source.slice(start, end);
}

const forbiddenImports = [
  "printer-claim-store", "printer-host-identity", "printer-pos-config", "printer-integration",
  "printer-registry", "printer-router", "commercial-print-queue", "print-pipeline",
  "print-transport", "escpos-formatter", "usb-printer"
];

test("425 KDS has no QR claim ownership", () => {
  for (const value of ["createPrinterClaimStore", ".claim(", "renewLease(", "markPrinting(", "printerClaims"]) assert.equal(kitchen.includes(value), false, value);
});

test("426 KDS imports no Printer Core or USB internals", () => {
  for (const name of forbiddenImports) assert.doesNotMatch(kitchen, new RegExp(`^import[\\s\\S]*?[\"'].*${name}`, "m"), name);
});

test("427 KDS has no eager or lazy printer boundary", () => {
  assert.doesNotMatch(kitchen, /printer-order-bridge|import\s*\(.*printer|PrinterOrderBridge/);
});

test("428 KDS initial snapshot only normalizes filters sorts and renders", () => {
  const listener = between(kitchen, "function loadOrders()", "async function setKitchenStatus");
  assert.match(listener, /onValue\(ordersRef/);
  assert.match(listener, /renderOrders\(orders\)/);
  assert.doesNotMatch(listener, /print|bridge|claim|trigger/i);
});

test("429 KDS reconnect replay has no printer side effect", () => {
  const listener = between(kitchen, "function loadOrders()", "async function setKitchenStatus");
  assert.equal((listener.match(/renderOrders\(orders\)/g) || []).length, 1);
  assert.equal((listener.match(/update\(/g) || []).length, 0);
  assert.equal((listener.match(/import\(/g) || []).length, 0);
});

test("430 cooking transition updates Firebase without printing", () => {
  const cooking = between(kitchen, "async function setKitchenStatus", "async function confirmDoneOrder");
  assert.match(cooking, /await update\(ref\(db, `orders\/\$\{orderId\}`\), updates\)/);
  assert.match(cooking, /if \(status === "cooking"\) updates\.cookingAt = now/);
  assert.doesNotMatch(cooking, /print|bridge|claim|trigger/i);
});

test("431 done transition updates Firebase without printing", () => {
  const done = between(kitchen, "async function confirmDoneOrder", "window.setKitchenStatus");
  assert.match(done, /status: "done"/);
  assert.match(done, /kitchenStatus: "done"/);
  assert.match(done, /await update\(/);
  assert.doesNotMatch(done, /print|bridge|claim|trigger/i);
});

test("432 printer unavailability cannot block KDS business lifecycle", () => {
  const business = between(kitchen, "async function setKitchenStatus", "window.setKitchenStatus");
  assert.doesNotMatch(business, /Printer|printer|import\(/);
  assert.match(business, /await update\(/);
  assert.match(business, /完成訂單失敗/);
});

test("433 KDS UI exposes only cooking and done business actions", () => {
  assert.match(kitchen, /setKitchenStatus\('\$\{order\.id\}', 'cooking'\)/);
  assert.match(kitchen, /confirmDoneOrder\('\$\{order\.id\}'\)/);
  assert.doesNotMatch(kitchen + kitchenHtml, /補印|重印|列印|print-btn|reprint/i);
});

test("434 QR automatic ownership remains exclusively wired in POS", () => {
  assert.match(pos, /processQrPrinterTransitions\(nextOrdersData\)/);
  assert.match(pos, /createPrinterClaimStore/);
  assert.match(pos, /import\("\.\/printer-order-transition\.js"\)/);
  assert.doesNotMatch(kitchen, /processQrPrinterTransitions|createPrinterClaimStore|source: "QR"/);
});
