const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let core;
let queryModule;
let firebaseModule;

function dataUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const [policySource, timeSource, storeSource, qualitySource, coreSource, querySource, firebaseSource] = await Promise.all([
    "statistics-policy.js", "statistics-time.js", "statistics-store.js", "statistics-data-quality.js",
    "statistics-core.js", "statistics-query.js", "statistics-query-firebase.js"
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
  core = await import(coreUrl);
  queryModule = await import(dataUrl(querySource
    .replace("./statistics-core.js", coreUrl)
    .replace("./statistics-time.js", timeUrl)));
  firebaseModule = await import(dataUrl(firebaseSource
    .replace("./statistics-time.js", timeUrl)
    .replace("./statistics-store.js", storeUrl)));
});

function order(extra = {}) {
  return { storeId: "defaultStore", businessDate: "2026-08-01", total: 100, paid: true, status: "confirmed", ...extra };
}

function options(extra = {}) {
  return { storeId: "defaultStore", startBusinessDate: "2026-08-01", endBusinessDate: "2026-08-31", ...extra };
}

test("S2 core builds a single-day report using Paid Valid Order semantics", () => {
  const report = core.buildStatisticsReport([
    order({ status: "confirmed", total: 100 }),
    order({ status: "cooking", total: 200 }),
    order({ status: "done", paid: false, total: 80 }),
    order({ status: "cancelled", total: 50 }),
    order({ isTestOrder: true, total: 999 }),
    order({ revenueExcluded: true, total: 500 })
  ], options());
  assert.equal(report.ok, true);
  assert.equal(report.contractVersion, 2);
  assert.deepEqual(report.metrics, {
    salesRevenue: 300,
    paidOrders: 2,
    unpaidOrders: 1,
    outstandingAmount: 80,
    validOrders: 3,
    cancelledOrders: 1,
    cancelledAmount: 50,
    averageTicket: 150
  });
  assert.equal(report.daily.length, 1);
});

test("S2 range is inclusive and invalid ranges fail closed", () => {
  const inclusive = core.buildStatisticsReport([
    order({ businessDate: "2026-08-01" }),
    order({ businessDate: "2026-08-31" }),
    order({ businessDate: "2026-09-01" })
  ], options());
  assert.equal(inclusive.metrics.paidOrders, 2);
  assert.equal(inclusive.diagnostics.rangeMatchedOrders, 2);
  const invalid = core.buildStatisticsReport([], options({ startBusinessDate: "2026-09-01", endBusinessDate: "2026-08-01" }));
  assert.deepEqual(invalid, { ok: false, errorCode: "INVALID_RANGE", message: "startBusinessDate must not be after endBusinessDate." });
});

test("S2 core filters canonical stores, aliases, wrong stores, and unassigned stores", () => {
  const report = core.buildStatisticsReport([
    order(),
    order({ storeId: "mainStore" }),
    order({ storeId: "otherStore" }),
    order({ storeId: null }),
    order({ storeId: "bad/store" })
  ], options({ aliases: { mainStore: "defaultStore" } }));
  assert.equal(report.metrics.paidOrders, 2);
  assert.equal(report.diagnostics.includedStoreOrders, 2);
  assert.equal(report.diagnostics.wrongStoreOrders, 1);
  assert.equal(report.diagnostics.unassignedStoreOrders, 2);
  assert.equal(report.diagnostics.invalidStoreOrders, 1);
});

test("S2 invalid alias target is unassigned and never merged", () => {
  const report = core.buildStatisticsReport([order({ storeId: "mainStore" })], options({ aliases: { mainStore: "bad/store" } }));
  assert.equal(report.metrics.paidOrders, 0);
  assert.equal(report.diagnostics.unassignedStoreOrders, 1);
  assert.equal(report.diagnostics.invalidStoreOrders, 1);
});

