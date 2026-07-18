const VALID_STATUSES = Object.freeze(["ready", "offline", "connecting", "printing", "busy", "error"]);
const records = new Map();
const subscribers = [];

function now() {
  return Date.now();
}

function createStatus(id) {
  return {
    id: String(id),
    status: "ready",
    busy: false,
    queueLength: 0,
    lastPrintTime: null,
    lastError: null,
    updatedAt: now()
  };
}

function clone(record) {
  return Object.assign({}, record);
}

function ensure(id) {
  const key = String(id || "unknown");
  if (!records.has(key)) records.set(key, createStatus(key));
  return records.get(key);
}

function update(id, changes) {
  const record = ensure(id);
  Object.assign(record, changes, { updatedAt: now() });
  const snapshot = clone(record);
  subscribers.slice().forEach(callback => {
    try { callback(snapshot); } catch (error) { console.error("PrinterStatus subscriber error", error); }
  });
  return snapshot;
}

export const PrinterStatus = {
  get(id) {
    return clone(ensure(id));
  },
  setStatus(id, status) {
    const value = String(status || "").toLowerCase();
    return update(id, { status: VALID_STATUSES.indexOf(value) >= 0 ? value : "offline" });
  },
  setBusy(id, value) {
    return update(id, { busy: value === true });
  },
  setQueueLength(id, count) {
    return update(id, { queueLength: Math.max(0, Number(count) || 0) });
  },
  setLastPrintTime(id, time) {
    return update(id, { lastPrintTime: time === null ? null : (Number(time) || now()) });
  },
  setLastError(id, error) {
    const message = error && error.message ? error.message : String(error || "列印失敗");
    return update(id, { lastError: message, status: "error", busy: false });
  },
  setReady(id) {
    return update(id, { status: "ready", busy: false });
  },
  clearError(id) {
    return update(id, { lastError: null });
  },
  subscribe(callback) {
    if (typeof callback !== "function") return function() {};
    subscribers.push(callback);
    return function unsubscribe() {
      const index = subscribers.indexOf(callback);
      if (index >= 0) subscribers.splice(index, 1);
    };
  }
};

window.PrinterStatus = PrinterStatus;
export { VALID_STATUSES };
