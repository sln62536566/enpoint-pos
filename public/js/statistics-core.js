import {
  calculateRevenueMetrics,
  isCancelledForStatistics,
  isTestOrderForStatistics
} from "./statistics-policy.js";
import { isValidBusinessDate, resolveBusinessDate } from "./statistics-time.js";
import { normalizeStoreId, resolveReportingStoreId } from "./statistics-store.js";
import {
  createStatisticsDiagnostics,
  hasInvalidOrderTotal,
  isMissingStoreIdentity
} from "./statistics-data-quality.js";

const STATISTICS_CONTRACT_VERSION = 2;

function toOrderList(orderData) {
  if (Array.isArray(orderData)) return orderData.slice();
  if (!orderData || typeof orderData !== "object") return [];
  return Object.entries(orderData).map(([id, order]) => ({ id, ...(order || {}) }));
}

function invalidResult(errorCode, message) {
  return { ok: false, errorCode, message };
}

function validateReportOptions(options = {}) {
  const storeId = resolveReportingStoreId(options.storeId);
  if (!storeId) return invalidResult("INVALID_STORE_ID", "A valid reporting storeId is required.");
  if (!isValidBusinessDate(options.startBusinessDate) || !isValidBusinessDate(options.endBusinessDate)) {
    return invalidResult("INVALID_RANGE", "A valid inclusive business-date range is required.");
  }
  if (options.startBusinessDate > options.endBusinessDate) {
    return invalidResult("INVALID_RANGE", "startBusinessDate must not be after endBusinessDate.");
  }
  return {
    ok: true,
    storeId,
    startDate: options.startBusinessDate,
    endDate: options.endBusinessDate,
    aliases: options.aliases && typeof options.aliases === "object" ? options.aliases : {}
  };
}

function selectReportOrders(orderData, options = {}) {
  const validated = validateReportOptions(options);
  if (!validated.ok) return validated;
  const orders = toOrderList(orderData);
  const diagnostics = createStatisticsDiagnostics(orders.length);
  const matched = [];

  for (const order of orders) {
    const rawStoreId = order && order.storeId;
    const normalizedStoreId = normalizeStoreId(rawStoreId);
    const resolvedStoreId = normalizedStoreId
      ? resolveReportingStoreId(normalizedStoreId, { aliases: validated.aliases })
      : null;

    if (!resolvedStoreId) {
      diagnostics.unassignedStoreOrders += 1;
      if (!isMissingStoreIdentity(rawStoreId)) diagnostics.invalidStoreOrders += 1;
      continue;
    }
    if (resolvedStoreId !== validated.storeId) {
      diagnostics.wrongStoreOrders += 1;
      continue;
    }

    diagnostics.includedStoreOrders += 1;
    const businessDate = resolveBusinessDate(order);
    if (!businessDate) {
      diagnostics.unresolvedBusinessDateOrders += 1;
      continue;
    }
    if (businessDate < validated.startDate || businessDate > validated.endDate) continue;

    diagnostics.rangeMatchedOrders += 1;
    if (hasInvalidOrderTotal(order)) diagnostics.invalidTotalOrders += 1;
    if (isTestOrderForStatistics(order)) diagnostics.testOrders += 1;
    if (isCancelledForStatistics(order)) diagnostics.cancelledOrders += 1;
    if (order && order.revenueExcluded === true) diagnostics.revenueExcludedOrders += 1;
    matched.push({ order, businessDate });
  }

  return { ...validated, orders, matched, diagnostics };
}

function buildDailyStatisticsFromMatched(matched) {
  const groups = new Map();
  for (const entry of matched) {
    if (!groups.has(entry.businessDate)) groups.set(entry.businessDate, []);
    groups.get(entry.businessDate).push(entry.order);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([businessDate, orders]) => ({
      businessDate,
      metrics: calculateRevenueMetrics(orders)
    }));
}

function buildDailyStatistics(orderData, options = {}) {
  const selected = selectReportOrders(orderData, options);
  if (!selected.ok) return selected;
  return {
    ok: true,
    contractVersion: STATISTICS_CONTRACT_VERSION,
    storeId: selected.storeId,
    range: { startDate: selected.startDate, endDate: selected.endDate },
    daily: buildDailyStatisticsFromMatched(selected.matched),
    diagnostics: selected.diagnostics
  };
}

function buildStatisticsReport(orderData, options = {}) {
  const selected = selectReportOrders(orderData, options);
  if (!selected.ok) return selected;
  const reportOrders = selected.matched.map(entry => entry.order);
  return {
    ok: true,
    contractVersion: STATISTICS_CONTRACT_VERSION,
    storeId: selected.storeId,
    range: { startDate: selected.startDate, endDate: selected.endDate },
    metrics: calculateRevenueMetrics(reportOrders),
    daily: buildDailyStatisticsFromMatched(selected.matched),
    diagnostics: selected.diagnostics
  };
}

export {
  STATISTICS_CONTRACT_VERSION,
  buildStatisticsReport,
  buildDailyStatistics
};