test("S2 business date uses explicit value then Taipei createdAt and never updatedAt", () => {
  const report = core.buildStatisticsReport([
    order({ businessDate: "2026-08-01" }),
    order({ businessDate: undefined, createdAt: Date.UTC(2026, 7, 1, 16) }),
    order({ businessDate: undefined, createdAt: null, updatedAt: Date.UTC(2026, 7, 2) })
  ], options());
  assert.equal(report.metrics.paidOrders, 2);
  assert.equal(report.diagnostics.unresolvedBusinessDateOrders, 1);
});

test("S2 daily aggregation groups same dates, sorts ascending, and calculates daily average", () => {
  const report = core.buildStatisticsReport([
    order({ businessDate: "2026-08-03", total: 90 }),
    order({ businessDate: "2026-08-01", total: 100 }),
    order({ businessDate: "2026-08-01", total: 300 })
  ], options());
  assert.deepEqual(report.daily.map(value => value.businessDate), ["2026-08-01", "2026-08-03"]);
  assert.equal(report.daily[0].metrics.salesRevenue, 400);
  assert.equal(report.daily[0].metrics.averageTicket, 200);
  assert.equal(report.daily[1].metrics.averageTicket, 90);
});

test("S2 diagnostics identify invalid totals and official exclusion reasons", () => {
  const report = core.buildStatisticsReport([
    order({ total: "abc" }),
    order({ total: null }),
    order({ isTestOrder: true }),
    order({ status: "cancelled" }),
    order({ revenueExcluded: true })
  ], options());
  assert.equal(report.diagnostics.invalidTotalOrders, 2);
  assert.equal(report.diagnostics.testOrders, 1);
  assert.equal(report.diagnostics.cancelledOrders, 1);
  assert.equal(report.diagnostics.revenueExcludedOrders, 1);
  assert.equal(Number.isNaN(report.metrics.salesRevenue), false);
});

test("S2 core and memory adapter do not mutate input orders", async () => {
  const input = [order()];
  const before = JSON.stringify(input);
  core.buildStatisticsReport(input, options());
  const adapter = queryModule.createMemoryStatisticsAdapter(input);
  await adapter.getRange(options());
  assert.equal(JSON.stringify(input), before);
});

test("S2 memory adapter applies an inclusive range and keeps legacy coverage", async () => {
  const adapter = queryModule.createMemoryStatisticsAdapter([
    order({ businessDate: "2026-08-01" }),
    order({ businessDate: "2026-08-31" }),
    order({ businessDate: "2026-09-01" }),
    order({ businessDate: undefined, createdAt: Date.UTC(2026, 7, 2) }),
    order({ businessDate: undefined, createdAt: Date.UTC(2026, 8, 2) }),
    order({ businessDate: undefined, createdAt: null })
  ]);
  const result = await adapter.getRange(options());
  assert.equal(result.ok, true);
  assert.equal(result.orders.length, 3);
  assert.equal(result.queryMeta.legacyCoverage, "complete");
  assert.equal(result.queryMeta.realtime, false);
});

test("S2 query service getDay/week/month/year delegate through getRange", async () => {
  const calls = [];
  const adapter = { async getRange(value) { calls.push(value); return { ok: true, orders: [], queryMeta: { source: "spy" } }; } };
  const service = queryModule.createStatisticsQueryService({ adapter });
  await service.getDay({ storeId: "defaultStore", businessDate: "2026-08-18" });
  await service.getWeek({ storeId: "defaultStore", businessDate: "2026-08-16" });
  await service.getMonth({ storeId: "defaultStore", year: 2026, month: 8 });
  await service.getYear({ storeId: "defaultStore", year: 2027 });
  assert.deepEqual(calls.map(value => [value.startBusinessDate, value.endBusinessDate]), [
    ["2026-08-18", "2026-08-18"],
    ["2026-08-10", "2026-08-16"],
    ["2026-08-01", "2026-08-31"],
    ["2027-01-01", "2027-12-31"]
  ]);
});

