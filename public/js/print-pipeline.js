import { createPrintRequest } from "./print-request.js";
import { createPrintResult, resultError } from "./print-result.js";

function requireDependency(value, name) {
  if (!value) throw new TypeError(`Print pipeline requires ${name}`);
  return value;
}

export function createPrintPipeline(options = {}) {
  const decision = requireDependency(options.decision, "a decision layer");
  const layoutBuilders = requireDependency(options.layoutBuilders, "layout builders");
  const formatter = requireDependency(options.formatter, "a formatter");
  const transport = requireDependency(options.transport, "a transport");
  const provider = String(options.provider || "unknown");
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  let closed = false;
  let active = false;

  async function execute(input) {
    const started = Number(clock());
    let request;
    let acquired = false;
    try {
      if (closed) throw Object.assign(new Error("Print pipeline is closed"), { code: "PIPELINE_CLOSED" });
      if (active) throw Object.assign(new Error("Print pipeline is busy"), { code: "PIPELINE_BUSY" });
      active = true;
      acquired = true;
      request = createPrintRequest(input, clock);
      const plan = await decision.decide(request);
      if (!plan || plan.action !== "print" || !plan.tickets.length) {
        return createPrintResult({ success: true, duration: Number(clock()) - started, provider });
      }
      let bytes = 0;
      let copies = 0;
      for (const ticket of plan.tickets) {
        const builder = layoutBuilders[ticket.layoutVariant];
        if (typeof builder !== "function") throw Object.assign(new Error(`Missing layout builder: ${ticket.layoutVariant}`), { code: "LAYOUT_UNAVAILABLE" });
        const layout = await builder(request.order, request, ticket);
        const payload = await formatter(layout, { paper: ticket.paper, request, ticket });
        if (!(payload instanceof Uint8Array)) throw Object.assign(new TypeError("Formatter must return Uint8Array"), { code: "FORMATTER_INVALID_RESULT" });
        for (let copy = 0; copy < ticket.copies; copy += 1) {
          const sent = await transport.send(payload);
          bytes += Number(sent && sent.bytesTransferred) || payload.byteLength;
          copies += 1;
        }
      }
      return createPrintResult({ success: true, duration: Number(clock()) - started, bytes, copies, provider });
    } catch (error) {
      const cancelled = Boolean(error && error.code === "TRANSFER_CANCELLED");
      return createPrintResult({ cancelled, failed: !cancelled, duration: Number(clock()) - started, provider, errors: [resultError(error)] });
    } finally {
      if (acquired) active = false;
    }
  }

  return Object.freeze({
    execute,
    isBusy() { return active; },
    destroy() { if (closed) return false; closed = true; return true; }
  });
}
