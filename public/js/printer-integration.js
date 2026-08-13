const STATUS = Object.freeze({ IDLE: "idle", INITIALIZING: "initializing", READY: "ready", UNAVAILABLE: "unavailable", DESTROYED: "destroyed" });

function result(input = {}) {
  const error = input.error ? Object.freeze({ code: String(input.error.code || "PRINTER_INTEGRATION_FAILED"), message: String(input.error.message || "Printer integration failed") }) : null;
  return Object.freeze({ ok: input.ok === true, status: String(input.status || STATUS.UNAVAILABLE), code: String(input.code || (input.ok ? "OK" : "PRINTER_INTEGRATION_FAILED")), eventId: input.eventId ? String(input.eventId) : null, jobId: input.jobId ? String(input.jobId) : null, skipped: input.skipped === true, error });
}

async function loadCore(importer) {
  const names = ["print-decision", "receipt-layout", "escpos-formatter", "print-transport", "print-pipeline", "commercial-print-queue", "print-policy", "printer-capability", "auto-print-engine", "printer-registry", "printer-router", "print-scheduler"];
  const modules = await Promise.all(names.map(name => importer(`./${name}.js`)));
  return Object.fromEntries(names.map((name, index) => [name, modules[index]]));
}

export function createPrinterIntegration(options = {}) {
  const importer = typeof options.importer === "function" ? options.importer : specifier => import(specifier);
  const environment = options.environment === undefined ? globalThis : options.environment;
  const environmentSupported = Boolean(environment && environment.navigator && environment.navigator.usb);
  let state = STATUS.IDLE, initialization = null, components = null, lastError = null;

  function getStatus() {
    return Object.freeze({ status: state, ready: state === STATUS.READY, available: state === STATUS.READY && environmentSupported, capability: environmentSupported ? "unconfigured" : "unsupported", error: lastError ? Object.freeze({ code: String(lastError.code || "PRINTER_INTEGRATION_FAILED"), message: String(lastError.message || "Printer integration failed") }) : null });
  }

  async function compose() {
    const core = await loadCore(importer);
    const unsupported = !environmentSupported;
    const driver = Object.freeze({
      transferChunk() { return Promise.reject(Object.assign(new Error("No printer configured"), { code: unsupported ? "NOT_SUPPORTED" : "NO_PRINTER_CONFIGURED" })); },
      getStatus() { return Object.freeze({ status: unsupported ? "unsupported" : "no_device", capability: null }); },
      onStatusChanged() { return function() {}; }
    });
    const transport = core["print-transport"].createPrintTransport(driver);
    const pipeline = core["print-pipeline"].createPrintPipeline({
      decision: core["print-decision"].createDecisionLayer(),
      layoutBuilders: { customer: core["receipt-layout"].buildCustomerReceiptLayout, kitchen: core["receipt-layout"].buildKitchenReceiptLayout },
      formatter: core["escpos-formatter"].formatLayout, transport,
      provider: unsupported ? "unsupported" : "unconfigured"
    });
    const queue = core["commercial-print-queue"].createCommercialPrintQueue({ pipeline, provider: unsupported ? "unsupported" : "unconfigured" });
    const registry = core["printer-registry"].createPrinterRegistry([]);
    const router = core["printer-router"].createPrinterRouter({ registry });
    const scheduler = core["print-scheduler"].createPrintScheduler({ router, registry, queue });
    const policies = core["print-policy"].createPolicyRegistry({ default: core["print-policy"].createPrintPolicy() });
    const capabilities = core["printer-capability"].createCapabilityRegistry({ default: { id: "default" } });
    const engine = core["auto-print-engine"].createAutoPrintEngine({ policies, capabilities, scheduler });
    return Object.freeze({ transport, pipeline, queue, registry, router, scheduler, policies, capabilities, engine });
  }

  function initialize() {
    if (state === STATUS.READY) return Promise.resolve(result({ ok: true, status: state, code: "READY" }));
    if (state === STATUS.DESTROYED) return Promise.resolve(result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration is destroyed") }));
    if (initialization) return initialization;
    state = STATUS.INITIALIZING;
    initialization = Promise.resolve().then(compose).then(value => {
      if (state === STATUS.DESTROYED) { try { value.queue.destroy(); } catch (error) {} return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration was destroyed during initialization") }); }
      components = value; state = STATUS.READY;
      return result({ ok: true, status: state, code: "READY" });
    }).catch(error => { lastError = error; state = STATUS.UNAVAILABLE; return result({ status: state, code: "INITIALIZATION_FAILED", error }); });
    return initialization;
  }

  async function handle(trigger) {
    try {
      const initialized = await initialize();
      if (!initialized.ok || !components) return result({ status: initialized.status, code: initialized.code, eventId: trigger && trigger.id, error: initialized.error });
      const handled = await components.engine.handle(trigger);
      if (handled.accepted) return result({ ok: true, status: "accepted", code: "PRINT_ACCEPTED", eventId: trigger.id, jobId: handled.jobId });
      if (handled.skipped) return result({ ok: true, status: "skipped", code: "DEFAULT_SAFE_SKIP", eventId: trigger.id, skipped: true });
      const error = handled.errors && handled.errors[0] || { code: "AUTO_PRINT_FAILED", message: "Auto print engine failed" };
      return result({ status: "failed", code: error.code, eventId: trigger.id, error });
    } catch (error) { return result({ status: "failed", eventId: trigger && trigger.id, error }); }
  }

  function destroy() {
    if (state === STATUS.DESTROYED) return false;
    state = STATUS.DESTROYED;
    if (components) { try { components.engine.close(); } catch (error) {} try { components.queue.destroy(); } catch (error) {} try { components.transport.destroy(); } catch (error) {} }
    components = null;
    return true;
  }

  return Object.freeze({ initialize, handle, getStatus, destroy });
}

export const PrinterIntegration = createPrinterIntegration();
