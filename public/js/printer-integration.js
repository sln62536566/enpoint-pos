const STATUS = Object.freeze({ IDLE: "idle", INITIALIZING: "initializing", READY: "ready", UNAVAILABLE: "unavailable", DESTROYED: "destroyed" });

function result(input = {}) {
  const error = input.error ? Object.freeze({ code: String(input.error.code || "PRINTER_INTEGRATION_FAILED"), message: String(input.error.message || "Printer integration failed") }) : null;
  return Object.freeze({ ok: input.ok === true, status: String(input.status || STATUS.UNAVAILABLE), code: String(input.code || (input.ok ? "OK" : "PRINTER_INTEGRATION_FAILED")), eventId: input.eventId ? String(input.eventId) : null, jobId: input.jobId ? String(input.jobId) : null, skipped: input.skipped === true, error });
}

async function loadCore(importer) {
  const names = ["print-decision", "receipt-layout", "escpos-formatter", "print-transport", "print-pipeline", "commercial-print-queue", "print-policy", "printer-capability", "auto-print-engine", "printer-registry", "printer-router", "print-scheduler", "printer-pos-config"];
  const modules = await Promise.all(names.map(name => importer(`./${name}.js`)));
  return Object.fromEntries(names.map((name, index) => [name, modules[index]]));
}

