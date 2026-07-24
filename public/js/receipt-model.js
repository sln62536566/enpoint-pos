function text(value) { return value === undefined || value === null ? "" : String(value); }
function money(value) { const amount = Number(value); return Number.isFinite(amount) ? amount : 0; }

export function createReceiptModel(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Receipt model must be an object");
  const items = Array.isArray(input.items) ? input.items.map((item, index) => {
    if (!item || typeof item !== "object") throw new TypeError(`Receipt item ${index} must be an object`);
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = money(item.unitPrice);
    return Object.freeze({
      name: text(item.name), quantity, unitPrice,
      total: item.total === undefined ? quantity * unitPrice : money(item.total),
      note: text(item.note)
    });
  }) : [];
  return Object.freeze({
    store: text(input.store), orderNumber: text(input.orderNumber), table: text(input.table),
    items: Object.freeze(items), subtotal: money(input.subtotal), total: money(input.total),
    footer: text(input.footer)
  });
}
