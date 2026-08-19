import { buildStatisticsReport } from "./statistics-core.js";
import {
  getBusinessMonthRange,
  getBusinessWeekRange,
  getTodayBusinessDate,
  resolveBusinessDate
} from "./statistics-time.js";
import { resolveReportingStoreId } from "./statistics-store.js";
import { calculateRevenueMetrics, isProductSalesOrder, isValidOrder } from "./statistics-policy.js";

let buildStatisticsBreakdownsFn = null;
let renderStatisticsAnalyticsFn = null;

function configureStatisticsAnalytics(options = {}) {
  if (typeof options.buildStatisticsBreakdowns === "function") buildStatisticsBreakdownsFn = options.buildStatisticsBreakdowns;
  if (typeof options.renderStatisticsAnalytics === "function") renderStatisticsAnalyticsFn = options.renderStatisticsAnalytics;
}

const CURRENT_REPORT_STORE_ID = "defaultStore";
const CURRENT_REPORT_ALIASES = Object.freeze({ mainStore: CURRENT_REPORT_STORE_ID });
const PERIODS = Object.freeze(["day", "week", "month"]);

function toOrders(orderData) {
  if (Array.isArray(orderData)) return orderData.slice();
  if (!orderData || typeof orderData !== "object") return [];
  return Object.entries(orderData).map(([id, order]) => ({ id, ...(order || {}) }));
}

function getCurrentPeriodRange(period, now = Date.now()) {
  const today = getTodayBusinessDate(now);
  if (!today) return null;
  if (period === "day") return { startDate: today, endDate: today };
  if (period === "week") return getBusinessWeekRange(today);
  if (period === "month") {
    const [year, month] = today.split("-").map(Number);
    return getBusinessMonthRange(year, month);
  }
  return null;
}

function formatDisplayDate(value) {
  return String(value || "").replace(/-/g, "/");
}

function getPeriodPresentation(period, range) {
  if (period === "day") {
    return { title: "今日", subtitle: formatDisplayDate(range.startDate), revenueLabel: "今日營收", ordersLabel: "今日有效訂單" };
  }
  if (period === "week") {
    return { title: "本週", subtitle: `${formatDisplayDate(range.startDate)} ～ ${formatDisplayDate(range.endDate)}`, revenueLabel: "本週營收", ordersLabel: "本週有效訂單" };
  }
  const [year, month] = range.startDate.split("-");
  return { title: "本月", subtitle: `${year} 年 ${Number(month)} 月`, revenueLabel: "本月營收", ordersLabel: "本月有效訂單" };
}

function selectCurrentOrderBuckets(orderData, range, today, aliases = CURRENT_REPORT_ALIASES) {
  const selectedRangeOrders = [];
  const todayOrders = [];
  for (const order of toOrders(orderData)) {
    const storeId = resolveReportingStoreId(order && order.storeId, { aliases, fallback: null });
    if (storeId !== CURRENT_REPORT_STORE_ID) continue;
    const businessDate = resolveBusinessDate(order);
    if (!businessDate) continue;
    if (businessDate >= range.startDate && businessDate <= range.endDate) selectedRangeOrders.push(order);
    if (businessDate === today) todayOrders.push(order);
  }
  return { selectedRangeOrders, todayOrders };
}

function getOperationalStatus(order) {
  const values = [order && order.status, order && order.kitchenStatus]
    .map(value => String(value || "").toLowerCase());
  if (values.some(value => value === "done" || value === "closed")) return "completed";
  if (values.some(value => value === "pending" || value === "confirmed" || value === "cooking")) return "processing";
  return "other";
}

function buildOperationalMetrics(orders) {
  const result = { processingOrders: 0, completedOrders: 0 };
  for (const order of orders) {
    if (!isValidOrder(order)) continue;
    const status = getOperationalStatus(order);
    if (status === "processing") result.processingOrders += 1;
    if (status === "completed") result.completedOrders += 1;
  }
  return result;
}

