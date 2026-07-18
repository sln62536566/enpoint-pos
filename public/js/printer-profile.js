const STORAGE_KEY = "printerProfiles";
const PROFILE_NAMES = Object.freeze(["Kitchen", "Customer", "Label"]);
const VALID_PROVIDERS = Object.freeze(["browser", "usb", "bluetooth", "network"]);
const VALID_WIDTHS = Object.freeze(["58", "80"]);

function legacyDefaults() {
  const provider = localStorage.getItem("printerProvider") || "browser";
  const paperWidth = localStorage.getItem("paperWidth") || "58";
  const copies = localStorage.getItem("copies") || "1";
  const autoPrint = localStorage.getItem("autoPrint") === "true";
  return { provider, paperWidth, copies, autoPrint };
}

function createDefaults() {
  const inherited = normalizeProfile(legacyDefaults(), false);
  return {
    Kitchen: Object.assign({}, inherited),
    Customer: Object.assign({}, inherited),
    Label: normalizeProfile({ provider: "browser", paperWidth: "58", copies: 1, autoPrint: false }, true)
  };
}

function normalizeProfile(profile, isLabel) {
  const value = profile && typeof profile === "object" ? profile : {};
  return {
    provider: VALID_PROVIDERS.indexOf(String(value.provider || "").toLowerCase()) >= 0 ? String(value.provider).toLowerCase() : "browser",
    paperWidth: VALID_WIDTHS.indexOf(String(value.paperWidth)) >= 0 ? String(value.paperWidth) : "58",
    copies: Math.min(3, Math.max(1, Number(value.copies) || 1)),
    autoPrint: isLabel ? value.autoPrint === true : value.autoPrint === true
  };
}

function normalizeProfiles(value) {
  const defaults = createDefaults();
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  PROFILE_NAMES.forEach(name => {
    result[name] = normalizeProfile(Object.assign({}, defaults[name], source[name]), name === "Label");
  });
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const PrinterProfile = {
  registry: PROFILE_NAMES,
  load() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
      stored = null;
    }
    const profiles = normalizeProfiles(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    return clone(profiles);
  },
  save(nameOrProfiles, changes) {
    let profiles = this.load();
    if (typeof nameOrProfiles === "string" && PROFILE_NAMES.indexOf(nameOrProfiles) >= 0) {
      profiles[nameOrProfiles] = normalizeProfile(Object.assign({}, profiles[nameOrProfiles], changes), nameOrProfiles === "Label");
    } else if (nameOrProfiles && typeof nameOrProfiles === "object") {
      profiles = normalizeProfiles(nameOrProfiles);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    return clone(profiles);
  },
  getKitchenPrinter() {
    return this.load().Kitchen;
  },
  getCustomerPrinter() {
    return this.load().Customer;
  },
  getLabelPrinter() {
    return this.load().Label;
  }
};

window.PrinterProfile = PrinterProfile;
export { PROFILE_NAMES };
