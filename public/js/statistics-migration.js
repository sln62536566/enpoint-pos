import { isValidBusinessDate, resolveBusinessDate } from "./statistics-time.js";
import { DEFAULT_REPORTING_STORE_ID, normalizeStoreId } from "./statistics-store.js";
import {
  calculateRevenueMetrics,
  isCancelledForStatistics,
  isRevenueExcludedForStatistics,
  isTestOrderForStatistics
} from "./statistics-policy.js";

const STATISTICS_MIGRATION_VERSION = "statistics-v2-s7";
const LEGACY_STORE_ID = "mainStore";
const PLAN_STATUSES = Object.freeze({
  READY: "READY",
  NO_CHANGE: "NO_CHANGE",
  UNRESOLVED: "UNRESOLVED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED"
});
const CANONICAL_METRIC_FIELDS = Object.freeze([
  "salesRevenue", "paidOrders", "unpaidOrders", "outstandingAmount",
  "validOrders", "cancelledOrders", "cancelledAmount", "averageTicket"
]);

function entriesOf(records) {
  if (Array.isArray(records)) return records.map((record, index) => [String(record?.id ?? index), record || {}]);
  if (!records || typeof records !== "object") return [];
  return Object.entries(records).map(([id, record]) => [id, record || {}]);
}

