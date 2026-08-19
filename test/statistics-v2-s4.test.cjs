const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let historical;
let posSource;
let htmlSource;
let cssSource;

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const [policy, time, storeRaw, quality, coreRaw, queryRaw, currentRaw, historicalRaw] = await Promise.all([
    "statistics-policy.js", "statistics-time.js", "statistics-store.js", "statistics-data-quality.js",
    "statistics-core.js", "statistics-query.js", "statistics-current-reports.js", "statistics-historical-reports.js"
  ].map(read));
  const policyUrl = dataUrl(policy);
  const timeUrl = dataUrl(time);
  const qualityUrl = dataUrl(quality);
  const storeUrl = dataUrl(storeRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl));
  const coreUrl = dataUrl(coreRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-data-quality.js", qualityUrl));
  const queryUrl = dataUrl(queryRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl));
  const currentUrl = dataUrl(currentRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-policy.js", policyUrl));
  historical = await import(dataUrl(historicalRaw
    .replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl)
    .replace("./statistics-store.js", storeUrl).replace("./statistics-query.js", queryUrl)
    .replace("./statistics-current-reports.js", currentUrl)));
  [posSource, htmlSource, cssSource] = await Promise.all([
    fs.readFile(path.join(root, "pos.js"), "utf8"),
    fs.readFile(path.join(root, "..", "pos.html"), "utf8"),
    fs.readFile(path.join(root, "..", "css", "pos-v600.css"), "utf8")
  ]);
});

function order(extra = {}) {
  return { storeId: "defaultStore", businessDate: "2026-01-01", total: 100, paid: true, status: "confirmed", ...extra };
}

test("S4 available years use one canonical pass, explicit alias, and descending order", () => {
  const years = historical.collectAvailableHistoricalYears([
    order({ businessDate: "2024-01-01", paid: false }),
    order({ storeId: "mainStore", businessDate: "2026-12-31" }),
    order({ businessDate: "2025-06-01", status: "cancelled" }),
    order({ storeId: "otherStore", businessDate: "2027-01-01" }),
    order({ storeId: "", businessDate: "2028-01-01" }),
    order({ businessDate: "bad" })
  ]);
  assert.deepEqual(years, [2026, 2025, 2024]);
});

test("S4 year aggregation always returns 12 months and reconciles with year metrics", async () => {
  const orders = [
    order({ businessDate: "2025-12-31", total: 999 }),
    order({ businessDate: "2026-01-01", total: 100 }),
    order({ storeId: "mainStore", businessDate: "2026-02-28", total: 200 }),
    order({ businessDate: "2026-12-31", total: 300 }),
    order({ businessDate: "2027-01-01", total: 888 })
  ];
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => orders, now: () => Date.UTC(2026, 7, 18) });
  controller.initialize();
  await controller.activate("year");
  const report = await controller.selectYear(2026);
  const months = historical.aggregateYearMonths(report, 2026);
  assert.equal(months.length, 12);
  assert.equal(months[0].metrics.salesRevenue, 100);
  assert.equal(months[1].metrics.salesRevenue, 200);
  assert.equal(months[5].metrics.salesRevenue, 0);
  assert.equal(months[11].metrics.salesRevenue, 300);
  assert.equal(months.reduce((sum, month) => sum + month.metrics.salesRevenue, 0), report.metrics.salesRevenue);
});

test("S4 year to month to day drill-down keeps selection across realtime refresh", async () => {
  let orders = [order({ businessDate: "2025-03-04", total: 120 })];
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => orders, now: () => Date.UTC(2026, 7, 18) });
  await controller.activate("year");
  await controller.selectYear(2025);
  const month = await controller.selectMonth(3);
  assert.equal(month.metrics.salesRevenue, 120);
  const day = await controller.selectDay("2025-03-04");
  assert.equal(day.metrics.salesRevenue, 120);
  orders = [...orders, order({ businessDate: "2025-03-04", total: 80 })];
  const refreshed = await controller.refresh();
  assert.equal(refreshed.metrics.salesRevenue, 200);
  assert.deepEqual(controller.getState(), { mode: "year", selectedYear: 2025, selectedMonth: 3, selectedDay: "2025-03-04", customStart: "", customEnd: "" });
});

