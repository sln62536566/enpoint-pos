const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
let migration;

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const [policy, time, storeRaw, migrationRaw] = await Promise.all([
    "statistics-policy.js", "statistics-time.js", "statistics-store.js", "statistics-migration.js"
  ].map(name => fs.readFile(path.join(root, name), "utf8")));
  const policyUrl = dataUrl(policy);
  const timeUrl = dataUrl(time);
  const storeUrl = dataUrl(storeRaw.replace("./statistics-policy.js", policyUrl).replace("./statistics-time.js", timeUrl));
  migration = await import(dataUrl(migrationRaw
    .replace("./statistics-time.js", timeUrl)
    .replace("./statistics-store.js", storeUrl)
    .replace("./statistics-policy.js", policyUrl)));
});

const DATE = "2026-08-19";
const CREATED_AT = Date.parse("2026-08-18T16:30:00Z");
const paid = extra => ({ storeId: "defaultStore", businessDate: DATE, paid: true, total: 100, ...extra });

test("S7 inventories dates, stores, and exclusion semantics with record ids", () => {
  const result = migration.inventoryLegacyOrders({
    canonical: paid(),
    recoverable: paid({ businessDate: undefined, createdAt: CREATED_AT, storeId: "mainStore" }),
    invalidDate: paid({ businessDate: "bad", createdAt: CREATED_AT, storeId: "otherStore" }),
    unresolved: paid({ businessDate: undefined, createdAt: undefined, storeId: "" }),
    invalidStore: paid({ storeId: "bad/store", isTestOrder: true }),
    cancelled: paid({ status: "cancelled" })
  });
  assert.equal(result.total, 6);
  assert.deepEqual(result.dates.canonical.ids, ["cancelled", "canonical", "invalidStore"]);
  assert.deepEqual(result.dates.createdAtRecoverable.ids, ["invalidDate", "recoverable"]);
  assert.deepEqual(result.dates.unresolvedDate.ids, ["unresolved"]);
  assert.deepEqual(result.stores.mainStore.ids, ["recoverable"]);
  assert.deepEqual(result.stores.missingStore.ids, ["unresolved"]);
  assert.deepEqual(result.stores.invalidStore.ids, ["invalidStore"]);
  assert.deepEqual(result.semantics.test.ids, ["invalidStore"]);
  assert.deepEqual(result.semantics.cancelled.ids, ["cancelled"]);
  assert.deepEqual(result.semantics.revenueExcluded.ids, ["cancelled", "invalidStore"]);
});

test("S7 date recovery uses createdAt Taipei date and never updatedAt", () => {
  const plan = migration.buildOrderMigrationPlan({
    recoverable: paid({ businessDate: null, createdAt: CREATED_AT }),
    updatedOnly: paid({ businessDate: null, createdAt: null, updatedAt: CREATED_AT })
  });
  assert.deepEqual(plan[0].patch.businessDate, DATE);
  assert.equal(plan[0].status, "READY");
  assert.equal(plan[1].status, "UNRESOLVED");
  assert.deepEqual(plan[1].patch, {});
});

test("S7 mainStore rewrite requires explicit policy", () => {
  const records = { legacy: paid({ storeId: "mainStore" }) };
  assert.equal(migration.buildOrderMigrationPlan(records)[0].status, "REVIEW_REQUIRED");
  const approved = migration.buildOrderMigrationPlan(records, { allowMainStoreAliasMigration: true, migratedAt: 123 })[0];
  assert.equal(approved.status, "READY");
  assert.deepEqual(approved.patch, {
    storeId: "defaultStore", statisticsMigrationVersion: "statistics-v2-s7", statisticsMigratedAt: 123
  });
});

test("S7 missing, invalid, and other stores stay untouched for review", () => {
  for (const storeId of [undefined, "bad/store", "otherStore"]) {
    const row = migration.buildOrderMigrationPlan({ x: paid({ storeId, businessDate: null, createdAt: CREATED_AT }) })[0];
    assert.equal(row.status, "REVIEW_REQUIRED");
    assert.deepEqual(row.patch, {});
  }
});

test("S7 planning is deterministic and already canonical orders are idempotent", () => {
  const records = { z: paid(), a: paid({ businessDate: null, createdAt: CREATED_AT }) };
  assert.deepEqual(migration.buildOrderMigrationPlan(records), migration.buildOrderMigrationPlan(records));
  assert.deepEqual(migration.buildOrderMigrationPlan(records).map(row => row.id), ["a", "z"]);
  assert.equal(migration.buildOrderMigrationPlan({ canonical: paid({ statisticsMigrationVersion: "statistics-v2-s7" }) })[0].status, "NO_CHANGE");
});