function isMissing(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function createBucket(names) {
  return Object.fromEntries(names.map(name => [name, { count: 0, ids: [] }]));
}

function add(bucket, name, id) {
  bucket[name].count += 1;
  bucket[name].ids.push(id);
}

function classifyDate(order) {
  if (isValidBusinessDate(order.businessDate)) return "canonical";
  return resolveBusinessDate(order) ? "createdAtRecoverable" : "unresolvedDate";
}

function classifyStore(order) {
  if (isMissing(order.storeId)) return "missingStore";
  const storeId = normalizeStoreId(order.storeId);
  if (!storeId) return "invalidStore";
  if (storeId === DEFAULT_REPORTING_STORE_ID) return "defaultStore";
  if (storeId === LEGACY_STORE_ID) return "mainStore";
  return "otherStore";
}

function inventoryLegacyOrders(records) {
  const dates = createBucket(["canonical", "missingBusinessDate", "invalidBusinessDate", "createdAtRecoverable", "unresolvedDate"]);
  const stores = createBucket(["defaultStore", "mainStore", "missingStore", "invalidStore", "otherStore"]);
  const semantics = createBucket(["test", "cancelled", "revenueExcluded"]);
  const rows = entriesOf(records).sort(([a], [b]) => a.localeCompare(b));
  for (const [id, order] of rows) {
    if (isValidBusinessDate(order.businessDate)) add(dates, "canonical", id);
    else {
      add(dates, isMissing(order.businessDate) ? "missingBusinessDate" : "invalidBusinessDate", id);
      add(dates, classifyDate(order), id);
    }
    add(stores, classifyStore(order), id);
    if (isTestOrderForStatistics(order)) add(semantics, "test", id);
    if (isCancelledForStatistics(order)) add(semantics, "cancelled", id);
    if (isRevenueExcludedForStatistics(order)) add(semantics, "revenueExcluded", id);
  }
  return { total: rows.length, dates, stores, semantics };
}

function buildOrderMigrationPlan(records, options = {}) {
  const allowMainStoreAliasMigration = options.allowMainStoreAliasMigration === true;
  return entriesOf(records).sort(([a], [b]) => a.localeCompare(b)).map(([id, order]) => {
    const dateClass = classifyDate(order);
    const storeClass = classifyStore(order);
    const patch = {};
    const reasons = [];
    let status = PLAN_STATUSES.NO_CHANGE;

    if (dateClass === "unresolvedDate") {
      status = PLAN_STATUSES.UNRESOLVED;
      reasons.push("businessDate cannot be resolved from businessDate or createdAt");
    }
    if (["missingStore", "invalidStore", "otherStore"].includes(storeClass)) {
      status = PLAN_STATUSES.REVIEW_REQUIRED;
      reasons.push(`${storeClass} is never rewritten automatically`);
    } else if (storeClass === "mainStore" && !allowMainStoreAliasMigration) {
      status = PLAN_STATUSES.REVIEW_REQUIRED;
      reasons.push("mainStore alias migration requires explicit policy");
    }

    if (status !== PLAN_STATUSES.UNRESOLVED && status !== PLAN_STATUSES.REVIEW_REQUIRED) {
      if (dateClass === "createdAtRecoverable") patch.businessDate = resolveBusinessDate(order);
      if (storeClass === "mainStore") patch.storeId = DEFAULT_REPORTING_STORE_ID;
      if (Object.keys(patch).length) {
        patch.statisticsMigrationVersion = STATISTICS_MIGRATION_VERSION;
        if (options.migratedAt !== undefined) patch.statisticsMigratedAt = options.migratedAt;
        status = PLAN_STATUSES.READY;
      }
    }
    const candidateBusinessDate = patch.businessDate || (isValidBusinessDate(order.businessDate) ? order.businessDate : null);
    const candidateStoreId = patch.storeId || normalizeStoreId(order.storeId);
    return {
      id,
      orderId: id,
      currentBusinessDate: order.businessDate ?? null,
      candidateBusinessDate,
      currentStoreId: order.storeId ?? null,
      candidateStoreId,
      changes: Object.keys(patch).filter(key => key === "businessDate" || key === "storeId"),
      confidence: status === PLAN_STATUSES.READY ? "HIGH" : (status === PLAN_STATUSES.NO_CHANGE ? "CANONICAL" : "NONE"),
      status, dateClass, storeClass, reasons, patch
    };
  });
}

async function executeOrderMigration(records, options = {}) {
  const plan = buildOrderMigrationPlan(records, options);
  const ready = plan.filter(row => row.status === PLAN_STATUSES.READY);
  if (options.apply !== true) return { mode: "DRY_RUN", writes: 0, plan };
  if (typeof options.writer !== "function") {
    return { mode: "APPLY", status: "WRITER_REQUIRED", writes: 0, plan };
  }
  const batchSize = Math.max(1, Math.min(100, Number.isInteger(options.batchSize) ? options.batchSize : 25));
  let writes = 0;
  const results = [];
  for (let offset = 0; offset < ready.length; offset += batchSize) {
    const batch = ready.slice(offset, offset + batchSize);
    const settled = await Promise.allSettled(batch.map(async row => {
      const patch = { ...row.patch };
      if (!Object.prototype.hasOwnProperty.call(patch, "statisticsMigratedAt")) {
        patch.statisticsMigratedAt = options.now ? options.now() : Date.now();
      }
      await options.writer(row.id, patch);
      return { id: row.id, patch };
    }));
    settled.forEach((result, index) => {
      const id = batch[index].id;
      if (result.status === "fulfilled") {
        writes += 1;
        results.push({ id, status: "APPLIED", patch: result.value.patch });
      } else {
        results.push({ id, status: "MIGRATION_WRITE_FAILED", error: String(result.reason?.message || result.reason || "Unknown migration write failure") });
      }
    });
  }
  const failures = results.filter(result => result.status === "MIGRATION_WRITE_FAILED").length;
  return { mode: "APPLY", status: failures ? "PARTIAL_FAILURE" : "APPLIED", writes, failures, results, plan };
}

function deriveActivationCandidate(records, options = {}) {
  const storeId = options.storeId || DEFAULT_REPORTING_STORE_ID;
  const candidates = entriesOf(records).filter(([, order]) => {
    const rawStore = normalizeStoreId(order.storeId);
    const resolvedStore = rawStore === LEGACY_STORE_ID ? DEFAULT_REPORTING_STORE_ID : rawStore;
    return resolvedStore === storeId && resolveBusinessDate(order) &&
      !isTestOrderForStatistics(order) && !isCancelledForStatistics(order);
  }).map(([id, order]) => ({ businessDate: resolveBusinessDate(order), orderId: id }))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.orderId.localeCompare(b.orderId));
  return candidates.length
    ? { status: "ACTIVATION_CONFIRMATION_REQUIRED", persisted: false, ...candidates[0] }
    : { status: "ACTIVATION_UNRESOLVED", persisted: false, businessDate: null, orderId: null };
}

function buildActivationConfirmation(candidate, options = {}) {
  if (options.confirm !== true) return { status: "ACTIVATION_CONFIRMATION_REQUIRED", persisted: false, patch: null };
  const businessDate = options.businessDate || candidate?.businessDate;
  if (!isValidBusinessDate(businessDate)) return { status: "INVALID_ACTIVATION_DATE", persisted: false, patch: null };
  const hasExplicitStoreId = Object.prototype.hasOwnProperty.call(options, "storeId");
  let storeId = DEFAULT_REPORTING_STORE_ID;
  if (hasExplicitStoreId) {
    storeId = normalizeStoreId(options.storeId);
    if (!storeId) return { status: "INVALID_ACTIVATION_STORE_ID", persisted: false, patch: null };
    if (storeId === LEGACY_STORE_ID) {
      if (options.allowMainStoreActivationAlias !== true) {
        return { status: "ACTIVATION_STORE_REVIEW_REQUIRED", persisted: false, patch: null };
      }
      storeId = DEFAULT_REPORTING_STORE_ID;
    } else if (storeId !== DEFAULT_REPORTING_STORE_ID) {
      return { status: "INVALID_ACTIVATION_STORE_ID", persisted: false, patch: null };
    }
  }
  if (typeof options.confirmedAt !== "number" || !Number.isFinite(options.confirmedAt) || options.confirmedAt <= 0) {
    return { status: "INVALID_ACTIVATION_CONFIRMATION_TIMESTAMP", persisted: false, patch: null };
  }
  return {
    status: "READY", persisted: false,
    path: `stores/${storeId}/metadata`,
    patch: {
      statisticsActivationBusinessDate: businessDate,
      statisticsActivationConfirmed: true,
      statisticsActivationConfirmedAt: options.confirmedAt,
      statisticsActivationVersion: STATISTICS_MIGRATION_VERSION
    }
  };
}

