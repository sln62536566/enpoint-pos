const STATISTICS_TIME_ZONE = "Asia/Taipei";
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_CANONICAL_EPOCH_MS = Date.UTC(2000, 0, 1);

function isValidBusinessDate(value) {
  if (typeof value !== "string") return false;
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function timestampToBusinessDate(value) {
  const timestamp = value instanceof Date
    ? value.getTime()
    : (typeof value === "number" ? value : NaN);
  if (!Number.isInteger(timestamp) || timestamp < MIN_CANONICAL_EPOCH_MS) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATISTICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  const result = `${values.year}-${values.month}-${values.day}`;
  return isValidBusinessDate(result) ? result : null;
}

function resolveBusinessDate(order) {
  if (!order || typeof order !== "object") return null;
  if (isValidBusinessDate(order.businessDate)) return order.businessDate;
  return timestampToBusinessDate(order.createdAt);
}

function getTodayBusinessDate(now = Date.now()) {
  return timestampToBusinessDate(now);
}

function parseBusinessDate(value) {
  if (!isValidBusinessDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getBusinessWeekRange(value) {
  const date = parseBusinessDate(value);
  if (!date) return null;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { startDate: formatUtcDate(start), endDate: formatUtcDate(end) };
}

function getBusinessMonthRange(year, month) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 1 ||
      !Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) return null;
  const start = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, 1));
  const end = new Date(Date.UTC(normalizedYear, normalizedMonth, 0));
  return { startDate: formatUtcDate(start), endDate: formatUtcDate(end) };
}

function getBusinessYearRange(year) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 1) return null;
  return {
    startDate: `${String(normalizedYear).padStart(4, "0")}-01-01`,
    endDate: `${String(normalizedYear).padStart(4, "0")}-12-31`
  };
}

export {
  STATISTICS_TIME_ZONE,
  isValidBusinessDate,
  resolveBusinessDate,
  getTodayBusinessDate,
  getBusinessWeekRange,
  getBusinessMonthRange,
  getBusinessYearRange
};
