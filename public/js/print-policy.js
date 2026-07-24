import { createPrintPlan } from "./print-plan.js";

export function createPrintPolicy(resolver = () => ({ tickets: [], metadata: { reason: "No print policy configured" } })) {
  if (typeof resolver !== "function") throw new TypeError("Print policy resolver must be a function");
  return Object.freeze({ resolve(trigger, capability) { return Promise.resolve(resolver(trigger, capability)).then(createPrintPlan); } });
}

export function createPolicyRegistry(policies = {}) {
  const registry = new Map(Object.entries(policies));
  const fallback = registry.get("default") || createPrintPolicy();
  return Object.freeze({
    get(name) { return registry.get(String(name || "default")) || fallback; },
    register() { throw new Error("Print policy registry is immutable"); }
  });
}
