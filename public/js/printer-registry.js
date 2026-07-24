import { normalizePrinterGroup } from "./printer-group.js";
import { createPrinterCapability } from "./printer-capability.js";

function freezeClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if (value && typeof value === "object") { const result = {}; Object.keys(value).forEach(key => { result[key] = freezeClone(value[key]); }); return Object.freeze(result); }
  return value;
}

function normalizePrinter(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !input.id) throw new TypeError("Printer requires an id");
  return Object.freeze({
    id: String(input.id), name: String(input.name || input.id), group: normalizePrinterGroup(input.group),
    provider: String(input.provider || "unknown"), capability: createPrinterCapability(input.capability || {}),
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
    enabled: input.enabled !== false, metadata: freezeClone(input.metadata || {})
  });
}

export function createPrinterRegistry(printers = []) {
  if (!Array.isArray(printers)) throw new TypeError("Printer registry requires an array");
  const list = Object.freeze(printers.map(normalizePrinter));
  const byId = new Map();
  list.forEach(printer => { if (byId.has(printer.id)) throw new Error(`Duplicate printer id: ${printer.id}`); byId.set(printer.id, printer); });
  return Object.freeze({
    get(id) { return byId.get(String(id)) || null; },
    list() { return list; },
    find(predicate) { if (typeof predicate !== "function") throw new TypeError("Printer predicate must be a function"); return Object.freeze(list.filter(predicate)); }
  });
}
