import { createReceiptModel } from "./receipt-model.js";

function node(type, values = {}) { return Object.freeze(Object.assign({ type }, values)); }

export function createLayout(variant, nodes) {
  if (!Array.isArray(nodes)) throw new TypeError("Receipt layout nodes must be an array");
  const safeNodes = nodes.map((entry, index) => {
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
      throw new TypeError(`Invalid receipt layout node ${index}`);
    }
    return Object.freeze(Object.assign({}, entry));
  });
  return Object.freeze({ type: "receipt-layout", variant: String(variant || "custom"), nodes: Object.freeze(safeNodes) });
}

export function buildCustomerReceiptLayout(input) {
  const model = createReceiptModel(input);
  const nodes = [node("command", { name: "initialize" }), node("command", { name: "alignCenter" }), node("command", { name: "boldOn" }), node("line", { value: model.store }), node("command", { name: "boldOff" })];
  if (model.orderNumber) nodes.push(node("line", { value: `Order: ${model.orderNumber}` }));
  if (model.table) nodes.push(node("line", { value: `Table: ${model.table}` }));
  nodes.push(node("command", { name: "alignLeft" }), node("separator"));
  model.items.forEach(item => {
    nodes.push(node("line", { value: `${item.name} x${item.quantity} ${item.total}` }));
    if (item.note) nodes.push(node("line", { value: `  ${item.note}` }));
  });
  nodes.push(node("separator"), node("line", { value: `Subtotal: ${model.subtotal}` }), node("command", { name: "boldOn" }), node("line", { value: `Total: ${model.total}` }), node("command", { name: "boldOff" }));
  if (model.footer) nodes.push(node("command", { name: "alignCenter" }), node("line", { value: model.footer }));
  nodes.push(node("feed", { lines: 2 }), node("command", { name: "cut" }));
  return createLayout("customer", nodes);
}

export function buildKitchenReceiptLayout(input) {
  const model = createReceiptModel(input);
  const nodes = [node("command", { name: "initialize" }), node("command", { name: "alignCenter" }), node("command", { name: "boldOn" }), node("line", { value: "KITCHEN" }), node("command", { name: "boldOff" })];
  if (model.isTestOrder) nodes.push(node("command", { name: "boldOn" }), node("line", { value: "*** 測試單 ***" }), node("command", { name: "boldOff" }));
  if (model.orderNumber) nodes.push(node("line", { value: `Order: ${model.orderNumber}` }));
  if (model.table) nodes.push(node("line", { value: `Table: ${model.table}` }));
  if (model.paymentStatus === "unpaid") nodes.push(node("command", { name: "boldOn" }), node("line", { value: "*** 未付款 ***" }), node("command", { name: "boldOff" }));
  nodes.push(node("command", { name: "alignLeft" }), node("separator"));
  model.items.forEach(item => {
    nodes.push(node("line", { value: `${item.quantity} x ${item.name}` }));
    item.details.forEach(detail => nodes.push(node("line", { value: `  ${detail}` })));
    if (item.note) nodes.push(node("line", { value: item.details.length ? `  備註：${item.note}` : `  ${item.note}` }));
  });
  if (model.orderNote) nodes.push(node("separator"), node("command", { name: "boldOn" }), node("line", { value: "整單備註：" }), node("command", { name: "boldOff" }), node("line", { value: model.orderNote }));
  nodes.push(node("feed", { lines: 2 }), node("command", { name: "cut" }));
  return createLayout("kitchen", nodes);
}