export function createPrinterIntegration(options = {}) {
  const importer = typeof options.importer === "function" ? options.importer : specifier => import(specifier);
  const environment = options.environment === undefined ? globalThis : options.environment;
  const environmentSupported = Boolean(environment && environment.navigator && environment.navigator.usb);
  let state = STATUS.IDLE, initialization = null, components = null, lastError = null;
  let configured = false, configurationCode = environmentSupported ? "UNCONFIGURED" : "WEBUSB_UNSUPPORTED";
  let configurationStale = false, reloadPromise = null, configurationGeneration = 0;

  function getStatus() {
    return Object.freeze({ status: state, ready: state === STATUS.READY, available: state === STATUS.READY && configured, capability: configurationCode, configurationStale, reloading: Boolean(reloadPromise), error: lastError ? Object.freeze({ code: String(lastError.code || "PRINTER_INTEGRATION_FAILED"), message: String(lastError.message || "Printer integration failed") }) : null });
  }

  async function compose() {
    const core = await loadCore(importer);
    const unsupportedDriver = Object.freeze({
      transferChunk() { return Promise.reject(Object.assign(new Error("No printer configured"), { code: unsupported ? "NOT_SUPPORTED" : "NO_PRINTER_CONFIGURED" })); },
      getStatus() { return Object.freeze({ status: unsupported ? "unsupported" : "no_device", capability: null }); },
      onStatusChanged() { return function() {}; }
    });
    const unsupported = !environmentSupported;
    const configuration = await core["printer-pos-config"].loadPosPrinterConfiguration(importer);
    const driver = configuration.driver || unsupportedDriver;
    const transport = core["print-transport"].createPrintTransport(driver);
    const pipeline = core["print-pipeline"].createPrintPipeline({
      decision: core["print-decision"].createDecisionLayer(request => {
        const tickets = request && request.metadata && Array.isArray(request.metadata.tickets) ? request.metadata.tickets : [];
        return tickets.length ? { action: "print", tickets, reason: "POS_AUTO_PRINT" } : { action: "skip", reason: "NO_TICKETS" };
      }),
      layoutBuilders: { customer: core["receipt-layout"].buildCustomerReceiptLayout, kitchen: core["receipt-layout"].buildKitchenReceiptLayout },
      formatter: core["escpos-formatter"].formatLayout, transport,
      provider: configuration.printer ? configuration.printer.provider : (unsupported ? "unsupported" : "unconfigured")
    });
    const queue = core["commercial-print-queue"].createCommercialPrintQueue({ pipeline, provider: configuration.printer ? configuration.printer.provider : (unsupported ? "unsupported" : "unconfigured") });
    const registry = core["printer-registry"].createPrinterRegistry(configuration.printer ? [configuration.printer] : []);
    const router = core["printer-router"].createPrinterRouter({ registry });
    const scheduler = core["print-scheduler"].createPrintScheduler({ router, registry, queue });
    const posPolicy = core["print-policy"].createPrintPolicy(trigger => {
      if (!configuration.enabled || trigger.type !== "OrderCreated" || String(trigger.source).toUpperCase() !== "POS") return { tickets: [], metadata: { reason: configuration.code || "NOT_POS_ORDER" } };
      const profile = configuration.profile;
      return {
        tickets: [{ type: "kitchen", copies: profile.copies, paper: profile.paperSize, layoutVariant: "kitchen" }],
        copies: profile.copies, paper: profile.paperSize, layoutVariant: "kitchen",
        printerCapability: "pos-kitchen", requiredCapabilities: ["supportsEscPos", "supportsReceipt", profile.paperSize === "80" ? "supportsPaper80" : "supportsPaper58"],
        metadata: { group: "Kitchen", configurationCode: configuration.code }
      };
    });
    const policies = core["print-policy"].createPolicyRegistry({ default: core["print-policy"].createPrintPolicy(), "pos-order-created": posPolicy });
    const capabilities = core["printer-capability"].createCapabilityRegistry({ default: { id: "default" }, "pos-kitchen": configuration.printer ? configuration.printer.capability : { id: "pos-kitchen" } });
    const engine = core["auto-print-engine"].createAutoPrintEngine({ policies, capabilities, scheduler });
    return Object.freeze({ configuration, transport, pipeline, queue, registry, router, scheduler, policies, capabilities, engine });
  }

  function initialize() {
    if (state === STATUS.READY) return Promise.resolve(result({ ok: true, status: state, code: "READY" }));
    if (state === STATUS.DESTROYED) return Promise.resolve(result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration is destroyed") }));
    if (initialization) return initialization;
    state = STATUS.INITIALIZING;
    initialization = Promise.resolve().then(compose).then(value => {
      if (state === STATUS.DESTROYED) { try { value.queue.destroy(); } catch (error) {} return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration was destroyed during initialization") }); }
      components = value; configured = value.configuration.enabled === true; configurationCode = value.configuration.code || "UNCONFIGURED"; state = STATUS.READY;
      return result({ ok: true, status: state, code: "READY" });
    }).catch(error => { lastError = error; state = STATUS.UNAVAILABLE; return result({ status: state, code: "INITIALIZATION_FAILED", error }); });
    return initialization;
  }

  function waitForQueueIdle(queue) {
    return new Promise(resolve => {
      function check() {
        const jobs = typeof queue.getJobs === "function" ? queue.getJobs() : [];
        const active = (typeof queue.isBusy === "function" && queue.isBusy()) || jobs.some(job => !["Completed", "Failed", "Cancelled"].includes(job.status));
        if (!active) { resolve(); return; }
        setTimeout(check, 10);
      }
      check();
    });
  }

  function retire(value) {
    if (!value) return;
    try { value.engine.close(); } catch (error) {}
    try { value.queue.destroy(); } catch (error) {}
    try { value.transport.destroy(); } catch (error) {}
  }

  function invalidateConfiguration() {
    if (state === STATUS.DESTROYED) return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration is destroyed") });
    configurationStale = true; configurationGeneration += 1;
    if (state === STATUS.UNAVAILABLE) {
      state = STATUS.IDLE; initialization = null; lastError = null;
    }
    return result({ ok: true, status: "stale", code: "CONFIGURATION_INVALIDATED" });
  }

  function reloadConfiguration() {
    if (state === STATUS.DESTROYED) return Promise.resolve(result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration is destroyed") }));
    if (!configurationStale) { configurationStale = true; configurationGeneration += 1; }
    if (reloadPromise) return reloadPromise;
    reloadPromise = Promise.resolve().then(async () => {
      if (state === STATUS.INITIALIZING && initialization) await initialization;
      if (state === STATUS.IDLE || state === STATUS.UNAVAILABLE) {
        initialization = null;
        const initialized = await initialize();
        if (!initialized.ok) return initialized;
        configurationStale = false;
        return result({ ok: true, status: state, code: "CONFIGURATION_RELOADED" });
      }
      const previous = components;
      if (previous && previous.queue && typeof previous.queue.close === "function") previous.queue.close();
      if (previous) await waitForQueueIdle(previous.queue);
      try {
        let replacement, targetGeneration;
        do {
          targetGeneration = configurationGeneration;
          replacement = await compose();
          if (configurationGeneration !== targetGeneration) retire(replacement);
        } while (configurationGeneration !== targetGeneration);
        if (state === STATUS.DESTROYED) { retire(replacement); return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration was destroyed during reload") }); }
        components = replacement;
        configured = replacement.configuration.enabled === true;
        configurationCode = replacement.configuration.code || "UNCONFIGURED";
        configurationStale = false; lastError = null; state = STATUS.READY;
        retire(previous);
        return result({ ok: true, status: state, code: "CONFIGURATION_RELOADED" });
      } catch (error) {
        retire(previous); components = null; configured = false; configurationCode = "RELOAD_FAILED";
        configurationStale = false; lastError = error; state = STATUS.UNAVAILABLE;
        return result({ status: state, code: "CONFIGURATION_RELOAD_FAILED", error });
      }
    }).catch(error => result({ status: "unavailable", code: "CONFIGURATION_RELOAD_FAILED", error })).finally(() => { reloadPromise = null; });
    return reloadPromise;
  }

  async function handle(trigger) {
    try {
      const initialized = await initialize();
      if (!initialized.ok || !components) return result({ status: initialized.status, code: initialized.code, eventId: trigger && trigger.id, error: initialized.error });
      if (configurationStale) {
        const reloaded = await reloadConfiguration();
        if (!reloaded.ok || !components) return result({ status: reloaded.status, code: reloaded.code, eventId: trigger && trigger.id, error: reloaded.error });
      }
      const handled = await components.engine.handle(trigger);
      if (handled.accepted) {
        const completed = handled.completion ? await handled.completion : null;
        if (completed && completed.result && completed.result.failed) {
          const completionError = completed.result.errors && completed.result.errors[0] || { code: "PRINT_JOB_FAILED", message: "Print job failed" };
          return result({ status: "failed", code: completionError.code, eventId: trigger.id, jobId: handled.jobId, error: completionError });
        }
        return result({ ok: true, status: completed ? "completed" : "accepted", code: completed ? "PRINT_COMPLETED" : "PRINT_ACCEPTED", eventId: trigger.id, jobId: handled.jobId });
      }
      if (handled.skipped) return result({ ok: true, status: "skipped", code: "DEFAULT_SAFE_SKIP", eventId: trigger.id, skipped: true });
      const error = handled.errors && handled.errors[0] || { code: "AUTO_PRINT_FAILED", message: "Auto print engine failed" };
      return result({ status: "failed", code: error.code, eventId: trigger.id, error });
    } catch (error) { return result({ status: "failed", eventId: trigger && trigger.id, error }); }
  }

  function destroy() {
    if (state === STATUS.DESTROYED) return false;
    state = STATUS.DESTROYED;
    if (components) { try { components.engine.close(); } catch (error) {} retire(components); }
    components = null;
    return true;
  }

  return Object.freeze({ initialize, handle, getStatus, invalidateConfiguration, reloadConfiguration, destroy });
}

export const PrinterIntegration = createPrinterIntegration();
