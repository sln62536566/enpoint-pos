const FIELDS = Object.freeze(["supportsEscPos", "supportsCut", "supportsPaper58", "supportsPaper80", "supportsLabel", "supportsReceipt"]);

function freezeClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if (value && typeof value === "object") { const result = {}; Object.keys(value).forEach(key => { result[key] = freezeClone(value[key]); }); return Object.freeze(result); }
  return value;
}

export function createPrinterCapability(input = {}) {
  const capability = { id: String(input.id || "default") };
  FIELDS.forEach(field => { capability[field] = input[field] === true; });
  capability.metadata = freezeClone(input.metadata || {});
  return Object.freeze(capability);
}

export function capabilityMatches(capability, requirements = []) {
  if (!capability) return false;
  const required = Array.isArray(requirements) ? requirements : Object.keys(requirements || {}).filter(key => requirements[key]);
  return required.every(field => FIELDS.includes(field) && capability[field] === true);
}

export const PRINTER_CAPABILITY_FIELDS = FIELDS;

export function createCapabilityRegistry(capabilities = {}) {
  const registry = new Map(Object.entries(capabilities).map(([key, value]) => [key, createPrinterCapability(value)]));
  return Object.freeze({ get(name) { return registry.get(String(name || "default")) || null; } });
}