test("S7 an applied canonical patch makes the second plan NO_CHANGE", async () => {
  const records = { x: paid({ businessDate: null, createdAt: CREATED_AT }) };
  await migration.executeOrderMigration(records, {
    apply: true, migratedAt: 1,
    writer: async (id, patch) => Object.assign(records[id], patch)
  });
  assert.equal(migration.buildOrderMigrationPlan(records)[0].status, "NO_CHANGE");
});

test("S7 dry-run is the default and performs exactly zero writes", async () => {
  let calls = 0;
  const result = await migration.executeOrderMigration({ x: paid({ businessDate: null, createdAt: CREATED_AT }) }, {
    writer: async () => { calls += 1; }
  });
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.writes, 0);
  assert.equal(calls, 0);
});

test("S7 apply is explicit, bounded, and sends only narrow patches", async () => {
  const writes = [];
  const result = await migration.executeOrderMigration({
    a: paid({ businessDate: null, createdAt: CREATED_AT, customerName: "keep" }),
    b: paid({ storeId: "mainStore" }),
    c: paid()
  }, {
    apply: true, allowMainStoreAliasMigration: true, migratedAt: 456, batchSize: 1,
    writer: async (id, patch) => writes.push([id, patch])
  });
  assert.equal(result.writes, 2);
  assert.deepEqual(writes.map(([id]) => id), ["a", "b"]);
  assert.deepEqual(Object.keys(writes[0][1]).sort(), ["businessDate", "statisticsMigratedAt", "statisticsMigrationVersion"]);
  assert.deepEqual(Object.keys(writes[1][1]).sort(), ["statisticsMigratedAt", "statisticsMigrationVersion", "storeId"]);
});

test("S7 apply fails closed without an injected writer", async () => {
  const result = await migration.executeOrderMigration({ x: paid({ businessDate: null, createdAt: CREATED_AT }) }, { apply: true });
  assert.equal(result.status, "WRITER_REQUIRED");
  assert.equal(result.writes, 0);
});

test("S7 apply reports per-record partial failure without a false all-success claim", async () => {
  const result = await migration.executeOrderMigration({
    a: paid({ businessDate: null, createdAt: CREATED_AT }),
    b: paid({ businessDate: null, createdAt: CREATED_AT })
  }, {
    apply: true, migratedAt: 2,
    writer: async id => { if (id === "b") throw new Error("denied"); }
  });
  assert.equal(result.status, "PARTIAL_FAILURE");
  assert.equal(result.writes, 1);
  assert.equal(result.failures, 1);
  assert.deepEqual(result.results.map(row => row.status), ["APPLIED", "MIGRATION_WRITE_FAILED"]);
});

test("S7 activation candidate excludes test and cancelled orders and cannot self-persist", () => {
  const candidate = migration.deriveActivationCandidate({
    test: paid({ businessDate: "2026-08-01", isTestOrder: true }),
    cancelled: paid({ businessDate: "2026-08-02", status: "cancelled" }),
    later: paid({ businessDate: "2026-08-04" }),
    legacy: paid({ businessDate: "2026-08-03", storeId: "mainStore" })
  });
  assert.deepEqual(candidate, {
    status: "ACTIVATION_CONFIRMATION_REQUIRED", persisted: false,
    businessDate: "2026-08-03", orderId: "legacy"
  });
  assert.equal(migration.buildActivationConfirmation(candidate).patch, null);
  const confirmation = migration.buildActivationConfirmation(candidate, { confirm: true, confirmedAt: 789 });
  assert.equal(confirmation.path, "stores/defaultStore/metadata");
  assert.equal(confirmation.patch.statisticsActivationBusinessDate, "2026-08-03");
  assert.equal(confirmation.patch.statisticsActivationConfirmed, true);
});

test("S7.1 activation store validation fails closed and aliases only with approval", () => {
  const candidate = { businessDate: DATE };
  const base = { confirm: true, confirmedAt: 789 };
  assert.equal(migration.buildActivationConfirmation(candidate, base).path, "stores/defaultStore/metadata");
  assert.equal(migration.buildActivationConfirmation(candidate, { ...base, storeId: "defaultStore" }).status, "READY");
  for (const storeId of ["bad/store", "", "   ", null]) {
    const result = migration.buildActivationConfirmation(candidate, { ...base, storeId });
    assert.equal(result.status, "INVALID_ACTIVATION_STORE_ID");
    assert.equal(result.patch, null);
  }
  const legacy = migration.buildActivationConfirmation(candidate, { ...base, storeId: "mainStore" });
  assert.equal(legacy.status, "ACTIVATION_STORE_REVIEW_REQUIRED");
  assert.equal(legacy.patch, null);
  assert.notEqual(legacy.path, "stores/mainStore/metadata");
  const approved = migration.buildActivationConfirmation(candidate, {
    ...base, storeId: "mainStore", allowMainStoreActivationAlias: true
  });
  assert.equal(approved.status, "READY");
  assert.equal(approved.path, "stores/defaultStore/metadata");
});

