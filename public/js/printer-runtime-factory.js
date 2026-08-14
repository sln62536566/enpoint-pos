const sessionId = `usb-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sessionDevices = new Map();
const objectAliases = new WeakMap();
const runtimePool = new Map();
let aliasSequence = 0;

function text(value) { return value === undefined || value === null ? "" : String(value); }
function number(value) { return Number(value) || 0; }
function sessionAlias(device) {
  if (!objectAliases.has(device)) objectAliases.set(device, `device-${++aliasSequence}`);
  return objectAliases.get(device);
}

export function createUsbDeviceBinding(device) {
  if (!device || typeof device !== "object") throw new TypeError("USB device binding requires device metadata");
  const vendorId = number(device.vendorId), productId = number(device.productId), serialNumber = text(device.serialNumber);
  const durable = Boolean(serialNumber);
  const bindingId = durable ? `usb:${vendorId}:${productId}:${serialNumber}` : `usb-session:${sessionId}:${sessionAlias(device)}`;
  if (!durable) sessionDevices.set(bindingId, device);
  return Object.freeze({ bindingId, vendorId, productId, serialNumber, productName: text(device.productName), manufacturerName: text(device.manufacturerName), durable, sessionId: durable ? "" : sessionId });
}

export async function listAuthorizedUsbBindings(environment = globalThis) {
  const usb = environment && environment.navigator && environment.navigator.usb;
  if (!usb || typeof usb.getDevices !== "function") return Object.freeze([]);
  const devices = await usb.getDevices();
  return Object.freeze((Array.isArray(devices) ? devices : []).map(createUsbDeviceBinding));
}

export async function requestUsbDeviceBinding(filters, environment = globalThis) {
  const usb = environment && environment.navigator && environment.navigator.usb;
  if (!usb || typeof usb.requestDevice !== "function") throw Object.assign(new Error("WebUSB unavailable"), { code: "NOT_SUPPORTED" });
  const normalizedFilters = Array.isArray(filters) && filters.length ? filters : [{}];
  const device = await usb.requestDevice({ filters: normalizedFilters });
  return createUsbDeviceBinding(device);
}

export async function resolveUsbDeviceBinding(binding, environment = globalThis) {
  const usb = environment && environment.navigator && environment.navigator.usb;
  if (!usb || typeof usb.getDevices !== "function") throw Object.assign(new Error("WebUSB unavailable"), { code: "NOT_SUPPORTED" });
  if (!binding || !binding.bindingId) throw Object.assign(new Error("USB profile has no device binding"), { code: "PHYSICAL_TARGET_NOT_FOUND" });
  if (binding.durable === false) {
    if (binding.sessionId !== sessionId || !sessionDevices.has(binding.bindingId)) throw Object.assign(new Error("Session USB binding expired"), { code: "PHYSICAL_TARGET_UNAVAILABLE" });
    return sessionDevices.get(binding.bindingId);
  }
  const devices = await usb.getDevices();
  const matches = (Array.isArray(devices) ? devices : []).filter(device => number(device.vendorId) === number(binding.vendorId) && number(device.productId) === number(binding.productId) && text(device.serialNumber) === text(binding.serialNumber));
  if (!matches.length) throw Object.assign(new Error("Bound USB printer is not authorized"), { code: "PHYSICAL_TARGET_UNAVAILABLE" });
  if (matches.length > 1 || !binding.serialNumber) throw Object.assign(new Error("USB printer identity is ambiguous"), { code: "AMBIGUOUS_USB_DEVICE" });
  return matches[0];
}

function scopedEnvironment(environment, device) {
  const source = environment.navigator.usb;
  return { usb: {
    getDevices: async () => [device],
    requestDevice: options => source.requestDevice(options),
    addEventListener: typeof source.addEventListener === "function" ? source.addEventListener.bind(source) : undefined,
    removeEventListener: typeof source.removeEventListener === "function" ? source.removeEventListener.bind(source) : undefined
  } };
}

function managedTransport(transport, driver) {
  let destroyed = false, closePromise = null;
  function close() {
    if (closePromise) return closePromise;
    destroyed = true;
    closePromise = Promise.resolve().then(async () => {
      try { if (transport && typeof transport.cancel === "function") transport.cancel("Physical runtime is retiring"); } catch (error) {}
      try { if (transport && typeof transport.flush === "function") await transport.flush(); } catch (error) {}
      try { if (transport && typeof transport.destroy === "function") transport.destroy(); } catch (error) {}
      let disconnectError = null;
      try {
        if (driver && typeof driver.disconnect === "function") {
          const status = await driver.disconnect();
          if (status && status.lastErrorCode) disconnectError = Object.assign(new Error(status.lastError || "USB runtime disconnect failed"), { code: status.lastErrorCode });
        }
      } catch (error) { disconnectError = error; }
      try { if (driver && typeof driver.destroy === "function") driver.destroy(); } catch (error) { if (!disconnectError) disconnectError = error; }
      if (disconnectError) console.warn("Physical printer runtime teardown isolated", { code: disconnectError.code || "RUNTIME_TEARDOWN_FAILED", message: disconnectError.message || String(disconnectError) });
      return Object.freeze({ ok: !disconnectError, code: disconnectError ? String(disconnectError.code || "RUNTIME_TEARDOWN_FAILED") : "RUNTIME_RELEASED" });
    });
    return closePromise;
  }
  return Object.freeze({
    send: (payload, context) => transport.send(payload, context),
    cancel: reason => transport.cancel(reason),
    flush: () => transport.flush(),
    isBusy: () => transport.isBusy(),
    close,
    destroy() { if (destroyed) return closePromise || false; return close(); }
  });
}

function leaseRuntime(bindingId, entry, runtime) {
  let released = false, releasePromise = null;
  const transport = runtime.transport;
  function release() {
    if (releasePromise) return releasePromise;
    if (released) return Promise.resolve(false);
    released = true; entry.references -= 1;
    releasePromise = entry.references === 0
      ? (runtimePool.delete(bindingId), Promise.resolve(typeof transport.close === "function" ? transport.close() : transport.destroy()))
      : Promise.resolve(true);
    return releasePromise;
  }
  return Object.freeze({
    bindingId, binding: runtime.binding, driver: runtime.driver,
    transport: Object.freeze({
      send: (payload, context) => transport.send(payload, context), cancel: reason => transport.cancel(reason),
      flush: () => transport.flush(), isBusy: () => transport.isBusy(),
      close: release,
      destroy() { return release(); }
    })
  });
}

export function createPrinterRuntimeFactory(options = {}) {
  const importer = typeof options.importer === "function" ? options.importer : specifier => import(specifier);
  const environment = options.environment === undefined ? globalThis : options.environment;
  const runtimes = new Map();

  async function runtimeFor(binding) {
    if (!binding || !binding.bindingId) throw Object.assign(new Error("USB profile has no device binding"), { code: "PHYSICAL_TARGET_NOT_FOUND" });
    if (runtimes.has(binding.bindingId)) return runtimes.get(binding.bindingId);
    let entry = runtimePool.get(binding.bindingId);
    if (!entry) {
      entry = { references: 0, promise: null };
      entry.promise = Promise.resolve().then(async () => {
        const device = await resolveUsbDeviceBinding(binding, environment);
        const [providerModule, transportModule] = await Promise.all([importer("./usb-printer-provider.js"), importer("./print-transport.js")]);
        const driver = providerModule.createUsbPrinterProvider({ environment: scopedEnvironment(environment, device) });
        await driver.detect();
        let status = driver.getStatus();
        if (!status.connected) await driver.connect();
        status = driver.getStatus();
        if (!status.connected || !status.capability) { driver.destroy(); throw Object.assign(new Error("Bound USB printer is not ready"), { code: status.lastErrorCode || "PRINTER_NOT_READY" }); }
        return Object.freeze({ bindingId: binding.bindingId, binding: Object.freeze(Object.assign({}, binding)), driver, transport: managedTransport(transportModule.createPrintTransport(driver), driver) });
      });
      runtimePool.set(binding.bindingId, entry);
    }
    entry.references += 1;
    const creating = entry.promise.then(runtime => leaseRuntime(binding.bindingId, entry, runtime));
    runtimes.set(binding.bindingId, creating);
    try { return await creating; }
    catch (error) { entry.references -= 1; if (entry.references === 0) runtimePool.delete(binding.bindingId); runtimes.delete(binding.bindingId); throw error; }
  }

  return Object.freeze({
    runtimeFor,
    async createMappings(printers) {
      const mappings = new Map(), ready = [], errors = new Map();
      for (const printer of printers || []) {
        try { const runtime = await runtimeFor(printer.deviceBinding); mappings.set(printer.id, runtime.transport); ready.push(Object.freeze(Object.assign({}, printer, { physicalBindingId: runtime.bindingId }))); }
        catch (error) { errors.set(printer.id, Object.freeze({ code: String(error && error.code || "PHYSICAL_TARGET_UNAVAILABLE"), message: String(error && error.message || "Physical target unavailable") })); }
      }
      return Object.freeze({ transports: mappings, printers: Object.freeze(ready), errors });
    },
    async destroy() {
      const pending = Array.from(runtimes.values()); runtimes.clear();
      const results = await Promise.all(pending.map(value => Promise.resolve(value).then(runtime => runtime.transport.close ? runtime.transport.close() : runtime.transport.destroy()).catch(error => {
        console.warn("Physical runtime factory teardown isolated", { code: error && error.code || "RUNTIME_TEARDOWN_FAILED" });
        return false;
      })));
      return Object.freeze({ ok: results.every(value => value !== false && (!value || value.ok !== false)), released: results.length });
    }
  });
}

export const USB_BINDING_SESSION_ID = sessionId;
