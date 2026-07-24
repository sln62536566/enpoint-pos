import { createPrintTrigger } from "./print-trigger.js";
import { capabilityMatches } from "./printer-capability.js";
import { createPrintRequest } from "./print-request.js";

function engineResult(input = {}) {
  const errors = Object.freeze((input.errors || []).map(error => Object.freeze({
    code: String(error && error.code || "AUTO_PRINT_FAILED"), message: String(error && error.message || "Auto print engine failed")
  })));
  const result = input.accepted ? null : Object.freeze({
    success: input.skipped === true, cancelled: false, failed: input.failed === true,
    duration: 0, bytes: 0, copies: 0, provider: "none", errors
  });
  return Object.freeze({ accepted: input.accepted === true, skipped: input.skipped === true, failed: input.failed === true,
    jobId: input.jobId || null, completion: input.completion || null, result, errors });
}

export function createAutoPrintEngine(options = {}) {
  if (!options.policies || typeof options.policies.get !== "function") throw new TypeError("Auto print engine requires policies");
  if (!options.capabilities || typeof options.capabilities.get !== "function") throw new TypeError("Auto print engine requires capabilities");
  if (!options.queue || typeof options.queue.enqueue !== "function") throw new TypeError("Auto print engine requires a queue");
  const policies = options.policies, capabilities = options.capabilities, queue = options.queue;
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  let closed = false;

  async function handle(input) {
    try {
      if (closed) throw Object.assign(new Error("Auto print engine is closed"), { code: "AUTO_PRINT_CLOSED" });
      const trigger = createPrintTrigger(input, clock);
      const policy = policies.get(trigger.policy);
      if (!policy || typeof policy.resolve !== "function") throw Object.assign(new Error("Print policy unavailable"), { code: "POLICY_UNAVAILABLE" });
      const requestedCapability = capabilities.get(trigger.payload.printerCapability || "default");
      if (!requestedCapability) throw Object.assign(new Error("Printer capability unavailable"), { code: "CAPABILITY_UNAVAILABLE" });
      const plan = await policy.resolve(trigger, requestedCapability);
      if (!plan.tickets.length) return engineResult({ skipped: true });
      if (!capabilityMatches(requestedCapability, plan.requiredCapabilities)) {
        throw Object.assign(new Error("Printer capability does not match print plan"), { code: "CAPABILITY_MISMATCH" });
      }
      const request = createPrintRequest({
        type: trigger.type, copies: plan.copies, paper: plan.paper, layoutVariant: plan.layoutVariant,
        order: trigger.payload.order || {}, source: trigger.source, timestamp: trigger.timestamp,
        metadata: Object.assign({}, trigger.metadata, plan.metadata, { triggerId: trigger.id, tickets: plan.tickets })
      }, clock);
      const queued = queue.enqueue(request, {
        requestId: trigger.id, correlationId: trigger.metadata.correlationId || trigger.id,
        provider: requestedCapability.id, metadata: { triggerType: trigger.type, policy: trigger.policy }
      });
      return engineResult({ accepted: true, jobId: queued.id, completion: queued.completion });
    } catch (error) { return engineResult({ failed: true, errors: [error] }); }
  }

  return Object.freeze({ handle, close() { if (closed) return false; closed = true; return true; } });
}