function getItemQuantity(item) {
  const value = item && (item.qty !== undefined ? item.qty : item.quantity);
  const quantity = value === undefined ? 1 : Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function getItemName(item) {
  const value = item && (item.displayName || item.itemName || item.name);
  return String(value || "未命名商品").trim() || "未命名商品";
}

function buildTopProducts(orders, limit = 5) {
  const totals = new Map();
  for (const order of orders) {
    if (!isProductSalesOrder(order) || !Array.isArray(order.items)) continue;
    for (const item of order.items) {
      const quantity = getItemQuantity(item);
      if (quantity <= 0) continue;
      const name = getItemName(item);
      totals.set(name, (totals.get(name) || 0) + quantity);
    }
  }
  return Array.from(totals, ([name, quantity]) => ({ name, quantity }))
    .sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name, "zh-TW"))
    .slice(0, Math.max(0, Number(limit) || 0));
}

function formatStatisticsCurrency(value) {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `NT$ ${safeAmount.toLocaleString("zh-TW")}`;
}

function buildCurrentStatisticsViewModel(orderData, options = {}) {
  const period = PERIODS.includes(options.period) ? options.period : "day";
  const range = getCurrentPeriodRange(period, options.now === undefined ? Date.now() : options.now);
  if (!range) return { ok: false, errorCode: "INVALID_CURRENT_PERIOD", message: "無法計算目前統計期間。" };
  const aliases = options.aliases || CURRENT_REPORT_ALIASES;
  const report = buildStatisticsReport(orderData, {
    storeId: CURRENT_REPORT_STORE_ID,
    aliases,
    startBusinessDate: range.startDate,
    endBusinessDate: range.endDate
  });
  if (!report.ok) return report;
  const today = getTodayBusinessDate(options.now === undefined ? Date.now() : options.now);
  const buckets = selectCurrentOrderBuckets(orderData, range, today, aliases);
  const closingMetrics = calculateRevenueMetrics(buckets.todayOrders);
  const analytics = buildStatisticsBreakdownsFn ? buildStatisticsBreakdownsFn(orderData, {
    storeId: CURRENT_REPORT_STORE_ID, aliases,
    startBusinessDate: range.startDate, endBusinessDate: range.endDate
  }) : null;
  return {
    ...report,
    period,
    presentation: getPeriodPresentation(period, range),
    operational: buildOperationalMetrics(buckets.selectedRangeOrders),
    analytics,
    topProducts: analytics ? analytics.productAnalytics.byQuantity.slice(0, 5) : buildTopProducts(buckets.selectedRangeOrders, 5),
    closingPreview: {
      salesRevenue: closingMetrics.salesRevenue,
      validOrders: closingMetrics.validOrders,
      cancelledOrders: closingMetrics.cancelledOrders
    }
  };
}

function setText(documentRef, id, value) {
  const element = documentRef.getElementById(id);
  if (element) element.textContent = String(value);
}

function renderTopProducts(documentRef, products) {
  const container = documentRef.getElementById("topItemsList");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!products.length) {
    const empty = documentRef.createElement("div");
    empty.className = "empty";
    empty.textContent = "目前沒有已付款商品資料";
    container.appendChild(empty);
    return;
  }
  products.forEach((product, index) => {
    const row = documentRef.createElement("div");
    row.className = "top-item-row";
    const label = documentRef.createElement("span");
    label.textContent = `${index + 1}. ${product.name}`;
    const quantity = documentRef.createElement("strong");
    quantity.textContent = `${product.quantity} 份`;
    row.appendChild(label);
    row.appendChild(quantity);
    container.appendChild(row);
  });
}

