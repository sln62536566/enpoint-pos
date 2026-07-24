import { createPrintRequest } from "./print-request.js";

export function createPrintScheduler(options = {}) {
  if (!options.router || typeof options.router.route !== "function") throw new TypeError("Print scheduler requires a router");
  if (!options.registry || typeof options.registry.get !== "function") throw new TypeError("Print scheduler requires a registry");
  if (!options.queue || typeof options.queue.enqueue !== "function") throw new TypeError("Print scheduler requires a queue");
  const router = options.router, registry = options.registry, queue = options.queue;
  const clock = typeof options.clock === "function" ? options.clock : Date.now;

  return Object.freeze({
    schedule(plan, trigger) {
      try {
        const routing = router.route({ group: plan.metadata.group, requiredCapabilities: plan.requiredCapabilities, plan, trigger });
        if (!routing.printer || !registry.get(routing.printer.id)) throw Object.assign(new Error("No matching printer"), { code: "NO_MATCHING_PRINTER" });
        const request = createPrintRequest({
          type: trigger.type, copies: plan.copies, paper: plan.paper, layoutVariant: plan.layoutVariant,
          order: trigger.payload.order || {}, source: trigger.source, timestamp: trigger.timestamp,
          metadata: Object.assign({}, trigger.metadata, plan.metadata, { triggerId: trigger.id, tickets: plan.tickets, printerId: routing.printer.id, routingScore: routing.score })
        }, clock);
        const queued = queue.enqueue(request, {
          requestId: trigger.id, correlationId: trigger.metadata.correlationId || trigger.id,
          provider: routing.printer.provider, metadata: { triggerType: trigger.type, policy: trigger.policy, printerId: routing.printer.id }
        });
        return Object.freeze({ ok: true, routing, request, id: queued.id, completion: queued.completion });
      } catch (error) {
        return Object.freeze({ ok: false, routing: null, request: null, id: null, completion: null,
          error: Object.freeze({ code: String(error.code || "SCHEDULER_FAILED"), message: String(error.message || "Print scheduler failed") }) });
      }
    }
  });
}
