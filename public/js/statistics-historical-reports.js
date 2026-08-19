import { calculateRevenueMetrics } from "./statistics-policy.js";
import { resolveBusinessDate, getTodayBusinessDate, isValidBusinessDate } from "./statistics-time.js";
import { resolveReportingStoreId } from "./statistics-store.js";
import { createMemoryStatisticsAdapter, createStatisticsQueryService } from "./statistics-query.js";
import { formatStatisticsCurrency } from "./statistics-current-reports.js";

let buildStatisticsBreakdownsFn = null;
let renderStatisticsAnalyticsFn = null;

function configureHistoricalStatisticsAnalytics(options = {}) {
  if (typeof options.buildStatisticsBreakdowns === "function") buildStatisticsBreakdownsFn = options.buildStatisticsBreakdowns;
  if (typeof options.renderStatisticsAnalytics === "function") renderStatisticsAnalyticsFn = options.renderStatisticsAnalytics;
}

const HISTORICAL_STORE_ID = "defaultStore";
const HISTORICAL_ALIASES = Object.freeze({ mainStore: HISTORICAL_STORE_ID });
const MAX_CUSTOM_RANGE_DAYS = 366;

function toOrders(data) {
  if (Array.isArray(data)) return data.slice();
  if (!data || typeof data !== "object") return [];
  return Object.entries(data).map(([id, order]) => ({ id, ...(order || {}) }));
}

function selectCanonicalHistoricalOrders(data, aliases = HISTORICAL_ALIASES) {
  const result = [];
  for (const order of toOrders(data)) {
    const storeId = resolveReportingStoreId(order.storeId, { aliases, fallback: null });
    if (storeId !== HISTORICAL_STORE_ID) continue;
    const businessDate = resolveBusinessDate(order);
    if (!businessDate) continue;
    result.push({ order, businessDate });
  }
  return result;
}

function collectAvailableHistoricalYears(data, aliases = HISTORICAL_ALIASES) {
  return Array.from(new Set(selectCanonicalHistoricalOrders(data, aliases)
    .map(entry => Number(entry.businessDate.slice(0, 4)))))
    .filter(Number.isInteger)
    .sort((a, b) => b - a);
}

function buildHistoricalYearSummaries(data, aliases = HISTORICAL_ALIASES) {
  const groups = new Map();
  for (const entry of selectCanonicalHistoricalOrders(data, aliases)) {
    const year = Number(entry.businessDate.slice(0, 4));
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(entry.order);
  }
  return Array.from(groups, ([year, orders]) => ({ year, metrics: calculateRevenueMetrics(orders) }))
    .sort((a, b) => b.year - a.year);
}

function emptyMetrics() {
  return calculateRevenueMetrics([]);
}

function aggregateYearMonths(report, year) {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, metrics: emptyMetrics() }));
  for (const day of report && Array.isArray(report.daily) ? report.daily : []) {
    if (!day.businessDate.startsWith(`${year}-`)) continue;
    const month = Number(day.businessDate.slice(5, 7));
    const target = months[month - 1];
    if (!target) continue;
    for (const key of ["salesRevenue", "paidOrders", "unpaidOrders", "outstandingAmount", "validOrders", "cancelledOrders", "cancelledAmount"]) {
      target.metrics[key] += Number(day.metrics[key] || 0);
    }
    target.metrics.averageTicket = target.metrics.paidOrders
      ? target.metrics.salesRevenue / target.metrics.paidOrders : 0;
  }
  return months;
}