function assessBusinessDateIndexReadiness(input = {}) {
  const source = typeof input.rulesSource === "string" ? input.rulesSource : "";
  const indexed = /["']\.indexOn["']\s*:\s*(?:["']businessDate["']|\[[^\]]*["']businessDate["'][^\]]*\])/.test(source);
  if (indexed) return { status: "READY", ready: true };
  return {
    status: "PRODUCTION_INDEX_ACTION_REQUIRED", ready: false,
    code: "BUSINESSDATE_INDEX_MISSING",
    requiredRule: { orders: { ".indexOn": ["businessDate"] } },
    action: "Add .indexOn [\"businessDate\"] at the production orders query path and deploy the RTDB rules manually."
  };
}

function classifyBusinessDaySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { classification: "MALFORMED", missingFields: [] };
  const statistics = snapshot.statistics;
  const isStrictFiniteNumber = value => typeof value === "number" && Number.isFinite(value);
  const missingFields = CANONICAL_METRIC_FIELDS.filter(field => !isStrictFiniteNumber(statistics?.[field]));
  if (snapshot.statisticsVersion === 2 && missingFields.length === 0) return { classification: "CURRENT_V2", missingFields: [], migrationRequired: false };
  const hasLegacyMetrics = ["revenue", "salesRevenue", "validOrders", "cancelledOrders"].some(field => isStrictFiniteNumber(snapshot[field]));
  if (hasLegacyMetrics || statistics) return { classification: "LEGACY", missingFields, migrationRequired: true };
  return { classification: "MALFORMED", missingFields: CANONICAL_METRIC_FIELDS.slice(), migrationRequired: false };
}

function reconcileBusinessDaySnapshot(snapshot, records, options = {}) {
  const businessDate = options.businessDate || snapshot?.businessDate;
  const storeId = options.storeId || DEFAULT_REPORTING_STORE_ID;
  const orders = entriesOf(records).map(([, order]) => order).filter(order => {
    const rawStore = normalizeStoreId(order.storeId);
    const resolvedStore = rawStore === LEGACY_STORE_ID ? DEFAULT_REPORTING_STORE_ID : rawStore;
    return resolvedStore === storeId && resolveBusinessDate(order) === businessDate;
  });
  const canonical = calculateRevenueMetrics(orders);
  const stored = {};
  const delta = {};
  for (const field of CANONICAL_METRIC_FIELDS) {
    const hasCanonicalField = snapshot?.statistics && Object.prototype.hasOwnProperty.call(snapshot.statistics, field);
    const hasRootField = snapshot && Object.prototype.hasOwnProperty.call(snapshot, field);
    const value = hasCanonicalField
      ? snapshot.statistics[field]
      : (hasRootField ? snapshot[field] : (field === "salesRevenue" ? snapshot?.revenue : undefined));
    stored[field] = typeof value === "number" && Number.isFinite(value) ? value : null;
    delta[field] = stored[field] === null ? null : canonical[field] - stored[field];
  }
  return {
    mode: "READ_ONLY", writes: 0, businessDate, storeId,
    classification: classifyBusinessDaySnapshot(snapshot), stored, canonical, delta,
    storedRevenue: stored.salesRevenue,
    canonicalRevenue: canonical.salesRevenue,
    revenueDelta: delta.salesRevenue,
    storedValidOrders: stored.validOrders,
    canonicalValidOrders: canonical.validOrders,
    storedCancelledOrders: stored.cancelledOrders,
    canonicalCancelledOrders: canonical.cancelledOrders
  };
}

export {
  STATISTICS_MIGRATION_VERSION,
  PLAN_STATUSES,
  inventoryLegacyOrders,
  buildOrderMigrationPlan,
  executeOrderMigration,
  deriveActivationCandidate,
  buildActivationConfirmation,
  assessBusinessDateIndexReadiness,
  classifyBusinessDaySnapshot,
  reconcileBusinessDaySnapshot
};
