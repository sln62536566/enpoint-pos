const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");

let breakdowns;
let current;

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const [price, policy, time, storeRaw, quality, coreRaw, breakdownRaw, currentRaw] = await Promise.all([
    "order-price-core.js", "statistics-policy.js", "statistics-time.js", "statistics-store.js",
    "statistics-data-quality.js", "statistics-core.js", "statistics-breakdowns.js", "statistics-current-reports.js"
  ].map(read));
  const priceUrl = dataUrl(price), policyUrl = dataUrl(policy), timeUrl = dataUrl(time), qualityUrl = dataUrl(quality);
  const storeUrl = dataUrl(storeRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl));
  const coreUrl = dataUrl(coreRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-data-quality.js", qualityUrl));
  breakdowns = await import(dataUrl(breakdownRaw.replace("./order-price-core.js", priceUrl).replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl)));
  current = await import(dataUrl(currentRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-policy.js", policyUrl)));
  current.configureStatisticsAnalytics({ buildStatisticsBreakdowns: breakdowns.buildStatisticsBreakdowns });
});

const range = { startBusinessDate: "2026-08-01", endBusinessDate: "2026-08-31" };
const order = (extra = {}) => ({
  storeId: "defaultStore", businessDate: "2026-08-18", paid: true,
  total: 100, orderSource: "POS", type: "內用",
  items: [{ productId: "p1", name: "紅茶", price: 100, qty: 1 }], ...extra
});
const build = orders => breakdowns.buildStatisticsBreakdowns(orders, range);

test("S5 Paid Valid qualification and store alias are canonical", () => {
  const result = build([
    order(), order({ paid: false }), order({ status: "cancelled" }),
    order({ isTestOrder: true }), order({ revenueExcluded: true }),
    order({ storeId: "otherStore" }), order({ storeId: "mainStore" })
  ]);
  assert.equal(result.totals.paidOrders, 2);
  assert.equal(result.totals.salesRevenue, 200);
});

test("S5 product identity keeps stable IDs and explicit legacy fallback", () => {
  const result = build([
    order({ items: [{ productId: "same", name: "舊名", price: 30 }] }),
    order({ items: [{ productId: "same", name: "新名", price: 40 }] }),
    order({ items: [{ productId: "different", name: "舊名", price: 20 }] }),
    order({ items: [{ name: " Legacy  Tea ", price: 10 }] }),
    order({ items: [{ name: "legacy tea", price: 10 }] })
  ]);
  const rows = result.productAnalytics.byQuantity;
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.productKey === "productId:same").orderCount, 2);
  assert.ok(rows.some(row => row.productKey === "productId:different"));
  assert.equal(rows.find(row => row.productKey.startsWith("legacy-name:")).orderCount, 2);
});

test("S5 quantity compatibility rejects invalid values without corrupting totals", () => {
  const result = build([order({ items: [
    { itemId: "a", name: "A", price: 10, qty: 2 },
    { itemId: "b", name: "B", price: 10, quantity: 3 },
    { itemId: "c", name: "C", price: 10 },
    { itemId: "d", name: "D", price: 10, qty: 0 },
    { itemId: "e", name: "E", price: 10, qty: -1 },
    { itemId: "f", name: "F", price: 10, qty: "bad" }
  ] })]);
  assert.equal(result.productAnalytics.totalQuantity, 6);
  assert.ok(result.productAnalytics.byQuantity.every(row => Number.isFinite(row.quantity)));
});

test("S5 product revenue reuses pricing core for options, addons, and quantity", () => {
  const result = build([order({ total: 53, items: [
    { productId: "base", name: "Base", price: 10, qty: 2 },
    { productId: "option", name: "Option", basePrice: 10, qty: 2, selectedOptions: [{ price: 3 }] },
    { productId: "addon", name: "Addon", price: 5, addons: [{ price: 2 }] }
  ] })]);
  assert.equal(result.productAnalytics.totalProductRevenue, 53);
  assert.equal(result.productAnalytics.byRevenue[0].revenue, 26);
});

test("S5 source analytics expose unknown, exclude unpaid, and reconcile", () => {
  const result = build([
    order({ total: 100, orderSource: "POS" }),
    order({ total: 200, orderSource: "QR" }),
    order({ total: 50, orderSource: "other" }),
    order({ total: 999, orderSource: "QR", paid: false })
  ]);
  assert.deepEqual(result.sourceAnalytics.map(row => row.salesRevenue), [100, 200, 50]);
  assert.equal(result.totals.salesRevenue, 350);
  assert.deepEqual([result.reconciliation.sourceRevenueDelta, result.reconciliation.sourceOrderDelta], [0, 0]);
  assert.equal(result.sourceAnalytics[1].revenueShare, 200 / 350);
});

