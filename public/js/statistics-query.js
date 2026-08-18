import { buildStatisticsReport } from "./statistics-core.js";
import {
  getBusinessMonthRange,
  getBusinessWeekRange,
  getBusinessYearRange,
  isValidBusinessDate,
  resolveBusinessDate
} from "./statistics-time.js";

function failure(errorCode, message) {
  return { ok: false, errorCode, message };
}

function createStatisticsQueryService({ adapter } = {}) {
  if (!adapter || typeof adapter.getRange !== "function") {
    throw new TypeError("Statistics query service requires an adapter with getRange().");
  }

  async function getRange(options = {}) {
    if (!isValidBusinessDate(options.startBusinessDate) || !isValidBusinessDate(options.endBusinessDate) ||
        options.startBusinessDate > options.endBusinessDate) {
      return failure("INVALID_RANGE", "A valid inclusive business-date range is required.");
    }
    const requestedRange = { startDate: options.startBusinessDate, endDate: options.endBusinessDate };
    let effectiveOptions = options;
    let activationMeta = null;
    if (options.activationBusinessDate !== undefined && options.activationBusinessDate !== null) {
      if (!isValidBusinessDate(options.activationBusinessDate)) {
        return failure("INVALID_ACTIVATION_DATE", "activationBusinessDate must be a valid business date.");
      }
      const clampedStart = options.activationBusinessDate > options.startBusinessDate
        ? options.activationBusinessDate
        : options.startBusinessDate;
      activationMeta = {
        activationBusinessDate: options.activationBusinessDate,
        activationClamped: clampedStart !== options.startBusinessDate,
        requestedRange,
        effectiveRange: clampedStart > options.endBusinessDate
          ? null
          : { startDate: clampedStart, endDate: options.endBusinessDate }
      };
      if (!activationMeta.effectiveRange) {
        const emptyReport = buildStatisticsReport([], options);
        return { ...emptyReport, queryMeta: { source: "activation-boundary", realtime: false, ...activationMeta } };
      }
      effectiveOptions = { ...options, startBusinessDate: clampedStart };
    }
    try {
      const adapterResult = await adapter.getRange(effectiveOptions);
      if (!adapterResult || adapterResult.ok !== true) {
        return adapterResult && adapterResult.ok === false
          ? adapterResult
          : failure("MALFORMED_ADAPTER_RESULT", "Historical adapter returned an invalid result.");
      }
      if (!Array.isArray(adapterResult.orders)) {
        return failure("MALFORMED_ADAPTER_RESULT", "Historical adapter orders must be an array.");
      }
      const report = buildStatisticsReport(adapterResult.orders, effectiveOptions);
      if (!report.ok) return report;
      return {
        ...report,
        queryMeta: activationMeta
          ? { ...(adapterResult.queryMeta || {}), ...activationMeta }
          : (adapterResult.queryMeta || {})
      };
    } catch (error) {
      return failure("QUERY_FAILED", error && error.message ? error.message : "Historical query failed.");
    }
  }

  function getDay(options = {}) {
    if (!isValidBusinessDate(options.businessDate)) return Promise.resolve(failure("INVALID_RANGE", "A valid businessDate is required."));
    return getRange({ ...options, startBusinessDate: options.businessDate, endBusinessDate: options.businessDate });
  }

  function getWeek(options = {}) {
    const range = getBusinessWeekRange(options.businessDate);
    if (!range) return Promise.resolve(failure("INVALID_RANGE", "A valid businessDate is required."));
    return getRange({ ...options, startBusinessDate: range.startDate, endBusinessDate: range.endDate });
  }

  function getMonth(options = {}) {
    const range = getBusinessMonthRange(options.year, options.month);
    if (!range) return Promise.resolve(failure("INVALID_RANGE", "A valid year and month are required."));
    return getRange({ ...options, startBusinessDate: range.startDate, endBusinessDate: range.endDate });
  }

  function getYear(options = {}) {
    const range = getBusinessYearRange(options.year);
    if (!range) return Promise.resolve(failure("INVALID_RANGE", "A valid year is required."));
    return getRange({ ...options, startBusinessDate: range.startDate, endBusinessDate: range.endDate });
  }

  return Object.freeze({ getRange, getDay, getWeek, getMonth, getYear });
}

function createMemoryStatisticsAdapter(orderData) {
  const source = Array.isArray(orderData)
    ? orderData.slice()
    : Object.entries(orderData && typeof orderData === "object" ? orderData : {})
      .map(([id, order]) => ({ id, ...(order || {}) }));

  return Object.freeze({
    async getRange(options = {}) {
      if (!isValidBusinessDate(options.startBusinessDate) || !isValidBusinessDate(options.endBusinessDate) ||
          options.startBusinessDate > options.endBusinessDate) {
        return failure("INVALID_RANGE", "A valid inclusive business-date range is required.");
      }
      const orders = source.filter(order => {
        const date = resolveBusinessDate(order);
        return date && date >= options.startBusinessDate && date <= options.endBusinessDate;
      });
      return {
        ok: true,
        storeId: options.storeId,
        requestedRange: { startDate: options.startBusinessDate, endDate: options.endBusinessDate },
        orders,
        queryMeta: {
          source: "memory",
          realtime: false,
          storeFilter: "statistics-core",
          legacyCoverage: "complete"
        }
      };
    }
  });
}

export { createStatisticsQueryService, createMemoryStatisticsAdapter };
