const DEVICE_KEY = "enpoint_printer_host_device_id";

function createId(prefix, cryptoObject) {
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return `${prefix}-${cryptoObject.randomUUID()}`;
  const values = new Uint32Array(4);
  if (cryptoObject && typeof cryptoObject.getRandomValues === "function") cryptoObject.getRandomValues(values);
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 0xffffffff);
  return `${prefix}-${Array.from(values, value => value.toString(16).padStart(8, "0")).join("")}`;
}

export function createPrinterHostIdentity(options = {}) {
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const cryptoObject = options.crypto === undefined ? globalThis.crypto : options.crypto;
  let deviceId = "";
  try { deviceId = String(storage && storage.getItem(DEVICE_KEY) || ""); } catch (error) {}
  if (!deviceId) {
    deviceId = createId("device", cryptoObject);
    try { if (storage) storage.setItem(DEVICE_KEY, deviceId); } catch (error) {}
  }
  const sessionId = createId("session", cryptoObject);
  return Object.freeze({ deviceId, sessionId, ownerId: `${deviceId}:${sessionId}` });
}

export const PrinterHostIdentity = Object.freeze({ create: createPrinterHostIdentity, storageKey: DEVICE_KEY });
