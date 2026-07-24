function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const result = {};
    Object.keys(value).forEach(key => { result[key] = cloneValue(value[key]); });
    return result;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(key => deepFreeze(value[key]));
  return Object.freeze(value);
}

export function createPrintRequest(input = {}, clock = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Print request must be an object");
  const copies = Math.max(1, Math.floor(Number(input.copies) || 1));
  return deepFreeze({
    type: String(input.type || "generic"), copies,
    paper: String(input.paper || "58"), layoutVariant: String(input.layoutVariant || "customer"),
    order: cloneValue(input.order || {}), source: String(input.source || "application"),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Number(clock()),
    metadata: cloneValue(input.metadata || {})
  });
}

export { deepFreeze };
