function isRecord(value) {
  return value !== null && typeof value === "object";
}

function isPaid(order) {
  return isRecord(order) && (order.paymentStatus === "paid" || order.paid === true);
}

const MIN_CANONICAL_EPOCH_MS = Date.UTC(2000, 0, 1);
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function hasRealCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function hasValidCancelledAt(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= MIN_CANONICAL_EPOCH_MS &&
      Number.isFinite(new Date(value).getTime());
  }
  if (typeof value !== "string" || !value.trim()) return false;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match || !hasRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= MIN_CANONICAL_EPOCH_MS;
}

function isCancelledForStatistics(order) {
  if (!isRecord(order)) return false;
  return order.status === "cancelled" ||
    order.kitchenStatus === "cancelled" ||
    order.paymentStatus === "cancelled" ||
    order.cancelled === true ||
    hasValidCancelledAt(order.cancelledAt);
}

function isTestOrderForStatistics(order) {
  return isRecord(order) && (order.isTestOrder === true || order.testOrder === true);
}

function isRevenueExcludedForStatistics(order) {
  return isRecord(order) && (
    order.revenueExcluded === true ||
    isCancelledForStatistics(order) ||
    isTestOrderForStatistics(order)
  );
}

function isValidOrder(order) {
  return isRecord(order) && !isRevenueExcludedForStatistics(order);
}

function isSalesRevenueOrder(order) {
  return isValidOrder(order) && isPaid(order);
}

function isProductSalesOrder(order) {
  return isSalesRevenueOrder(order);
}

function getOrderTotal(order) {
  if (!isRecord(order)) return 0;
  const amount = Number(order.total);
  return Number.isFinite(amount) ? amount : 0;
}

function calculateRevenueMetrics(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const metrics = {
    salesRevenue: 0,
    paidOrders: 0,
    unpaidOrders: 0,
    outstandingAmount: 0,
    validOrders: 0,
    cancelledOrders: 0,
    cancelledAmount: 0,
    averageTicket: 0
  };

  for (const order of list) {
    if (!isRecord(order)) continue;

    if (isCancelledForStatistics(order) && !isTestOrderForStatistics(order)) {
      metrics.cancelledOrders += 1;
      metrics.cancelledAmount += getOrderTotal(order);
    }

    if (!isValidOrder(order)) continue;
    metrics.validOrders += 1;

    if (isPaid(order)) {
      metrics.paidOrders += 1;
      metrics.salesRevenue += getOrderTotal(order);
    } else {
      metrics.unpaidOrders += 1;
      metrics.outstandingAmount += getOrderTotal(order);
    }
  }

  metrics.averageTicket = metrics.paidOrders > 0
    ? metrics.salesRevenue / metrics.paidOrders
    : 0;
  return metrics;
}

export {
  isPaid,
  isCancelledForStatistics,
  isTestOrderForStatistics,
  isRevenueExcludedForStatistics,
  isValidOrder,
  isSalesRevenueOrder,
  isProductSalesOrder,
  getOrderTotal,
  calculateRevenueMetrics
};
