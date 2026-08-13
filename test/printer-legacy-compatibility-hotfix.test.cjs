const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

const posPath = path.join(__dirname, "..", "public", "js", "pos.js");
let posSource;

test.before(async () => { posSource = await fs.readFile(posPath, "utf8"); });

function loadProfileHelpers(document) {
  const start = posSource.indexOf("function renderPrintQueueStatus");
  const end = posSource.indexOf("function showPrinterError", start);
  assert.ok(start >= 0 && end > start);
  const context = { document };
  vm.createContext(context);
  vm.runInContext(posSource.slice(start, end), context);
  return context;
}

function profileCard(name = "Kitchen") {
  const status = { innerHTML: "" };
  return {
    name,
    status,
    getAttribute(attribute) { return attribute === "data-printer-profile" ? name : null; },
    querySelector(selector) { return selector === "[data-profile-status]" ? status : null; },
    querySelectorAll() { return []; }
  };
}

test("281 POS keeps legacy printer modules lazy and has no static printer import", () => {
  for (const name of ["printer-center", "printer-profile", "print-queue"]) assert.equal(new RegExp(`^import .*${name}\\.js`, "m").test(posSource), false);
  assert.match(posSource, /loadLegacyPrinterModules\(\)\.then\(function\(legacy\)/);
});

test("282 profile status reads queue through explicit legacy dependency", () => {
  const card = profileCard(), legacy = { PrintQueue: { getCurrent: () => null } };
  const helpers = loadProfileHelpers({ querySelectorAll: () => [] });
  assert.doesNotThrow(() => helpers.renderPrinterProfileStatus(card, { id: "kitchen", provider: "browser", paperSize: "58", copies: 1, autoPrint: true }, legacy));
  assert.match(card.status.innerHTML, /Queue/);
});

test("283 profile update forwards legacy dependency without global PrintQueue", () => {
  const card = profileCard(), queue = { getCurrent: () => ({ profile: { id: "kitchen" } }) }, legacy = { PrintQueue: queue };
  const helpers = loadProfileHelpers({ querySelectorAll: () => [] });
  assert.doesNotThrow(() => helpers.updatePrinterProfileCard(card, { id: "kitchen", provider: "usb", paperSize: "80", copies: 2, autoPrint: false }, legacy));
  assert.match(card.status.innerHTML, /Queue/);
});

test("284 queue status forwards legacy to every profile status render", () => {
  const kitchen = profileCard("Kitchen"), customer = profileCard("Customer");
  const elements = { printQueueCurrent: { textContent: "" }, printQueuePending: { textContent: "" }, printQueueStatus: { textContent: "" }, printQueueState: { textContent: "" } };
  const document = { querySelectorAll: () => [kitchen, customer], getElementById: id => elements[id] || null };
  const profiles = { Kitchen: { id: "kitchen", provider: "browser", paperSize: "58", copies: 1, autoPrint: true }, Customer: { id: "customer", provider: "browser", paperSize: "58", copies: 1, autoPrint: false } };
  const legacy = { PrinterProfile: { get: name => profiles[name] }, PrintQueue: { getCurrent: () => ({ profile: { id: "kitchen" } }) } };
  const helpers = loadProfileHelpers(document);
  assert.doesNotThrow(() => helpers.renderPrintQueueStatus({ current: null, pending: 0, busy: false, paused: false }, legacy));
  assert.match(kitchen.status.innerHTML, /Queue/); assert.match(customer.status.innerHTML, /Queue/);
});

test("285 manual print remains on lazy legacy PrinterCenter path", () => {
  assert.match(posSource, /function printOrderTicket[\s\S]*?loadLegacyPrinterModules\(\)\.then\(function\(legacy\)[\s\S]*?legacy\.PrinterCenter\.printCustomer[\s\S]*?legacy\.PrinterCenter\.printKitchen/);
  assert.equal(posSource.includes("PrinterOrderBridge.handle"), false);
});

test("286 all legacy printer identifiers are scoped or explicitly qualified", () => {
  assert.equal(posSource.includes("var current = PrintQueue.getCurrent();"), false);
  assert.match(posSource, /function renderPrinterProfileStatus\(card, profile, legacy\)[\s\S]*?legacy\.PrintQueue\.getCurrent\(\)/);
});
