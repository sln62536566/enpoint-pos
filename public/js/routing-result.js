function frozenCapability(value) {
  if (!value) return null;
  return Object.isFrozen(value) ? value : Object.freeze(Object.assign({}, value));
}

export function createRoutingResult(input = {}) {
  return Object.freeze({
    printer: input.printer || null, score: Number.isFinite(Number(input.score)) ? Number(input.score) : -1,
    reason: String(input.reason || "NO_PRINTER"), group: input.group ? String(input.group) : null,
    capability: frozenCapability(input.capability || (input.printer && input.printer.capability))
  });
}
