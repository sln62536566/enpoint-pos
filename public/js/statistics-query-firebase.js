import { isValidBusinessDate } from "./statistics-time.js";
import { resolveReportingStoreId } from "./statistics-store.js";

function failure(errorCode, message) {
  return { ok: false, errorCode, message };
}

function snapshotOrders(snapshot) {
  if (!snapshot || typeof snapshot.exists !== "function" || typeof snapshot.val !== "function") return null;
  if (!snapshot.exists()) return [];
  const value = snapshot.val();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.entries(value).map(([id, order]) => ({ id, ...(order || {}) }));
}

function createFirebaseStatisticsAdapter(dependencies = {}) {
  const required = ["ref", "query", "orderByChild", "startAt", "endAt", "get"];
  for (const name of required) {
    if (typeof dependencies[name] !== "function") throw new TypeError(`Firebase Statistics adapter requires ${name}().`);
  }

  return Object.freeze({
    async getRange(options = {}) {
      if (!isValidBusinessDate(options.startBusinessDate) || !isValidBusinessDate(options.endBusinessDate) ||
          options.startBusinessDate > options.endBusinessDate) {
        return failure("INVALID_RANGE", "A valid inclusive business-date range is required.");
      }
      const targetStoreId = resolveReportingStoreId(options.storeId);
      if (!targetStoreId) return failure("INVALID_STORE_ID", "A valid reporting storeId is required.");

      try {
        const ordersRef = dependencies.ref(dependencies.db, "orders");
        const rangeQuery = dependencies.query(
          ordersRef,
          dependencies.orderByChild("businessDate"),
          dependencies.startAt(options.startBusinessDate),
          dependencies.endAt(options.endBusinessDate)
        );
        const snapshot = await dependencies.get(rangeQuery);
        const values = snapshotOrders(snapshot);
        if (!values) return failure("MALFORMED_SNAPSHOT", "Firebase returned a malformed orders snapshot.");
        return {
          ok: true,
          storeId: targetStoreId,
          requestedRange: { startDate: options.startBusinessDate, endDate: options.endBusinessDate },
          orders: values,
          queryMeta: {
            source: "firebase-businessDate-range",
            realtime: false,
            storeFilter: "statistics-core",
            legacyCoverage: "partial"
          }
        };
      } catch (error) {
        const code = error && (error.code === "PERMISSION_DENIED" || error.code === "permission_denied")
          ? "PERMISSION_DENIED"
          : "FIREBASE_QUERY_FAILED";
        return failure(code, error && error.message ? error.message : "Firebase historical query failed.");
      }
    }
  });
}

export { createFirebaseStatisticsAdapter };
