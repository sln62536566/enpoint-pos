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

function clean(value) { return text(value).trim(); }

function optionName(option) {
  if (typeof option === "string") return clean(option);
  return clean(option && (option.name || option.label || option.value || option.title));
}

function optionValue(option) {
  const name = optionName(option);
  const quantity = Math.max(1, Number(option && (option.qty || option.quantity)) || 1);
  return name && quantity > 1 ? `${name} x${quantity}` : name;
}

function detailCategory(groupId, groupName) {
  const id = clean(groupId).toLowerCase(), name = clean(groupName).toLowerCase();
  if (id.includes("size") || name.includes("份量") || name.includes("大小") || name.includes("size")) return "size";
  if (id.includes("spicy") || name.includes("辣")) return "spicy";
  if (id.includes("satay") || name.includes("沙茶")) return "satay";
  if (id.includes("addon") || name.includes("加料") || name.includes("加點")) return "addons";
  if (id.includes("remove") || name.includes("不要") || name.includes("移除")) return "removes";
  if (id.includes("required")) return "required";
  return `custom:${id || name || "option"}`;
}

function categoryLabel(category, fallback) {
  return ({ size: "份量", spicy: "辣度", satay: "沙茶", addons: "加料", removes: "不要", required: "必選" })[category] || clean(fallback) || "選項";
}

function listValues(value) {
  if (!Array.isArray(value)) return [];
  return value.map(optionValue).filter(Boolean);
}

function buildItemDetails(item) {
  const details = [], seen = new Set(), covered = new Set(), groups = new Map();
  function add(label, values) {
    const unique = Array.from(new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean)));
    if (!unique.length) return;
    const line = `${label}：${unique.join("、")}`;
    if (!seen.has(line)) { seen.add(line); details.push(line); }
  }

  (Array.isArray(item.customOptions) ? item.customOptions : []).forEach(option => {
    if (!option || (option.modules && option.modules.print === false)) return;
    const value = optionValue(option);
    if (!value) return;
    const category = detailCategory(option.groupId, option.groupName);
    covered.add(category);
    const label = categoryLabel(category, option.groupName);
    const key = `${category}\n${label}`;
    if (!groups.has(key)) groups.set(key, { label, values: [] });
    groups.get(key).values.push(value);
  });
  groups.forEach(group => add(group.label, group.values));

  if (!covered.has("size")) add("份量", item.size || item.sizeName || item.portion || item.selectedSize);
  if (!covered.has("required") && item.requiredOption) add(clean(item.requiredOption.title) || "必選", item.requiredOption.value || item.requiredOption.name);
  if (!covered.has("spicy")) add("辣度", item.spicy);
  if (!covered.has("satay")) add("沙茶", item.satay);
  if (!covered.has("addons")) add("加料", listValues(item.addons || item.extras));
  if (!covered.has("removes")) add("不要", listValues(item.removes || item.removeOptionsSelected || item.noOptionsSelected));
  return details;
}

function normalizePrinterOrder(input) {
  const order = clone(input || {});
  if (!order.store && order.storeName) order.store = order.storeName;
  if (!order.table && order.customerLabel) order.table = order.customerLabel;
  if (order.subtotal === undefined && order.total !== undefined) order.subtotal = order.total;
  if (Array.isArray(order.items)) {
    order.items = order.items.map(item => Object.assign({}, item, {
      name: text(item && (item.name || item.displayName || item.itemName)),
      quantity: Number(item && (item.quantity || item.qty)) || 0,
      unitPrice: Number(item && (item.unitPrice || item.price)) || 0,
      details: buildItemDetails(item || {})
    }));
  }
  return order;
}

export function adaptPrinterEvent(input = {}, clock = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Printer business event must be an object");
  const type = input.eventType || input.type;
  if (!EVENT_TYPES.includes(type)) throw new RangeError(`Unsupported printer business event: ${type}`);
  const order = input.order && typeof input.order === "object" ? normalizePrinterOrder(input.order) : {};
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
