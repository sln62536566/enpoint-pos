const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let closing;
let current;

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const [policy, time, storeRaw, quality, coreRaw, currentRaw, closingRaw] = await Promise.all([
    "statistics-policy.js", "statistics-time.js", "statistics-store.js", "statistics-data-quality.js",
    "statistics-core.js", "statistics-current-reports.js", "statistics-closing.js"
  ].map(read));
  const policyUrl = dataUrl(policy), timeUrl = dataUrl(time), qualityUrl = dataUrl(quality);
  const storeUrl = dataUrl(storeRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl));
  const coreUrl = dataUrl(coreRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-data-quality.js", qualityUrl));
  closing = await import(dataUrl(closingRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl)));
  current = await import(dataUrl(currentRaw.replace("./statistics-core.js", coreUrl).replace("./statistics-time.js", timeUrl).replace("./statistics-store.js", storeUrl).replace("./statistics-policy.js", policyUrl)));
});

const DATE = "2026-08-19";
const CLOSED_AT = Date.parse("2026-08-19T14:00:00Z");
const order = (extra = {}) => ({ storeId: "defaultStore", businessDate: DATE, total: 100, paid: true, status: "confirmed", ...extra });
const build = orders => closing.buildClosingSnapshot(orders, { businessDate: DATE, closedAt: CLOSED_AT });