function renderCurrentStatistics(documentRef, viewModel) {
  const error = documentRef.getElementById("statisticsV2Error");
  if (!viewModel || viewModel.ok !== true) {
    if (error) {
      error.hidden = false;
      error.textContent = "統計資料暫時無法載入";
    }
    return false;
  }
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  const metrics = viewModel.metrics;
  setText(documentRef, "statisticsPeriodTitle", viewModel.presentation.title);
  setText(documentRef, "statisticsPeriodRange", viewModel.presentation.subtitle);
  setText(documentRef, "statRevenueLabel", viewModel.presentation.revenueLabel);
  setText(documentRef, "statTotalOrdersLabel", viewModel.presentation.ordersLabel);
  setText(documentRef, "statTodayRevenue", formatStatisticsCurrency(metrics.salesRevenue));
  setText(documentRef, "statTotalOrders", metrics.validOrders);
  setText(documentRef, "statAverageOrder", formatStatisticsCurrency(metrics.averageTicket));
  setText(documentRef, "statPaidOrders", metrics.paidOrders);
  setText(documentRef, "statUnpaidOrders", metrics.unpaidOrders);
  setText(documentRef, "statOutstandingAmount", formatStatisticsCurrency(metrics.outstandingAmount));
  setText(documentRef, "statCancelledOrders", metrics.cancelledOrders);
  setText(documentRef, "statCancelledAmount", formatStatisticsCurrency(metrics.cancelledAmount));
  setText(documentRef, "statProcessingOrders", viewModel.operational.processingOrders);
  setText(documentRef, "statDoneOrders", viewModel.operational.completedOrders);
  setText(documentRef, "closingRevenue", formatStatisticsCurrency(viewModel.closingPreview.salesRevenue));
  setText(documentRef, "closingValidOrders", viewModel.closingPreview.validOrders);
  setText(documentRef, "closingCancelledOrders", viewModel.closingPreview.cancelledOrders);
  renderTopProducts(documentRef, viewModel.topProducts);
  if (renderStatisticsAnalyticsFn && viewModel.analytics) {
    renderStatisticsAnalyticsFn(documentRef, documentRef.getElementById("currentAnalyticsDetails"), viewModel.analytics, { includeQuantity: false });
  }
  return true;
}

function hasDataQualityWarning(diagnostics) {
  return diagnostics && (
    diagnostics.unassignedStoreOrders > 0 || diagnostics.invalidStoreOrders > 0 ||
    diagnostics.unresolvedBusinessDateOrders > 0 || diagnostics.invalidTotalOrders > 0
  );
}

function createCurrentReportsController(options = {}) {
  const documentRef = options.documentRef;
  const getOrders = typeof options.getOrders === "function" ? options.getOrders : () => ({});
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const logger = options.logger || console;
  const onPeriodSelected = typeof options.onPeriodSelected === "function" ? options.onPeriodSelected : () => {};
  let selectedPeriod = "day";
  let initialized = false;

  function updateButtons() {
    const buttons = documentRef ? documentRef.querySelectorAll(".report-range-btn") : [];
    buttons.forEach(button => button.classList.toggle("active", button.dataset.range === selectedPeriod));
  }

  function refresh() {
    try {
      const viewModel = buildCurrentStatisticsViewModel(getOrders(), { period: selectedPeriod, now: now() });
      if (documentRef) renderCurrentStatistics(documentRef, viewModel);
      if (viewModel.ok && hasDataQualityWarning(viewModel.diagnostics) && logger && typeof logger.warn === "function") {
        logger.warn("Statistics v2 data quality diagnostics", viewModel.diagnostics);
      }
      if (!viewModel.ok && logger && typeof logger.warn === "function") logger.warn("Statistics v2 report error", viewModel.errorCode);
      return viewModel;
    } catch (error) {
      const failure = { ok: false, errorCode: "CURRENT_REPORT_FAILED", message: error && error.message ? error.message : "Current report failed." };
      if (documentRef) renderCurrentStatistics(documentRef, failure);
      if (logger && typeof logger.warn === "function") logger.warn("Statistics v2 render failure", failure.errorCode);
      return failure;
    }
  }

  function setPeriod(period) {
    if (!PERIODS.includes(period)) return { ok: false, errorCode: "INVALID_CURRENT_PERIOD" };
    selectedPeriod = period;
    onPeriodSelected(period);
    updateButtons();
    return refresh();
  }

  function initialize() {
    if (!initialized && documentRef) {
      documentRef.querySelectorAll(".report-range-btn").forEach(button => {
        button.addEventListener("click", () => setPeriod(button.dataset.range));
      });
      initialized = true;
    }
    updateButtons();
    return refresh();
  }

  return Object.freeze({ initialize, refresh, setPeriod, getSelectedPeriod: () => selectedPeriod });
}

export {
  CURRENT_REPORT_STORE_ID,
  CURRENT_REPORT_ALIASES,
  getCurrentPeriodRange,
  selectCurrentOrderBuckets,
  buildOperationalMetrics,
  buildTopProducts,
  configureStatisticsAnalytics,
  formatStatisticsCurrency,
  buildCurrentStatisticsViewModel,
  renderCurrentStatistics,
  createCurrentReportsController
};
