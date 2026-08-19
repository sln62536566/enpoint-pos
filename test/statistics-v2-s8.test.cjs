const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
let current;
let historical;
let closing;
let breakdowns;
let sources;

test.before(async () => {
  const root = path.join(__dirname, "..", "public");
  const js = path.join(root, "js");
  const read = name => fs.readFile(path.join(js, name), "utf8");
  const [price, policy, time, storeRaw, quality, coreRaw, queryRaw, currentRaw, historicalRaw, closingRaw, breakdownsRaw, pos, html, css, migration] = await Promise.all([
    "order-price-core.js",
    "statistics-policy.js", "statistics-time.js", "statistics-store.js", "statistics-data-quality.js",
    "statistics-core.js", "statistics-query.js", "statistics-current-reports.js", "statistics-historical-reports.js",
    "statistics-closing.js", "statistics-breakdowns.js"
  ].map(read).concat([
    fs.readFile(path.join(js, "pos.js"), "utf8"), fs.readFile(path.join(root, "pos.html"), "utf8"),
    fs.readFile(path.join(root, "css", "pos-v600.css"), "utf8"), read("statistics-migration.js")
  ]));
  const priceUrl = dataUrl(price), policyUrl = dataUrl(policy), timeUrl = dataUrl(time), qualityUrl = dataUrl(quality);
  const storeUrl = dataUrl(storeRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl));
  const coreUrl = dataUrl(coreRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-data-quality.js", qualityUrl));
  const queryUrl = dataUrl(queryRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl));
  const currentUrl = dataUrl(currentRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-policy.js", policyUrl));
  current = await import(currentUrl);
  historical = await import(dataUrl(historicalRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-query.js", queryUrl).replace("./statistics-current-reports.js", currentUrl)));
  closing = await import(dataUrl(closingRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl)));
  breakdowns = await import(dataUrl(breakdownsRaw.replace("./order-price-core.js", priceUrl).replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl)));
  sources = { pos, html, css, migration, current: currentRaw, historical: historicalRaw };
});

const NOW = Date.parse("2026-08-19T04:00:00Z");
const order = (extra = {}) => ({ storeId: "defaultStore", businessDate: "2026-08-19", createdAt: NOW, total: 100, paid: true, status: "confirmed", items: [{ id: "tea", name: "Tea", qty: 1, price: 100 }], ...extra });

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\n  async function ", start + 10);
  const nextPlain = source.indexOf("\n  function ", start + 10);
  const ends = [next, nextPlain].filter(value => value > start);
  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

