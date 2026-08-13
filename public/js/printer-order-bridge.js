function controlled(input = {}) {
  const error = input.error ? Object.freeze({ code: String(input.error.code || "PRINTER_BRIDGE_FAILED"), message: String(input.error.message || "Printer bridge failed") }) : null;
  return Object.freeze({ ok: input.ok === true, status: String(input.status || "failed"), code: String(input.code || (input.ok ? "OK" : "PRINTER_BRIDGE_FAILED")), eventId: input.eventId ? String(input.eventId) : null, jobId: input.jobId ? String(input.jobId) : null, skipped: input.skipped === true, error });
}

export function createPrinterOrderBridge(options = {}) {
  const loadAdapter = typeof options.loadAdapter === "function" ? options.loadAdapter : () => import("./printer-event-adapter.js");
  const loadIntegration = typeof options.loadIntegration === "function" ? options.loadIntegration : () => import("./printer-integration.js");
  let adapterPromise = null, integrationPromise = null;
  const adapter = () => adapterPromise || (adapterPromise = Promise.resolve().then(loadAdapter));
  const integration = () => integrationPromise || (integrationPromise = Promise.resolve().then(loadIntegration));

  async function isolatedHandle(event) {
    let trigger = null;
    try {
      const adapterModule = await adapter();
      const adapt = adapterModule.adaptPrinterEvent || (adapterModule.PrinterEventAdapter && adapterModule.PrinterEventAdapter.adapt);
      if (typeof adapt !== "function") throw Object.assign(new Error("Printer event adapter unavailable"), { code: "ADAPTER_UNAVAILABLE" });
      trigger = await adapt(event);
      const integrationModule = await integration();
      const target = integrationModule.PrinterIntegration || integrationModule.default || integrationModule;
      if (!target || typeof target.handle !== "function") throw Object.assign(new Error("Printer integration unavailable"), { code: "INTEGRATION_UNAVAILABLE" });
      const result = await target.handle(trigger);
      return controlled(Object.assign({}, result, { eventId: result && result.eventId || trigger.id }));
    } catch (error) {
      return controlled({ status: "isolated", code: error && error.code || "PRINTER_BRIDGE_FAILED", eventId: trigger && trigger.id, error });
    }
  }

  function handle(event) { return Promise.resolve().then(() => isolatedHandle(event)).catch(error => controlled({ status: "isolated", error })); }
  function invalidateConfiguration() {
    return Promise.resolve().then(integration).then(module => {
      const target = module.PrinterIntegration || module.default || module;
      if (!target || typeof target.invalidateConfiguration !== "function") throw Object.assign(new Error("Printer configuration invalidation unavailable"), { code: "CONFIGURATION_INVALIDATION_UNAVAILABLE" });
      return controlled(target.invalidateConfiguration());
    }).catch(error => controlled({ status: "isolated", code: error && error.code || "CONFIGURATION_INVALIDATION_FAILED", error }));
  }
  function canHandleQrAutoPrint() {
    return Promise.resolve().then(integration).then(module => {
      const target = module.PrinterIntegration || module.default || module;
      if (!target || typeof target.canHandleQrAutoPrint !== "function") return Object.freeze({ eligible: false, code: "PRINTER_ELIGIBILITY_UNAVAILABLE" });
      return target.canHandleQrAutoPrint();
    }).catch(() => Object.freeze({ eligible: false, code: "PRINTER_ELIGIBILITY_FAILED" }));
  }
  return Object.freeze({ handle, canHandleQrAutoPrint, invalidateConfiguration });
}

export const PrinterOrderBridge = createPrinterOrderBridge();