function getRangeDayCount(startDate, endDate) {
  if (!isValidBusinessDate(startDate) || !isValidBusinessDate(endDate) || startDate > endDate) return null;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

function validateCustomRange(startDate, endDate) {
  const days = getRangeDayCount(startDate, endDate);
  if (days === null) return { ok: false, errorCode: "INVALID_RANGE", message: "開始日期不能晚於結束日期" };
  if (days > MAX_CUSTOM_RANGE_DAYS) return { ok: false, errorCode: "RANGE_TOO_LARGE", message: "自訂查詢最多 366 天，請縮小日期範圍" };
  return { ok: true, days };
}

function buildDayOrderRows(data, businessDate, aliases = HISTORICAL_ALIASES) {
  return selectCanonicalHistoricalOrders(data, aliases)
    .filter(entry => entry.businessDate === businessDate)
    .map(entry => {
      const order = entry.order;
      return {
        id: order.id || "",
        orderNumber: order.orderNumber || order.id || "-",
        createdAt: Number(order.createdAt) || 0,
        time: order.createdAt ? new Date(order.createdAt).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }) : "-",
        source: order.orderSource || order.source || "-",
        type: order.type || "-",
        table: order.table || "-",
        total: Number.isFinite(Number(order.total)) ? Number(order.total) : 0,
        payment: order.paymentStatus === "paid" || order.paid === true ? "已付款" : "未付款",
        status: order.kitchenStatus || order.status || "-"
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function appendText(documentRef, parent, tag, text, className = "") {
  const element = documentRef.createElement(tag);
  element.textContent = String(text);
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function clear(element) {
  while (element && element.firstChild) element.removeChild(element.firstChild);
}

function renderMetricSummary(documentRef, parent, metrics) {
  const grid = documentRef.createElement("div");
  grid.className = "stats-grid";
  const values = [
    ["營收", formatStatisticsCurrency(metrics.salesRevenue)], ["有效訂單", metrics.validOrders],
    ["平均客單價", formatStatisticsCurrency(metrics.averageTicket)], ["已付款", metrics.paidOrders],
    ["未付款", metrics.unpaidOrders], ["未收款", formatStatisticsCurrency(metrics.outstandingAmount)],
    ["取消訂單", metrics.cancelledOrders], ["取消金額", formatStatisticsCurrency(metrics.cancelledAmount)]
  ];
  values.forEach(([label, value]) => {
    const card = documentRef.createElement("div"); card.className = "stat-card";
    appendText(documentRef, card, "span", label); appendText(documentRef, card, "strong", value); grid.appendChild(card);
  });
  parent.appendChild(grid);
}

function createHistoricalReportsController(options = {}) {
  const documentRef = options.documentRef;
  const getOrders = typeof options.getOrders === "function" ? options.getOrders : () => ({});
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const logger = options.logger || console;
  let active = false;
  let initialized = false;
  const today = () => getTodayBusinessDate(now());
  const state = { mode: "year", selectedYear: Number(today().slice(0, 4)), selectedMonth: null, selectedDay: null, customStart: "", customEnd: "" };

  function elements() {
    return {
      current: documentRef && documentRef.getElementById("currentStatsContent"),
      panel: documentRef && documentRef.getElementById("historicalStatsPanel"),
      content: documentRef && documentRef.getElementById("historicalStatsContent"),
      error: documentRef && documentRef.getElementById("historicalStatsError"),
      breadcrumb: documentRef && documentRef.getElementById("historicalBreadcrumb"),
      year: documentRef && documentRef.getElementById("historicalYearSelect"),
      month: documentRef && documentRef.getElementById("historicalMonthSelect"),
      start: documentRef && documentRef.getElementById("historicalStartDate"),
      end: documentRef && documentRef.getElementById("historicalEndDate")
    };
  }

  function setVisibility() {
    const el = elements();
    if (el.current) el.current.hidden = active;
    if (el.panel) el.panel.hidden = !active;
    if (active && documentRef) documentRef.querySelectorAll(".report-range-btn").forEach(button => button.classList.remove("active"));
    if (documentRef) documentRef.querySelectorAll(".historical-mode-btn").forEach(button => {
      button.classList.toggle("active", active && button.dataset.historicalMode === state.mode);
    });
  }

  function showError(message) {
    const el = elements();
    if (el.error) { el.error.hidden = false; el.error.textContent = message || "歷史統計暫時無法載入"; }
  }

  function setBreadcrumb(parts) {
    const target = elements().breadcrumb;
    if (target) target.textContent = parts.join(" > ");
  }

  function syncSelectors(years) {
    const el = elements();
    if (el.year) {
      clear(el.year);
      const values = Array.from(new Set([...years, state.selectedYear])).sort((a, b) => b - a);
      values.forEach(year => { const option = documentRef.createElement("option"); option.value = String(year); option.textContent = String(year); el.year.appendChild(option); });
      el.year.value = String(state.selectedYear);
    }
    if (el.month) el.month.value = state.selectedMonth ? String(state.selectedMonth) : "";
    if (el.start) el.start.value = state.customStart;
    if (el.end) el.end.value = state.customEnd;
  }

  async function query(method, values) {
    const adapter = createMemoryStatisticsAdapter(getOrders());
    const service = createStatisticsQueryService({ adapter });
    return service[method]({ storeId: HISTORICAL_STORE_ID, aliases: HISTORICAL_ALIASES, ...values });
  }

  function appendAnalytics(content, startBusinessDate, endBusinessDate) {
    if (!buildStatisticsBreakdownsFn) return null;
    const analytics = buildStatisticsBreakdownsFn(getOrders(), {
      storeId: HISTORICAL_STORE_ID, aliases: HISTORICAL_ALIASES,
      startBusinessDate, endBusinessDate
    });
    if (analytics.ok && content) {
      const container = documentRef.createElement("div");
      content.appendChild(container);
      renderStatisticsAnalyticsFn(documentRef, container, analytics);
    }
    return analytics;
  }

  async function renderYear() {
    const report = await query("getYear", { year: state.selectedYear });
    if (!report.ok) return report;
    const content = elements().content; if (!content) return report;
    clear(content); setBreadcrumb(["歷史報表", String(state.selectedYear)]);
    renderMetricSummary(documentRef, content, report.metrics);
    if (!report.daily.length) appendText(documentRef, content, "div", "此年度目前沒有營運資料", "empty");
    const list = documentRef.createElement("div"); list.className = "closing-check-list";
    aggregateYearMonths(report, state.selectedYear).forEach(value => {
      const button = documentRef.createElement("button"); button.type = "button"; button.className = "closing-check-item";
      button.dataset.historicalMonth = String(value.month);
      button.textContent = `${value.month} 月　${formatStatisticsCurrency(value.metrics.salesRevenue)}　${value.metrics.validOrders} 筆`;
      list.appendChild(button);
    });
    content.appendChild(list);
    const analytics = appendAnalytics(content, `${state.selectedYear}-01-01`, `${state.selectedYear}-12-31`);
    return { ...report, analytics };
  }

  async function renderHistory() {
    const summaries = buildHistoricalYearSummaries(getOrders());
    const content = elements().content; if (!content) return { ok: true, summaries };
    clear(content); setBreadcrumb(["歷史年份"]);
    if (!summaries.length) { appendText(documentRef, content, "div", "目前沒有可查詢的歷年資料", "empty"); return { ok: true, summaries }; }
    const list = documentRef.createElement("div"); list.className = "closing-check-list";
    summaries.forEach(value => { const button = documentRef.createElement("button"); button.type = "button"; button.className = "closing-check-item"; button.dataset.historicalYear = String(value.year); button.textContent = `${value.year}　${formatStatisticsCurrency(value.metrics.salesRevenue)}　${value.metrics.validOrders} 筆`; list.appendChild(button); });
    content.appendChild(list); return { ok: true, summaries };
  }

  async function renderMonth() {
    const report = await query("getMonth", { year: state.selectedYear, month: state.selectedMonth });
    if (!report.ok) return report;
    const content = elements().content; if (!content) return report;
    clear(content); setBreadcrumb(["歷史報表", String(state.selectedYear), `${state.selectedMonth} 月`]); renderMetricSummary(documentRef, content, report.metrics);
    if (!report.daily.length) appendText(documentRef, content, "div", "此月份目前沒有營運資料", "empty");
    report.daily.forEach(day => { const button = documentRef.createElement("button"); button.type = "button"; button.className = "closing-check-item"; button.dataset.historicalDay = day.businessDate; button.textContent = `${day.businessDate.slice(5).replace("-", "/")}　${formatStatisticsCurrency(day.metrics.salesRevenue)}　${day.metrics.validOrders} 筆`; content.appendChild(button); });
    const month = String(state.selectedMonth).padStart(2, "0");
    const endDay = new Date(Date.UTC(state.selectedYear, state.selectedMonth, 0)).getUTCDate();
    const analytics = appendAnalytics(content, `${state.selectedYear}-${month}-01`, `${state.selectedYear}-${month}-${String(endDay).padStart(2, "0")}`);
    return { ...report, analytics };
  }

  async function renderDay() {
    const report = await query("getDay", { businessDate: state.selectedDay });
    if (!report.ok) return report;
    const content = elements().content; if (!content) return report;
    clear(content); setBreadcrumb(["歷史報表", String(state.selectedYear), `${state.selectedMonth} 月`, state.selectedDay.replace(/-/g, "/")]); renderMetricSummary(documentRef, content, report.metrics);
    const rows = buildDayOrderRows(getOrders(), state.selectedDay);
    if (!rows.length) appendText(documentRef, content, "div", "此日期目前沒有訂單資料", "empty");
    rows.forEach(row => { const card = documentRef.createElement("div"); card.className = "closing-check-item"; appendText(documentRef, card, "strong", `#${row.orderNumber}　${formatStatisticsCurrency(row.total)}`); appendText(documentRef, card, "span", `${row.time}｜${row.source}｜${row.type}｜${row.table}｜${row.payment}｜${row.status}`); content.appendChild(card); });
    const analytics = appendAnalytics(content, state.selectedDay, state.selectedDay);
    return { ...report, orderRows: rows, analytics };
  }

  async function renderCustom() {
    const validation = validateCustomRange(state.customStart, state.customEnd);
    if (!validation.ok) return validation;
    const report = await query("getRange", { startBusinessDate: state.customStart, endBusinessDate: state.customEnd });
    if (!report.ok) return report;
    const content = elements().content; if (content) { clear(content); setBreadcrumb(["自訂範圍", `${state.customStart} ～ ${state.customEnd}`]); renderMetricSummary(documentRef, content, report.metrics); if (!report.daily.length) appendText(documentRef, content, "div", "此範圍沒有可顯示的資料", "empty"); }
    const analytics = appendAnalytics(content, state.customStart, state.customEnd);
    return { ...report, analytics };
  }

  async function refresh() {
    if (!active) return { ok: true, inactive: true };
    try {
      setVisibility();
      const years = collectAvailableHistoricalYears(getOrders()); syncSelectors(years);
      const el = elements(); if (el.error) { el.error.hidden = true; el.error.textContent = ""; }
      let result;
      if (state.mode === "history") result = await renderHistory();
      else if (state.mode === "custom") result = await renderCustom();
      else if (state.selectedDay) result = await renderDay();
      else if (state.selectedMonth) result = await renderMonth();
      else result = await renderYear();
      if (!result.ok) showError(result.message); return result;
    } catch (error) {
      if (logger && logger.warn) logger.warn("Historical Statistics render failure", error);
      showError("歷史統計暫時無法載入"); return { ok: false, errorCode: "HISTORICAL_REPORT_FAILED" };
    }
  }

  function activate(mode) {
    active = true;
    state.mode = mode;
    state.selectedMonth = null;
    state.selectedDay = null;
    if (mode === "custom" && (!state.customStart || !state.customEnd)) {
      state.customStart = today();
      state.customEnd = today();
    }
    setVisibility();
    return refresh();
  }
  function deactivate() { active = false; setVisibility(); return { ok: true }; }
  function selectYear(year) { const value = Number(year); if (!Number.isInteger(value) || value < 1) return { ok: false, errorCode: "INVALID_YEAR" }; state.mode = "year"; state.selectedYear = value; state.selectedMonth = null; state.selectedDay = null; return refresh(); }
  function selectMonth(month) { const value = Number(month); if (!Number.isInteger(value) || value < 1 || value > 12) return { ok: false, errorCode: "INVALID_MONTH" }; state.mode = "year"; state.selectedMonth = value; state.selectedDay = null; return refresh(); }
  function selectDay(day) { if (!isValidBusinessDate(day)) return { ok: false, errorCode: "INVALID_DAY" }; state.selectedDay = day; state.selectedMonth = Number(day.slice(5, 7)); state.selectedYear = Number(day.slice(0, 4)); return refresh(); }
  function setCustomRange(start, end) { state.customStart = start; state.customEnd = end; state.mode = "custom"; return refresh(); }
  function back() { if (state.selectedDay) { state.selectedDay = null; return refresh(); } if (state.selectedMonth) { state.selectedMonth = null; return refresh(); } state.mode = "history"; return refresh(); }

  function initialize() {
    if (!initialized && documentRef) {
      documentRef.querySelectorAll(".historical-mode-btn").forEach(button => button.addEventListener("click", () => activate(button.dataset.historicalMode)));
      const el = elements();
      if (el.year) el.year.addEventListener("change", () => selectYear(el.year.value));
      if (el.month) el.month.addEventListener("change", () => el.month.value ? selectMonth(el.month.value) : selectYear(state.selectedYear));
      const apply = documentRef.getElementById("historicalApplyRange"); if (apply) apply.addEventListener("click", () => setCustomRange(el.start.value, el.end.value));
      const backButton = documentRef.getElementById("historicalBackBtn"); if (backButton) backButton.addEventListener("click", back);
      if (el.content) el.content.addEventListener("click", event => { const target = event.target.closest ? event.target.closest("[data-historical-year],[data-historical-month],[data-historical-day]") : event.target; if (!target || !target.dataset) return; if (target.dataset.historicalYear) selectYear(target.dataset.historicalYear); else if (target.dataset.historicalMonth) selectMonth(target.dataset.historicalMonth); else if (target.dataset.historicalDay) selectDay(target.dataset.historicalDay); });
      initialized = true;
    }
    setVisibility(); return { ok: true };
  }

  return Object.freeze({ initialize, refresh, activate, deactivate, selectYear, selectMonth, selectDay, setCustomRange, back, isActive: () => active, getState: () => ({ ...state }) });
}

export {
  HISTORICAL_STORE_ID, HISTORICAL_ALIASES, MAX_CUSTOM_RANGE_DAYS,
  configureHistoricalStatisticsAnalytics,
  selectCanonicalHistoricalOrders, collectAvailableHistoricalYears, buildHistoricalYearSummaries,
  aggregateYearMonths, validateCustomRange, buildDayOrderRows, createHistoricalReportsController
};
