const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let policy;
let time;
let store;

function dataUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const [policySource, timeSource, storeSource] = await Promise.all([
    "statistics-policy.js",
    "statistics-time.js",
    "statistics-store.js"
  ].map(name => fs.readFile(path.join(root, name), "utf8")));
  const policyUrl = dataUrl(policySource);
  const timeUrl = dataUrl(timeSource);
  policy = await import(policyUrl);
  time = await import(timeUrl);
  store = await import(dataUrl(storeSource
    .replace("./statistics-policy.js", policyUrl)
    .replace("./statistics-time.js", timeUrl)));
});

test("S1 revenue qualification follows Paid Valid Order semantics", () => {
  for (const status of ["confirmed", "cooking", "done", "closed"]) {
    assert.equal(policy.isSalesRevenueOrder({ status, paid: true, total: 100 }), true, status);
    assert.equal(policy.isProductSalesOrder({ status, paymentStatus: "paid" }), true, status);
  }
  assert.equal(policy.isSalesRevenueOrder({ status: "done", paid: false }), false);
  assert.equal(policy.isSalesRevenueOrder({ paid: true, cancelled: true }), false);
  assert.equal(policy.isSalesRevenueOrder({ paid: true, isTestOrder: true }), false);
  assert.equal(policy.isSalesRevenueOrder({ paid: true, revenueExcluded: true }), false);
});

test("S1 cancellation compatibility recognizes all explicit representations", () => {
  assert.equal(policy.isCancelledForStatistics({ status: "cancelled" }), true);
  assert.equal(policy.isCancelledForStatistics({ kitchenStatus: "cancelled" }), true);
  assert.equal(policy.isCancelledForStatistics({ paymentStatus: "cancelled" }), true);
  assert.equal(policy.isCancelledForStatistics({ cancelled: true }), true);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: 1700000000000 }), true);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "2026-08-18T00:00:00Z" }), true);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "0" }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "1" }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "2026" }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "" }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: 0 }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: -1 }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: false }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "2026-02-30T00:00:00Z" }), false);
  assert.equal(policy.isCancelledForStatistics({ cancelledAt: "invalid" }), false);
  assert.equal(policy.isCancelledForStatistics({ revenueExcluded: true }), false);
});

test("S1 test detection uses explicit flags and never arbitrary text", () => {
  assert.equal(policy.isTestOrderForStatistics({ isTestOrder: true }), true);
  assert.equal(policy.isTestOrderForStatistics({ testOrder: true }), true);
  assert.equal(policy.isTestOrderForStatistics({ note: "test order", source: "POS test" }), false);
});

test("S1 totals and metrics never produce NaN", () => {
  assert.equal(policy.getOrderTotal({ total: "125" }), 125);
  assert.equal(policy.getOrderTotal({ total: "not-a-number" }), 0);
  const empty = policy.calculateRevenueMetrics([]);
  assert.equal(empty.averageTicket, 0);
  const metrics = policy.calculateRevenueMetrics([
    { paid: true, status: "confirmed", total: 200 },
    { paid: false, status: "done", total: 80 },
    { paid: true, status: "cancelled", total: 50 },
    { paid: true, isTestOrder: true, total: 999 },
    { paid: true, total: "bad" }
  ]);
  assert.deepEqual(metrics, {
    salesRevenue: 200,
    paidOrders: 2,
    unpaidOrders: 1,
    outstandingAmount: 80,
    validOrders: 3,
    cancelledOrders: 1,
    cancelledAmount: 50,
    averageTicket: 100
  });
  for (const value of Object.values(metrics)) assert.equal(Number.isNaN(value), false);
});

test("S1 resolves explicit businessDate before Taipei createdAt fallback", () => {
  assert.equal(time.resolveBusinessDate({ businessDate: "2024-02-29", createdAt: 0 }), "2024-02-29");
  assert.equal(time.resolveBusinessDate({ businessDate: "2023-02-29", createdAt: Date.UTC(2026, 0, 1) }), "2026-01-01");
  assert.equal(time.resolveBusinessDate({ createdAt: Date.UTC(2025, 11, 31, 16, 30) }), "2026-01-01");
  assert.equal(time.resolveBusinessDate({ createdAt: null }), null);
  assert.equal(time.resolveBusinessDate({ createdAt: "" }), null);
  assert.equal(time.resolveBusinessDate({ createdAt: false }), null);
  assert.equal(time.resolveBusinessDate({ createdAt: 0 }), null);
  assert.equal(time.resolveBusinessDate({ createdAt: "0" }), null);
  assert.equal(time.resolveBusinessDate({ updatedAt: Date.UTC(2026, 0, 1) }), null);
  assert.equal(time.resolveBusinessDate({ createdAt: "invalid" }), null);
  assert.equal(time.isValidBusinessDate("2024-02-29"), true);
  assert.equal(time.isValidBusinessDate("2023-02-29"), false);
});

test("S1 Taipei date handles midnight, month end, and year end", () => {
  assert.equal(time.getTodayBusinessDate(Date.UTC(2026, 0, 31, 15, 59, 59)), "2026-01-31");
  assert.equal(time.getTodayBusinessDate(Date.UTC(2026, 0, 31, 16, 0, 0)), "2026-02-01");
  assert.equal(time.getTodayBusinessDate(Date.UTC(2025, 11, 31, 16, 0, 0)), "2026-01-01");
  assert.deepEqual(time.getBusinessMonthRange(2024, 2), { startDate: "2024-02-01", endDate: "2024-02-29" });
  assert.deepEqual(time.getBusinessYearRange(2026), { startDate: "2026-01-01", endDate: "2026-12-31" });
});

