const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let current;
let posSource;
let htmlSource;

function dataUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const [policySource, timeSource, storeSource, qualitySource, coreSource, currentSource] = await Promise.all([
    "statistics-policy.js", "statistics-time.js", "statistics-store.js",
    "statistics-data-quality.js", "statistics-core.js", "statistics-current-reports.js"
  ].map(read));
  const policyUrl = dataUrl(policySource);
  const timeUrl = dataUrl(timeSource);
  const storeUrl = dataUrl(storeSource
    .replace("./statistics-policy.js", policyUrl)
    .replace("./statistics-time.js", timeUrl));
  const qualityUrl = dataUrl(qualitySource);
  const coreUrl = dataUrl(coreSource
    .replace("./statistics-policy.js", policyUrl)
    .replace("./statistics-time.js", timeUrl)
    .replace("./statistics-store.js", storeUrl)
    .replace("./statistics-data-quality.js", qualityUrl));
  current = await import(dataUrl(currentSource
    .replace("./statistics-core.js", coreUrl)
    .replace("./statistics-time.js", timeUrl)
    .replace("./statistics-store.js", storeUrl)
    .replace("./statistics-policy.js", policyUrl)));
  [posSource, htmlSource] = await Promise.all([
    fs.readFile(path.join(root, "pos.js"), "utf8"),
    fs.readFile(path.join(root, "..", "pos.html"), "utf8")
  ]);
});

const NOW = Date.UTC(2026, 7, 18, 4);

function order(extra = {}) {
  return {
    storeId: "defaultStore",
    businessDate: "2026-08-18",
    total: 100,
    paid: true,
    status: "confirmed",
    items: [{ name: "招牌麵", qty: 1 }],
    ...extra
  };
}

test("S3 current day uses Taipei date, Paid Valid Orders, and QR compatibility alias", () => {
  const view = current.buildCurrentStatisticsViewModel([
    order({ total: 100 }),
    order({ storeId: "mainStore", orderSource: "QR", status: "cooking", total: 200 }),
    order({ paid: false, total: 50 }),
    order({ status: "cancelled", total: 30 }),
    order({ isTestOrder: true, total: 999 }),
    order({ businessDate: "2026-08-17", total: 500 }),
    order({ businessDate: "2026-08-19", total: 600 }),
    order({ storeId: "anotherStore", total: 700 })
  ], { period: "day", now: NOW });
  assert.equal(view.ok, true);
  assert.deepEqual(view.range, { startDate: "2026-08-18", endDate: "2026-08-18" });
  assert.deepEqual(view.metrics, {
    salesRevenue: 300,
    paidOrders: 2,
    unpaidOrders: 1,
    outstandingAmount: 50,
    validOrders: 3,
    cancelledOrders: 1,
    cancelledAmount: 30,
    averageTicket: 150
  });
  assert.equal(view.presentation.title, "今日");
  assert.equal(view.presentation.subtitle, "2026/08/18");
});

test("S3 QR mainStore is included only through the explicit current-report alias", () => {
  const fixture = [order({ storeId: "mainStore", orderSource: "QR" })];
  const compatible = current.buildCurrentStatisticsViewModel(fixture, { period: "day", now: NOW });
  const strict = current.buildCurrentStatisticsViewModel(fixture, { period: "day", now: NOW, aliases: {} });
  assert.equal(compatible.metrics.paidOrders, 1);
  assert.equal(strict.metrics.paidOrders, 0);
});

test("S3 week is Monday through Sunday with adjacent dates excluded", () => {
  const view = current.buildCurrentStatisticsViewModel([
    order({ businessDate: "2026-08-16" }),
    order({ businessDate: "2026-08-17" }),
    order({ businessDate: "2026-08-23" }),
    order({ businessDate: "2026-08-24" })
  ], { period: "week", now: NOW });
  assert.deepEqual(view.range, { startDate: "2026-08-17", endDate: "2026-08-23" });
  assert.equal(view.metrics.paidOrders, 2);
  assert.equal(view.presentation.subtitle, "2026/08/17 ～ 2026/08/23");
});

