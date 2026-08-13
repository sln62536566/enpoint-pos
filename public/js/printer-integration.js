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
  const retirementPromises = new WeakMap();

  function getStatus() {
    return Object.freeze({ status: state, ready: state === STATUS.READY, available: state === STATUS.READY && configured, capability: configurationCode, configurationStale, reloading: Boolean(reloadPromise), error: lastError ? Object.freeze({ code: String(lastError.code || "PRINTER_INTEGRATION_FAILED"), message: String(lastError.message || "Printer integration failed") }) : null });
  }

  async function compose() {
    let configuration = null, transport = null, pipeline = null, queue = null, engine = null;
    try {
    const core = await loadCore(importer);
    const unsupportedDriver = Object.freeze({
      transferChunk() { return Promise.reject(Object.assign(new Error("No printer configured"), { code: unsupported ? "NOT_SUPPORTED" : "NO_PRINTER_CONFIGURED" })); },
      getStatus() { return Object.freeze({ status: unsupported ? "unsupported" : "no_device", capability: null }); },
      onStatusChanged() { return function() {}; }
    });
    const unsupported = !environmentSupported;
    const configLoader = core["printer-pos-config"].loadPrinterRuntimeConfiguration || core["printer-pos-config"].loadPosPrinterConfiguration;
    configuration = await configLoader(importer, environment);
    const driver = configuration.driver || unsupportedDriver;
    transport = configuration.transports instanceof Map
      ? (await importer("./physical-transport-router.js")).createPhysicalTransportRouter({ transports: configuration.transports })
      : core["print-transport"].createPrintTransport(driver);
    pipeline = core["print-pipeline"].createPrintPipeline({
      decision: core["print-decision"].createDecisionLayer(request => {
        const tickets = request && request.metadata && Array.isArray(request.metadata.tickets) ? request.metadata.tickets : [];
        return tickets.length ? { action: "print", tickets, reason: "POS_AUTO_PRINT" } : { action: "skip", reason: "NO_TICKETS" };
      }),
      layoutBuilders: { customer: core["receipt-layout"].buildCustomerReceiptLayout, kitchen: core["receipt-layout"].buildKitchenReceiptLayout },
      formatter: core["escpos-formatter"].formatLayout, transport,
      provider: configuration.printer ? configuration.printer.provider : (unsupported ? "unsupported" : "unconfigured")
    });
    queue = core["commercial-print-queue"].createCommercialPrintQueue({ pipeline, provider: configuration.printer ? configuration.printer.provider : (unsupported ? "unsupported" : "unconfigured") });
    const configuredPrinters = Array.isArray(configuration.printers) ? configuration.printers : (configuration.printer ? [configuration.printer] : []);
    const registry = core["printer-registry"].createPrinterRegistry(configuredPrinters);
    const router = core["printer-router"].createPrinterRouter({ registry });
    const scheduler = core["print-scheduler"].createPrintScheduler({ router, registry, queue });
    const kitchenPolicy = core["print-policy"].createPrintPolicy(trigger => {
      const isPos = trigger.type === "OrderCreated" && String(trigger.source).toUpperCase() === "POS";
      const isClaimedQr = trigger.type === "PaymentCompleted" && String(trigger.source).toUpperCase() === "QR" && trigger.metadata && trigger.metadata.crossDeviceClaimed === true;
      if (!configuration.enabled || (!isPos && !isClaimedQr)) return { tickets: [], metadata: { reason: configuration.code || "INVALID_AUTO_PRINT_EVENT" } };
      const profile = configuration.profile;
      return {
        tickets: [{ type: "kitchen", copies: profile.copies, paper: profile.paperSize, layoutVariant: "kitchen" }],
        copies: profile.copies, paper: profile.paperSize, layoutVariant: "kitchen",
        printerCapability: "pos-kitchen", requiredCapabilities: ["supportsEscPos", "supportsReceipt", profile.paperSize === "80" ? "supportsPaper80" : "supportsPaper58"],
        metadata: { group: "Kitchen", configurationCode: configuration.code }
      };
    });
    const manualPolicy = core["print-policy"].createPrintPolicy(trigger => {
      const payload = trigger.payload || {}, metadata = trigger.metadata || {};
      const group = payload.routeGroup === "Customer" ? "Customer" : "Kitchen";
      const profile = configuration.profiles && configuration.profiles[group];
      const printer = configuredPrinters.find(item => item.group === group);
      if (trigger.type !== "ManualReprint" || metadata.manual !== true || !profile || profile.enabled !== true) return { tickets: [], metadata: { reason: "INVALID_MANUAL_PRINT" } };
      if (!printer) return { tickets: [], metadata: { reason: "PRINTER_NOT_READY" } };
      return {
        tickets: [{ type: group === "Customer" ? "customer" : "kitchen", copies: profile.copies, paper: profile.paperSize, layoutVariant: group === "Customer" ? "customer" : "kitchen" }],
        copies: profile.copies, paper: profile.paperSize, layoutVariant: group === "Customer" ? "customer" : "kitchen",
        printerCapability: `manual-${group.toLowerCase()}`, requiredCapabilities: ["supportsEscPos", "supportsReceipt", profile.paperSize === "80" ? "supportsPaper80" : "supportsPaper58"],
        metadata: { group, manual: true, reprint: true }
      };
    });
    const policies = core["print-policy"].createPolicyRegistry({ default: core["print-policy"].createPrintPolicy(), "pos-order-created": kitchenPolicy, "qr-order-confirmed": kitchenPolicy, "manual-print": manualPolicy });
    const capabilityValues = { default: { id: "default" }, "pos-kitchen": configuration.printer ? configuration.printer.capability : { id: "pos-kitchen" } };
    configuredPrinters.forEach(item => { capabilityValues[`manual-${item.group.toLowerCase()}`] = item.capability; });
    const capabilities = core["printer-capability"].createCapabilityRegistry(capabilityValues);
    engine = core["auto-print-engine"].createAutoPrintEngine({ policies, capabilities, scheduler });
    return Object.freeze({ configuration, transport, pipeline, queue, registry, router, scheduler, policies, capabilities, engine });
    } catch (composeError) {
      try { if (engine && typeof engine.close === "function") engine.close(); } catch (cleanupError) { console.warn("Partial printer engine rollback isolated", { code: cleanupError && cleanupError.code || "COMPOSE_ROLLBACK_FAILED" }); }
      try { if (queue && typeof queue.destroy === "function") queue.destroy(); else if (pipeline && typeof pipeline.destroy === "function") pipeline.destroy(); } catch (cleanupError) { console.warn("Partial printer queue rollback isolated", { code: cleanupError && cleanupError.code || "COMPOSE_ROLLBACK_FAILED" }); }
      try {
        if (configuration && configuration.runtimeFactory && typeof configuration.runtimeFactory.destroy === "function") await configuration.runtimeFactory.destroy();
        else if (transport && typeof transport.destroy === "function") await transport.destroy();
      } catch (cleanupError) { console.warn("Partial printer runtime rollback isolated", { code: cleanupError && cleanupError.code || "COMPOSE_ROLLBACK_FAILED" }); }
      throw composeError;
    }
  }

  function initialize() {
    if (state === STATUS.READY) return Promise.resolve(result({ ok: true, status: state, code: "READY" }));
    if (state === STATUS.DESTROYED) return Promise.resolve(result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration is destroyed") }));
    if (initialization) return initialization;
    state = STATUS.INITIALIZING;
    initialization = Promise.resolve().then(compose).then(async value => {
      if (state === STATUS.DESTROYED) { await retire(value); return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration was destroyed during initialization") }); }
      components = value; configured = value.configuration.enabled === true; configurationCode = value.configuration.code || "UNCONFIGURED"; state = STATUS.READY;
      return result({ ok: true, status: state, code: "READY" });
    }).catch(error => {
      lastError = error;
      if (state === STATUS.DESTROYED) return result({ status: STATUS.DESTROYED, code: "PRINTER_INTEGRATION_DESTROYED", error });
      state = STATUS.UNAVAILABLE;
      return result({ status: state, code: "INITIALIZATION_FAILED", error });
    });
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

  async function retire(value) {
    if (!value) return;
    if (retirementPromises.has(value)) return retirementPromises.get(value);
    const retirement = Promise.resolve().then(async () => {
      try { value.engine.close(); } catch (error) {}
      try { value.queue.destroy(); } catch (error) {}
      try { if (value.configuration && value.configuration.runtimeFactory) await value.configuration.runtimeFactory.destroy(); else if (value.transport && typeof value.transport.destroy === "function") await value.transport.destroy(); }
      catch (error) { console.warn("Printer integration runtime retirement isolated", { code: error && error.code || "RUNTIME_TEARDOWN_FAILED" }); }
    });
    retirementPromises.set(value, retirement);
    return retirement;
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
          if (configurationGeneration !== targetGeneration) await retire(replacement);
        } while (configurationGeneration !== targetGeneration);
        if (state === STATUS.DESTROYED) { await retire(replacement); return result({ status: state, code: "PRINTER_INTEGRATION_DESTROYED", error: new Error("Printer integration was destroyed during reload") }); }
        components = replacement;
        configured = replacement.configuration.enabled === true;
        configurationCode = replacement.configuration.code || "UNCONFIGURED";
        configurationStale = false; lastError = null; state = STATUS.READY;
        await retire(previous);
        return result({ ok: true, status: state, code: "CONFIGURATION_RELOADED" });
      } catch (error) {
        await retire(previous);
        if (state === STATUS.DESTROYED) return result({ status: STATUS.DESTROYED, code: "PRINTER_INTEGRATION_DESTROYED", error });
        components = null; configured = false; configurationCode = "RELOAD_FAILED";
        configurationStale = false; lastError = error; state = STATUS.UNAVAILABLE;
        return result({ status: state, code: "CONFIGURATION_RELOAD_FAILED", error });
      }
    }).catch(error => state === STATUS.DESTROYED
      ? result({ status: STATUS.DESTROYED, code: "PRINTER_INTEGRATION_DESTROYED", error })
      : result({ status: "unavailable", code: "CONFIGURATION_RELOAD_FAILED", error })).finally(() => { reloadPromise = null; });
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

  async function canHandleQrAutoPrint() {
    try {
      if (state === STATUS.DESTROYED) return Object.freeze({ eligible: false, code: "PRINTER_INTEGRATION_DESTROYED" });
      if (!environmentSupported) return Object.freeze({ eligible: false, code: "WEBUSB_UNSUPPORTED" });
      const initialized = await initialize();
      if (!initialized.ok || !components) return Object.freeze({ eligible: false, code: initialized.code || "PRINTER_INTEGRATION_UNAVAILABLE" });
      if (configurationStale) {
        const reloaded = await reloadConfiguration();
        if (!reloaded.ok || !components) return Object.freeze({ eligible: false, code: reloaded.code || "CONFIGURATION_RELOAD_FAILED" });
      }
      if (components.configuration.transports instanceof Map) {
        return Object.freeze({ eligible: components.configuration.enabled === true, code: components.configuration.enabled === true ? "READY" : (components.configuration.code || "PRINTER_NOT_READY") });
      }
      const configModule = await importer("./printer-pos-config.js");
      return configModule.inspectPosPrinterEligibility(importer, environment);
    } catch (error) {
      return Object.freeze({ eligible: false, code: String(error && error.code || "PRINTER_ELIGIBILITY_FAILED") });
    }
  }

  let destroyPromise = null;
  function destroy() {
    if (state === STATUS.DESTROYED) return false;
    state = STATUS.DESTROYED;
    const previous = components;
    components = null;
    const pendingInitialization = initialization;
    const pendingReload = reloadPromise;
    destroyPromise = Promise.all([
      retire(previous),
      pendingInitialization ? Promise.resolve(pendingInitialization).catch(() => undefined) : Promise.resolve(),
      pendingReload ? Promise.resolve(pendingReload).catch(() => undefined) : Promise.resolve()
    ]).then(() => undefined);
    return true;
  }

  function destroyAsync() {
    if (state !== STATUS.DESTROYED) destroy();
    return destroyPromise || Promise.resolve();
  }

  return Object.freeze({ initialize, handle, canHandleQrAutoPrint, getStatus, invalidateConfiguration, reloadConfiguration, destroy, destroyAsync });
}

export const PrinterIntegration = createPrinterIntegration();
