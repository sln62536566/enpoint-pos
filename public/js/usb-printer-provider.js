const STATUSES = Object.freeze([
  "unsupported", "idle", "detecting", "no_device", "device_available",
  "requesting_permission", "selection_cancelled", "selected", "connecting",
  "connected", "disconnecting", "disconnected", "permission_denied",
  "device_not_found", "device_disconnected", "connection_failed", "error"
]);

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
  let state = {
    status: usb ? "idle" : "unsupported",
    message: usb ? "USB printer is idle" : "This browser does not support USB printer connections",
    devices: [], selectedDevice: null, connected: false, lastError: null
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
      connected: state.connected, lastError: state.lastError
    };
  }

  function update(status, message, error, changes = {}) {
    if (destroyed) return snapshot();
    state = Object.assign({}, state, changes, {
      status: STATUSES.includes(status) ? status : "error", message: message || status,
      lastError: error ? errorMessage(error) : null
    });
    listeners.slice().forEach(listener => {
      try { listener(snapshot()); } catch (listenerError) { console.error("USB printer listener error", listenerError); }
    });
    return snapshot();
  }

  function enqueue(action) {
    if (destroyed) return Promise.resolve(update("error", "USB printer provider has been destroyed"));
    operationCount += 1;
    const next = operationQueue.then(action, action).finally(() => { operationCount -= 1; });
    operationQueue = next.catch(() => undefined);
    return next;
  }

  async function detectInternal() {
    if (!usb) return update("unsupported", "This browser does not support USB printer connections", null, { devices: [] }).devices;
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
          activeDevice = null;
          authorizedDevices = nextMap;
          return update("device_not_found", "The selected USB printer is no longer authorized", null, {
            devices: Array.from(nextMap, ([key, value]) => metadata(value, key)), selectedDevice: null, connected: false
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
    return update("selected", "USB printer selected", null, { selectedDevice: metadata(selected, keyFor(selected)), connected: false });
  }

  async function connectInternal() {
    if (!activeDevice) return update("device_not_found", "Choose an authorized USB printer first", null, { connected: false });
    if (activeDevice.opened) return update("connected", "USB printer connected", null, { connected: true });
    update("connecting", "Connecting USB printer");
    try {
      await activeDevice.open();
      if (!activeDevice.configuration) {
        const configurations = Array.from(activeDevice.configurations || []);
        const preferred = configurations.find(item => item.configurationValue === 1) || configurations[0];
        if (!preferred) throw new Error("USB device has no available configuration");
        await activeDevice.selectConfiguration(preferred.configurationValue);
      }
      return update("connected", "USB printer connected", null, { connected: true });
    } catch (error) {
      try { if (activeDevice && activeDevice.opened) await activeDevice.close(); } catch (cleanupError) { console.error("USB cleanup failed", cleanupError); }
      return update("connection_failed", "Unable to open USB printer", error, { connected: false });
    }
  }

  async function disconnectInternal() {
    if (!activeDevice || !activeDevice.opened) return update("disconnected", "USB printer disconnected", null, { connected: false });
    update("disconnecting", "Disconnecting USB printer");
    try {
      await activeDevice.close();
      return update("disconnected", "USB printer disconnected", null, { connected: false });
    } catch (error) {
      return update("error", "Unable to close USB printer", error, { connected: Boolean(activeDevice.opened) });
    }
  }

  function onConnect() { enqueue(detectInternal); }
  function onDisconnect(event) {
    enqueue(() => {
      if (!sameDevice(event && event.device, activeDevice)) return snapshot();
      activeDevice = null;
      return update("device_disconnected", "USB printer was physically disconnected", null, { selectedDevice: null, connected: false });
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
      if (!usb) return Promise.resolve(update("unsupported", "This browser does not support USB printer connections").selectedDevice);
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
    getStatus: snapshot,
    print() { return Promise.reject(new Error("Printer Phase 3 does not send print data or implement ESC/POS")); },
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
      authorizedDevices.clear(); activeDevice = null;
      state = Object.assign({}, state, { status: "error", message: "USB printer provider has been destroyed", devices: [], selectedDevice: null, connected: false });
      return snapshot();
    }
  };
}

export const USB_PRINTER_STATUSES = STATUSES;
export { sameDevice };
