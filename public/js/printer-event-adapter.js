import { createPrintTrigger, PRINT_TRIGGER_TYPES } from "./print-trigger.js";

const EVENT_TYPES = Object.freeze(Object.values(PRINT_TRIGGER_TYPES));

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    const result = {};
    Object.keys(value).forEach(key => { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}

function text(value, fallback = "") { return value === undefined || value === null ? fallback : String(value); }

export function adaptPrinterEvent(input = {}, clock = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Printer business event must be an object");
  const type = input.eventType || input.type;
  if (!EVENT_TYPES.includes(type)) throw new RangeError(`Unsupported printer business event: ${type}`);
  const order = input.order && typeof input.order === "object" ? clone(input.order) : {};
  const orderId = text(input.orderId || order.id);
  if (!orderId) throw new TypeError("Printer business event requires an order id");
  const ticketType = text(input.ticketType, "generic");
  const routeGroup = text(input.routeGroup, "Generic");
  const version = text(input.businessEventVersion, "1");
  const id = text(input.eventId || input.id || [text(input.storeId, "default"), orderId, type, version, ticketType, routeGroup].join(":"));
  const correlationId = text(input.correlationId, id);

  return createPrintTrigger({
    id, type,
    source: text(input.source || order.orderSource || order.source, "application"),
    timestamp: input.timestamp,
    policy: text(input.policy, "default"),
    payload: { order, orderId, orderNumber: text(input.orderNumber || order.orderNumber), ticketType, routeGroup, businessEventVersion: version, printerCapability: text(input.printerCapability, "default") },
    metadata: Object.assign({}, clone(input.metadata || {}), { correlationId, idempotencyCandidate: id, routeGroup, ticketType, businessEventVersion: version, crossDeviceClaimed: false })
  }, clock);
}

export const PrinterEventAdapter = Object.freeze({ adapt: adaptPrinterEvent });
