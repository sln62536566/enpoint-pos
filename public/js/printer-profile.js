const STORAGE_KEY = "printerProfiles";
const PROFILE_KEYS = Object.freeze(["Kitchen", "Customer", "Label"]);
const VALID_PROVIDERS = Object.freeze(["browser", "usb", "bluetooth", "network"]);
const VALID_PAPER_SIZES = Object.freeze(["58", "80", "40x30"]);
const listeners = { changed: [], saved: [], loaded: [] };

const DEFAULT_PROFILES = Object.freeze({
  Kitchen: Object.freeze({ id: "kitchen", name: "Kitchen Printer", provider: "browser", paperSize: "80", copies: 1, autoPrint: true, enabled: true }),
  Customer: Object.freeze({ id: "customer", name: "Customer Printer", provider: "browser", paperSize: "58", copies: 1, autoPrint: false, enabled: true }),
  Label: Object.freeze({ id: "label", name: "Label Printer", provider: "browser", paperSize: "40x30", copies: 1, autoPrint: false, enabled: false })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emit(eventName, payload) {
  listeners[eventName].slice().forEach(callback => {
    try { callback(clone(payload)); } catch (error) { console.error("PrinterProfile listener error", error); }
  });
}

function subscribe(eventName, callback) {
  if (typeof callback !== "function") return function() {};
  listeners[eventName].push(callback);
  return function unsubscribe() {
    const index = listeners[eventName].indexOf(callback);
    if (index >= 0) listeners[eventName].splice(index, 1);
  };
}

function resolveKey(idOrKey) {
  const value = String(idOrKey || "").toLowerCase();
  return PROFILE_KEYS.find(key => key.toLowerCase() === value || DEFAULT_PROFILES[key].id === value) || null;
}

function normalizeDeviceBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.bindingId) return null;
  return {
    bindingId: String(value.bindingId), vendorId: Number(value.vendorId) || 0, productId: Number(value.productId) || 0,
    serialNumber: String(value.serialNumber || ""), productName: String(value.productName || ""), manufacturerName: String(value.manufacturerName || ""),
    durable: value.durable !== false, sessionId: value.durable === false ? String(value.sessionId || "") : ""
  };
}

function normalizeProfile(value, key) {
  const defaults = DEFAULT_PROFILES[key];
  const source = value && typeof value === "object" ? value : {};
  const provider = String(source.provider || defaults.provider).toLowerCase();
  const legacyPaper = source.paperWidth !== undefined ? source.paperWidth : source.paperSize;
  const paperSize = String(legacyPaper || defaults.paperSize).toLowerCase().replace("×", "x");
  return {
    id: defaults.id,
    name: String(source.name || defaults.name),
    provider: VALID_PROVIDERS.indexOf(provider) >= 0 ? provider : defaults.provider,
    paperSize: VALID_PAPER_SIZES.indexOf(paperSize) >= 0 ? paperSize : defaults.paperSize,
    copies: Math.min(3, Math.max(1, Number(source.copies) || defaults.copies)),
    autoPrint: typeof source.autoPrint === "boolean" ? source.autoPrint : defaults.autoPrint,
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
    deviceBinding: provider === "usb" ? normalizeDeviceBinding(source.deviceBinding) : null
  };
}

function normalizeProfiles(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  PROFILE_KEYS.forEach(key => { result[key] = normalizeProfile(source[key], key); });
  return result;
}

function readStoredProfiles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

export const PrinterProfile = {
  registry: PROFILE_KEYS,
  load() {
    const profiles = normalizeProfiles(readStoredProfiles());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    emit("loaded", profiles);
    return clone(profiles);
  },
  save(keyOrProfiles, changes) {
    let profiles = this.load();
    const key = resolveKey(keyOrProfiles);
    if (key) {
      profiles[key] = normalizeProfile(Object.assign({}, profiles[key], changes), key);
    } else if (keyOrProfiles && typeof keyOrProfiles === "object") {
      profiles = normalizeProfiles(keyOrProfiles);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    emit("saved", profiles);
    return clone(profiles);
  },
  get(idOrKey) {
    const key = resolveKey(idOrKey);
    return key ? this.load()[key] : null;
  },
  getKitchen() {
    return this.get("Kitchen");
  },
  getCustomer() {
    return this.get("Customer");
  },
  getLabel() {
    return this.get("Label");
  },
  update(idOrKey, changes) {
    const key = resolveKey(idOrKey);
    if (!key) return null;
    const before = this.get(key);
    const profiles = this.save(key, changes || {});
    emit("changed", { key, before, profile: profiles[key] });
    return clone(profiles[key]);
  },
  getKitchenPrinter() {
    return this.getKitchen();
  },
  getCustomerPrinter() {
    return this.getCustomer();
  },
  getLabelPrinter() {
    return this.getLabel();
  },
  onChanged(callback) {
    return subscribe("changed", callback);
  },
  onSaved(callback) {
    return subscribe("saved", callback);
  },
  onLoaded(callback) {
    return subscribe("loaded", callback);
  }
};

export const PrinterProfileCenter = PrinterProfile;
window.PrinterProfile = PrinterProfile;
window.PrinterProfileCenter = PrinterProfileCenter;
export { PROFILE_KEYS };