test("S7.1 activation confirmation requires a finite positive timestamp", () => {
  const candidate = { businessDate: DATE };
  for (const confirmedAt of [undefined, null, "789", 0, -1, NaN, Infinity, -Infinity]) {
    const result = migration.buildActivationConfirmation(candidate, { confirm: true, confirmedAt });
    assert.equal(result.status, "INVALID_ACTIVATION_CONFIRMATION_TIMESTAMP");
    assert.equal(result.patch, null);
  }
  assert.equal(migration.buildActivationConfirmation(candidate, { confirm: true, confirmedAt: 789 }).status, "READY");
});

test("S7 reports a structured production index action when rules cannot be verified", async () => {
  const root = path.join(__dirname, "..");
  const files = await fs.readdir(root);
  assert.equal(files.includes("firebase.json"), false);
  const result = migration.assessBusinessDateIndexReadiness();
  assert.equal(result.status, "PRODUCTION_INDEX_ACTION_REQUIRED");
  assert.deepEqual(result.requiredRule.orders[".indexOn"], ["businessDate"]);
  assert.match(result.action, /deploy.*manually/i);
  assert.equal(migration.assessBusinessDateIndexReadiness({ rulesSource: '".indexOn": ["businessDate"]' }).ready, true);
});

test("S7 classifies current, legacy, malformed, and missing-field snapshots", () => {
  const metrics = { salesRevenue: 1, paidOrders: 1, unpaidOrders: 0, outstandingAmount: 0, validOrders: 1, cancelledOrders: 0, cancelledAmount: 0, averageTicket: 1 };
  assert.equal(migration.classifyBusinessDaySnapshot({ statisticsVersion: 2, statistics: metrics }).classification, "CURRENT_V2");
  const legacy = migration.classifyBusinessDaySnapshot({ revenue: 1, validOrders: 1 });
  assert.equal(legacy.classification, "LEGACY");
  assert.ok(legacy.missingFields.includes("paidOrders"));
  assert.equal(migration.classifyBusinessDaySnapshot({ nonsense: true }).classification, "MALFORMED");
});

test("S7.1 CURRENT_V2 requires eight real finite numeric metrics", () => {
  const metrics = { salesRevenue: 1, paidOrders: 1, unpaidOrders: 0, outstandingAmount: 0, validOrders: 1, cancelledOrders: 0, cancelledAmount: 0, averageTicket: 1 };
  for (const invalid of [null, "", "   ", false, NaN, Infinity, -Infinity]) {
    const snapshot = { statisticsVersion: 2, statistics: { ...metrics, salesRevenue: invalid } };
    const result = migration.classifyBusinessDaySnapshot(snapshot);
    assert.notEqual(result.classification, "CURRENT_V2");
    assert.ok(result.missingFields.includes("salesRevenue"));
  }
  assert.equal(migration.classifyBusinessDaySnapshot({ statisticsVersion: 2, statistics: metrics }).classification, "CURRENT_V2");
});

test("S7 reconciliation is read-only and canonical raw orders are authoritative", () => {
  const result = migration.reconcileBusinessDaySnapshot({ businessDate: DATE, revenue: 500, validOrders: 1 }, {
    a: paid({ total: 600 }),
    cancelled: paid({ total: 300, status: "cancelled" }),
    test: paid({ total: 900, isTestOrder: true }),
    otherDate: paid({ total: 200, businessDate: "2026-08-18" })
  });
  assert.equal(result.mode, "READ_ONLY");
  assert.equal(result.writes, 0);
  assert.equal(result.canonical.salesRevenue, 600);
  assert.equal(result.canonical.cancelledOrders, 1);
  assert.equal(result.delta.salesRevenue, 100);
  assert.equal(result.storedRevenue, 500);
  assert.equal(result.canonicalRevenue, 600);
  assert.equal(result.revenueDelta, 100);
});

test("S7.1 reconciliation preserves invalid stored metrics as null", () => {
  for (const invalid of [null, "", "   ", false, NaN, Infinity, -Infinity]) {
    const result = migration.reconcileBusinessDaySnapshot({
      businessDate: DATE,
      statistics: { salesRevenue: invalid }
    }, { a: paid({ total: 600 }) });
    assert.equal(result.stored.salesRevenue, null);
    assert.equal(result.delta.salesRevenue, null);
    assert.equal(result.storedRevenue, null);
    assert.equal(result.revenueDelta, null);
  }
});
