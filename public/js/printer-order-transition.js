const QR_EVENT_VERSION = "qr-confirmed:v1";

function clone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(clone));
  if (value && typeof value === "object") {
    const result = {};
    Object.keys(value).forEach(key => { result[key] = clone(value[key]); });
    return Object.freeze(result);
  }
  return value;
}

function isQrOrder(order) {
  if (!order || typeof order !== "object") return false;
  return String(order.orderSource || order.source || "").toUpperCase() === "QR";
}

function isConfirmedAndPaid(order) {
  return Boolean(order && order.confirmed === true && (order.paymentStatus === "paid" || order.paid === true));
}

function isCancelled(order) {
  return Boolean(order && (order.cancelled === true || order.status === "cancelled" || order.kitchenStatus === "cancelled"));
}

export function isQrPrintEligible(previous, next) {
  if (!isQrOrder(next) || isCancelled(next) || !isConfirmedAndPaid(next)) return false;
  return !isConfirmedAndPaid(previous);
}

export function createQrOrderTransitionDetector() {
  let initialized = false;
  let previousOrders = {};

  function observe(nextValue) {
    const nextOrders = nextValue && typeof nextValue === "object" ? nextValue : {};
    if (!initialized) {
      previousOrders = clone(nextOrders);
      initialized = true;
      return Object.freeze([]);
    }
    const events = [];
    Object.keys(nextOrders).forEach(orderId => {
      const next = nextOrders[orderId];
      const previous = previousOrders[orderId];
      if (previous && isQrPrintEligible(previous, next)) {
        const order = clone(Object.assign({ id: orderId }, next));
        events.push(Object.freeze({
          eventType: "PaymentCompleted",
          order,
          orderId: String(orderId),
          orderNumber: String(next.orderNumber || ""),
          storeId: String(next.storeId || "defaultStore"),
          source: "QR",
          businessEventVersion: QR_EVENT_VERSION,
          ticketType: "kitchen",
          routeGroup: "Kitchen",
          policy: "qr-order-confirmed"
        }));
      }
    });
    previousOrders = clone(nextOrders);
    return Object.freeze(events);
  }

  return Object.freeze({ observe, isInitialized: () => initialized });
}

export const PrinterOrderTransition = Object.freeze({ isQrPrintEligible, create: createQrOrderTransitionDetector });