test("S8 owns exactly one operational orders realtime listener and no Statistics listener", () => {
  assert.equal((sources.pos.match(/onValue\(ordersRef\s*,/g) || []).length, 1);
  assert.doesNotMatch(sources.pos, /onValue\([^\n]*statistics/i);
  assert.match(sources.pos, /processQrPrinterTransitions[\s\S]*processOrderSoundTransitions[\s\S]*ordersData = nextOrdersData[\s\S]*renderStats/);
});

test("S8 historical reports have no realtime listener and remain memory compatibility mode", () => {
  assert.doesNotMatch(sources.historical, /\bonValue\s*\(/);
  assert.match(sources.historical, /createMemoryStatisticsAdapter\(getOrders\(\)\)/);
  assert.doesNotMatch(sources.pos, /createFirebaseStatisticsAdapter/);
});

test("S8 migration utility is absent from normal POS startup", () => {
  assert.doesNotMatch(sources.pos, /statistics-migration/);
  assert.doesNotMatch(sources.html, /statistics-migration/);
});

test("S8 production report modules contain no top-level await or dynamic initialization", () => {
  for (const source of [sources.current, sources.historical]) {
    assert.doesNotMatch(source, /^\s*await\s+/m);
    assert.doesNotMatch(source, /await\s+import\s*\(/);
    assert.doesNotMatch(source, /import\s*\([^)]*statistics-/);
  }
});

test("S8 current controller initialization binds controls only once", () => {
  let bindings = 0;
  const button = { dataset: { range: "day" }, classList: { toggle() {} }, addEventListener() { bindings += 1; } };
  const doc = { querySelectorAll: () => [button], getElementById: () => null };
  const controller = current.createCurrentReportsController({ documentRef: doc, getOrders: () => [], now: () => NOW });
  controller.initialize(); controller.initialize(); controller.initialize();
  assert.equal(bindings, 1);
});

test("S8 historical controller initialization binds controls only once", () => {
  const counts = new Map();
  const element = id => ({ id, hidden: false, value: "", dataset: {}, classList: { remove() {}, toggle() {} }, addEventListener(type) { counts.set(`${id}:${type}`, (counts.get(`${id}:${type}`) || 0) + 1); } });
  const ids = Object.fromEntries(["currentStatsContent", "historicalStatsPanel", "historicalStatsContent", "historicalStatsError", "historicalBreadcrumb", "historicalYearSelect", "historicalMonthSelect", "historicalStartDate", "historicalEndDate", "historicalApplyRange", "historicalBackBtn"].map(id => [id, element(id)]));
  const mode = element("mode"); mode.dataset.historicalMode = "year";
  const doc = { getElementById: id => ids[id] || null, querySelectorAll: selector => selector === ".historical-mode-btn" ? [mode] : [] };
  const controller = historical.createHistoricalReportsController({ documentRef: doc, getOrders: () => [] });
  controller.initialize(); controller.initialize(); controller.initialize();
  for (const count of counts.values()) assert.equal(count, 1);
});

test("S8 hidden historical panel performs zero historical data reads", async () => {
  let reads = 0;
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => { reads += 1; return []; }, now: () => NOW });
  controller.initialize();
  assert.deepEqual(await controller.refresh(), { ok: true, inactive: true });
  assert.equal(reads, 0);
});

test("S8 each selected historical detail dispatches exactly one matching query method", () => {
  const expectations = { renderYear: "getYear", renderMonth: "getMonth", renderDay: "getDay", renderCustom: "getRange" };
  for (const [renderer, method] of Object.entries(expectations)) {
    const body = functionBody(sources.historical, renderer);
    assert.equal((body.match(/await query\(/g) || []).length, 1);
    assert.match(body, new RegExp(`query\\("${method}"`));
  }
});

test("S8 history overview stays compact and does not run S5 detail analytics", () => {
  const body = functionBody(sources.historical, "renderHistory");
  assert.match(body, /buildHistoricalYearSummaries/);
  assert.doesNotMatch(body, /appendAnalytics|buildStatisticsBreakdowns/);
});

test("S8 current and historical day metrics reconcile including S5 analytics", async () => {
  const orders = [order({ total: 100 }), order({ total: 50, paid: false }), order({ total: 20, status: "cancelled" }), order({ total: 999, isTestOrder: true })];
  current.configureStatisticsAnalytics({ buildStatisticsBreakdowns: breakdowns.buildStatisticsBreakdowns });
  const currentDay = current.buildCurrentStatisticsViewModel(orders, { period: "day", now: NOW });
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => orders, now: () => NOW });
  await controller.activate("year");
  const historicalDay = await controller.selectDay("2026-08-19");
  for (const field of ["salesRevenue", "validOrders", "paidOrders", "unpaidOrders", "cancelledOrders", "averageTicket"]) {
    assert.equal(currentDay.metrics[field], historicalDay.metrics[field]);
  }
  const directAnalytics = breakdowns.buildStatisticsBreakdowns(orders, { storeId: "defaultStore", aliases: { mainStore: "defaultStore" }, startBusinessDate: "2026-08-19", endBusinessDate: "2026-08-19" });
  assert.deepEqual(currentDay.analytics.productAnalytics, directAnalytics.productAnalytics);
  assert.deepEqual(currentDay.analytics.sourceAnalytics, directAnalytics.sourceAnalytics);
  assert.deepEqual(currentDay.analytics.orderTypeAnalytics, directAnalytics.orderTypeAnalytics);
});

test("S8 Current Day, closing preview, and S6 closing snapshot reconcile", () => {
  const orders = [order({ total: 125 }), order({ total: 75, paid: false }), order({ total: 40, status: "cancelled" })];
  const day = current.buildCurrentStatisticsViewModel(orders, { period: "day", now: NOW });
  const result = closing.buildClosingSnapshot(orders, { businessDate: "2026-08-19", closedAt: NOW });
  assert.equal(result.ok, true);
  assert.equal(day.closingPreview.salesRevenue, day.metrics.salesRevenue);
  assert.equal(day.closingPreview.validOrders, day.metrics.validOrders);
  assert.equal(day.closingPreview.cancelledOrders, day.metrics.cancelledOrders);
  for (const field of ["salesRevenue", "validOrders", "paidOrders", "unpaidOrders", "cancelledOrders", "averageTicket"]) {
    assert.equal(day.metrics[field], result.snapshot.statistics[field]);
  }
});

test("S8 realtime refresh retains selected current period while history stays inactive", async () => {
  let orders = [order({ total: 100 })];
  const currentController = current.createCurrentReportsController({ documentRef: null, getOrders: () => orders, now: () => NOW });
  const historicalController = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => { throw new Error("hidden history must not execute"); }, now: () => NOW });
  currentController.setPeriod("month");
  orders = [...orders, order({ total: 200, orderSource: "QR" })];
  const refreshed = currentController.refresh();
  assert.equal(currentController.getSelectedPeriod(), "month");
  assert.equal(refreshed.metrics.salesRevenue, 300);
  assert.equal(refreshed.closingPreview.salesRevenue, 300);
  assert.equal(historicalController.isActive(), false);
  assert.deepEqual(await historicalController.refresh(), { ok: true, inactive: true });
});