test("S4 day rows are canonical, date-scoped, newest first, and read-only presentation data", () => {
  const rows = historical.buildDayOrderRows([
    order({ id: "old", createdAt: 100, orderNumber: "1", orderSource: "POS", type: "內用", table: "A1" }),
    order({ id: "new", storeId: "mainStore", createdAt: 200, orderNumber: "2", orderSource: "QR", paid: false, status: "cooking" }),
    order({ id: "wrong-date", businessDate: "2026-01-02", createdAt: 300 }),
    order({ id: "wrong-store", storeId: "otherStore", createdAt: 400 }),
    order({ id: "unresolved", businessDate: "bad", createdAt: 500 })
  ], "2026-01-01");
  assert.deepEqual(rows.map(row => row.id), ["new", "old"]);
  assert.equal(rows[0].source, "QR");
  assert.equal(rows[0].payment, "未付款");
  assert.equal(Object.hasOwn(rows[0], "order"), false);
});

test("S4 custom range is inclusive, leap-safe, and capped at 366 days", () => {
  assert.deepEqual(historical.validateCustomRange("2024-02-29", "2024-02-29"), { ok: true, days: 1 });
  assert.deepEqual(historical.validateCustomRange("2024-02-28", "2024-03-01"), { ok: true, days: 3 });
  assert.deepEqual(historical.validateCustomRange("2025-12-31", "2026-01-01"), { ok: true, days: 2 });
  assert.equal(historical.validateCustomRange("2024-01-01", "2024-12-31").days, 366);
  assert.equal(historical.validateCustomRange("2024-01-01", "2025-01-01").errorCode, "RANGE_TOO_LARGE");
  assert.equal(historical.validateCustomRange("2026-02-01", "2026-01-01").errorCode, "INVALID_RANGE");
});

test("S4 controller initialization binds each historical listener once", () => {
  const counts = new Map();
  const element = id => ({ id, hidden: false, value: "", dataset: {}, classList: { toggle() {} }, addEventListener(type) { counts.set(`${id}:${type}`, (counts.get(`${id}:${type}`) || 0) + 1); } });
  const ids = Object.fromEntries(["currentStatsContent", "historicalStatsPanel", "historicalStatsContent", "historicalStatsError", "historicalBreadcrumb", "historicalYearSelect", "historicalMonthSelect", "historicalStartDate", "historicalEndDate", "historicalApplyRange", "historicalBackBtn"].map(id => [id, element(id)]));
  const mode = element("mode"); mode.dataset.historicalMode = "year";
  const doc = { getElementById: id => ids[id] || null, querySelectorAll: () => [mode] };
  const controller = historical.createHistoricalReportsController({ documentRef: doc, getOrders: () => [] });
  controller.initialize(); controller.initialize(); controller.initialize();
  for (const count of counts.values()) assert.equal(count, 1);
});

test("S4 production wiring uses ordersData memory reports and hides daily closing with current content", () => {
  assert.match(posSource, /createHistoricalReportsController/);
  assert.match(posSource, /getOrders:\s*\(\) => ordersData/);
  assert.match(posSource, /statisticsHistoricalReports\.isActive\(\)/);
  assert.doesNotMatch(posSource, /createFirebaseStatisticsAdapter/);
  assert.match(htmlSource, /id="currentStatsContent"[\s\S]*id="closeBusinessDayBtn"/);
  for (const id of ["historicalStatsPanel", "historicalYearSelect", "historicalMonthSelect", "historicalStartDate", "historicalEndDate", "historicalStatsContent"]) assert.match(htmlSource, new RegExp(`id="${id}"`));
});

test("S4.1 direct month selection leaves History and Custom for the month report", async () => {
  const orders = [order({ businessDate: "2025-08-18", total: 250 })];
  const controller = historical.createHistoricalReportsController({ documentRef: null, getOrders: () => orders, now: () => Date.UTC(2026, 7, 18) });
  await controller.activate("history");
  await controller.selectYear(2025);
  await controller.activate("history");
  let result = await controller.selectMonth(8);
  assert.deepEqual(controller.getState(), { mode: "year", selectedYear: 2025, selectedMonth: 8, selectedDay: null, customStart: "", customEnd: "" });
  assert.equal(result.metrics.salesRevenue, 250);
  assert.equal(Object.hasOwn(result, "summaries"), false);

  await controller.activate("custom");
  await controller.selectYear(2025);
  await controller.activate("custom");
  result = await controller.selectMonth(8);
  assert.equal(controller.getState().mode, "year");
  assert.equal(result.metrics.salesRevenue, 250);
});