test("S2 query service isolates adapter throws and malformed results", async () => {
  const failed = queryModule.createStatisticsQueryService({ adapter: { async getRange() { throw new Error("offline"); } } });
  assert.deepEqual(await failed.getRange(options()), { ok: false, errorCode: "QUERY_FAILED", message: "offline" });
  const malformed = queryModule.createStatisticsQueryService({ adapter: { async getRange() { return null; } } });
  assert.equal((await malformed.getRange(options())).errorCode, "MALFORMED_ADAPTER_RESULT");
  for (const orders of [null, "oops", 123, true, undefined]) {
    const malformedOrders = queryModule.createStatisticsQueryService({ adapter: { async getRange() { return { ok: true, orders }; } } });
    assert.equal((await malformedOrders.getRange(options())).errorCode, "MALFORMED_ADAPTER_RESULT");
  }
  const validEmpty = queryModule.createStatisticsQueryService({ adapter: { async getRange() { return { ok: true, orders: [] }; } } });
  assert.equal((await validEmpty.getRange(options())).ok, true);
  const validOrders = queryModule.createStatisticsQueryService({ adapter: { async getRange() { return { ok: true, orders: [order()] }; } } });
  assert.equal((await validOrders.getRange(options())).metrics.paidOrders, 1);
  let invalidCalls = 0;
  const guarded = queryModule.createStatisticsQueryService({ adapter: { async getRange() { invalidCalls += 1; return { ok: true, orders: [] }; } } });
  const invalid = await guarded.getRange(options({ startBusinessDate: "2026-09-01", endBusinessDate: "2026-08-01" }));
  assert.equal(invalid.errorCode, "INVALID_RANGE");
  assert.equal(invalidCalls, 0);
});

test("S2 query service applies only an explicitly supplied activation boundary", async () => {
  const calls = [];
  const adapter = { async getRange(value) { calls.push(value); return { ok: true, orders: [], queryMeta: { source: "spy" } }; } };
  const service = queryModule.createStatisticsQueryService({ adapter });
  const unchanged = await service.getRange(options());
  assert.deepEqual(unchanged.range, { startDate: "2026-08-01", endDate: "2026-08-31" });
  assert.equal(unchanged.queryMeta.activationBusinessDate, undefined);

  const clamped = await service.getRange(options({ activationBusinessDate: "2026-08-10" }));
  assert.deepEqual(clamped.range, { startDate: "2026-08-10", endDate: "2026-08-31" });
  assert.equal(clamped.queryMeta.activationClamped, true);
  assert.deepEqual(clamped.queryMeta.requestedRange, { startDate: "2026-08-01", endDate: "2026-08-31" });
  assert.deepEqual(clamped.queryMeta.effectiveRange, { startDate: "2026-08-10", endDate: "2026-08-31" });

  const beforeActivation = await service.getRange(options({ activationBusinessDate: "2026-09-01" }));
  assert.equal(beforeActivation.ok, true);
  assert.equal(beforeActivation.metrics.validOrders, 0);
  assert.equal(beforeActivation.queryMeta.source, "activation-boundary");
  assert.equal(beforeActivation.queryMeta.effectiveRange, null);
  assert.equal(calls.length, 2);

  const invalid = await service.getRange(options({ activationBusinessDate: "bad" }));
  assert.equal(invalid.errorCode, "INVALID_ACTIVATION_DATE");
});

function firebaseDependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    db: { name: "db" },
    ref(db, path) { calls.push(["ref", db, path]); return { path }; },
    orderByChild(field) { calls.push(["orderByChild", field]); return { field }; },
    startAt(value) { calls.push(["startAt", value]); return { start: value }; },
    endAt(value) { calls.push(["endAt", value]); return { end: value }; },
    query(...parts) { calls.push(["query", ...parts]); return { parts }; },
    async get(value) {
      calls.push(["get", value]);
      return {
        exists: () => true,
        val: () => ({
          a: order(),
          b: order({ storeId: "mainStore" }),
          c: order({ storeId: null })
        })
      };
    },
    ...overrides
  };
}

