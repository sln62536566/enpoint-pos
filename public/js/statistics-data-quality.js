function createStatisticsDiagnostics(totalInputOrders = 0) {
  return {
    totalInputOrders,
    includedStoreOrders: 0,
    rangeMatchedOrders: 0,
    unassignedStoreOrders: 0,
    invalidStoreOrders: 0,
    wrongStoreOrders: 0,
    unresolvedBusinessDateOrders: 0,
    invalidTotalOrders: 0,
    testOrders: 0,
    cancelledOrders: 0,
    revenueExcludedOrders: 0
  };
}

function isMissingStoreIdentity(value) {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function hasInvalidOrderTotal(order) {
  if (!order || typeof order !== "object") return true;
  if (order.total === null || order.total === undefined || typeof order.total === "boolean") return true;
  if (typeof order.total === "string" && !order.total.trim()) return true;
  return !Number.isFinite(Number(order.total));
}

export {
  createStatisticsDiagnostics,
  isMissingStoreIdentity,
  hasInvalidOrderTotal
};