test("S5 order types expose unknown and reconcile commercial totals", () => {
  const result = build([
    order({ total: 100, type: "內用" }),
    order({ total: 250, type: "外帶" }),
    order({ total: 50, type: "delivery" })
  ]);
  assert.deepEqual(result.orderTypeAnalytics.map(row => row.salesRevenue), [100, 250, 50]);
  assert.deepEqual([result.reconciliation.typeRevenueDelta, result.reconciliation.typeOrderDelta], [0, 0]);
});

test("S5 business-date range is inclusive and adjacent dates are excluded", () => {
  const result = build([
    order({ businessDate: "2026-07-31" }), order({ businessDate: "2026-08-01" }),
    order({ businessDate: "2026-08-31" }), order({ businessDate: "2026-09-01" }),
    order({ businessDate: undefined, createdAt: Date.parse("2026-08-18T16:30:00Z") })
  ]);
  assert.equal(result.totals.paidOrders, 3);
});

test("S5 current day and direct canonical day produce identical analytics", () => {
  const orders = [order(), order({ orderSource: "QR", type: "外帶", total: 250 })];
  const currentDay = current.buildCurrentStatisticsViewModel(orders, { period: "day", now: Date.parse("2026-08-18T04:00:00Z") });
  const direct = breakdowns.buildStatisticsBreakdowns(orders, { startBusinessDate: "2026-08-18", endBusinessDate: "2026-08-18" });
  assert.deepEqual(currentDay.analytics.productAnalytics, direct.productAnalytics);
  assert.deepEqual(currentDay.analytics.sourceAnalytics, direct.sourceAnalytics);
  assert.deepEqual(currentDay.analytics.orderTypeAnalytics, direct.orderTypeAnalytics);
});

test("S5 current controller retains month while realtime analytics update", () => {
  let orders = [order()];
  const controller = current.createCurrentReportsController({ documentRef: null, getOrders: () => orders, now: () => Date.parse("2026-08-18T04:00:00Z") });
  controller.initialize(); controller.setPeriod("month");
  orders = [...orders, order({ total: 200, orderSource: "QR", type: "外帶", productId: "p2" })];
  const refreshed = controller.refresh();
  assert.equal(controller.getSelectedPeriod(), "month");
  assert.equal(refreshed.analytics.sourceAnalytics.find(row => row.key === "QR").salesRevenue, 200);
  assert.equal(refreshed.analytics.orderTypeAnalytics.find(row => row.key === "外帶").salesRevenue, 200);
  assert.equal(refreshed.closingPreview.salesRevenue, 300);
});

test("S5 production assets, boundaries, and safe renderer are explicit", async () => {
  const root = path.join(__dirname, "..", "public");
  const [html, pos, view, breakdownSource, historical, currentSource] = await Promise.all([
    fs.readFile(path.join(root, "pos.html"), "utf8"), fs.readFile(path.join(root, "js", "pos.js"), "utf8"),
    fs.readFile(path.join(root, "js", "statistics-analytics-view.js"), "utf8"),
    fs.readFile(path.join(root, "js", "statistics-breakdowns.js"), "utf8"),
    fs.readFile(path.join(root, "js", "statistics-historical-reports.js"), "utf8"),
    fs.readFile(path.join(root, "js", "statistics-current-reports.js"), "utf8")
  ]);
  assert.match(html, /pos-v600\.css\?v=statistics-s6/);
  assert.match(html, /pos\.js\?v=statistics-s6/);
  assert.match(pos, /statistics-current-reports\.js\?v=statistics-s6/);
  assert.match(pos, /statistics-historical-reports\.js\?v=statistics-s6/);
  assert.match(pos, /statistics-breakdowns\.js\?v=statistics-s6/);
  assert.match(pos, /statistics-analytics-view\.js\?v=statistics-s6/);
  assert.match(pos, /configureStatisticsAnalytics\(\{ buildStatisticsBreakdowns, renderStatisticsAnalytics \}\)/);
  assert.match(pos, /configureHistoricalStatisticsAnalytics\(\{ buildStatisticsBreakdowns, renderStatisticsAnalytics \}\)/);
  assert.match(view, /textContent/); assert.doesNotMatch(view, /innerHTML/);
  assert.doesNotMatch(breakdownSource, /Firebase|addEventListener|document\./);
  assert.match(historical, /if \(state\.mode === "history"\) result = await renderHistory\(\)/);
  for (const source of [currentSource, historical]) {
    assert.doesNotMatch(source, /await\s+Promise\.all\s*\(\s*\[\s*import\(/);
    assert.doesNotMatch(source, /import\(["']\.\/statistics-(?:breakdowns|analytics-view)\.js/);
  }
  assert.match(historical, /function configureHistoricalStatisticsAnalytics\(options = \{\}\)/);
});