test("S2 Firebase adapter uses one-shot businessDate range query and preserves raw range records", async () => {
  const dependencies = firebaseDependencies();
  const adapter = firebaseModule.createFirebaseStatisticsAdapter(dependencies);
  const result = await adapter.getRange(options({ aliases: { mainStore: "defaultStore" } }));
  assert.equal(result.ok, true);
  assert.equal(result.orders.length, 3);
  assert.equal(result.queryMeta.source, "firebase-businessDate-range");
  assert.equal(result.queryMeta.realtime, false);
  assert.equal(result.queryMeta.storeFilter, "statistics-core");
  assert.equal(result.queryMeta.legacyCoverage, "partial");
  assert.equal(dependencies.calls.filter(call => call[0] === "get").length, 1);
  assert.equal(dependencies.calls.some(call => call[0] === "orderByChild" && call[1] === "businessDate"), true);
  assert.equal(dependencies.calls.some(call => call[0] === "startAt" && call[1] === "2026-08-01"), true);
  assert.equal(dependencies.calls.some(call => call[0] === "endAt" && call[1] === "2026-08-31"), true);
  assert.equal("onValue" in dependencies, false);
});

test("S2 Firebase query pipeline preserves store diagnostics for the core", async () => {
  const dependencies = firebaseDependencies({
    async get(value) {
      this.calls.push(["get", value]);
      return {
        exists: () => true,
        val: () => ({
          matching: order({ storeId: "defaultStore" }),
          wrong: order({ storeId: "otherStore" }),
          missing: order({ storeId: null }),
          invalid: order({ storeId: "bad/store" })
        })
      };
    }
  });
  const adapter = firebaseModule.createFirebaseStatisticsAdapter(dependencies);
  const service = queryModule.createStatisticsQueryService({ adapter });
  const report = await service.getRange(options());
  assert.equal(report.metrics.paidOrders, 1);
  assert.equal(report.diagnostics.totalInputOrders, 4);
  assert.equal(report.diagnostics.includedStoreOrders, 1);
  assert.equal(report.diagnostics.wrongStoreOrders, 1);
  assert.equal(report.diagnostics.unassignedStoreOrders, 2);
  assert.equal(report.diagnostics.invalidStoreOrders, 1);
});

test("S2 Firebase query pipeline applies aliases only in Statistics Core", async () => {
  const dependencies = firebaseDependencies({
    async get() {
      return { exists: () => true, val: () => ({ main: order({ storeId: "mainStore" }) }) };
    }
  });
  const service = queryModule.createStatisticsQueryService({
    adapter: firebaseModule.createFirebaseStatisticsAdapter(dependencies)
  });
  const distinct = await service.getRange(options());
  assert.equal(distinct.metrics.paidOrders, 0);
  assert.equal(distinct.diagnostics.wrongStoreOrders, 1);

  const aliased = await service.getRange(options({ aliases: { mainStore: "defaultStore" } }));
  assert.equal(aliased.metrics.paidOrders, 1);
  assert.equal(aliased.diagnostics.includedStoreOrders, 1);

  const invalidAlias = await service.getRange(options({ aliases: { mainStore: "bad/store" } }));
  assert.equal(invalidAlias.metrics.paidOrders, 0);
  assert.equal(invalidAlias.diagnostics.unassignedStoreOrders, 1);
  assert.equal(invalidAlias.diagnostics.invalidStoreOrders, 1);
});

test("S2 Firebase adapter converts errors and malformed snapshots into structured failures", async () => {
  const failedDependencies = firebaseDependencies({ async get() { throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }); } });
  const failed = await firebaseModule.createFirebaseStatisticsAdapter(failedDependencies).getRange(options());
  assert.deepEqual(failed, { ok: false, errorCode: "PERMISSION_DENIED", message: "denied" });
  const malformedDependencies = firebaseDependencies({ async get() { return { exists: () => true, val: () => [] }; } });
  const malformed = await firebaseModule.createFirebaseStatisticsAdapter(malformedDependencies).getRange(options());
  assert.equal(malformed.errorCode, "MALFORMED_SNAPSHOT");
});
