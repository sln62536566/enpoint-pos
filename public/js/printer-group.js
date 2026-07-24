export const PRINTER_GROUPS = Object.freeze({
  KITCHEN: "Kitchen", CASHIER: "Cashier", LABEL: "Label",
  INVOICE: "Invoice", GENERIC: "Generic"
});

export function normalizePrinterGroup(value) {
  const group = String(value || PRINTER_GROUPS.GENERIC);
  if (!Object.values(PRINTER_GROUPS).includes(group)) throw new RangeError(`Unsupported printer group: ${group}`);
  return group;
}
