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
  if (model.orderNumber) nodes.push(node("line", { value: `Order: ${model.orderNumber}` }));
  if (model.table) nodes.push(node("line", { value: `Table: ${model.table}` }));
  nodes.push(node("command", { name: "alignLeft" }), node("separator"));
  model.items.forEach(item => {
    nodes.push(node("line", { value: `${item.quantity} x ${item.name}` }));
    if (item.note) nodes.push(node("line", { value: `  ${item.note}` }));
  });
  nodes.push(node("feed", { lines: 2 }), node("command", { name: "cut" }));
  return createLayout("kitchen", nodes);
}