test("S3 month includes first and last day only within the current month", () => {
  const view = current.buildCurrentStatisticsViewModel([
    order({ businessDate: "2026-07-31" }),
    order({ businessDate: "2026-08-01" }),
    order({ businessDate: "2026-08-31" }),
    order({ businessDate: "2026-09-01" })
  ], { period: "month", now: NOW });
  assert.deepEqual(view.range, { startDate: "2026-08-01", endDate: "2026-08-31" });
  assert.equal(view.metrics.paidOrders, 2);
  assert.equal(view.presentation.subtitle, "2026 年 8 月");
});

test("S3 operational status metrics are independent from revenue eligibility", () => {
  const metrics = current.buildOperationalMetrics([
    order({ paid: false, status: "pending" }),
    order({ status: "confirmed" }),
    order({ kitchenStatus: "cooking" }),
    order({ status: "done" }),
    order({ status: "closed" }),
    order({ status: "cancelled" }),
    order({ status: "done", isTestOrder: true })
  ]);
  assert.deepEqual(metrics, { processingOrders: 3, completedOrders: 2 });
});

test("S3 TOP 5 uses only paid valid orders, quantity compatibility, sorting, and limit", () => {
  const products = current.buildTopProducts([
    order({ items: [{ displayName: "A", qty: 2 }, { itemName: "B", quantity: 3 }] }),
    order({ items: [{ name: "A", qty: 4 }, { name: "C" }, { name: "D" }, { name: "E" }, { name: "F" }] }),
    order({ paid: false, items: [{ name: "UNPAID", qty: 99 }] }),
    order({ status: "cancelled", items: [{ name: "CANCELLED", qty: 99 }] }),
    order({ isTestOrder: true, items: [{ name: "TEST", qty: 99 }] }),
    order({ revenueExcluded: true, items: [{ name: "EXCLUDED", qty: 99 }] }),
    order({ items: [{ name: "INVALID", qty: 0 }] })
  ]);
  assert.equal(products.length, 5);
  assert.deepEqual(products[0], { name: "A", quantity: 6 });
  assert.deepEqual(products[1], { name: "B", quantity: 3 });
  assert.equal(products.some(value => ["UNPAID", "CANCELLED", "TEST", "EXCLUDED", "INVALID"].includes(value.name)), false);
});

test("S3 currency formatting is stable and never exposes invalid values", () => {
  assert.equal(current.formatStatisticsCurrency(12350), "NT$ 12,350");
  assert.equal(current.formatStatisticsCurrency(NaN), "NT$ 0");
  assert.equal(current.formatStatisticsCurrency(undefined), "NT$ 0");
});

test("S3 controller preserves selected month across realtime refresh", () => {
  let orders = [order({ businessDate: "2026-08-01", total: 100 })];
  const controller = current.createCurrentReportsController({
    documentRef: null,
    getOrders: () => orders,
    now: () => NOW,
    logger: { warn() {} }
  });
  const selected = controller.setPeriod("month");
  assert.equal(selected.metrics.salesRevenue, 100);
  orders = [...orders, order({ businessDate: "2026-08-02", total: 200 })];
  const refreshed = controller.refresh();
  assert.equal(controller.getSelectedPeriod(), "month");
  assert.equal(refreshed.metrics.salesRevenue, 300);
  assert.deepEqual(refreshed.range, { startDate: "2026-08-01", endDate: "2026-08-31" });
});

function createRenderDocument() {
  const ids = [
    "statisticsV2Error", "statisticsPeriodTitle", "statisticsPeriodRange", "statRevenueLabel",
    "statTotalOrdersLabel", "statTodayRevenue", "statTotalOrders", "statAverageOrder",
    "statPaidOrders", "statUnpaidOrders", "statOutstandingAmount", "statCancelledOrders",
    "statCancelledAmount", "statProcessingOrders", "statDoneOrders", "closingRevenue",
    "closingValidOrders", "closingCancelledOrders", "topItemsList"
  ];
  function element() {
    const value = {
      textContent: "", hidden: false, className: "", children: [],
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    };
    Object.defineProperty(value, "firstChild", { get() { return this.children[0] || null; } });
    return value;
  }
  const elements = new Map(ids.map(id => [id, element()]));
  return {
    elements,
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return element(); }
  };
}

