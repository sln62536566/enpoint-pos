import { PrinterProfile } from "./printer-profile.js";
import { PrintQueue } from "./print-queue.js";

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

function createUsbFallbackProvider(message = "USB Provider unavailable") {
  const fallbackState = { status: "unsupported", message, devices: [], selectedDevice: null, connected: false, lastError: message };
  return {
    name: "USB", available: false,
    detect: () => Promise.resolve([]), requestDevice: () => Promise.resolve(null),
    selectAuthorizedDevice: () => Promise.resolve(fallbackState), connect: () => Promise.resolve(fallbackState),
    disconnect: () => Promise.resolve(fallbackState), getStatus: () => Object.assign({}, fallbackState),
    transferChunk: () => Promise.reject(new Error("USB transport driver unavailable")),
    print: () => Promise.reject(new Error("Printer Phase 3 does not send print data or implement ESC/POS")),
    onStatusChanged: () => function() {}, destroy: () => fallbackState
  };
}

let activeUsbProvider = createUsbFallbackProvider();
let usbLoadPromise = null;
const UsbProvider = {
  name: "USB",
  get available() { return activeUsbProvider.available; },
  detect() { return activeUsbProvider.detect(); },
  requestDevice(filters) { return activeUsbProvider.requestDevice(filters); },
  selectAuthorizedDevice(key) { return activeUsbProvider.selectAuthorizedDevice(key); },
  connect() { return activeUsbProvider.connect(); },
  disconnect() { return activeUsbProvider.disconnect(); },
  transferChunk(data) { return activeUsbProvider.transferChunk(data); },
  getStatus() { return activeUsbProvider.getStatus(); },
  print(job) { return activeUsbProvider.print(job); },
  onStatusChanged(callback) { return activeUsbProvider.onStatusChanged(callback); },
  destroy() { return activeUsbProvider.destroy(); }
};

export function initializeUsbProvider(importer = () => import("./usb-printer-provider.js")) {
  if (usbLoadPromise) return usbLoadPromise;
  usbLoadPromise = Promise.resolve().then(importer).then(module => {
    if (!module || typeof module.createUsbPrinterProvider !== "function") throw new Error("Invalid USB Provider module");
    activeUsbProvider = module.createUsbPrinterProvider();
    return activeUsbProvider;
  }).catch(error => {
    console.error("Printer USB module unavailable", error);
    activeUsbProvider = createUsbFallbackProvider("USB Provider module unavailable");
    return activeUsbProvider;
  });
  return usbLoadPromise;
}
const providers = Object.freeze({
  browser: BrowserProvider,
  usb: UsbProvider,
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
  if (type === "kitchen") return PrinterProfile.getKitchen();
  if (type === "label") return PrinterProfile.getLabel();
  return PrinterProfile.getCustomer();
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
  if (!profile.enabled) throw new Error(`${profile.name} 已停用`);
  const label = type === "customer" ? "客人單" : "廚房單";
  const title = `${label} #${order.orderNumber || order.id || ""}`;
  return {
    type,
    order,
    profile,
    copies: profile.copies,
    paperWidth: profile.paperSize,
    autoPrint: profile.autoPrint,
    documentHtml: adapters.buildDocument(title, builder(order), profile)
  };
}

function print(type, order) {
  try {
    const job = createJob(type, order);
    lastOrder = order;
    lastType = type;
    return PrintQueue.enqueue(job);
  } catch (error) {
    return Promise.reject(error);
  }
}

export const PrinterCenter = {
  providers,
  init(options = {}) {
    try {
      adapters = Object.assign({}, adapters, options);
      readSettings();
      PrinterProfile.load();
      PrintQueue.init({ providers });
      initialized = true;
      initializeUsbProvider();
    } catch (error) {
      initialized = false;
      console.error("Printer USB initialization unavailable", error);
    }
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
  detectUsbPrinter() {
    return UsbProvider.detect();
  },
  requestUsbPrinter(filters) {
    return UsbProvider.requestDevice(filters);
  },
  selectAuthorizedUsbPrinter(key) {
    return UsbProvider.selectAuthorizedDevice(key);
  },
  connectUsbPrinter() {
    return UsbProvider.connect();
  },
  disconnectUsbPrinter() {
    return UsbProvider.disconnect();
  },
  getUsbStatus() {
    return UsbProvider.getStatus();
  },
  whenUsbReady() {
    return initializeUsbProvider();
  },
  onUsbStatusChanged(callback) {
    return UsbProvider.onStatusChanged(callback);
  },
  destroyUsb() {
    UsbProvider.destroy();
  },
  getLastOrder() {
    return lastOrder;
  }
};

window.PrinterCenter = PrinterCenter;
export { BrowserProvider, UsbProvider, providers };
