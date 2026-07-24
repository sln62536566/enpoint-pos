const TYPES = Object.freeze({
  ORDER_CREATED: "OrderCreated", PAYMENT_COMPLETED: "PaymentCompleted",
  MANUAL_PRINT: "ManualPrint", MANUAL_REPRINT: "ManualReprint",
  KITCHEN_FINISHED: "KitchenFinished", TEST_PRINT: "TestPrint"
});

function clone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(clone));
  if (value && typeof value === "object") { const result = {}; Object.keys(value).forEach(key => { result[key] = clone(value[key]); }); return Object.freeze(result); }
  return value;
}

export function createPrintTrigger(input = {}, clock = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Print trigger must be an object");
  if (!Object.values(TYPES).includes(input.type)) throw new RangeError(`Unsupported print trigger: ${input.type}`);
  return Object.freeze({
    id: String(input.id || ""), type: input.type, source: String(input.source || "application"),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Number(clock()),
    policy: String(input.policy || "default"), payload: clone(input.payload || {}), metadata: clone(input.metadata || {})
  });
}

export const PRINT_TRIGGER_TYPES = TYPES;
