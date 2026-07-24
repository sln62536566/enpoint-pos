const STATUSES = Object.freeze([
  "unsupported", "idle", "detecting", "no_device", "device_available",
  "requesting_permission", "selection_cancelled", "selected", "connecting",
  "connected", "disconnecting", "disconnected", "permission_denied",
  "device_not_found", "device_disconnected", "connection_failed", "error"
]);

const DRIVER_ERRORS = Object.freeze({
  NO_CONFIGURATION: "NO_CONFIGURATION", NO_INTERFACE: "NO_INTERFACE",
  NO_ENDPOINT: "NO_ENDPOINT", CLAIM_FAILED: "CLAIM_FAILED",
  RELEASE_FAILED: "RELEASE_FAILED", DEVICE_BUSY: "DEVICE_BUSY",
  NOT_SUPPORTED: "NOT_SUPPORTED"
});

function driverError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function mapDriverError(error, fallbackCode) {
  if (error && error.code && DRIVER_ERRORS[error.code]) return error;
  if (error && (error.name === "NetworkError" || error.name === "InvalidStateError")) {
    return driverError(DRIVER_ERRORS.DEVICE_BUSY, "USB device is busy", error);
  }
  return driverError(fallbackCode, errorMessage(error), error);
}

function configurationValue(configuration) {
  return Number(configuration && configuration.configurationValue);
}

function discoverCapability(device, cached) {
  const configurations = Array.from(device && device.configurations || []);
  if (!configurations.length) throw driverError(DRIVER_ERRORS.NO_CONFIGURATION, "USB device has no configuration");
  let sawInterface = false;
  function inspect(requireCached) {
    for (const configuration of configurations) {
      if (requireCached && configurationValue(configuration) !== cached.configuration) continue;
      const interfaces = Array.from(configuration.interfaces || []);
      if (interfaces.length) sawInterface = true;
      for (const usbInterface of interfaces) {
        if (requireCached && Number(usbInterface.interfaceNumber) !== cached.interfaceNumber) continue;
        for (const alternate of Array.from(usbInterface.alternates || [])) {
          const endpoint = Array.from(alternate.endpoints || []).find(item => item.direction === "out" &&
            (!requireCached || Number(item.endpointNumber) === cached.endpointNumber));
          if (endpoint) return { configuration, usbInterface, alternate, endpoint };
        }
      }
    }
    return null;
  }
  const found = (cached && inspect(true)) || inspect(false);
  if (found) {
    const { configuration, usbInterface, alternate, endpoint } = found;
    return {
      vendorId: Number(device.vendorId) || 0, productId: Number(device.productId) || 0,
      configuration: configurationValue(configuration), interfaceNumber: Number(usbInterface.interfaceNumber),
      alternateSetting: Number(alternate.alternateSetting) || 0,
      endpointNumber: Number(endpoint.endpointNumber), packetSize: Number(endpoint.packetSize) || 0
    };
  }
  for (const configuration of configurations) {
    const interfaces = Array.from(configuration.interfaces || []);
    if (interfaces.length) sawInterface = true;
  }
  if (!sawInterface) throw driverError(DRIVER_ERRORS.NO_INTERFACE, "USB configuration has no interface");
  throw driverError(DRIVER_ERRORS.NO_ENDPOINT, "USB interface has no OUT endpoint");
}

function sameDevice(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (!left.serialNumber || !right.serialNumber) return false;
  return Number(left.vendorId) === Number(right.vendorId) &&
    Number(left.productId) === Number(right.productId) &&
    left.serialNumber === right.serialNumber;
}

function errorMessage(error) {
  return error && error.message ? error.message : "USB printer operation failed";
}