test("S3.1 daily closing preview stays today while month and week reports change", () => {
  let orders = [
    order({ businessDate: "2026-08-18", total: 100 }),
    order({ businessDate: "2026-08-01", total: 900 })
  ];
  const controller = current.createCurrentReportsController({
    documentRef: null,
    getOrders: () => orders,
    now: () => NOW,
    logger: { warn() {} }
  });
  const month = controller.setPeriod("month");
  assert.equal(month.metrics.salesRevenue, 1000);
  assert.deepEqual(month.closingPreview, { salesRevenue: 100, validOrders: 1, cancelledOrders: 0 });

  orders = [...orders, order({ businessDate: "2026-08-18", total: 50 })];
  const refreshed = controller.refresh();
  assert.equal(controller.getSelectedPeriod(), "month");
  assert.equal(refreshed.metrics.salesRevenue, 1050);
  assert.equal(refreshed.closingPreview.salesRevenue, 150);

  const week = controller.setPeriod("week");
  assert.equal(week.metrics.salesRevenue, 150);
  assert.equal(week.closingPreview.salesRevenue, 150);
  const monthAgain = controller.setPeriod("month");
  assert.equal(monthAgain.metrics.salesRevenue, 1050);
  assert.equal(monthAgain.closingPreview.salesRevenue, 150);

  const documentRef = createRenderDocument();
  current.renderCurrentStatistics(documentRef, monthAgain);
  assert.equal(documentRef.elements.get("statTodayRevenue").textContent, "NT$ 1,050");
  assert.equal(documentRef.elements.get("closingRevenue").textContent, "NT$ 150");
});

test("S3 controller isolates report failures from the operational caller", () => {
  const warnings = [];
  const controller = current.createCurrentReportsController({
    documentRef: null,
    getOrders() { throw new Error("fixture failure"); },
    now: () => NOW,
    logger: { warn(...values) { warnings.push(values); } }
  });
  const result = controller.refresh();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CURRENT_REPORT_FAILED");
  assert.equal(warnings.length, 1);
});

test("S3 production bridge keeps the operational listener and delegates legacy renderStats", () => {
  assert.match(posSource, /import\s*\{\s*createCurrentReportsController\s*\}\s*from "\.\/statistics-current-reports\.js"/);
  const listenerStart = posSource.indexOf("onValue(ordersRef");
  const listenerEnd = posSource.indexOf("renderTableButtons", listenerStart);
  const listener = posSource.slice(listenerStart, listenerEnd);
  assert.match(listener, /ordersData = nextOrdersData/);
  assert.match(listener, /renderStats\(\)/);
  assert.doesNotMatch(listener, /statistics-query-firebase/);
  assert.match(posSource, /function renderStats\(\)\s*\{\s*return statisticsCurrentReports\.refresh\(\)/);
  assert.equal((posSource.match(/\.report-range-btn[\s\S]{0,300}addEventListener/g) || []).length, 0);
});

test("S3.1 leaves the closing Firebase write boundary untouched", () => {
  const start = posSource.indexOf("async function closeBusinessDay()");
  const end = posSource.indexOf("async function reopenBusinessDay()", start);
  const closeBlock = posSource.slice(start, end);
  assert.match(closeBlock, /const orders = getTodayOrders\(\)/);
  assert.match(closeBlock, /businessDays\/\$\{STORE_ID\}\/\$\{getTodayKey\(\)\}/);
  assert.match(closeBlock, /qrSessionControlRef/);
  assert.doesNotMatch(closeBlock, /closingPreview|statisticsCurrentReports/);
});

test("S3 HTML exposes every Statistics v2 KPI and period target", () => {
  for (const id of [
    "statisticsPeriodTitle", "statisticsPeriodRange", "statisticsV2Error", "statTodayRevenue",
    "statTotalOrders", "statAverageOrder", "statPaidOrders", "statUnpaidOrders",
    "statOutstandingAmount", "statCancelledOrders", "statCancelledAmount",
    "statProcessingOrders", "statDoneOrders", "topItemsList"
  ]) assert.match(htmlSource, new RegExp(`id="${id}"`), id);
});