test("S1 weeks run Monday through Sunday across ISO week-year boundaries", () => {
  assert.deepEqual(time.getBusinessWeekRange("2026-08-16"), { startDate: "2026-08-10", endDate: "2026-08-16" });
  assert.deepEqual(time.getBusinessWeekRange("2026-08-17"), { startDate: "2026-08-17", endDate: "2026-08-23" });
  assert.deepEqual(time.getBusinessWeekRange("2021-01-01"), { startDate: "2020-12-28", endDate: "2021-01-03" });
  assert.equal(time.getBusinessWeekRange("bad"), null);
});

test("S1 store IDs are validated, casing-stable, and aliases are explicit", () => {
  assert.equal(store.normalizeStoreId(" defaultStore "), "defaultStore");
  assert.equal(store.normalizeStoreId("mainStore"), "mainStore");
  assert.equal(store.normalizeStoreId(""), null);
  assert.equal(store.normalizeStoreId("bad/store"), null);
  assert.equal(store.resolveReportingStoreId("mainStore"), "mainStore");
  assert.equal(store.resolveReportingStoreId(null), "defaultStore");
  assert.equal(store.resolveReportingStoreId(""), "defaultStore");
  assert.equal(store.resolveReportingStoreId("bad/store"), null);
  assert.equal(store.resolveReportingStoreId("mainStore", { aliases: { mainStore: "defaultStore" } }), "defaultStore");
  assert.equal(store.resolveReportingStoreId("mainStore", { aliases: { mainStore: "bad/store" } }), null);
});

test("S1 inventory preserves missing IDs and summarizes source, range, and paid-valid count", () => {
  const result = store.summarizeStoreInventory([
    { storeId: "defaultStore", orderSource: "POS", businessDate: "2026-01-02", paid: true },
    { storeId: "defaultStore", source: "QR", businessDate: "2026-01-03", paid: false },
    { storeId: "mainStore", orderSource: "QR", businessDate: "2025-12-31", paid: true },
    { source: "legacy", createdAt: Date.UTC(2026, 0, 3, 16), paid: true },
    { storeId: "bad/store", source: "invalid-store", businessDate: "2026-01-05", paid: true }
  ]);
  const defaultStore = result.find(value => value.storeId === "defaultStore");
  const mainStore = result.find(value => value.storeId === "mainStore");
  const missing = result.find(value => value.missingStoreId);
  assert.deepEqual(defaultStore.sources, { POS: 1, QR: 1 });
  assert.equal(defaultStore.count, 2);
  assert.equal(defaultStore.paidValidCount, 1);
  assert.equal(defaultStore.earliestBusinessDate, "2026-01-02");
  assert.equal(defaultStore.latestBusinessDate, "2026-01-03");
  assert.equal(mainStore.paidValidCount, 1);
  assert.equal(missing.storeId, null);
  assert.equal(missing.count, 2);
  assert.equal(result.some(value => value.storeId === "defaultStore" && value.count > 2), false);
});

test("S1 inventory keeps an invalid explicit alias target unassigned", () => {
  const result = store.summarizeStoreInventory([
    { storeId: "mainStore", paid: true, businessDate: "2026-01-01" }
  ], { aliases: { mainStore: "bad/store" } });
  assert.equal(result.length, 1);
  assert.equal(result[0].storeId, null);
  assert.equal(result[0].missingStoreId, true);
  assert.equal(result[0].count, 1);
  assert.equal(result.some(value => value.storeId === "defaultStore"), false);

  const distinct = store.summarizeStoreInventory([
    { storeId: "mainStore", paid: true, businessDate: "2026-01-01" }
  ]);
  assert.equal(distinct[0].storeId, "mainStore");
  assert.equal(distinct[0].missingStoreId, false);

  const aliased = store.summarizeStoreInventory([
    { storeId: "mainStore", paid: true, businessDate: "2026-01-01" }
  ], { aliases: { mainStore: "defaultStore" } });
  assert.equal(aliased[0].storeId, "defaultStore");
  assert.equal(aliased[0].missingStoreId, false);
});

test("S1 activation candidates ignore earlier test/cancelled orders and remain unpersisted", () => {
  const result = store.calculateStoreActivationCandidates({
    orders: [
      { businessDate: "2020-01-01", paid: true, isTestOrder: true },
      { businessDate: "2020-02-01", paid: true, cancelled: true },
      { businessDate: "2020-03-01", paid: false },
      { businessDate: "2020-04-01", paid: true }
    ],
    businessDays: [{ date: "2020-03-15" }]
  });
  assert.equal(result.status, "pending_confirmation");
  assert.equal(result.selected, null);
  assert.equal(result.persisted, false);
  assert.deepEqual(result.candidates, [
    { date: "2020-03-01", source: "valid-order", confidence: "medium", reason: "Earliest valid order" },
    { date: "2020-03-15", source: "business-day", confidence: "high", reason: "Earliest supplied business-day evidence" },
    { date: "2020-04-01", source: "paid-valid-order", confidence: "high", reason: "Earliest paid valid order" }
  ]);
});