test("S6 closing snapshot uses Paid Valid Orders without done/closed requirement", () => {
  const result = build([
    order({ total: 100, status: "pending" }),
    order({ total: 200, status: "cooking" }),
    order({ total: 300, status: "done" }),
    order({ total: 150, paid: false, paymentStatus: "unpaid" }),
    order({ total: 400, status: "cancelled" }),
    order({ total: 500, isTestOrder: true }),
    order({ total: 600, revenueExcluded: true })
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.statistics, {
    salesRevenue: 600, validOrders: 4, paidOrders: 3, unpaidOrders: 1,
    outstandingAmount: 150, cancelledOrders: 1, cancelledAmount: 400, averageTicket: 200
  });
});

test("S6 legacy fields map exactly to canonical Statistics v2 metrics", () => {
  const snapshot = build([order({ total: 125 }), order({ total: 75, status: "cancelled" })]).snapshot;
  assert.equal(snapshot.statisticsVersion, 2);
  assert.equal(snapshot.revenue, snapshot.statistics.salesRevenue);
  assert.equal(snapshot.salesRevenue, snapshot.statistics.salesRevenue);
  assert.equal(snapshot.validOrders, snapshot.statistics.validOrders);
  assert.equal(snapshot.cancelledOrders, snapshot.statistics.cancelledOrders);
  assert.equal(snapshot.date, DATE);
  assert.equal(snapshot.businessDate, DATE);
});

test("S6 Current Day, Closing Preview, and persisted snapshot reconcile", () => {
  const orders = [order({ total: 100, status: "pending" }), order({ total: 200, status: "cooking" }), order({ total: 150, paid: false })];
  const day = current.buildCurrentStatisticsViewModel(orders, { period: "day", now: Date.parse("2026-08-19T04:00:00Z") });
  const snapshot = build(orders).snapshot;
  assert.deepEqual(snapshot.statistics, {
    salesRevenue: day.metrics.salesRevenue, validOrders: day.metrics.validOrders,
    paidOrders: day.metrics.paidOrders, unpaidOrders: day.metrics.unpaidOrders,
    outstandingAmount: day.metrics.outstandingAmount, cancelledOrders: day.metrics.cancelledOrders,
    cancelledAmount: day.metrics.cancelledAmount, averageTicket: day.metrics.averageTicket
  });
  assert.equal(day.closingPreview.salesRevenue, snapshot.statistics.salesRevenue);
  assert.equal(day.closingPreview.validOrders, snapshot.statistics.validOrders);
  assert.equal(day.closingPreview.cancelledOrders, snapshot.statistics.cancelledOrders);
});

test("S6 canonical store/date selection uses Taipei createdAt and never updatedAt", () => {
  const result = build([
    order({ total: 10 }), order({ storeId: "mainStore", total: 20 }),
    order({ storeId: "otherStore", total: 30 }), order({ storeId: "", total: 40 }),
    order({ storeId: undefined, total: 50 }), order({ businessDate: undefined, createdAt: Date.parse("2026-08-18T16:30:00Z"), total: 60 }),
    order({ businessDate: undefined, createdAt: undefined, updatedAt: Date.parse("2026-08-19T04:00:00Z"), total: 70 }),
    order({ businessDate: "2026-08-18", total: 80 })
  ]);
  assert.equal(result.snapshot.statistics.salesRevenue, 90);
  assert.equal(result.snapshot.statistics.paidOrders, 3);
  assert.equal(result.snapshot.totalOrders, 3);
});

test("S6 closing snapshot calculation is idempotent for the same input", () => {
  const orders = [order({ total: 100 }), order({ total: 50, paid: false })];
  assert.deepEqual(build(orders), build(orders));
});

test("S6 invalid date or timestamp fails closed without a snapshot", () => {
  assert.equal(closing.buildClosingSnapshot([], { businessDate: "bad", closedAt: CLOSED_AT }).ok, false);
  assert.equal(closing.buildClosingSnapshot([], { businessDate: DATE, closedAt: NaN }).ok, false);
});

test("S6 production close is guarded, atomic with QR control, and reopen remains compatible", async () => {
  const root = path.join(__dirname, "..", "public");
  const [pos, html] = await Promise.all([
    fs.readFile(path.join(root, "js", "pos.js"), "utf8"), fs.readFile(path.join(root, "pos.html"), "utf8")
  ]);
  const start = pos.indexOf("async function closeBusinessDay()");
  const end = pos.indexOf("async function reopenBusinessDay()", start);
  const closeBlock = pos.slice(start, end);
  assert.match(pos, /statistics-closing\.js\?v=statistics-s6/);
  assert.match(closeBlock, /if \(businessDayCloseInFlight\) return/);
  assert.match(closeBlock, /buildClosingSnapshot\(ordersData/);
  assert.match(closeBlock, /closingUpdates\[`businessDays\/\$\{STORE_ID\}\/\$\{businessDate\}`\]/);
  assert.match(closeBlock, /closingUpdates\["qrSessionControl\/closeDayVersion"\]/);
  assert.match(closeBlock, /await update\(ref\(db\), closingUpdates\)/);
  assert.ok(closeBlock.indexOf("buildClosingSnapshot") < closeBlock.indexOf("await update(ref(db), closingUpdates)"));
  assert.match(pos.slice(end), /await remove\(ref\(db, `businessDays\/\$\{STORE_ID\}\/\$\{getTodayKey\(\)\}`\)\)/);
  assert.match(html, /pos-v600\.css\?v=statistics-s6/);
  assert.match(html, /pos\.js\?v=statistics-s6/);
});

test("S6.1 render status keeps close and reopen disabled throughout close re-entry window", async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "pos.js"), "utf8");
  const start = source.indexOf("function renderClosingStatus()");
  const end = source.indexOf("function watchBusinessDayClose()", start);
  const renderSource = source.slice(start, end);
  assert.match(renderSource, /closeBusinessDayBtn\.disabled = businessDayCloseInFlight/g);
  assert.doesNotMatch(renderSource, /closeBusinessDayBtn\.disabled = false/);

  const harness = new Function(`
    let businessDayCloseData = null;
    let businessDayCloseInFlight = false;
    const closingStatus = { textContent: "" };
    const closingTime = { textContent: "" };
    const closeBusinessDayBtn = { disabled: false, textContent: "" };
    const submitOrderBtn = { disabled: false };
    const submitUnpaidOrderBtn = { disabled: false };
    const formatTime = value => String(value);
    ${renderSource}
    return {
      renderClosingStatus,
      setFlight: value => { businessDayCloseInFlight = value; },
      setData: value => { businessDayCloseData = value; },
      state: () => ({ disabled: closeBusinessDayBtn.disabled, text: closeBusinessDayBtn.textContent })
    };
  `)();

  harness.setFlight(true); harness.setData(null); harness.renderClosingStatus();
  assert.equal(harness.state().disabled, true);
  harness.setData({ closed: true, closedAt: 1 }); harness.renderClosingStatus();
  assert.equal(harness.state().disabled, true);

  harness.setFlight(false); harness.setData(null); harness.renderClosingStatus();
  assert.deepEqual(harness.state(), { disabled: false, text: "確認今日收班" });
  harness.setData({ closed: true, closedAt: 1 }); harness.renderClosingStatus();
  assert.deepEqual(harness.state(), { disabled: false, text: "重新開班" });
});

test("S6.1 click handler rejects re-entry before choosing close or reopen", async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "public", "js", "pos.js"), "utf8");
  const start = source.indexOf('if (closeBusinessDayBtn) {');
  const handler = source.slice(start, source.indexOf("watchBusinessDayClose();", start));
  const guard = handler.indexOf("if (businessDayCloseInFlight) return;");
  const branch = handler.indexOf("if (isBusinessDayClosed())");
  assert.ok(guard >= 0 && branch > guard);
});
