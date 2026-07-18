import { PrinterProfile } from "./printer-profile.js";

const STORAGE_DEFAULTS = Object.freeze({
  printerMode: "manual",
  printerProvider: "browser",
  printerName: "Browser",
  paperWidth: "58",
  copies: "1",
  autoPrint: "false"
});

function createUnavailableProvider(name) {
  return Object.freeze({
    name,
    available: false,
    print() {
      return Promise.reject(new Error(`${name} Provider 尚未實作`));
    },
    detect() {
      return Promise.resolve([]);
    }
  });
}

const BrowserProvider = {
  name: "Browser",
  available: true,
  print(job) {
    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) return Promise.reject(new Error("瀏覽器已封鎖列印視窗"));

    printWindow.addEventListener("load", () => {
      window.setTimeout(() => printWindow.print(), 120);
    }, { once: true });
    printWindow.document.open();
    printWindow.document.write(job.documentHtml);
    printWindow.document.close();
    return Promise.resolve({ provider: "browser", copies: job.copies });
  },
  detect() {
    return Promise.resolve([{ id: "browser", name: "Browser", available: true }]);
  }
};

const providers = Object.freeze({
  browser: BrowserProvider,
  usb: createUnavailableProvider("USB"),
  bluetooth: createUnavailableProvider("Bluetooth"),
  network: createUnavailableProvider("Network")
});

let initialized = false;
let adapters = {};
let lastOrder = null;
let lastType = "kitchen";

function readSettings() {
  const settings = {};
  Object.keys(STORAGE_DEFAULTS).forEach(key => {
    let value = localStorage.getItem(key);
    if (value === null) {
      value = STORAGE_DEFAULTS[key];
      localStorage.setItem(key, value);
    }
    settings[key] = value;
  });
  settings.copies = Math.min(3, Math.max(1, Number(settings.copies) || 1));
  settings.autoPrint = settings.autoPrint === "true";
  return settings;
}

function saveSettings(nextSettings) {
  Object.keys(STORAGE_DEFAULTS).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(nextSettings, key)) {
      localStorage.setItem(key, String(nextSettings[key]));
    }
  });
  return readSettings();
}

function getProfile(type) {
  if (type === "kitchen") return PrinterProfile.getKitchenPrinter();
  if (type === "label") return PrinterProfile.getLabelPrinter();
  return PrinterProfile.getCustomerPrinter();
}

function getProvider(type) {
  const selected = getProfile(type).provider;
  return providers[selected] || providers.browser;
}

function createJob(type, order) {
  if (!order) throw new Error("缺少列印訂單");
  const builder = type === "customer" ? adapters.buildCustomer : adapters.buildKitchen;
  if (typeof builder !== "function" || typeof adapters.buildDocument !== "function") {
    throw new Error("Printer Center 尚未完成票券轉接初始化");
  }
  const profile = getProfile(type);
  const label = type === "customer" ? "客人單" : "廚房單";
  const title = `${label} #${order.orderNumber || order.id || ""}`;
  return {
    type,
    order,
    profile,
    provider: profile.provider,
    copies: profile.copies,
    paperWidth: profile.paperWidth,
    autoPrint: profile.autoPrint,
    documentHtml: adapters.buildDocument(title, builder(order), profile)
  };
}

function print(type, order) {
  try {
    const job = createJob(type, order);
    lastOrder = order;
    lastType = type;
    return getProvider(type).print(job);
  } catch (error) {
    return Promise.reject(error);
  }
}

export const PrinterCenter = {
  providers,
  init(options = {}) {
    adapters = Object.assign({}, adapters, options);
    readSettings();
    PrinterProfile.load();
    initialized = true;
    return this;
  },
  isInitialized() {
    return initialized;
  },
  getSettings: readSettings,
  saveSettings,
  printKitchen(order) {
    return print("kitchen", order);
  },
  printCustomer(order) {
    return print("customer", order);
  },
  testPrint() {
    const now = Date.now();
    return this.printCustomer({
      id: "TEST",
      orderNumber: "TEST",
      createdAt: now,
      type: "測試列印",
      items: [],
      total: 0,
      paymentStatus: "paid",
      note: "Printer Center Browser Provider 測試"
    });
  },
  reprint(orderOrId) {
    let order = orderOrId;
    if (typeof orderOrId === "string" && typeof adapters.resolveOrder === "function") {
      order = adapters.resolveOrder(orderOrId);
    }
    order = order || lastOrder;
    if (!order) return Promise.reject(new Error("目前沒有可重印的票券"));
    return print(lastType, order);
  },
  detectPrinter() {
    return getProvider(lastType).detect();
  },
  getLastOrder() {
    return lastOrder;
  }
};

window.PrinterCenter = PrinterCenter;
export { BrowserProvider, providers };