test("S8 old-iPad Statistics controls use click-only single actions and wrapping layout", () => {
  assert.doesNotMatch(sources.current, /touchend/);
  assert.doesNotMatch(sources.historical, /touchend/);
  assert.match(sources.css, /#statsTab \.statistics-mode-tabs,[\s\S]*#statsTab \.historical-filter-controls[\s\S]*flex-wrap:\s*wrap/);
  assert.match(sources.css, /#statsTab[\s\S]*overflow-x:\s*hidden/);
  assert.match(sources.css, /historical-filter-controls \.settings-input[\s\S]*max-width:\s*100%/);
  assert.match(sources.css, /@media \(max-width: 760px\)[\s\S]*statistics-breakdown-grid[\s\S]*grid-template-columns:\s*1fr/);
});

test("S8 production Statistics cache chain remains consistently statistics-s6", () => {
  const htmlVersions = [...sources.html.matchAll(/(?:pos-v600\.css|pos\.js)\?v=(statistics-s\d+)/g)].map(match => match[1]);
  const moduleVersions = [...sources.pos.matchAll(/statistics-(?:current-reports|historical-reports|breakdowns|analytics-view|closing)\.js\?v=(statistics-s\d+)/g)].map(match => match[1]);
  assert.ok(htmlVersions.length >= 2);
  assert.ok(moduleVersions.length >= 5);
  assert.deepEqual(new Set([...htmlVersions, ...moduleVersions]), new Set(["statistics-s6"]));
});

test("S8 large fixture remains deterministic, compact, range-scoped, and finite", async () => {
  const orders = [];
  for (const year of [2024, 2025, 2026]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 30; day += 1) {
        const businessDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        orders.push(order({ id: `${year}-${month}-${day}`, businessDate, total: day, createdAt: Date.UTC(year, month - 1, day) }));
      }
    }
  }
  const years = historical.buildHistoricalYearSummaries(orders);
  assert.equal(orders.length, 1080);
  assert.equal(years.length, 3);
  assert.deepEqual(years.map(row => row.year), [2026, 2025, 2024]);
  let reads = 0;
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => { reads += 1; return orders; }, now: () => NOW });
  assert.deepEqual(await controller.refresh(), { ok: true, inactive: true });
  assert.equal(reads, 0);
  await controller.activate("year");
  const month = await controller.selectMonth(8);
  assert.equal(month.daily.length, 30);
  assert.equal(month.metrics.validOrders, 30);
  assert.ok(Object.values(month.metrics).every(Number.isFinite));
  const custom = await controller.setCustomRange("2026-08-10", "2026-08-12");
  assert.equal(custom.daily.length, 3);
  assert.equal(custom.metrics.validOrders, 3);
});

test("S8 historical failure is structured and isolated from operational code", async () => {
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => { throw new Error("query failed"); }, logger: { warn() {} }, now: () => NOW });
  const result = await controller.activate("year");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "HISTORICAL_REPORT_FAILED");
});

test("S8 carries the production Firebase businessDate index gate forward", () => {
  assert.match(sources.migration, /PRODUCTION_INDEX_ACTION_REQUIRED/);
  assert.match(sources.migration, /"\.indexOn": \["businessDate"\]/);
});