function createNavigationDocument() {
  function element(id, dataset = {}) {
    const classes = new Set();
    const children = [];
    return {
      id, dataset, hidden: false, value: "", textContent: "", children,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); }, contains: value => classes.has(value) },
      appendChild(child) { children.push(child); return child; },
      removeChild(child) { children.splice(children.indexOf(child), 1); },
      get firstChild() { return children[0] || null; },
      addEventListener() {}
    };
  }
  const currentButtons = [element("day", { range: "day" }), element("week", { range: "week" }), element("month", { range: "month" })];
  const modeButtons = ["year", "history", "custom"].map(mode => element(mode, { historicalMode: mode }));
  const ids = Object.fromEntries(["currentStatsContent", "historicalStatsPanel", "historicalStatsError", "historicalBreadcrumb", "historicalYearSelect", "historicalMonthSelect", "historicalStartDate", "historicalEndDate", "historicalApplyRange", "historicalBackBtn"].map(id => [id, element(id)]));
  return {
    ids, modeButtons,
    getElementById: id => ids[id] || null,
    querySelectorAll: selector => selector === ".historical-mode-btn" ? modeButtons : selector === ".report-range-btn" ? [...currentButtons, ...modeButtons] : [],
    createElement: tag => element(tag)
  };
}

test("S4.1 mode buttons synchronize and the selected empty year stays selectable", async () => {
  const documentRef = createNavigationDocument();
  const controller = historical.createHistoricalReportsController({
    documentRef,
    getOrders: () => [order({ businessDate: "2025-01-01" }), order({ businessDate: "2024-01-01" })],
    now: () => Date.UTC(2026, 7, 18)
  });
  controller.initialize();
  await controller.activate("year");
  assert.deepEqual(documentRef.ids.historicalYearSelect.children.map(option => Number(option.value)), [2026, 2025, 2024]);
  assert.equal(documentRef.ids.historicalYearSelect.value, "2026");
  await controller.activate("history");
  await controller.selectYear(2025);
  assert.equal(documentRef.modeButtons[0].classList.contains("active"), true);
  await controller.back();
  assert.equal(documentRef.modeButtons[1].classList.contains("active"), true);
  await controller.activate("custom");
  await controller.selectMonth(1);
  assert.equal(documentRef.modeButtons[0].classList.contains("active"), true);
});

test("S4.1 HTML and CSS provide matching active buttons and wrapping historical controls", () => {
  assert.match(htmlSource, /class="report-range-btn historical-mode-btn"[^>]*>歷年</);
  assert.match(htmlSource, /class="report-range-tabs statistics-mode-tabs"/);
  assert.match(htmlSource, /class="report-range-tabs historical-filter-controls"/);
  assert.match(htmlSource, /今日、本週、本月、年度、歷年與自訂報表/);
  assert.match(cssSource, /#statsTab \.statistics-mode-tabs,[\s\S]*#statsTab \.historical-filter-controls[\s\S]*flex-wrap:wrap/);
  assert.match(cssSource, /historical-filter-controls \.settings-input[\s\S]*min-width:130px[\s\S]*max-width:100%/);
});

test("S4.2 production Statistics assets share the current cache version", () => {
  assert.match(htmlSource, /\.\/css\/pos-v600\.css\?v=statistics-s5/);
  assert.match(htmlSource, /\.\/js\/pos\.js\?v=statistics-s5/);
  assert.doesNotMatch(htmlSource, /\.\/js\/pos\.js\?v=statistics-s3/);
  assert.match(posSource, /\.\/statistics-current-reports\.js\?v=statistics-s5/);
  assert.match(posSource, /\.\/statistics-historical-reports\.js\?v=statistics-s5/);
});
