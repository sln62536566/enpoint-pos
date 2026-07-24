function ticket(input = {}) {
  return Object.freeze({
    type: String(input.type || "generic"), copies: Math.max(1, Math.floor(Number(input.copies) || 1)),
    paper: String(input.paper || "58"), layoutVariant: String(input.layoutVariant || "customer")
  });
}

function freezeClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if (value && typeof value === "object") { const result = {}; Object.keys(value).forEach(key => { result[key] = freezeClone(value[key]); }); return Object.freeze(result); }
  return value;
}

export function createPrintPlan(input = {}) {
  const tickets = Array.isArray(input.tickets) ? input.tickets.map(ticket) : [];
  const requiredCapabilities = Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities.map(String) : [];
  return Object.freeze({
    tickets: Object.freeze(tickets), copies: Math.max(1, Math.floor(Number(input.copies) || 1)),
    paper: String(input.paper || "58"), layoutVariant: String(input.layoutVariant || "customer"),
    printerCapability: String(input.printerCapability || "default"),
    requiredCapabilities: Object.freeze(requiredCapabilities), metadata: freezeClone(input.metadata || {})
  });
}
