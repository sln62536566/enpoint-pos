import { calculateOrderItemPrice } from "./order-price-core.js";
import { isProductSalesOrder, getOrderTotal } from "./statistics-policy.js";
import { resolveBusinessDate, isValidBusinessDate } from "./statistics-time.js";
import { resolveReportingStoreId } from "./statistics-store.js";

const BREAKDOWN_STORE_ID = "defaultStore";
const BREAKDOWN_ALIASES = Object.freeze({ mainStore: BREAKDOWN_STORE_ID });
const UNKNOWN_BUCKET = "Unknown";

function toOrders(data) {
  if (Array.isArray(data)) return data.slice();
  if (!data || typeof data !== "object") return [];
  return Object.entries(data).map(([id, order]) => ({ id, ...(order || {}) }));
}

function safeShare(value, total) {
  const numerator = Number(value);
  const denominator = Number(total);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator : 0;
}

function normalizeProductName(item) {
  const value = item && (item.displayName || item.itemName || item.name);
  return String(value || "未命名商品").trim() || "未命名商品";
}

function normalizeLegacyName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-TW") || "未命名商品";
}

function getProductIdentity(item) {
  for (const field of ["itemId", "productId", "menuId"]) {
    const value = item && item[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      return { productKey: `${field}:${String(value).trim()}`, stable: true };
    }
  }
  const name = normalizeProductName(item);
  return { productKey: `legacy-name:${normalizeLegacyName(name)}`, stable: false };
}

function getItemQuantity(item) {
  const raw = item && (item.qty !== undefined ? item.qty : item.quantity);
  const quantity = raw === undefined ? 1 : Number(raw);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function normalizeSource(order) {
  const value = String(order && (order.orderSource || order.source) || "").trim().toUpperCase();
  if (value === "POS") return "POS";
  if (value === "QR") return "QR";
  return UNKNOWN_BUCKET;
}

function normalizeOrderType(order) {
  const value = String(order && order.type || "").trim();
  if (value === "內用") return "內用";
  if (value === "外帶") return "外帶";
  return UNKNOWN_BUCKET;
}

function createCommercialBucket(key) {
  return { key, paidOrders: 0, salesRevenue: 0, averageTicket: 0, revenueShare: 0, orderShare: 0 };
}

function finalizeCommercialBuckets(map, keys, totalRevenue, totalOrders) {
  return keys.map(key => {
    const bucket = map.get(key) || createCommercialBucket(key);
    bucket.averageTicket = bucket.paidOrders ? bucket.salesRevenue / bucket.paidOrders : 0;
    bucket.revenueShare = safeShare(bucket.salesRevenue, totalRevenue);
    bucket.orderShare = safeShare(bucket.paidOrders, totalOrders);
    return bucket;
  });
}

function addCommercialValue(map, key, revenue) {
  if (!map.has(key)) map.set(key, createCommercialBucket(key));
  const bucket = map.get(key);
  bucket.paidOrders += 1;
  bucket.salesRevenue += revenue;
}

function selectPaidValidOrders(data, options = {}) {
  const startBusinessDate = options.startBusinessDate;
  const endBusinessDate = options.endBusinessDate;
  if (!isValidBusinessDate(startBusinessDate) || !isValidBusinessDate(endBusinessDate) || startBusinessDate > endBusinessDate) {
    return { ok: false, errorCode: "INVALID_BREAKDOWN_RANGE", orders: [] };
  }
  const storeId = options.storeId || BREAKDOWN_STORE_ID;
  const aliases = options.aliases || BREAKDOWN_ALIASES;
  const orders = [];
  for (const order of toOrders(data)) {
    if (resolveReportingStoreId(order && order.storeId, { aliases, fallback: null }) !== storeId) continue;
    const businessDate = resolveBusinessDate(order);
    if (!businessDate || businessDate < startBusinessDate || businessDate > endBusinessDate) continue;
    if (isProductSalesOrder(order)) orders.push(order);
  }
  return { ok: true, orders };
}

function buildStatisticsBreakdowns(data, options = {}) {
  const selection = selectPaidValidOrders(data, options);
  if (!selection.ok) return selection;
  const products = new Map();
  const sources = new Map();
  const types = new Map();
  let totalRevenue = 0;

  for (const order of selection.orders) {
    const orderRevenue = getOrderTotal(order);
    totalRevenue += orderRevenue;
    addCommercialValue(sources, normalizeSource(order), orderRevenue);
    addCommercialValue(types, normalizeOrderType(order), orderRevenue);
    const seenProducts = new Set();
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const identity = getProductIdentity(item);
      const name = normalizeProductName(item);
      if (!products.has(identity.productKey)) {
        products.set(identity.productKey, { productKey: identity.productKey, name, quantity: 0, revenue: 0, orderCount: 0 });
      }
      const row = products.get(identity.productKey);
      if (name.localeCompare(row.name, "zh-TW") < 0) row.name = name;
      row.quantity += getItemQuantity(item);
      const subtotal = Number(calculateOrderItemPrice(item).subtotal);
      if (Number.isFinite(subtotal)) row.revenue += subtotal;
      if (!seenProducts.has(identity.productKey)) {
        row.orderCount += 1;
        seenProducts.add(identity.productKey);
      }
    }
  }

  const rows = Array.from(products.values());
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalProductRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  rows.forEach(row => { row.revenueShare = safeShare(row.revenue, totalProductRevenue); });
  const byQuantity = rows.slice().sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "zh-TW") || a.productKey.localeCompare(b.productKey));
  const byRevenue = rows.slice().sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "zh-TW") || a.productKey.localeCompare(b.productKey));
  const paidOrders = selection.orders.length;
  const sourceAnalytics = finalizeCommercialBuckets(sources, ["POS", "QR", UNKNOWN_BUCKET], totalRevenue, paidOrders);
  const orderTypeAnalytics = finalizeCommercialBuckets(types, ["內用", "外帶", UNKNOWN_BUCKET], totalRevenue, paidOrders);

  return {
    ok: true,
    range: { startBusinessDate: options.startBusinessDate, endBusinessDate: options.endBusinessDate },
    paidValidOrders: selection.orders,
    totals: { paidOrders, salesRevenue: totalRevenue },
    productAnalytics: { totalQuantity, totalProductRevenue, byQuantity, byRevenue },
    sourceAnalytics,
    orderTypeAnalytics,
    reconciliation: {
      sourceRevenueDelta: sourceAnalytics.reduce((sum, row) => sum + row.salesRevenue, 0) - totalRevenue,
      sourceOrderDelta: sourceAnalytics.reduce((sum, row) => sum + row.paidOrders, 0) - paidOrders,
      typeRevenueDelta: orderTypeAnalytics.reduce((sum, row) => sum + row.salesRevenue, 0) - totalRevenue,
      typeOrderDelta: orderTypeAnalytics.reduce((sum, row) => sum + row.paidOrders, 0) - paidOrders
    }
  };
}

export {
  BREAKDOWN_STORE_ID, BREAKDOWN_ALIASES, UNKNOWN_BUCKET,
  safeShare, getProductIdentity, getItemQuantity, normalizeSource, normalizeOrderType,
  selectPaidValidOrders, buildStatisticsBreakdowns
};
