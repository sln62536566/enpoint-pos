import {
  isPaid,
  isValidOrder,
  isSalesRevenueOrder
} from "./statistics-policy.js";
import {
  isValidBusinessDate,
  resolveBusinessDate
} from "./statistics-time.js";

const DEFAULT_REPORTING_STORE_ID = "defaultStore";
const STORE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MISSING_STORE_ID = "__missing__";

function normalizeStoreId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && STORE_ID_PATTERN.test(normalized) ? normalized : null;
}

function resolveReportingStoreId(value, options = {}) {
  const isMissing = value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
  const normalized = normalizeStoreId(value);
  const aliases = options.aliases && typeof options.aliases === "object" ? options.aliases : {};
  if (normalized && Object.prototype.hasOwnProperty.call(aliases, normalized)) {
    return normalizeStoreId(aliases[normalized]);
  }
  if (normalized) return normalized;
  if (!isMissing) return null;
  if (Object.prototype.hasOwnProperty.call(options, "fallback")) {
    return normalizeStoreId(options.fallback);
  }
  return DEFAULT_REPORTING_STORE_ID;
}

function toOrderList(orderData) {
  if (Array.isArray(orderData)) return orderData;
  if (!orderData || typeof orderData !== "object") return [];
  return Object.entries(orderData).map(([id, order]) => ({ id, ...(order || {}) }));
}

function updateDateBounds(summary, date) {
  if (!date) return;
  if (!summary.earliestBusinessDate || date < summary.earliestBusinessDate) summary.earliestBusinessDate = date;
  if (!summary.latestBusinessDate || date > summary.latestBusinessDate) summary.latestBusinessDate = date;
}

function createInventorySummary(storeId) {
  return {
    storeId: storeId === MISSING_STORE_ID ? null : storeId,
    missingStoreId: storeId === MISSING_STORE_ID,
    count: 0,
    paidValidCount: 0,
    earliestBusinessDate: null,
    latestBusinessDate: null,
    sources: {}
  };
}

function summarizeStoreInventory(orderData, options = {}) {
  const summaries = new Map();
  for (const order of toOrderList(orderData)) {
    const rawStoreId = normalizeStoreId(order && order.storeId);
    const resolvedStoreId = rawStoreId
      ? resolveReportingStoreId(rawStoreId, { aliases: options.aliases })
      : MISSING_STORE_ID;
    const storeId = resolvedStoreId || MISSING_STORE_ID;
    if (!summaries.has(storeId)) summaries.set(storeId, createInventorySummary(storeId));
    const summary = summaries.get(storeId);
    summary.count += 1;
    if (isSalesRevenueOrder(order)) summary.paidValidCount += 1;
    const source = String(order.orderSource || order.source || "unknown").trim() || "unknown";
    summary.sources[source] = (summary.sources[source] || 0) + 1;
    updateDateBounds(summary, resolveBusinessDate(order));
  }
  return Array.from(summaries.values()).sort((a, b) => {
    if (a.missingStoreId !== b.missingStoreId) return a.missingStoreId ? 1 : -1;
    return String(a.storeId).localeCompare(String(b.storeId));
  });
}

function addCandidate(target, date, source, confidence, reason) {
  if (!isValidBusinessDate(date)) return;
  target.push({ date, source, confidence, reason });
}

function calculateStoreActivationCandidates(input = {}) {
  const orders = toOrderList(input.orders);
  const validOrders = orders
    .map(order => ({ order, date: resolveBusinessDate(order) }))
    .filter(entry => entry.date && isValidOrder(entry.order));
  const paidValidDates = validOrders.filter(entry => isPaid(entry.order)).map(entry => entry.date).sort();
  const validDates = validOrders.map(entry => entry.date).sort();
  const candidates = [];

  if (paidValidDates.length) addCandidate(candidates, paidValidDates[0], "paid-valid-order", "high", "Earliest paid valid order");
  if (validDates.length) addCandidate(candidates, validDates[0], "valid-order", "medium", "Earliest valid order");

  const businessDays = Array.isArray(input.businessDays) ? input.businessDays : [];
  const businessDayDates = businessDays
    .map(value => typeof value === "string" ? value : value && (value.date || value.businessDate))
    .filter(isValidBusinessDate)
    .sort();
  if (businessDayDates.length) addCandidate(candidates, businessDayDates[0], "business-day", "high", "Earliest supplied business-day evidence");

  const trustedEvidence = Array.isArray(input.trustedEvidence) ? input.trustedEvidence : [];
  for (const evidence of trustedEvidence) {
    if (!evidence || evidence.trusted !== true) continue;
    addCandidate(candidates, evidence.date, evidence.source || "trusted-evidence", evidence.confidence || "high", evidence.reason || "Explicitly supplied trusted evidence");
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
  return { status: "pending_confirmation", selected: null, persisted: false, candidates };
}

export {
  DEFAULT_REPORTING_STORE_ID,
  MISSING_STORE_ID,
  normalizeStoreId,
  resolveReportingStoreId,
  summarizeStoreInventory,
  calculateStoreActivationCandidates
};
