import { calculateRevenueMetrics } from "./statistics-policy.js";
import { resolveBusinessDate, isValidBusinessDate } from "./statistics-time.js";
import { resolveReportingStoreId } from "./statistics-store.js";

const CLOSING_STORE_ID = "defaultStore";
const CLOSING_ALIASES = Object.freeze({ mainStore: CLOSING_STORE_ID });
const CLOSING_STATISTICS_VERSION = 2;

function toOrders(data) {
  if (Array.isArray(data)) return data.slice();
  if (!data || typeof data !== "object") return [];
  return Object.entries(data).map(([id, order]) => ({ id, ...(order || {}) }));
}

function selectCanonicalClosingOrders(data, options = {}) {
  const businessDate = options.businessDate;
  if (!isValidBusinessDate(businessDate)) return { ok: false, errorCode: "INVALID_CLOSING_BUSINESS_DATE", orders: [] };
  const storeId = options.storeId || CLOSING_STORE_ID;
  const aliases = options.aliases || CLOSING_ALIASES;
  const orders = [];
  for (const order of toOrders(data)) {
    if (resolveReportingStoreId(order && order.storeId, { aliases, fallback: null }) !== storeId) continue;
    if (resolveBusinessDate(order) !== businessDate) continue;
    orders.push(order);
  }
  return { ok: true, orders };
}

function canonicalStatistics(metrics) {
  return {
    salesRevenue: metrics.salesRevenue, validOrders: metrics.validOrders,
    paidOrders: metrics.paidOrders, unpaidOrders: metrics.unpaidOrders,
    outstandingAmount: metrics.outstandingAmount, cancelledOrders: metrics.cancelledOrders,
    cancelledAmount: metrics.cancelledAmount, averageTicket: metrics.averageTicket
  };
}

function buildClosingSnapshot(data, options = {}) {
  const selection = selectCanonicalClosingOrders(data, options);
  if (!selection.ok) return selection;
  const closedAt = Number(options.closedAt);
  if (!Number.isFinite(closedAt) || closedAt <= 0) return { ok: false, errorCode: "INVALID_CLOSING_TIMESTAMP" };
  const statistics = canonicalStatistics(calculateRevenueMetrics(selection.orders));
  const businessDate = options.businessDate;
  const storeId = options.storeId || CLOSING_STORE_ID;
  return { ok: true, snapshot: {
    storeId, date: businessDate, businessDate, closed: true, closedAt,
    revenue: statistics.salesRevenue, validOrders: statistics.validOrders,
    cancelledOrders: statistics.cancelledOrders, totalOrders: selection.orders.length,
    salesRevenue: statistics.salesRevenue, paidOrders: statistics.paidOrders,
    unpaidOrders: statistics.unpaidOrders, outstandingAmount: statistics.outstandingAmount,
    cancelledAmount: statistics.cancelledAmount, averageTicket: statistics.averageTicket,
    statisticsVersion: CLOSING_STATISTICS_VERSION, statistics,
    note: "Statistics v2 daily closing snapshot", createdAt: closedAt, updatedAt: closedAt
  } };
}

export {
  CLOSING_STORE_ID, CLOSING_ALIASES, CLOSING_STATISTICS_VERSION,
  selectCanonicalClosingOrders, buildClosingSnapshot
};