export function createUsbPrinterProvider(options = {}) {
  const environment = options.environment === undefined ? (typeof navigator !== "undefined" ? navigator : null) : options.environment;
  const usb = environment && environment.usb;
  const listeners = [];
  const objectKeys = new WeakMap();
  let keySequence = 0;
  let authorizedDevices = new Map();
  let activeDevice = null;
  let destroyed = false;
  let operationQueue = Promise.resolve();
  let operationCount = 0;
  const capabilityCache = new Map();
  let activeCapability = null;
  let claimedInterface = null;
  let state = {
    status: usb ? "idle" : "unsupported",
    message: usb ? "USB printer is idle" : "This browser does not support USB printer connections",
    devices: [], selectedDevice: null, connected: false, capability: null, lastError: null, lastErrorCode: usb ? null : DRIVER_ERRORS.NOT_SUPPORTED
  };

  function keyFor(device) {
    if (objectKeys.has(device)) return objectKeys.get(device);
    keySequence += 1;
    const key = `usb-runtime-${keySequence}`;
    objectKeys.set(device, key);
    return key;
  }

  function metadata(device, key) {
    return {
      key, productName: device.productName || "", manufacturerName: device.manufacturerName || "",
      vendorId: Number(device.vendorId) || 0, productId: Number(device.productId) || 0,
      serialNumber: device.serialNumber || ""
    };
  }

  function snapshot() {
    return {
      status: state.status, message: state.message,
      devices: state.devices.map(item => Object.assign({}, item)),
      selectedDevice: state.selectedDevice ? Object.assign({}, state.selectedDevice) : null,
      connected: state.connected, capability: state.capability ? Object.assign({}, state.capability) : null,
      lastError: state.lastError, lastErrorCode: state.lastErrorCode
    };
  }

  function update(status, message, error, changes = {}) {
    if (destroyed) return snapshot();
    state = Object.assign({}, state, changes, {
      status: STATUSES.includes(status) ? status : "error", message: message || status,
      lastError: error ? errorMessage(error) : null,
      lastErrorCode: error && error.code ? error.code : null
    });
    listeners.slice().forEach(listener => {
      try { listener(snapshot()); } catch (listenerError) { console.error("USB printer listener error", listenerError); }
    });
    return snapshot();
  }

  function cacheKey(device) {
    return `${Number(device.vendorId) || 0}:${Number(device.productId) || 0}:${device.serialNumber || keyFor(device)}`;
  }

  function enqueue(action) {
    if (destroyed) return Promise.resolve(update("error", "USB printer provider has been destroyed"));
    operationCount += 1;
    const next = operationQueue.then(action, action).finally(() => { operationCount -= 1; });
    operationQueue = next.catch(() => undefined);
    return next;
  }

  async function detectInternal() {
    if (!usb) return update("unsupported", "This browser does not support USB printer connections", driverError(DRIVER_ERRORS.NOT_SUPPORTED, "WebUSB is not supported"), { devices: [] }).devices;
    const wasConnected = state.connected;
    update("detecting", "Searching authorized USB devices");
    try {
      const raw = await usb.getDevices();
      const found = Array.isArray(raw) ? raw : [];
      const nextMap = new Map();
      found.forEach(device => nextMap.set(keyFor(device), device));
      if (activeDevice) {
        const match = found.find(device => sameDevice(device, activeDevice));
        if (!match) {
          activeDevice = null; activeCapability = null; claimedInterface = null;
          authorizedDevices = nextMap;
          return update("device_not_found", "The selected USB printer is no longer authorized", null, {
            devices: Array.from(nextMap, ([key, value]) => metadata(value, key)), selectedDevice: null, connected: false, capability: null
          }).devices;
        }
        activeDevice = match;
      }
      authorizedDevices = nextMap;
      const devices = Array.from(nextMap, ([key, value]) => metadata(value, key));
      if (activeDevice) {
        const selectedKey = keyFor(activeDevice);
        return update(wasConnected && activeDevice.opened ? "connected" : "selected", wasConnected ? "USB printer connected" : "USB printer selected", null, {
          devices, selectedDevice: metadata(activeDevice, selectedKey), connected: wasConnected && Boolean(activeDevice.opened)
        }).devices;
      }
      if (found.length === 1) {
        activeDevice = found[0];
        return update("selected", "Authorized USB printer selected", null, {
          devices, selectedDevice: metadata(activeDevice, keyFor(activeDevice)), connected: false
        }).devices;
      }
      return update(found.length ? "device_available" : "no_device", found.length ? "Authorized USB devices available" : "No authorized USB printer found", null, {
        devices, selectedDevice: null, connected: false
      }).devices;
    } catch (error) {
      update("error", "Unable to search USB devices", error);
      return [];
    }
  }

  async function handleRequestResult(chooserPromise) {
    try {
      const device = await chooserPromise;
      if (destroyed) return null;
      const key = keyFor(device);
      authorizedDevices.set(key, device);
      activeDevice = device;
      const selected = metadata(device, key);
      update("selected", "USB printer selected", null, {
        devices: Array.from(authorizedDevices, ([itemKey, value]) => metadata(value, itemKey)), selectedDevice: selected, connected: false
      });
      return Object.assign({}, selected);
    } catch (error) {
      if (destroyed) return null;
      if (error && error.name === "NotFoundError") update("selection_cancelled", "USB printer selection cancelled");
      else if (error && (error.name === "SecurityError" || error.name === "NotAllowedError")) update("permission_denied", "USB printer permission denied", error);
      else update("error", "Unable to choose USB printer", error);
      return null;
    }
  }

  function selectInternal(key) {
    if ((activeDevice && activeDevice.opened) || state.connected) {
      return update("connected", "請先中斷目前 USB 印表機，再選擇其他裝置", null, { connected: true });
    }
    const selected = authorizedDevices.get(String(key || ""));
    if (!selected) return update("device_not_found", "Authorized USB printer not found", null, { selectedDevice: null, connected: false });
    activeDevice = selected;
    activeCapability = null; claimedInterface = null;
    return update("selected", "USB printer selected", null, { selectedDevice: metadata(selected, keyFor(selected)), connected: false, capability: null });
  }

  async function connectInternal() {
    if (!activeDevice) return update("device_not_found", "Choose an authorized USB printer first", null, { connected: false });
    if (activeDevice.opened && claimedInterface !== null) return update("connected", "USB printer driver ready", null, { connected: true });
    update("connecting", "Connecting USB printer");
    let phase = DRIVER_ERRORS.DEVICE_BUSY;
    try {
      if (typeof activeDevice.open !== "function" || typeof activeDevice.claimInterface !== "function") {
        throw driverError(DRIVER_ERRORS.NOT_SUPPORTED, "WebUSB driver lifecycle is not supported by this device");
      }
      if (!activeDevice.opened) await activeDevice.open();
      const key = cacheKey(activeDevice);
      const cached = capabilityCache.get(key) || null;
      activeCapability = discoverCapability(activeDevice, cached);
      phase = DRIVER_ERRORS.NO_CONFIGURATION;
      if (!activeDevice.configuration || configurationValue(activeDevice.configuration) !== activeCapability.configuration) {
        await activeDevice.selectConfiguration(activeCapability.configuration);
      }
      phase = DRIVER_ERRORS.CLAIM_FAILED;
      await activeDevice.claimInterface(activeCapability.interfaceNumber);
      claimedInterface = activeCapability.interfaceNumber;
      if (activeCapability.alternateSetting !== 0) {
        if (typeof activeDevice.selectAlternateInterface !== "function") {
          throw driverError(DRIVER_ERRORS.NOT_SUPPORTED, "USB alternate interface selection is not supported");
        }
        await activeDevice.selectAlternateInterface(activeCapability.interfaceNumber, activeCapability.alternateSetting);
      }
      capabilityCache.set(key, Object.assign({}, activeCapability));
      return update("connected", "USB printer driver ready", null, {
        connected: true, capability: Object.assign({}, activeCapability)
      });
    } catch (error) {
      const mapped = mapDriverError(error, phase);
      try {
        if (activeDevice && activeDevice.opened && claimedInterface !== null && typeof activeDevice.releaseInterface === "function") {
          await activeDevice.releaseInterface(claimedInterface);
        }
      } catch (cleanupError) { console.error("USB interface cleanup failed", cleanupError); }
      claimedInterface = null;
      try { if (activeDevice && activeDevice.opened) await activeDevice.close(); } catch (cleanupError) { console.error("USB cleanup failed", cleanupError); }
      activeCapability = null;
      return update("connection_failed", mapped.message, mapped, { connected: false, capability: null });
    }
  }

  async function disconnectInternal() {
    if (!activeDevice || !activeDevice.opened) return update("disconnected", "USB printer disconnected", null, { connected: false });
    update("disconnecting", "Disconnecting USB printer");
    let releaseError = null;
    try {
      if (claimedInterface !== null) {
        if (typeof activeDevice.releaseInterface !== "function") throw driverError(DRIVER_ERRORS.NOT_SUPPORTED, "USB interface release is not supported");
        try { await activeDevice.releaseInterface(claimedInterface); }
        catch (error) { releaseError = mapDriverError(error, DRIVER_ERRORS.RELEASE_FAILED); }
      }
      claimedInterface = null;
      await activeDevice.close();
      activeCapability = null;
      if (releaseError) return update("error", releaseError.message, releaseError, { connected: false, capability: null });
      return update("disconnected", "USB printer disconnected", null, { connected: false, capability: null });
    } catch (error) {
      const mapped = mapDriverError(error, error && error.code === DRIVER_ERRORS.NOT_SUPPORTED ? DRIVER_ERRORS.NOT_SUPPORTED : DRIVER_ERRORS.DEVICE_BUSY);
      return update("error", mapped.message, mapped, { connected: Boolean(activeDevice.opened), capability: activeCapability });
    }
  }

  async function transferChunk(data) {
    if (destroyed) return Promise.reject(driverError(DRIVER_ERRORS.NOT_SUPPORTED, "USB printer provider has been destroyed"));
    if (!(data instanceof Uint8Array)) return Promise.reject(new TypeError("USB transfer data must be a Uint8Array"));
    if (!state.connected || !activeDevice || !activeDevice.opened || claimedInterface === null || !activeCapability) {
      return Promise.reject(driverError(DRIVER_ERRORS.DEVICE_BUSY, "USB printer driver is not ready"));
    }
    if (typeof activeDevice.transferOut !== "function") {
      return Promise.reject(driverError(DRIVER_ERRORS.NOT_SUPPORTED, "USB OUT transfer is not supported"));
    }
    const browserResult = await activeDevice.transferOut(activeCapability.endpointNumber, data);
    if (browserResult && browserResult.status && browserResult.status !== "ok") {
      throw driverError(DRIVER_ERRORS.DEVICE_BUSY, `USB OUT transfer failed: ${browserResult.status}`);
    }
    const bytesTransferred = browserResult && Number.isFinite(Number(browserResult.bytesWritten))
      ? Number(browserResult.bytesWritten) : data.byteLength;
    if (bytesTransferred !== data.byteLength) {
      throw driverError(DRIVER_ERRORS.DEVICE_BUSY, "USB OUT transfer was incomplete");
    }
    return { ok: true, bytesTransferred };
  }

  function onConnect() { enqueue(detectInternal); }
  function onDisconnect(event) {
    enqueue(() => {
      if (!sameDevice(event && event.device, activeDevice)) return snapshot();
      activeDevice = null; activeCapability = null; claimedInterface = null;
      return update("device_disconnected", "USB printer was physically disconnected", null, { selectedDevice: null, connected: false, capability: null });
    });
  }

  if (usb && typeof usb.addEventListener === "function") {
    usb.addEventListener("connect", onConnect);
    usb.addEventListener("disconnect", onDisconnect);
  }

  return {
    name: "USB", available: Boolean(usb),
    detect() { return enqueue(detectInternal); },
    requestDevice(filters) {
      if (destroyed) return Promise.resolve(snapshot());
      if (!usb) return Promise.resolve(update("unsupported", "This browser does not support USB printer connections", driverError(DRIVER_ERRORS.NOT_SUPPORTED, "WebUSB is not supported")).selectedDevice);
      if (operationCount > 0) {
        return Promise.resolve(update("error", "USB 正在處理其他操作，請完成後再次點選"));
      }
      if ((activeDevice && activeDevice.opened) || state.connected) {
        return Promise.resolve(update("connected", "請先中斷目前 USB 印表機，再選擇其他裝置", null, { connected: true }));
      }
      update("requesting_permission", "Choose a USB printer");
      let chooserPromise;
      try {
        chooserPromise = usb.requestDevice({ filters: Array.isArray(filters) ? filters : [] });
      } catch (error) {
        chooserPromise = Promise.reject(error);
      }
      operationCount += 1;
      const result = handleRequestResult(chooserPromise).finally(() => { operationCount -= 1; });
      operationQueue = result.catch(() => undefined);
      return result;
    },
    selectAuthorizedDevice(key) { return enqueue(() => selectInternal(key)); },
    connect() { return enqueue(connectInternal); },
    disconnect() { return enqueue(disconnectInternal); },
    transferChunk,
    getStatus: snapshot,
    print() { return Promise.reject(new Error("Printer Phase 4 provides USB communication setup only and does not print")); },
    onStatusChanged(callback) {
      if (destroyed || typeof callback !== "function") return function() {};
      listeners.push(callback);
      return () => { const index = listeners.indexOf(callback); if (index >= 0) listeners.splice(index, 1); };
    },
    destroy() {
      if (destroyed) return snapshot();
      destroyed = true;
      if (usb && typeof usb.removeEventListener === "function") {
        usb.removeEventListener("connect", onConnect);
        usb.removeEventListener("disconnect", onDisconnect);
      }
      listeners.length = 0;
      authorizedDevices.clear(); capabilityCache.clear(); activeDevice = null; activeCapability = null; claimedInterface = null;
      state = Object.assign({}, state, { status: "error", message: "USB printer provider has been destroyed", devices: [], selectedDevice: null, connected: false, capability: null });
      return snapshot();
    }
  };
}

export const USB_PRINTER_STATUSES = STATUSES;
export { DRIVER_ERRORS as USB_DRIVER_ERRORS, discoverCapability, sameDevice };
