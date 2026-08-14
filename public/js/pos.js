import {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  runTransaction,
  getBusinessDate,
  createOrderNumber
} from "./firebase.js";

import {
  getAppliedMenuOptionGroups
} from "./menu-studio-core.js";

import {
  applyOrderItemPrice,
  calculateOrderItemPrice,
  calculateOrderTotal
} from "./order-price-core.js";

import {
  formatOrderOptionHtml,
  formatOrderOptionLines
} from "./order-option-display.js";

import {
  playSound,
  configureSoundCenter,
  getSoundCenterSettings,
  unlockSoundCenter
} from "./sound-center.js?v=sound-phase-1";

let legacyPrinterModulesPromise = null;

function loadLegacyPrinterModules() {
  if (!legacyPrinterModulesPromise) {
    legacyPrinterModulesPromise = Promise.all([
      import("./printer-center.js"),
      import("./printer-profile.js"),
      import("./print-queue.js"),
      import("./printer-settings-operator.js")
    ]).then(function(modules) {
      var legacy = { PrinterCenter: modules[0].PrinterCenter, PrinterProfile: modules[1].PrinterProfile, PrintQueue: modules[2].PrintQueue, PrinterSettingsOperator: modules[3].PrinterSettingsOperator };
      legacy.PrinterCenter.init({
        buildKitchen: buildKitchenTicketHtml,
        buildCustomer: buildCustomerTicketHtml,
        buildDocument: buildPrintWindowHtml,
        resolveOrder: function(orderId) { return ordersData && ordersData[orderId] ? Object.assign({ id: orderId }, ordersData[orderId]) : null; }
      });
      return legacy;
    });
  }
  return legacyPrinterModulesPromise;
}

let printerOrderBridgePromise = null;
let manualPrinterProfilePromise = null;
let manualPrintSequence = 0;
let lastManualPrintRequest = null;
let qrPrinterOwnershipPromise = null;
let qrPrinterSnapshotChain = Promise.resolve();
const qrClaimRecoveryTimers = new Map();

function isPrintingEnabled() {
  return getFeatureModuleSettings().print !== false;
}

function loadPrinterOrderBridge() {
  if (!printerOrderBridgePromise) printerOrderBridgePromise = import("./printer-order-bridge.js");
  return printerOrderBridgePromise;
}

function loadManualPrinterProfile() {
  if (!manualPrinterProfilePromise) {
    manualPrinterProfilePromise = import("./printer-profile.js").catch(function(error) {
      manualPrinterProfilePromise = null;
      throw error;
    });
  }
  return manualPrinterProfilePromise;
}

function createManualPrintEventId(orderId, ticketType) {
  manualPrintSequence += 1;
  var sessionPart = typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now()) + "-" + String(manualPrintSequence);
  return ["manual", orderId, ticketType, sessionPart, manualPrintSequence].join(":");
}

function handleManualPrintResult(result) {
  if (result && result.ok && !result.skipped) {
    alert("列印工作已完成。");
    return result;
  }
  var code = result && result.code || "MANUAL_PRINT_FAILED";
  alert("列印失敗 / 印表機不可用（" + code + "）");
  return result;
}

function triggerManualOrderPrint(type, order) {
  var ticketType = type === "customer" ? "customer" : "kitchen";
  var routeGroup = ticketType === "customer" ? "Customer" : "Kitchen";
  var eventId = createManualPrintEventId(order.id, ticketType);
  var printerOrder = ticketType === "customer" ? Object.assign({}, order, { orderLookupUrl: getCustomerOrderUrl(order) }) : order;
  var printerEvent = {
    eventType: "ManualReprint",
    eventId: eventId,
    order: printerOrder,
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: "POS",
    businessEventVersion: "manual:v1",
    ticketType: ticketType,
    routeGroup: routeGroup,
    printerCapability: "manual-" + routeGroup.toLowerCase(),
    policy: "manual-print",
    metadata: { manual: true, reprint: true, requestedBy: "POS", requestedAt: Date.now(), originalOrderSource: order.orderSource || order.source || "" }
  };
  return Promise.resolve().then(loadPrinterOrderBridge).then(function(module) {
    if (!module || !module.PrinterOrderBridge || typeof module.PrinterOrderBridge.handle !== "function") throw Object.assign(new Error("Printer order bridge unavailable"), { code: "PRINTER_BRIDGE_UNAVAILABLE" });
    return module.PrinterOrderBridge.handle(printerEvent);
  }).then(handleManualPrintResult).catch(function(error) {
    return handleManualPrintResult({ ok: false, status: "isolated", code: error && error.code || "MANUAL_PRINT_FAILED" });
  });
}

function executeManualOrderPrint(type, order) {
  return loadManualPrinterProfile().then(function(profileModule) {
    var profile = type === "customer" ? profileModule.PrinterProfile.getCustomer() : profileModule.PrinterProfile.getKitchen();
    if (!profile || profile.enabled !== true) return handleManualPrintResult({ ok: false, status: "skipped", code: "PROFILE_DISABLED" });
    lastManualPrintRequest = { type: type === "customer" ? "customer" : "kitchen", orderId: order.id };
    if (profile.provider === "browser") {
      return loadLegacyPrinterModules().then(function(legacy) {
        return type === "customer" ? legacy.PrinterCenter.printCustomer(order) : legacy.PrinterCenter.printKitchen(order);
      }).then(function(result) {
        return handleManualPrintResult({ ok: true, status: "completed", code: "BROWSER_PRINT_COMPLETED", providerResult: result });
      }).catch(function(error) {
        return handleManualPrintResult({ ok: false, status: "isolated", code: error && error.code || "BROWSER_PRINT_FAILED" });
      });
    }
    if (profile.provider !== "usb") return handleManualPrintResult({ ok: false, status: "skipped", code: "PROVIDER_UNSUPPORTED" });
    return triggerManualOrderPrint(type, order);
  }).catch(function(error) {
    return handleManualPrintResult({ ok: false, status: "isolated", code: error && error.code || "MANUAL_PRINT_FAILED" });
  });
}

function reprintLastManualOrder() {
  if (!lastManualPrintRequest) return handleManualPrintResult({ ok: false, status: "skipped", code: "NO_MANUAL_PRINT_HISTORY" });
  var order = ordersData && ordersData[lastManualPrintRequest.orderId] ? Object.assign({ id: lastManualPrintRequest.orderId }, ordersData[lastManualPrintRequest.orderId]) : null;
  if (!order) return handleManualPrintResult({ ok: false, status: "skipped", code: "ORDER_NOT_FOUND" });
  return executeManualOrderPrint(lastManualPrintRequest.type, order);
}

function loadQrPrinterOwnership() {
  if (!qrPrinterOwnershipPromise) {
    qrPrinterOwnershipPromise = Promise.all([
      import("./printer-order-transition.js"),
      import("./printer-claim-store.js"),
      import("./printer-host-identity.js")
    ]).then(function(modules) {
      return Object.freeze({
        detector: modules[0].createQrOrderTransitionDetector(),
        claimStore: modules[1].createPrinterClaimStore({ db: db, ref: ref, runTransaction: runTransaction }),
        identity: modules[2].createPrinterHostIdentity()
      });
    });
  }
  return qrPrinterOwnershipPromise;
}

async function handleQrPrinterEvent(event, ownership) {
  if (!isPrintingEnabled()) return { ok: true, status: "skipped", code: "PRINT_MODULE_DISABLED" };
  const bridgeModule = await loadPrinterOrderBridge();
  const bridge = bridgeModule && bridgeModule.PrinterOrderBridge;
  if (!bridge || typeof bridge.canHandleQrAutoPrint !== "function" || typeof bridge.handle !== "function") throw Object.assign(new Error("QR printer bridge unavailable"), { code: "PRINTER_BRIDGE_UNAVAILABLE" });
  const eligibility = await bridge.canHandleQrAutoPrint();
  if (!eligibility || eligibility.eligible !== true) return { ok: true, status: "skipped", code: eligibility && eligibility.code || "PRINTER_HOST_INELIGIBLE" };
  const acquired = await ownership.claimStore.claim(event, ownership.identity);
  if (!acquired.acquired) {
    scheduleQrClaimRecovery(event, ownership, acquired);
    return acquired;
  }
  clearQrClaimRecovery(acquired.claimKey);
  const printing = await ownership.claimStore.markPrinting(acquired.claimKey, ownership.identity.ownerId);
  if (!printing.ok) return printing;
  const printerEvent = Object.assign({}, event, {
    eventId: acquired.claimKey,
    metadata: {
      claimKey: acquired.claimKey,
      claimOwner: ownership.identity.ownerId,
      claimAttempt: acquired.claim.attempt,
      crossDeviceClaimed: true,
      paymentStatus: event.order.paymentStatus,
      isTestOrder: event.order.isTestOrder === true,
      test: event.order.isTestOrder === true
    }
  });
  const heartbeat = startQrClaimHeartbeat(acquired.claimKey, ownership);
  const result = await bridge.handle(printerEvent);
  const heartbeatState = await heartbeat.finish();
  if (heartbeatState.ownershipLost || heartbeatState.uncertain) {
    console.warn("QR printer ownership uncertain", { orderId: event.orderId, claimKey: acquired.claimKey, code: heartbeatState.code });
    return { ok: false, status: "isolated", code: heartbeatState.code || "CLAIM_OWNERSHIP_UNCERTAIN" };
  }
  return finalizeQrPrinterClaim(event, ownership, acquired, result);
}

async function finalizeQrPrinterClaim(event, ownership, acquired, printResult, lifecycle) {
  const helpers = lifecycle || {};
  const clearRecovery = helpers.clearRecovery || clearQrClaimRecovery;
  const scheduleRecovery = helpers.scheduleRecovery || scheduleQrClaimRecovery;
  const warning = helpers.warning || function(details) { console.warn("QR printer claim finalization failed", details); };
  const successfulPrint = Boolean(printResult && printResult.ok && !printResult.skipped);
  const finalized = successfulPrint
    ? await ownership.claimStore.complete(acquired.claimKey, ownership.identity.ownerId)
    : await ownership.claimStore.fail(acquired.claimKey, ownership.identity.ownerId, { code: printResult && printResult.code || "PRINT_FAILED" });
  if (!finalized || finalized.ok !== true) {
    const code = finalized && finalized.code || (successfulPrint ? "CLAIM_COMPLETION_FAILED" : "CLAIM_FAILURE_WRITE_FAILED");
    warning({ orderId: event.orderId, claimKey: acquired.claimKey, code: code });
    scheduleRecovery(event, ownership, {
      claimKey: acquired.claimKey,
      claim: { status: "printing", leaseExpiresAt: Date.now() + ownership.claimStore.leaseMs }
    });
    return { ok: false, status: "isolated", code: code, eventId: acquired.claimKey };
  }
  clearRecovery(acquired.claimKey);
  return printResult;
}

function clearQrClaimRecovery(claimKey) {
  const timer = qrClaimRecoveryTimers.get(claimKey);
  if (timer !== undefined) clearTimeout(timer);
  qrClaimRecoveryTimers.delete(claimKey);
}

function scheduleQrClaimRecovery(event, ownership, claimResult) {
  const claim = claimResult && claimResult.claim;
  const claimKey = claimResult && claimResult.claimKey;
  if (!claimKey || !claim || (claim.status !== "claimed" && claim.status !== "printing") || Number(claim.leaseExpiresAt) <= Date.now()) return false;
  clearQrClaimRecovery(claimKey);
  const delay = Math.max(250, Number(claim.leaseExpiresAt) - Date.now() + 50);
  const timer = setTimeout(function() {
    qrClaimRecoveryTimers.delete(claimKey);
    handleQrPrinterEvent(event, ownership).catch(function(error) {
      console.warn("QR printer lease recovery isolated", { orderId: event.orderId, code: error && error.code || "QR_PRINT_RECOVERY_FAILED" });
    });
  }, delay);
  qrClaimRecoveryTimers.set(claimKey, timer);
  return true;
}

function startQrClaimHeartbeat(claimKey, ownership) {
  return createQrHeartbeatController({
    renew: function() { return ownership.claimStore.renewLease(claimKey, ownership.identity.ownerId); },
    intervalMs: ownership.claimStore.heartbeatMs,
    warning: function(code) { console.warn("QR printer lease heartbeat failed", { claimKey: claimKey, code: code }); }
  });
}

function createQrHeartbeatController(options) {
  const state = { stopped: false, running: false, ownershipLost: false, uncertain: false, code: null };
  const renew = options.renew;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const warning = typeof options.warning === "function" ? options.warning : function() {};
  let pending = Promise.resolve();

  function snapshot() { return Object.freeze(Object.assign({}, state)); }
  function applyResult(renewed) {
    if (renewed && renewed.ok === true) {
      if (!state.ownershipLost) { state.uncertain = false; state.code = null; }
      return;
    }
    const code = renewed && renewed.code || "CLAIM_HEARTBEAT_FAILED";
    state.code = code;
    if (code === "CLAIM_OWNERSHIP_LOST") { state.ownershipLost = true; state.uncertain = false; }
    else if (!state.ownershipLost) state.uncertain = true;
    warning(code);
  }
  async function renewOnce() {
    if (state.running) { await pending; return snapshot(); }
    if (state.ownershipLost) return snapshot();
    state.running = true;
    pending = Promise.resolve().then(renew).then(applyResult).catch(function(error) {
      applyResult({ ok: false, code: error && error.code || "CLAIM_HEARTBEAT_FAILED" });
    }).finally(function() { state.running = false; });
    await pending;
    return snapshot();
  }

  const timer = setIntervalFn(function() { if (!state.stopped) void renewOnce(); }, options.intervalMs);
  return Object.freeze({
    tick: renewOnce,
    getState: snapshot,
    stop: async function() { state.stopped = true; clearIntervalFn(timer); await pending; return snapshot(); },
    finish: async function() {
      state.stopped = true;
      clearIntervalFn(timer);
      await pending;
      if (!state.ownershipLost) await renewOnce();
      return snapshot();
    }
  });
}

function processQrPrinterTransitions(nextOrdersData) {
  qrPrinterSnapshotChain = qrPrinterSnapshotChain.then(async function() {
    const ownership = await loadQrPrinterOwnership();
    const events = ownership.detector.observe(nextOrdersData);
    await Promise.all(events.map(function(event) {
      return handleQrPrinterEvent(event, ownership).catch(function(error) {
        console.warn("QR printer event isolated", { orderId: event.orderId, orderNumber: event.orderNumber, code: error && error.code || "QR_PRINT_FAILED" });
        return null;
      });
    }));
  }).catch(function(error) {
    console.warn("QR printer snapshot isolated", { code: error && error.code || "QR_PRINT_SNAPSHOT_FAILED" });
  });
  return qrPrinterSnapshotChain;
}

function invalidatePrinterIntegrationConfiguration() {
  return Promise.resolve().then(loadPrinterOrderBridge).then(function(module) {
    if (!module || !module.PrinterOrderBridge || typeof module.PrinterOrderBridge.invalidateConfiguration !== "function") return null;
    return module.PrinterOrderBridge.invalidateConfiguration();
  }).catch(function(error) {
    console.warn("Printer configuration invalidation isolated", error);
    return null;
  });
}

function triggerPosOrderPrint(order) {
  if (!isPrintingEnabled()) return Promise.resolve({ ok: true, status: "skipped", code: "PRINT_MODULE_DISABLED" });
  var event = {
    eventType: "OrderCreated",
    order: order,
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: "POS",
    storeId: order.storeId || STORE_ID,
    businessEventVersion: "1",
    ticketType: "auto",
    routeGroup: "Kitchen",
    policy: "pos-order-created",
    metadata: { paymentStatus: order.paymentStatus, isTestOrder: order.isTestOrder === true, test: order.isTestOrder === true }
  };
  return Promise.resolve().then(loadPrinterOrderBridge).then(function(module) {
    if (!module || !module.PrinterOrderBridge || typeof module.PrinterOrderBridge.handle !== "function") throw Object.assign(new Error("Printer order bridge unavailable"), { code: "PRINTER_BRIDGE_UNAVAILABLE" });
    return module.PrinterOrderBridge.handle(event);
  }).then(function(result) {
    var details = { orderId: order.id, orderNumber: order.orderNumber, code: result && result.code, status: result && result.status };
    if (result && result.ok) console.info("POS printer event", details);
    else console.warn("POS printer event failed", details);
    return result;
  }).catch(function(error) {
    console.warn("POS printer event isolated", { orderId: order.id, orderNumber: order.orderNumber, code: error && error.code || "PRINTER_TRIGGER_FAILED", status: "isolated" });
    return { ok: false, status: "isolated", code: error && error.code || "PRINTER_TRIGGER_FAILED" };
  });
}


/* =========================
   v59-5 EARLY POS LEGACY OPEN
   放在檔案前面：避免後面某段舊平板報錯，導致 window 函式還沒掛上
========================= */
window.posOpenFoodById = function (itemId, event) {
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
  }
  if (!itemId) return false;

  var latestMenuItem = menuData[String(itemId)];
  if (!latestMenuItem || latestMenuItem.enabled === false) return false;
  if (!canPosOrderItem(latestMenuItem)) {
    showMenuStatusError("今日售完");
    return false;
  }

  var now = Date.now ? Date.now() : new Date().getTime();
  if (lastFoodOpenId === String(itemId) && now - lastFoodOpenAt < 1200) {
    return false;
  }
  if (typeof customModal !== "undefined" && customModal && (" " + (customModal.className || "") + " ").indexOf(" hidden ") === -1) {
    return false;
  }
  lastFoodOpenId = String(itemId);
  lastFoodOpenAt = now;

  try {
    openCustomModal(String(itemId));
    if (typeof customModal !== "undefined" && customModal) {
      customModal.className = (customModal.className || "").replace(/\bhidden\b/g, "");
      if ((" " + customModal.className + " ").indexOf(" show-force ") === -1) {
        customModal.className += " show-force";
      }
      customModal.style.display = "flex";
      addPosModalOpenClass();
      resetPosCustomModalScroll();
    }
  } catch (error) {
    alert("餐點視窗開啟失敗：" + (error && error.message ? error.message : error));
  }
  return false;
};

window.posOpenFood = function (button, event) {
  var itemId = button && button.getAttribute ? button.getAttribute("data-id") : "";
  return window.posOpenFoodById(itemId, event);
};

/* =========================
   v56 設定
========================= */

const STORE_MODE = "pro_plus";
const STORE_ID = "defaultStore";

/* =========================
   DOM
========================= */

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const orderSubtabButtons = document.querySelectorAll(".order-subtab-btn");
const orderSubtabPanels = document.querySelectorAll("[data-order-subtab-panel]");

const categoryList = document.getElementById("categoryList");
const posMenuList = document.getElementById("posMenuList");
const cartList = document.getElementById("cartList");
const totalAmount = document.getElementById("totalAmount");
const posOrderNoteInput = document.getElementById("posOrderNoteInput");

const dineInBtn = document.getElementById("dineInBtn");
const takeOutBtn = document.getElementById("takeOutBtn");
const tableSelectBox = document.getElementById("tableSelectBox");
const tableButtons = document.getElementById("tableButtons");
const takeOutInfo = document.getElementById("takeOutInfo");

const submitOrderBtn = document.getElementById("submitOrderBtn");
const submitUnpaidOrderBtn = document.getElementById("submitUnpaidOrderBtn");
const submitTestOrderBtn = document.getElementById("submitTestOrderBtn");
const clearCartBtn = document.getElementById("clearCartBtn");

const pendingOrderList = document.getElementById("pendingOrderList");
const processingOrderList = document.getElementById("processingOrderList");
const doneOrderList = document.getElementById("doneOrderList");
const cancelledOrderList = document.getElementById("cancelledOrderList");

const statTotalOrders = document.getElementById("statTotalOrders");
const statUnpaidOrders = document.getElementById("statUnpaidOrders");
const statProcessingOrders = document.getElementById("statProcessingOrders");
const statDoneOrders = document.getElementById("statDoneOrders");
const statTodayRevenue = document.getElementById("statTodayRevenue");

const customModal = document.getElementById("customModal");
const modalItemName = document.getElementById("modalItemName");
const modalItemPrice = document.getElementById("modalItemPrice");
const portionBox = document.getElementById("portionBox");
const spicySelect = document.getElementById("spicySelect");
const satayBox = document.getElementById("satayBox");
const extrasBox = document.getElementById("extrasBox");
const noteInput = document.getElementById("noteInput");
const modalMinusBtn = document.getElementById("modalMinusBtn");
const modalPlusBtn = document.getElementById("modalPlusBtn");
const modalQuantity = document.getElementById("modalQuantity");
const closeCustomModalBtn = document.getElementById("closeCustomModalBtn");
const cancelCustomBtn = document.getElementById("cancelCustomBtn");
const confirmCustomBtn = document.getElementById("confirmCustomBtn");

const editOrderModal = document.getElementById("editOrderModal");
const editOrderTitle = document.getElementById("editOrderTitle");
const editOrderInfo = document.getElementById("editOrderInfo");
const editOrderItems = document.getElementById("editOrderItems");
const editOrderNote = document.getElementById("editOrderNote");
const editOrderTotal = document.getElementById("editOrderTotal");
const cancelEditOrderBtn = document.getElementById("cancelEditOrderBtn");
const saveEditOrderBtn = document.getElementById("saveEditOrderBtn");

const editItemModal = document.getElementById("editItemModal");
const editItemName = document.getElementById("editItemName");
const editItemPrice = document.getElementById("editItemPrice");
const editItemPortionBox = document.getElementById("editItemPortionBox");
const editItemSpicySelect = document.getElementById("editItemSpicySelect");
const editItemSatayBox = document.getElementById("editItemSatayBox");
const editItemExtrasBox = document.getElementById("editItemExtrasBox");
const editItemMinusBtn = document.getElementById("editItemMinusBtn");
const editItemPlusBtn = document.getElementById("editItemPlusBtn");
const editItemQuantity = document.getElementById("editItemQuantity");
const editItemNoteInput = document.getElementById("editItemNoteInput");
const editItemSubtotal = document.getElementById("editItemSubtotal");
const cancelEditItemBtn = document.getElementById("cancelEditItemBtn");
const saveEditItemBtn = document.getElementById("saveEditItemBtn");

const fullscreenBtn = document.getElementById("fullscreenBtn");
const storeNameInput = document.getElementById("storeNameInput");
const tableCountInput = document.getElementById("tableCountInput");
const prepTimeInput = document.getElementById("prepTimeInput");
const qrValidMinutesInput = document.getElementById("qrValidMinutesInput");
const orderLookupMinutesInput = document.getElementById("orderLookupMinutesInput");
const showTestOrdersToggle = document.getElementById("showTestOrdersToggle");
const enableSoundToggle = document.getElementById("enableSoundToggle");
const soundTypeSelect = document.getElementById("soundTypeSelect");
const soundVolumeInput = document.getElementById("soundVolumeInput");
const soundVolumeValue = document.getElementById("soundVolumeValue");
const testSoundBtn = document.getElementById("testSoundBtn");
const autoSwitchCartToggle = document.getElementById("autoSwitchCartToggle");
const posMenuManageSearch = document.getElementById("posMenuManageSearch");
const posMenuManageList = document.getElementById("posMenuManageList");
const posMenuManageSubtabButtons = document.querySelectorAll("[data-menu-manage-subtab]");
const posMenuManagePanes = document.querySelectorAll("[data-menu-manage-pane]");

/* =========================
   Firebase
========================= */

const menuRef = ref(db, "menu");
const categoriesRef = ref(db, "categories");
const ordersRef = ref(db, "orders");
const customOptionGroupsRef = ref(db, "customOptionGroups");
const customGroupsRef = ref(db, "customGroups");
const storeNameRef = ref(db, "settings/storeName");
const qrValidMinutesRef = ref(db, "settings/qrValidMinutes");
const orderLookupMinutesRef = ref(db, "settings/orderLookupMinutes");
const enableSoundRef = ref(db, "settings/enableSound");
const soundTypeRef = ref(db, "settings/soundType");
const soundVolumeRef = ref(db, "settings/soundVolume");
const qrSessionControlRef = ref(db, "qrSessionControl");

/* =========================
   State
========================= */

let menuData = {};
let categoriesData = {};
let ordersData = {};
let customOptionGroupsData = {};
let customGroupsData = {};
let currentCategory = "全部";
let cart = [];
const HELD_CARTS_KEY = "enpoint_pos_held_carts_v1";
let heldCarts = loadHeldCarts();

let currentOrderType = "外帶";
let selectedTable = "1";

let currentItem = null;
let currentQuantity = 1;
let selectedPortion = null;
let selectedExtras = [];
let selectedRemoves = [];
let selectedSatay = "不要";
let selectedRequiredOption = "";

window.posV64SelectedCustomOptions = [];
window.posV64EditSelectedCustomOptions = [];

let editingOrderId = null;
let editingItems = [];
let editingCartId = null;

let editingItemIndex = null;
let editingItemData = null;
let editingMenuItem = null;
let editSelectedPortion = null;
let editSelectedExtras = [];
let editSelectedRemoves = [];
let editSelectedSatay = "不要";
let editSelectedRequiredOption = "";
let editQuantity = 1;

const POS_LEGACY_SPICY_OPTIONS = ["不辣", "微辣", "小辣", "中辣", "大辣"];

let businessDayCloseData = null;
let lastFoodOpenAt = 0;
let lastFoodOpenId = "";
let lastPrintOrderAt = 0;
let lastPrintOrderKey = "";
let storeNameSyncTimer = null;

const defaultSettings = {
  storeName: "",
  tableCount: 8,
  prepTime: 15,
  qrValidMinutes: 30,
  orderLookupMinutes: 60,
  showTestOrders: true,
  enableSound: true,
  soundType: "classic",
  soundVolume: 100,
  repeatAlertEnabled: true,
  repeatAlertInterval: 15,
  repeatAlertCustomSeconds: 15,
  repeatAlertMaxCount: 3,
  silentHoursEnabled: false,
  silentHoursStart: "22:00",
  silentHoursEnd: "07:00",
  autoSwitchCartAfterAdd: false
};

let posSettings = loadSettings();
let tables = buildTables(posSettings.tableCount);
let orderSoundKnownIds = {};
let orderSoundReady = false;
let pendingNewOrderAlert = false;
let orderAlertIntervalId = null;
let pendingAlertOrderIds = {};
let orderAlertPlayCount = 0;
let submittingPosOrder = false;
let AudioManager = null;
let PaymentStatusManager = null;
let settingsCenterReady = false;
let settingsModalCurrentSection = "";

function renderPosFoodButton(item) {
  return renderPosFoodButtonV64(item);
}

function renderCart() {
  return renderCartV64();
}

function renderEditCustomOptionGroups() {
  return false;
}

function safePosInit(name, task) {
  try {
    return task();
  } catch (error) {
    console.error("POS 初始化區塊失敗：", name, error);
    return null;
  }
}

/* =========================
   Init
========================= */

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  safePosInit("menu", function() {
    renderCategories();
    renderMenu();
    renderPosMenuManage();
  });
});

onValue(categoriesRef, snapshot => {
  categoriesData = snapshot.exists() ? snapshot.val() : {};
  safePosInit("categories", function() {
    renderCategories();
    renderMenu();
    renderPosMenuManage();
  });
});

onValue(customOptionGroupsRef, snapshot => {
  customOptionGroupsData = snapshot.exists() ? snapshot.val() : {};
  safePosInit("customOptionGroups", function() {
    renderCustomOptionGroups();
    renderEditCustomOptionGroups();
    renderMenu();
  });
});

onValue(customGroupsRef, snapshot => {
  customGroupsData = snapshot.exists() ? snapshot.val() : {};
  safePosInit("customGroups", function() {
    renderCustomOptionGroups();
    renderEditCustomOptionGroups();
    renderMenu();
  });
});

onValue(ordersRef, snapshot => {
  const nextOrdersData = snapshot.exists() ? snapshot.val() : {};
  safePosInit("orders", function() {
    void processQrPrinterTransitions(nextOrdersData);
    processOrderSoundTransitions(nextOrdersData);
    processNewQrOrderSound(nextOrdersData);
    ordersData = nextOrdersData;
    renderAllOrders();
    renderStats();
    renderRealtimeBadges();
    renderPosMenuManage();
  });
});

renderTableButtons();
ensurePosMenuStudioUi();
renderCart();
renderStoreModeNotice();
renderSettings();
initPosOrderSoundUnlock();
watchSharedSettings();
hideAppLoadingScreen();

function hideAppLoadingScreen() {
  var el = document.getElementById("appLoadingScreen");
  if (el && (" " + (el.className || "") + " ").indexOf(" hidden ") === -1) {
    el.className += " hidden";
  }
}

/* =========================
   Tabs
========================= */

function setLegacyClassActive(element, className, active) {
  if (!element) return;
  if (element.classList) {
    if (active) {
      element.classList.add(className);
    } else {
      element.classList.remove(className);
    }
    return;
  }

  var current = " " + (element.className || "") + " ";
  var hasClass = current.indexOf(" " + className + " ") !== -1;
  if (active && !hasClass) {
    element.className = (element.className ? element.className + " " : "") + className;
  }
  if (!active && hasClass) {
    element.className = current.replace(" " + className + " ", " ").replace(/^\s+|\s+$/g, "");
  }
}

function addLegacyTapListener(element, handler) {
  if (!element || !handler) return;
  var lastTouchAt = 0;

  function handleTap(event) {
    var now = Date.now ? Date.now() : new Date().getTime();
    if (event && event.type === "touchend") {
      lastTouchAt = now;
    }
    if (event && event.type === "click" && now - lastTouchAt < 500) {
      return;
    }
    handler(event);
  }

  element.addEventListener("click", handleTap, false);
  element.addEventListener("touchend", handleTap, false);
}

function addSettingsCenterClickListener(element, handler) {
  if (!element || !handler) return;
  if (element.getAttribute("data-settings-click-bound") === "true") return;

  element.setAttribute("data-settings-click-bound", "true");
  element.addEventListener("click", function(event) {
    handler(event);
  }, false);
}

for (var posTabIndex = 0; posTabIndex < tabButtons.length; posTabIndex += 1) {
  (function(button) {
    addLegacyTapListener(button, function(event) {
      if (event && event.preventDefault) event.preventDefault();
      var target = button.getAttribute("data-tab");

      for (var i = 0; i < tabButtons.length; i += 1) {
        setLegacyClassActive(tabButtons[i], "active", tabButtons[i] === button);
      }
      for (var j = 0; j < tabPanels.length; j += 1) {
        setLegacyClassActive(tabPanels[j], "active", tabPanels[j].id === target);
      }
    });
  })(tabButtons[posTabIndex]);
}

for (var orderSubtabIndex = 0; orderSubtabIndex < orderSubtabButtons.length; orderSubtabIndex += 1) {
  (function(button) {
    addLegacyTapListener(button, function(event) {
      if (event && event.preventDefault) event.preventDefault();
      switchOrderSubtab(button.getAttribute("data-order-subtab"));
    });
  })(orderSubtabButtons[orderSubtabIndex]);
}

switchOrderSubtab("menu");

/* =========================
   Helpers
========================= */

function money(n) {
  return `$${Number(n || 0)}`;
}

function readBooleanSetting(key, fallback) {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

function readNumberSetting(key, fallback, min, max) {
  const value = Number(localStorage.getItem(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeOrderLookupMinutes(value) {
  var raw = String(value === undefined || value === null ? "" : value);
  if (raw === "0" || raw === "forever" || raw === "permanent") return 0;
  var minutes = Math.floor(Number(value) || defaultSettings.orderLookupMinutes);
  return Math.min(1440, Math.max(30, minutes));
}

function normalizeQrValidMinutes(value) {
  var minutes = Math.floor(Number(value) || defaultSettings.qrValidMinutes);
  var allowed = [15, 30, 45, 60, 75, 90];
  for (var i = 0; i < allowed.length; i += 1) {
    if (minutes === allowed[i]) return minutes;
  }
  return defaultSettings.qrValidMinutes;
}

function readSoundTypeSetting(key, fallback) {
  var value = localStorage.getItem(key) || fallback;
  var normalized = normalizePosSoundType(value);
  if (normalized !== value) localStorage.setItem(key, normalized);
  return normalized;
}

function readRepeatMaxCountSetting() {
  var value = localStorage.getItem("repeatAlertMaxCount");
  if (value === "infinite" || value === "until-confirmed") return "until-confirmed";
  return readNumberSetting("repeatAlertMaxCount", defaultSettings.repeatAlertMaxCount, 1, 99);
}

function readRepeatIntervalSetting() {
  var value = localStorage.getItem("repeatAlertInterval");
  if (value === "off" || value === "custom") return value;
  return readNumberSetting("repeatAlertInterval", defaultSettings.repeatAlertInterval, 1, 3600);
}

function readTimeSetting(key, fallback) {
  var value = localStorage.getItem(key) || fallback;
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function isValidSoundType(value) {
  return value === "classic" ||
    value === "restaurant" ||
    value === "cafe" ||
    value === "modern" ||
    value === "night-market" ||
    value === "high-tone-double" ||
    value === "fast-triple" ||
    value === "kitchen-alert" ||
    value === "long-bell";
}

function normalizePosSoundType(value) {
  var legacyThemes = {
    warm: "restaurant",
    bright: "modern",
    pro: "cafe",
    kitchen: "night-market",
    harmony: "restaurant",
    breeze: "modern",
    bell: "cafe",
    pulse: "night-market",
    short: "classic",
    double: "high-tone-double",
    dingdong: "restaurant",
    urgent: "kitchen-alert",
    triple: "fast-triple",
    doorbell: "restaurant",
    fastDingdong: "modern",
    longShort: "long-bell",
    rapidShort: "fast-triple"
  };
  var normalized = legacyThemes[value] || value;
  return isValidSoundType(normalized) ? normalized : "classic";
}

function loadSettings() {
  return {
    storeName: localStorage.getItem("storeName") || defaultSettings.storeName,
    tableCount: readNumberSetting("tableCount", defaultSettings.tableCount, 1, 99),
    prepTime: readNumberSetting("prepTime", defaultSettings.prepTime, 1, 999),
    qrValidMinutes: normalizeQrValidMinutes(localStorage.getItem("qrValidMinutes")),
    orderLookupMinutes: normalizeOrderLookupMinutes(localStorage.getItem("orderLookupMinutes")),
    showTestOrders: readBooleanSetting("showTestOrders", defaultSettings.showTestOrders),
    enableSound: readBooleanSetting("enableSound", defaultSettings.enableSound),
    soundType: readSoundTypeSetting("soundType", defaultSettings.soundType),
    soundVolume: readNumberSetting("soundVolume", defaultSettings.soundVolume, 0, 200),
    repeatAlertEnabled: readBooleanSetting("repeatAlertEnabled", defaultSettings.repeatAlertEnabled),
    repeatAlertInterval: readRepeatIntervalSetting(),
    repeatAlertCustomSeconds: readNumberSetting("repeatAlertCustomSeconds", defaultSettings.repeatAlertCustomSeconds, 1, 3600),
    repeatAlertMaxCount: readRepeatMaxCountSetting(),
    silentHoursEnabled: readBooleanSetting("silentHoursEnabled", defaultSettings.silentHoursEnabled),
    silentHoursStart: readTimeSetting("silentHoursStart", defaultSettings.silentHoursStart),
    silentHoursEnd: readTimeSetting("silentHoursEnd", defaultSettings.silentHoursEnd),
    autoSwitchCartAfterAdd: readBooleanSetting("autoSwitchCartAfterAdd", defaultSettings.autoSwitchCartAfterAdd)
  };
}

function saveSetting(key, value) {
  localStorage.setItem(key, String(value));
}

function syncStoreNameToFirebase(value) {
  const name = String(value || "").trim();
  if (storeNameSyncTimer) clearTimeout(storeNameSyncTimer);
  storeNameSyncTimer = setTimeout(() => {
    set(storeNameRef, name).catch(error => {
      console.error("同步店家名稱失敗：", error);
    });
  }, 350);
}

function syncStoreNameToFirebaseNow(value) {
  const name = String(value || "").trim();
  if (storeNameSyncTimer) clearTimeout(storeNameSyncTimer);
  set(storeNameRef, name).catch(error => {
    console.error("同步店家名稱失敗：", error);
  });
}

function syncOrderLookupMinutesToFirebase(value) {
  const minutes = normalizeOrderLookupMinutes(value);
  set(orderLookupMinutesRef, minutes).catch(error => {
    console.error("同步訂單查詢保留時間失敗：", error);
  });
}

function syncQrValidMinutesToFirebase(value) {
  var minutes = normalizeQrValidMinutes(value);
  set(qrValidMinutesRef, minutes).catch(function(error) {
    console.error("同步 QR 點餐有效時間失敗：", error);
  });
}

function syncSoundSettingsToFirebase() {
  set(enableSoundRef, posSettings.enableSound === true).catch(error => {
    console.error("同步提示音開關失敗：", error);
  });
  set(soundTypeRef, posSettings.soundType || defaultSettings.soundType).catch(error => {
    console.error("同步提示音類型失敗：", error);
  });
  set(soundVolumeRef, Number(posSettings.soundVolume || 0)).catch(error => {
    console.error("同步提示音音量失敗：", error);
  });
}

function syncSoundCenterSettings() {
  var repeatMode = posSettings.repeatAlertEnabled === true ? String(posSettings.repeatAlertInterval || defaultSettings.repeatAlertInterval) : "off";
  if (repeatMode === "custom") repeatMode = "custom";
  configureSoundCenter({
    enabled: posSettings.enableSound === true,
    masterVolume: Math.min(200, Math.max(0, Math.floor(Number(posSettings.soundVolume) || 0))),
    theme: isValidSoundType(posSettings.soundType) ? posSettings.soundType : defaultSettings.soundType,
    repeatMode: repeatMode,
    repeatCustomSeconds: Math.min(3600, Math.max(1, Math.floor(Number(posSettings.repeatAlertCustomSeconds) || defaultSettings.repeatAlertCustomSeconds))),
    repeatMaxCount: posSettings.repeatAlertMaxCount === "until-confirmed" || posSettings.repeatAlertMaxCount === "infinite" ? "until-confirmed" : Math.min(10, Math.max(1, Math.floor(Number(posSettings.repeatAlertMaxCount) || defaultSettings.repeatAlertMaxCount))),
    silentHoursEnabled: posSettings.silentHoursEnabled === true,
    silentStart: posSettings.silentHoursStart || defaultSettings.silentHoursStart,
    silentEnd: posSettings.silentHoursEnd || defaultSettings.silentHoursEnd
  });
}

function watchSharedSettings() {
  onValue(storeNameRef, snapshot => {
    const name = snapshot && snapshot.exists && snapshot.exists() ? String(snapshot.val() || "") : "";
    if (!name || name === posSettings.storeName) return;
    posSettings.storeName = name;
    saveSetting("storeName", name);
    if (storeNameInput && document.activeElement !== storeNameInput) storeNameInput.value = name;
    applyStoreName();
  });

  onValue(orderLookupMinutesRef, snapshot => {
    const value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
    if (value === null || value === undefined) return;
    const minutes = normalizeOrderLookupMinutes(value);
    if (minutes === posSettings.orderLookupMinutes) return;
    posSettings.orderLookupMinutes = minutes;
    saveSetting("orderLookupMinutes", minutes);
    if (orderLookupMinutesInput && document.activeElement !== orderLookupMinutesInput) orderLookupMinutesInput.value = String(minutes);
  });

  onValue(qrValidMinutesRef, snapshot => {
    var value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
    if (value === null || value === undefined) return;
    var minutes = normalizeQrValidMinutes(value);
    if (minutes === posSettings.qrValidMinutes) return;
    posSettings.qrValidMinutes = minutes;
    saveSetting("qrValidMinutes", minutes);
    if (qrValidMinutesInput && document.activeElement !== qrValidMinutesInput) qrValidMinutesInput.value = String(minutes);
  });

  onValue(enableSoundRef, snapshot => {
    const value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
    if (value === null || value === undefined) return;
    const enabled = value === true || value === "true";
    if (enabled === posSettings.enableSound) return;
    posSettings.enableSound = enabled;
    saveSetting("enableSound", enabled);
    setSwitchState(enableSoundToggle, enabled);
    if (!enabled) stopOrderAlertSound();
    syncSoundCenterSettings();
  });

  onValue(soundTypeRef, snapshot => {
    const value = snapshot && snapshot.exists && snapshot.exists() ? String(snapshot.val() || "") : "";
    if (!value) return;
    const normalized = normalizePosSoundType(value);
    if (normalized === posSettings.soundType) return;
    posSettings.soundType = normalized;
    saveSetting("soundType", normalized);
    if (soundTypeSelect && document.activeElement !== soundTypeSelect) soundTypeSelect.value = normalized;
    renderSoundCenterControlsV656();
    syncSoundCenterSettings();
  });

  onValue(soundVolumeRef, snapshot => {
    const value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
    if (value === null || value === undefined) return;
    const volume = Math.min(200, Math.max(0, Math.floor(Number(value) || 0)));
    if (volume === posSettings.soundVolume) return;
    posSettings.soundVolume = volume;
    saveSetting("soundVolume", volume);
    renderSoundVolume();
    syncSoundCenterSettings();
  });
}

function buildTables(count) {
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

function applyStoreName() {
  const headerTitle = document.querySelector(".pos-header h1");
  if (!headerTitle) return;
  headerTitle.textContent = posSettings.storeName.trim() || "恩點 POS";
}

function setSwitchState(button, enabled) {
  if (!button) return;
  setLegacyClassActive(button, "active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function applyShowTestOrdersSetting() {
  if (!submitTestOrderBtn) return;
  var enabled = posSettings.showTestOrders === true;
  submitTestOrderBtn.style.display = enabled ? "" : "none";
  submitTestOrderBtn.hidden = !enabled;
  submitTestOrderBtn.disabled = !enabled;
  submitTestOrderBtn.setAttribute("aria-hidden", enabled ? "false" : "true");
  setLegacyClassActive(document.body, "hide-test-order-button", !enabled);
}

function renderSoundVolume() {
  var volume = Math.min(200, Math.max(0, Math.floor(Number(posSettings.soundVolume) || 0)));
  if (soundVolumeInput) {
    soundVolumeInput.setAttribute("min", "0");
    soundVolumeInput.setAttribute("max", "200");
    soundVolumeInput.setAttribute("step", "25");
  }
  if (soundVolumeInput && document.activeElement !== soundVolumeInput) soundVolumeInput.value = volume;
  if (soundVolumeValue) soundVolumeValue.textContent = String(volume) + "%";
  var soundCenterVolumeValue = document.getElementById("soundCenterVolumeValue");
  var soundCenterVolumeInput = document.getElementById("soundCenterVolumeInput");
  if (soundCenterVolumeValue) soundCenterVolumeValue.textContent = String(volume) + "%";
  if (soundCenterVolumeInput && document.activeElement !== soundCenterVolumeInput) soundCenterVolumeInput.value = String(volume);
}

function unlockPosOrderSound() {
  return unlockSoundCenter();
}

function initPosOrderSoundUnlock() {
  var unlocking = false;
  var lastTouchAt = 0;
  var unlockOnce = async function(event) {
    var now = Date.now ? Date.now() : new Date().getTime();
    if (event && event.type === "touchend") lastTouchAt = now;
    if (event && event.type === "click" && now - lastTouchAt < 700) return;
    if (unlocking) return;
    unlocking = true;
    var success = await unlockPosOrderSound();
    unlocking = false;
    if (!success) return;
    document.removeEventListener("click", unlockOnce, false);
    document.removeEventListener("touchend", unlockOnce, false);
  };
  document.addEventListener("click", unlockOnce, false);
  document.addEventListener("touchend", unlockOnce, false);
}

function playNewQrOrderBeep(forcePlay) {
  return playSound("new-order", { force: forcePlay === true });
}

AudioManager = {
  unlock: unlockPosOrderSound,
  playNewOrder: function(forcePlay) {
    return playNewQrOrderBeep(forcePlay);
  },
  stop: stopOrderAlertSound,
  test: function() {
    return playNewQrOrderBeep(true);
  }
};

function isQrOrderForSound(order) {
  if (!order) return false;
  return String(order.source || "").toLowerCase() === "qr";
}

function isTodayTabActive() {
  var panel = document.getElementById("todayTab");
  return !!(panel && (" " + (panel.className || "") + " ").indexOf(" active ") !== -1);
}

function getRepeatAlertIntervalMs() {
  if (posSettings.repeatAlertEnabled !== true || posSettings.repeatAlertInterval === "off") return 0;
  if (posSettings.repeatAlertInterval === "custom") {
    return Math.min(3600, Math.max(1, Math.floor(Number(posSettings.repeatAlertCustomSeconds) || defaultSettings.repeatAlertCustomSeconds))) * 1000;
  }
  return Math.min(3600, Math.max(1, Math.floor(Number(posSettings.repeatAlertInterval) || defaultSettings.repeatAlertInterval))) * 1000;
}

function getRepeatAlertMaxCount() {
  return posSettings.repeatAlertMaxCount === "until-confirmed" || posSettings.repeatAlertMaxCount === "infinite" ? "until-confirmed" : Math.min(10, Math.max(1, Math.floor(Number(posSettings.repeatAlertMaxCount) || defaultSettings.repeatAlertMaxCount)));
}

function isOrderStillAwaitingAttention(order) {
  if (!order || !isQrOrderForSound(order)) return false;
  if (order.confirmed === true || order.accepted === true || order.paid === true || order.cancelled === true || order.closed === true) return false;
  var status = String(order.status || "").toLowerCase();
  var kitchenStatus = String(order.kitchenStatus || "").toLowerCase();
  var paymentStatus = String(order.paymentStatus || "").toLowerCase();
  return status !== "confirmed" &&
    status !== "accepted" &&
    status !== "paid" &&
    status !== "cooking" &&
    status !== "done" &&
    status !== "completed" &&
    status !== "closed" &&
    status !== "cancelled" &&
    kitchenStatus !== "confirmed" &&
    kitchenStatus !== "accepted" &&
    kitchenStatus !== "paid" &&
    kitchenStatus !== "cooking" &&
    kitchenStatus !== "done" &&
    kitchenStatus !== "completed" &&
    kitchenStatus !== "closed" &&
    kitchenStatus !== "cancelled" &&
    paymentStatus !== "paid" &&
    paymentStatus !== "cancelled";
}

function isOrderCookingForSound(order) {
  if (!order) return false;
  var status = String(order.status || "").toLowerCase();
  var kitchenStatus = String(order.kitchenStatus || "").toLowerCase();
  return status === "cooking" || kitchenStatus === "cooking";
}

function processOrderSoundTransitions(nextOrdersData) {
  if (!orderSoundReady) return;
  Object.keys(nextOrdersData || {}).forEach(function(orderId) {
    var previous = ordersData && ordersData[orderId];
    var next = nextOrdersData[orderId];
    if (!previous || !next || isTestOrder(next)) return;
    if (!isPaid(previous) && isPaid(next)) playSound("payment");
    if (!isOrderCookingForSound(previous) && isOrderCookingForSound(next)) playSound("cooking");
    if (!isDone(previous) && isDone(next)) playSound("done");
    if (!isCancelled(previous) && isCancelled(next)) playSound("cancel");
  });
}

function reconcilePendingOrderAlerts() {
  var hasPending = false;
  Object.keys(pendingAlertOrderIds).forEach(function(orderId) {
    if (isOrderStillAwaitingAttention(ordersData[orderId])) {
      hasPending = true;
      return;
    }
    delete pendingAlertOrderIds[orderId];
  });
  if (!hasPending) stopOrderAlertSound();
  return hasPending;
}

function startOrderAlertSound(orderId) {
  if (!posSettings || posSettings.enableSound !== true) return;
  if (orderId) pendingAlertOrderIds[orderId] = true;
  pendingNewOrderAlert = true;
  orderAlertPlayCount = playNewQrOrderBeep() ? 1 : 0;
  var repeatIntervalMs = getRepeatAlertIntervalMs();
  if (orderAlertIntervalId || repeatIntervalMs <= 0) return;
  orderAlertIntervalId = window.setInterval(function() {
    var maxCount = getRepeatAlertMaxCount();
    if (!pendingNewOrderAlert || posSettings.enableSound !== true || !reconcilePendingOrderAlerts()) {
      stopOrderAlertSound();
      return;
    }
    if (maxCount !== "until-confirmed" && orderAlertPlayCount >= maxCount) {
      stopOrderAlertSound();
      return;
    }
    if (playNewQrOrderBeep()) {
      orderAlertPlayCount += 1;
    }
  }, repeatIntervalMs);
}

function stopOrderAlertSound() {
  pendingNewOrderAlert = false;
  pendingAlertOrderIds = {};
  orderAlertPlayCount = 0;
  if (orderAlertIntervalId) {
    window.clearInterval(orderAlertIntervalId);
    orderAlertIntervalId = null;
  }
}

function stopOrderAlertForOrder(orderId) {
  if (orderId && pendingAlertOrderIds[orderId]) delete pendingAlertOrderIds[orderId];
  reconcilePendingOrderAlerts();
}

function rebuildSoundTypeOptions() {
  if (!soundTypeSelect || soundTypeSelect.getAttribute("data-v655-ready") === "true") return;
  soundTypeSelect.innerHTML = [
    '<option value="classic">經典</option>',
    '<option value="restaurant">餐廳</option>',
    '<option value="cafe">咖啡館</option>',
    '<option value="modern">現代</option>',
    '<option value="night-market">夜市</option>',
    '<option value="high-tone-double">高音雙響</option>',
    '<option value="fast-triple">急促三響</option>',
    '<option value="kitchen-alert">廚房警示音</option>',
    '<option value="long-bell">長鈴提醒</option>'
  ].join("");
  soundTypeSelect.setAttribute("data-v655-ready", "true");
}

function processNewQrOrderSound(nextOrdersData) {
  var entries = Object.entries(nextOrdersData || {});
  var previousOrdersData = ordersData || {};

  if (!orderSoundReady) {
    entries.forEach(function(entry) {
      orderSoundKnownIds[entry[0]] = true;
    });
    orderSoundReady = true;
    return;
  }

  entries.forEach(function(entry) {
    var id = entry[0];
    var order = entry[1];
    if (pendingAlertOrderIds[id] && !isOrderStillAwaitingAttention(order)) {
      delete pendingAlertOrderIds[id];
    }
    if (previousOrdersData[id] && isOrderStillAwaitingAttention(previousOrdersData[id]) && !isOrderStillAwaitingAttention(order)) {
      delete pendingAlertOrderIds[id];
    }
  });
  if (pendingNewOrderAlert) reconcilePendingOrderAlerts();

  entries.forEach(function(entry) {
    var id = entry[0];
    var order = entry[1];
    if (orderSoundKnownIds[id]) return;
    orderSoundKnownIds[id] = true;
    if (isOrderStillAwaitingAttention(order)) {
      startOrderAlertSound(id);
    }
  });
}

function switchOrderSubtab(target) {
  var next = target === "cart" ? "cart" : "menu";

  for (var i = 0; i < orderSubtabButtons.length; i += 1) {
    var button = orderSubtabButtons[i];
    var active = button.getAttribute("data-order-subtab") === next;
    setLegacyClassActive(button, "active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }

  for (var j = 0; j < orderSubtabPanels.length; j += 1) {
    var panel = orderSubtabPanels[j];
    var panelActive = panel.getAttribute("data-order-subtab-panel") === next;
    setLegacyClassActive(panel, "order-subtab-active", panelActive);
    panel.style.display = panelActive ? "" : "none";
    panel.style.visibility = panelActive ? "visible" : "hidden";
    panel.style.overflowY = panelActive ? "auto" : "";
  }
}

function renderSettings() {
  initSettingsCenter();
  if (storeNameInput) storeNameInput.value = posSettings.storeName;
  if (tableCountInput) tableCountInput.value = posSettings.tableCount;
  if (prepTimeInput) prepTimeInput.value = posSettings.prepTime;
  if (qrValidMinutesInput) qrValidMinutesInput.value = String(normalizeQrValidMinutes(posSettings.qrValidMinutes));
  if (orderLookupMinutesInput) orderLookupMinutesInput.value = String(normalizeOrderLookupMinutes(posSettings.orderLookupMinutes));
  rebuildSoundTypeOptions();
  var normalizedSoundType = normalizePosSoundType(posSettings.soundType);
  if (normalizedSoundType !== posSettings.soundType) {
    posSettings.soundType = normalizedSoundType;
    saveSetting("soundType", posSettings.soundType);
  }
  if (soundTypeSelect) soundTypeSelect.value = posSettings.soundType || defaultSettings.soundType;
  renderSoundVolume();
  syncSoundCenterSettings();

  applyStoreName();
  applyShowTestOrdersSetting();
  setSwitchState(showTestOrdersToggle, posSettings.showTestOrders);
  setSwitchState(enableSoundToggle, posSettings.enableSound);
  setSwitchState(autoSwitchCartToggle, posSettings.autoSwitchCartAfterAdd);
  renderFeatureModuleSettings();
  renderSoundCenterControlsV656();
}

function findSettingsCardByControl(controlId) {
  var control = document.getElementById(controlId);
  while (control && control !== document.body) {
    if ((" " + (control.className || "") + " ").indexOf(" settings-card ") !== -1) return control;
    control = control.parentNode;
  }
  return null;
}

function createSettingsSection(id) {
  var section = document.createElement("div");
  section.id = id;
  section.className = "settings-section-body";
  return section;
}

function moveSettingsCard(section, controlId) {
  var card = findSettingsCardByControl(controlId);
  if (section && card) section.appendChild(card);
}

function initSettingsCenter() {
  if (settingsCenterReady) return;
  var layout = document.querySelector("#settingsTab .settings-layout");
  var grid = document.querySelector("#settingsTab .settings-grid");
  if (!layout || !grid) return;

  var sections = {
    store: createSettingsSection("settingsSectionStore"),
    order: createSettingsSection("settingsSectionOrder"),
    qr: createSettingsSection("settingsSectionQr"),
    sound: createSettingsSection("settingsSectionSound"),
    print: createSettingsSection("settingsSectionPrint"),
    modules: createSettingsSection("settingsSectionModules"),
    system: createSettingsSection("settingsSectionSystem")
  };

  moveSettingsCard(sections.system, "fullscreenBtn");
  moveSettingsCard(sections.store, "storeNameInput");
  moveSettingsCard(sections.store, "tableCountInput");
  moveSettingsCard(sections.order, "prepTimeInput");
  moveSettingsCard(sections.qr, "qrValidMinutesInput");
  moveSettingsCard(sections.qr, "orderLookupMinutesInput");
  moveSettingsCard(sections.order, "showTestOrdersToggle");
  moveSettingsCard(sections.sound, "enableSoundToggle");
  moveSettingsCard(sections.order, "autoSwitchCartToggle");
  sections.sound.appendChild(buildSoundCenterPanelV656());
  sections.print.appendChild(buildPrinterCenterPanel());
  sections.modules.appendChild(buildReservedSettingsCard("功能模組", "QR、KDS、列印、會員、電子發票、外送平台都會放在這裡管理。"));
  sections.system.appendChild(buildReservedSettingsCard("系統與裝置", "裝置、喇叭、勿擾模式、排程靜音與多店音效設定的預留區。"));

  grid.className = "settings-center-grid";
  grid.innerHTML = [
    buildSettingsEntry("store", "🏪", "店家與桌位", "店名、桌數、店內使用設定"),
    buildSettingsEntry("order", "🛒", "點餐流程", "出餐時間、測試單與點餐行為"),
    buildSettingsEntry("qr", "📱", "QR 點餐", "QR 有效時間與查詢時間"),
    buildSettingsEntry("sound", "🔔", "通知與音效", "音效中心與重複提醒"),
    buildSettingsEntry("print", "🖨️", "印表機設定", "廚房、客人與貼紙印表機設定"),
    buildSettingsEntry("modules", "🧩", "功能模組", "SaaS、會員、電子發票、外送平台"),
    buildSettingsEntry("system", "⚙️", "系統與裝置", "全螢幕、喇叭與裝置預留")
  ].join("");

  var modal = document.createElement("div");
  modal.id = "settingsCenterModal";
  modal.className = "settings-center-modal hidden";
  modal.innerHTML = '<div class="settings-center-dialog" role="dialog" aria-modal="true" aria-labelledby="settingsCenterTitle">' +
    '<div class="settings-center-header"><button type="button" id="settingsCenterBackBtn" class="settings-center-icon-btn" aria-label="返回">‹</button><div><h3 id="settingsCenterTitle">設定中心</h3><p id="settingsCenterSubtitle">設定中心</p></div><button type="button" id="settingsCenterCloseBtn" class="settings-center-icon-btn" aria-label="關閉">×</button></div>' +
    '<div id="settingsCenterBody" class="settings-center-body"></div>' +
    '<div class="settings-center-footer"><button type="button" id="settingsCenterFooterBackBtn" class="secondary-btn">返回</button><button type="button" id="settingsCenterFooterCloseBtn" class="primary-btn">關閉</button></div>' +
    '</div>';
  document.body.appendChild(modal);

  var body = modal.querySelector("#settingsCenterBody");
  Object.keys(sections).forEach(function(key) {
    body.appendChild(sections[key]);
  });

  var entryButtons = grid.querySelectorAll("[data-settings-section]");
  for (var i = 0; i < entryButtons.length; i += 1) {
    (function(button) {
      addSettingsCenterClickListener(button, function(event) {
        if (event && event.preventDefault) event.preventDefault();
        openSettingsSection(button.getAttribute("data-settings-section"));
      });
    })(entryButtons[i]);
  }

  ["settingsCenterBackBtn", "settingsCenterCloseBtn", "settingsCenterFooterBackBtn", "settingsCenterFooterCloseBtn"].forEach(function(id) {
    var button = document.getElementById(id);
    addSettingsCenterClickListener(button, function(event) {
      if (event && event.preventDefault) event.preventDefault();
      closeSettingsSection();
    });
  });

  settingsCenterReady = true;
}

function buildSettingsEntry(section, icon, title, subtitle) {
  return '<button type="button" class="settings-center-entry" data-settings-section="' + section + '">' +
    '<span class="settings-center-entry-icon">' + icon + '</span>' +
    '<span><strong>' + title + '</strong><small>' + subtitle + '</small></span>' +
    '<b>›</b>' +
    '</button>';
}

function buildReservedSettingsCard(title, text) {
  var card = document.createElement("section");
  card.className = "settings-card settings-reserved-card";
  card.innerHTML = '<div class="settings-card-title"><span>' + title + '</span><small>' + text + '</small></div>';
  return card;
}

function buildPrinterCenterPanel() {
  var card = document.createElement("section");
  card.className = "settings-card settings-sound-center-card printer-center-card printer-profile-center";
  card.innerHTML = '<div class="settings-card-title"><span>🖨️ 印表機設定</span><small>廚房單、客人單與貼紙可使用獨立列印設定</small></div>' +
    '<div class="printer-profile-list">' +
      buildPrinterProfileCard("Kitchen", "🖨️", "廚房印表機", false) +
      buildPrinterProfileCard("Customer", "🖨️", "客人印表機", false) +
      buildPrinterProfileCard("Label", "🖨️", "貼紙印表機", true) +
    '</div>' + buildUsbPrinterPanel() + buildPrintQueuePanel() +
    '<div id="printerReloadFeedback" class="printer-operator-feedback" role="status" aria-live="polite">設定變更後會在這裡顯示套用結果。</div>' +
    '<div class="printer-center-actions"><button type="button" id="printerDetectBtn" class="secondary-btn">重新搜尋印表機</button><button type="button" id="printerReprintBtn" class="primary-btn">重印最後一張</button></div>';
  window.setTimeout(bindPrinterCenterControls, 0);
  return card;
}

function buildUsbPrinterPanel() {
  return '<section class="usb-printer-panel" aria-labelledby="usbPrinterTitle"><div class="printer-profile-heading"><strong id="usbPrinterTitle">USB 印表機管理</strong><small id="usbPrinterCapability">檢查中</small></div><div class="usb-printer-details"><span id="usbPrinterDevice">已授權裝置：0 台</span><span id="usbPrinterIds">請在各用途設定綁定裝置</span><span id="usbPrinterConnection">實體連線由列印時管理</span></div><label class="usb-device-picker"><span>已授權裝置</span><select id="usbAuthorizedDevices" class="settings-input" disabled><option value="">尚無裝置</option></select></label><p id="usbPrinterMessage" class="usb-printer-message">選擇裝置只取得瀏覽器權限，不會開啟或連線印表機。</p><div class="printer-center-actions"><button type="button" id="usbDetectBtn" class="secondary-btn">偵測已授權裝置</button><button type="button" id="usbRequestBtn" class="secondary-btn">選擇 USB 印表機</button></div></section>';
}

function buildPrintQueuePanel() {
  return '<section class="print-queue-panel"><div class="printer-profile-heading"><strong>🖨️ 列印佇列</strong><small id="printQueueState">待命</small></div>' +
    '<div class="print-queue-stats"><div><span>目前列印</span><strong id="printQueueCurrent">無</strong></div><div><span>等待數量</span><strong id="printQueuePending">0</strong></div><div><span>佇列狀態</span><strong id="printQueueStatus">待命</strong></div></div>' +
    '<div class="print-queue-actions"><button type="button" id="printQueueResumeBtn" class="secondary-btn">重新開始列印佇列</button><button type="button" id="printQueueClearBtn" class="secondary-btn">清空列印佇列</button></div></section>';
}

function buildPrinterProfileCard(profileName, icon, title, reserved) {
  var operatorActions = reserved ? "" : '<div class="printer-profile-actions"><button type="button" class="secondary-btn" data-profile-unbind>解除綁定</button><button type="button" class="primary-btn" data-profile-test>測試' + (profileName === "Kitchen" ? "廚房印表機" : "客人單印表機") + '</button></div>';
  return '<section class="printer-profile-card" data-printer-profile="' + profileName + '">' +
    '<div class="printer-profile-heading"><strong>' + icon + ' ' + title + '</strong>' + (reserved ? '<small>（預留）</small>' : '') + '</div>' +
    '<div class="printer-profile-fields">' +
      '<label><span>列印方式</span><select class="settings-input" data-profile-field="provider"><option value="browser">瀏覽器列印</option><option value="usb" disabled>USB（尚未開放）</option><option value="bluetooth" disabled>藍牙（尚未開放）</option><option value="network" disabled>LAN（尚未開放）</option></select></label>' +
      '<label><span>紙張尺寸</span><select class="settings-input" data-profile-field="paperSize"><option value="58">58mm</option><option value="80">80mm</option><option value="40x30">40×30 貼紙</option></select></label>' +
      '<label><span>列印份數</span><select class="settings-input" data-profile-field="copies"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>' +
      '<label data-profile-binding-row><span>USB 實體印表機</span><select class="settings-input" data-profile-device-binding><option value="">請選擇已授權 USB 印表機</option></select></label>' +
      '<label class="printer-profile-toggle"><span>自動列印</span><input type="checkbox" data-profile-field="autoPrint"><b data-profile-auto-label>停用</b></label>' +
      '<label class="printer-profile-toggle"><span>啟用</span><input type="checkbox" data-profile-field="enabled"><b data-profile-enabled-label>停用</b></label>' +
    '</div><div class="printer-binding-summary" data-profile-binding-summary><strong>綁定狀態：<b data-binding-status>未綁定</b></strong><span>裝置：<b data-binding-device>—</b></span><span>USB 裝置資訊：VID <b data-binding-vid>—</b> / PID <b data-binding-pid>—</b> / 序號（S/N）<b data-binding-serial>—</b></span><span>紙張：<b data-binding-paper>—</b>・份數：<b data-binding-copies>—</b>・自動列印：<b data-binding-auto>—</b></span><small data-binding-warning>請選擇印表機。</small></div>' +
    '<div class="printer-profile-status" data-profile-status><span>列印方式：-</span><span>紙張尺寸：-</span><span>列印份數：-</span><span>自動列印：-</span><span>列印佇列：待命</span></div>' + operatorActions + '</section>';
}

function bindPrinterCenterControls() {
  loadLegacyPrinterModules().then(bindLoadedPrinterCenterControls).catch(showPrinterError);
}

function bindLoadedPrinterCenterControls(legacy) {
  var PrinterCenter = legacy.PrinterCenter;
  var PrinterProfile = legacy.PrinterProfile;
  var PrintQueue = legacy.PrintQueue;
  var profiles = PrinterProfile.load();
  var usbOptions = document.querySelectorAll('[data-profile-field="provider"] option[value="usb"]');
  for (var usbIndex = 0; usbIndex < usbOptions.length; usbIndex += 1) {
    usbOptions[usbIndex].disabled = false;
    usbOptions[usbIndex].textContent = "USB";
  }
  var cards = document.querySelectorAll("[data-printer-profile]");
  for (var i = 0; i < cards.length; i += 1) bindPrinterProfileCard(cards[i], profiles, legacy);
  void refreshPrinterProfileDeviceBindings(legacy);
  var detect = document.getElementById("printerDetectBtn");
  var reprint = document.getElementById("printerReprintBtn");
  if (detect) detect.addEventListener("click", function() { PrinterCenter.detectPrinter().then(function(devices) { alert(devices.length ? "找到印表機：" + devices[0].name : "未找到印表機"); }).catch(showPrinterError); });
  if (reprint) reprint.addEventListener("click", function() { void reprintLastManualOrder(); });
  bindUsbPrinterControls(legacy);
  bindPrinterOperatorControls(legacy);
  var resumeQueue = document.getElementById("printQueueResumeBtn");
  var clearQueue = document.getElementById("printQueueClearBtn");
  if (resumeQueue) resumeQueue.addEventListener("click", function() { PrintQueue.resume(); });
  if (clearQueue) clearQueue.addEventListener("click", function() { PrintQueue.clear(); });
  PrintQueue.onStatusChanged(function(state) { renderPrintQueueStatus(state, legacy); });
  renderPrintQueueStatus({ current: PrintQueue.getCurrent(), pending: PrintQueue.getPending().length, busy: PrintQueue.isBusy(), paused: PrintQueue.isPaused() }, legacy);
}

function bindUsbPrinterControls(legacy) {
  var detect = document.getElementById("usbDetectBtn");
  var request = document.getElementById("usbRequestBtn");
  if (detect) detect.addEventListener("click", function() { void refreshPrinterProfileDeviceBindings(legacy); });
  if (request) request.addEventListener("click", function() {
    request.disabled = true;
    import("./printer-runtime-factory.js").then(function(module) { return module.requestUsbDeviceBinding(); }).then(function() {
      return refreshPrinterProfileDeviceBindings(legacy, "USB 印表機權限已取得，請在廚房或客人單設定中選擇裝置。");
    }).catch(function(error) {
      var mapped = legacy.PrinterSettingsOperator.operatorPrinterError(error, "DEVICE_SELECTION_FAILED");
      renderUsbBindingManagerStatus([], mapped.message);
    }).finally(function() { request.disabled = false; });
  });
}

function renderPrinterReloadFeedback(value) {
  var target = document.getElementById("printerReloadFeedback");
  if (!target || !value) return;
  target.setAttribute("data-state", value.state || "idle");
  target.textContent = value.message || "";
}

function applySavedPrinterConfiguration(legacy, profileName, changes) {
  var bridge = {
    invalidateConfiguration: function() { return loadPrinterOrderBridge().then(function(module) { return module.PrinterOrderBridge.invalidateConfiguration(); }); },
    reloadConfiguration: function() { return loadPrinterOrderBridge().then(function(module) { return module.PrinterOrderBridge.reloadConfiguration(); }); }
  };
  return legacy.PrinterSettingsOperator.savePrinterProfileAndApply(legacy.PrinterProfile, profileName, changes, bridge, renderPrinterReloadFeedback);
}

function bindPrinterOperatorControls(legacy) {
  var cards = document.querySelectorAll('[data-printer-profile="Kitchen"], [data-printer-profile="Customer"]');
  for (var i = 0; i < cards.length; i += 1) {
    (function(card) {
      var profileName = card.getAttribute("data-printer-profile");
      var unbind = card.querySelector("[data-profile-unbind]");
      var test = card.querySelector("[data-profile-test]");
      addLegacyTapListener(unbind, function(event) {
        if (event && event.preventDefault) event.preventDefault();
        var purpose = profileName === "Kitchen" ? "廚房" : "客人單";
        if (!window.confirm("確定解除這台" + purpose + "印表機的綁定嗎？\n解除後，USB 列印將暫時無法使用，直到重新選擇印表機。")) return;
        var saved = applySavedPrinterConfiguration(legacy, profileName, { deviceBinding: null });
        var updated = saved.profile;
        var select = card.querySelector("[data-profile-device-binding]");
        if (select) select.value = "";
        updatePrinterProfileCard(card, updated, legacy);
        void saved.completion;
      });
      addLegacyTapListener(test, function(event) {
        if (event && event.preventDefault) event.preventDefault();
        if (test.disabled) return;
        test.disabled = true;
        test.textContent = "正在測試…";
        legacy.PrinterCenter.testPrint(profileName === "Kitchen" ? "kitchen" : "customer").then(function() {
          alert((profileName === "Kitchen" ? "廚房" : "客人單") + "印表機測試已送出。");
        }).catch(function(error) {
          console.warn("Printer diagnostic test isolated", { profile: profileName, code: error && error.code || "TEST_PRINT_FAILED", error: error });
          alert(legacy.PrinterSettingsOperator.operatorPrinterError(error, "TEST_PRINT_FAILED").message);
        }).finally(function() {
          test.disabled = false;
          test.textContent = "測試" + (profileName === "Kitchen" ? "廚房印表機" : "客人單印表機");
        });
      });
    })(cards[i]);
  }
}

function refreshPrinterProfileDeviceBindings(legacy, message) {
  return import("./printer-runtime-factory.js").then(function(module) { return module.listAuthorizedUsbBindings(); }).then(function(bindings) {
    var cards = document.querySelectorAll("[data-printer-profile]");
    for (var i = 0; i < cards.length; i += 1) bindPrinterProfileDeviceBinding(cards[i], bindings, legacy);
    renderUsbBindingManagerStatus(bindings, message);
    return bindings;
  }).catch(function(error) { console.warn("USB profile binding refresh isolated", error); });
}

function bindPrinterProfileDeviceBinding(card, bindings, legacy) {
  var select = card.querySelector("[data-profile-device-binding]");
  var row = card.querySelector("[data-profile-binding-row]");
  if (!select || !legacy) return;
  var profileName = card.getAttribute("data-printer-profile");
  var profile = legacy.PrinterProfile.get(profileName);
  var currentId = profile && profile.deviceBinding && profile.deviceBinding.bindingId || "";
  var values = Array.isArray(bindings) ? bindings : [];
  select.innerHTML = '<option value="">請選擇已授權 USB 印表機</option>' + values.map(function(binding) {
    var label = (binding.productName || "USB 印表機") + " — VID:" + formatUsbId(binding.vendorId) + " PID:" + formatUsbId(binding.productId) + (binding.serialNumber ? " — 序號（S/N）:" + binding.serialNumber : " — 僅限本次工作階段");
    return '<option value="' + escapeHtml(binding.bindingId) + '"' + (binding.bindingId === currentId ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
  }).join("");
  select.disabled = !profile || profile.provider !== "usb";
  if (row) row.style.display = profile && profile.provider === "usb" ? "" : "none";
  select.onchange = function() {
    var selected = values.find(function(binding) { return binding.bindingId === select.value; }) || null;
    var saved = applySavedPrinterConfiguration(legacy, profileName, { deviceBinding: selected });
    var updated = saved.profile;
    updatePrinterProfileCard(card, updated, legacy);
    void saved.completion;
  };
}

function renderUsbBindingManagerStatus(bindings, message) {
  var values = Array.isArray(bindings) ? bindings : [];
  var supported = Boolean(typeof navigator !== "undefined" && navigator.usb);
  var capability = document.getElementById("usbPrinterCapability");
  var name = document.getElementById("usbPrinterDevice");
  var ids = document.getElementById("usbPrinterIds");
  var connection = document.getElementById("usbPrinterConnection");
  var messageNode = document.getElementById("usbPrinterMessage");
  var authorized = document.getElementById("usbAuthorizedDevices");
  if (capability) capability.textContent = supported ? "WebUSB 可用" : "此瀏覽器不支援 WebUSB";
  if (name) name.textContent = "已授權裝置：" + values.length + " 台";
  if (ids) ids.textContent = "請在各用途設定綁定裝置";
  if (connection) connection.textContent = "實體連線由列印時管理";
  if (messageNode) messageNode.textContent = message || (supported ? "選擇裝置只取得瀏覽器權限，不會開啟或連線印表機。" : "請改用支援 WebUSB 的 Windows Chrome；iPad Safari 不支援 USB 印表機。");
  if (authorized) {
    authorized.innerHTML = values.length ? values.map(function(binding) {
      var label = (binding.productName || "USB 印表機") + " — VID:" + formatUsbId(binding.vendorId) + " PID:" + formatUsbId(binding.productId) + (binding.serialNumber ? " — 序號（S/N）:" + binding.serialNumber : " — 僅限本次工作階段");
      return '<option>' + escapeHtml(label) + '</option>';
    }).join("") : '<option value="">尚無裝置</option>';
    authorized.disabled = true;
  }
}

function formatUsbId(value) {
  return (Number(value) || 0).toString(16).toUpperCase().padStart(4, "0");
}

function renderPrintQueueStatus(state, legacy) {
  if (!legacy) return;
  var PrinterProfile = legacy.PrinterProfile;
  var PrintQueue = legacy.PrintQueue;
  var current = document.getElementById("printQueueCurrent");
  var pending = document.getElementById("printQueuePending");
  var status = document.getElementById("printQueueStatus");
  var badge = document.getElementById("printQueueState");
  var statusText = state.paused ? "已暫停" : (state.busy ? "列印中" : (state.pending > 0 ? "等待中" : "待命"));
  if (current) current.textContent = state.current ? (state.current.type === "kitchen" ? "廚房單" : "客人單") + " #" + (state.current.order && (state.current.order.orderNumber || state.current.order.id) || state.current.id) : "無";
  if (pending) pending.textContent = String(state.pending || 0);
  if (status) status.textContent = statusText;
  if (badge) badge.textContent = statusText;
  var profileCards = document.querySelectorAll("[data-printer-profile]");
  for (var i = 0; i < profileCards.length; i += 1) {
    var profileName = profileCards[i].getAttribute("data-printer-profile");
    renderPrinterProfileStatus(profileCards[i], PrinterProfile.get(profileName), legacy);
  }
}

function bindPrinterProfileCard(card, profiles, legacy) {
  var PrinterProfile = legacy.PrinterProfile;
  var profileName = card.getAttribute("data-printer-profile");
  var profile = profiles[profileName];
  var fields = card.querySelectorAll("[data-profile-field]");
  for (var i = 0; i < fields.length; i += 1) {
    (function(field) {
      var key = field.getAttribute("data-profile-field");
      if (key === "autoPrint" || key === "enabled") field.checked = profile[key] === true;
      else field.value = String(profile[key]);
      updatePrinterProfileCard(card, profile, legacy);
      field.addEventListener("change", function() {
        var value = key === "autoPrint" || key === "enabled" ? field.checked : field.value;
        var saved = applySavedPrinterConfiguration(legacy, profileName, (function() { var change = {}; change[key] = value; return change; })());
        var updated = saved.profile;
        updatePrinterProfileCard(card, updated, legacy);
        void saved.completion;
        if (key === "provider") void refreshPrinterProfileDeviceBindings(legacy);
      });
    })(fields[i]);
  }
}

function updatePrinterProfileCard(card, profile, legacy) {
  var autoInput = card.querySelector('[data-profile-field="autoPrint"]');
  var enabledInput = card.querySelector('[data-profile-field="enabled"]');
  var autoLabel = card.querySelector("[data-profile-auto-label]");
  var enabledLabel = card.querySelector("[data-profile-enabled-label]");
  if (autoLabel) autoLabel.textContent = autoInput && autoInput.checked ? "啟用" : "停用";
  if (enabledLabel) enabledLabel.textContent = enabledInput && enabledInput.checked ? "啟用" : "停用";
  renderPrinterProfileStatus(card, profile, legacy);
}

function renderPrinterProfileStatus(card, profile, legacy) {
  var status = card.querySelector("[data-profile-status]");
  if (!status || !profile) return;
  var current = legacy.PrintQueue.getCurrent();
  var queueText = current && current.profile && current.profile.id === profile.id ? "列印中" : "待命";
  var providerLabels = { browser: "瀏覽器列印", usb: "USB", bluetooth: "藍牙", network: "LAN" };
  status.innerHTML = '<span>列印方式：' + (providerLabels[profile.provider] || "未支援") + '</span><span>紙張尺寸：' + (profile.paperSize === "40x30" ? "40×30" : profile.paperSize + "mm") + '</span><span>列印份數：' + profile.copies + '</span><span>自動列印：' + (profile.autoPrint ? "啟用" : "停用") + '</span><span>列印佇列：' + queueText + '</span>';
  if (legacy.PrinterSettingsOperator) legacy.PrinterSettingsOperator.renderBindingSummary(card.querySelector("[data-profile-binding-summary]"), profile, card.getAttribute("data-printer-profile") === "Kitchen" ? "廚房印表機" : "客人單印表機");
}

function showPrinterError(error) {
  playSound("print-fail");
  alert(error && error.message ? error.message : "列印失敗");
}

function openSettingsSection(section) {
  var modal = document.getElementById("settingsCenterModal");
  if (!modal) return;
  var titles = {
    store: ["店家與桌位", "店家與桌位"],
    order: ["點餐流程", "點餐流程"],
    qr: ["QR 點餐", "QR 點餐"],
    sound: ["通知與音效", "音效中心"],
    print: ["印表機設定", "印表機設定"],
    modules: ["功能模組", "功能模組"],
    system: ["系統與裝置", "系統與裝置"]
  };
  settingsModalCurrentSection = section || "store";
  var title = titles[settingsModalCurrentSection] || titles.store;
  var titleEl = document.getElementById("settingsCenterTitle");
  var subEl = document.getElementById("settingsCenterSubtitle");
  if (titleEl) titleEl.textContent = title[0];
  if (subEl) subEl.textContent = title[1];
  var bodies = modal.querySelectorAll(".settings-section-body");
  for (var i = 0; i < bodies.length; i += 1) {
    setLegacyClassActive(bodies[i], "active", bodies[i].id === "settingsSection" + settingsModalCurrentSection.charAt(0).toUpperCase() + settingsModalCurrentSection.slice(1));
  }
  setLegacyClassActive(modal, "hidden", false);
  setLegacyClassActive(document.body, "settings-center-open", true);
}

function closeSettingsSection() {
  var modal = document.getElementById("settingsCenterModal");
  if (modal) setLegacyClassActive(modal, "hidden", true);
  setLegacyClassActive(document.body, "settings-center-open", false);
  settingsModalCurrentSection = "";
}

function buildSoundCenterPanel() {
  var card = document.createElement("section");
  card.className = "settings-card settings-sound-center-card";
  var settings = getSoundCenterSettings();
  var events = [
    ["new-order", "新訂單"],
    ["qr-order", "QR 訂單"],
    ["pos-order", "POS 點餐"],
    ["payment", "收款完成"],
    ["kds-done", "廚房完成"],
    ["cancel", "作廢"],
    ["print-fail", "列印失敗"],
    ["uber-eats", "Uber Eats（預留）"],
    ["foodpanda", "foodpanda（預留）"]
  ];
  var soundOptions = [
    ["new-order", "新訂單"],
    ["qr-order", "QR 訂單"],
    ["pos-order", "POS 點餐"],
    ["payment", "收款完成"],
    ["kds-done", "廚房完成"],
    ["cancel", "作廢"],
    ["print-fail", "列印失敗"],
    ["delivery", "外送平台"]
  ];
  card.innerHTML = '<div class="settings-card-title"><span>🔔 音效中心</span><small>提示音、音效主題、事件音效與未處理訂單重複提醒</small></div>' +
    '<div class="sound-center-repeat-grid">' +
    '<label class="feature-module-row"><span>啟用重複提醒</span><input id="repeatAlertEnabledInput" type="checkbox" ' + (posSettings.repeatAlertEnabled ? "checked" : "") + ' /></label>' +
    '<label><span>提醒間隔</span><select id="repeatAlertIntervalInput" class="settings-input"><option value="10">10 秒</option><option value="15">15 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option><option value="60">60 秒</option></select></label>' +
    '<label><span>最大提醒次數</span><select id="repeatAlertMaxInput" class="settings-input"><option value="1">1 次</option><option value="3">3 次</option><option value="5">5 次</option><option value="10">10 次</option><option value="infinite">持續提醒直到確認</option></select></label>' +
    '</div>' +
    '<div class="sound-event-list" id="soundEventList">' +
    events.map(function(item) {
      var value = item[0];
      return '<div class="sound-event-row"><span>' + item[1] + '</span><select class="settings-input" data-legacy-sound-event="' + item[0] + '">' +
        soundOptions.map(function(option) {
          return '<option value="' + option[0] + '"' + (value === option[0] ? " selected" : "") + '>' + option[1] + '</option>';
        }).join("") +
        '</select><button type="button" class="secondary-btn sound-test-btn" data-sound-test="' + item[0] + '">▶ 播放</button></div>';
    }).join("") +
    '</div>' +
    '<div class="settings-future-note">預留：自訂 MP3/WAV、Uber Eats、foodpanda、多店音效、Bluetooth/USB Speaker、勿擾模式、排程靜音。</div>';
  return card;
}

function renderSoundCenterControls() {
  var repeatEnabledInput = document.getElementById("repeatAlertEnabledInput");
  var repeatIntervalInput = document.getElementById("repeatAlertIntervalInput");
  var repeatMaxInput = document.getElementById("repeatAlertMaxInput");
  if (repeatEnabledInput) repeatEnabledInput.checked = posSettings.repeatAlertEnabled === true;
  if (repeatIntervalInput) repeatIntervalInput.value = String(posSettings.repeatAlertInterval || defaultSettings.repeatAlertInterval);
  if (repeatMaxInput) repeatMaxInput.value = String(posSettings.repeatAlertMaxCount || defaultSettings.repeatAlertMaxCount);
  bindSoundCenterControls();
}

function bindSoundCenterControls() {
  var repeatEnabledInput = document.getElementById("repeatAlertEnabledInput");
  var repeatIntervalInput = document.getElementById("repeatAlertIntervalInput");
  var repeatMaxInput = document.getElementById("repeatAlertMaxInput");
  if (repeatEnabledInput && repeatEnabledInput.getAttribute("data-bound") !== "true") {
    repeatEnabledInput.setAttribute("data-bound", "true");
    repeatEnabledInput.addEventListener("change", function() {
      posSettings.repeatAlertEnabled = repeatEnabledInput.checked === true;
      saveSetting("repeatAlertEnabled", posSettings.repeatAlertEnabled);
      syncSoundCenterSettings();
      if (posSettings.repeatAlertEnabled !== true) stopOrderAlertSound();
    }, false);
  }
  if (repeatIntervalInput && repeatIntervalInput.getAttribute("data-bound") !== "true") {
    repeatIntervalInput.setAttribute("data-bound", "true");
    repeatIntervalInput.addEventListener("change", function() {
      posSettings.repeatAlertInterval = Math.min(3600, Math.max(1, Math.floor(Number(repeatIntervalInput.value) || defaultSettings.repeatAlertInterval)));
      saveSetting("repeatAlertInterval", posSettings.repeatAlertInterval);
      syncSoundCenterSettings();
    }, false);
  }
  if (repeatMaxInput && repeatMaxInput.getAttribute("data-bound") !== "true") {
    repeatMaxInput.setAttribute("data-bound", "true");
    repeatMaxInput.addEventListener("change", function() {
      posSettings.repeatAlertMaxCount = repeatMaxInput.value === "infinite" ? "infinite" : Math.min(99, Math.max(1, Math.floor(Number(repeatMaxInput.value) || defaultSettings.repeatAlertMaxCount)));
      saveSetting("repeatAlertMaxCount", posSettings.repeatAlertMaxCount);
      syncSoundCenterSettings();
    }, false);
  }
  var eventSelects = document.querySelectorAll("[data-legacy-sound-event]");
  for (var i = 0; i < eventSelects.length; i += 1) {
    (function(select) {
      if (select.getAttribute("data-bound") === "true") return;
      select.setAttribute("data-bound", "true");
      select.addEventListener("change", function() {
        var settings = getSoundCenterSettings();
        settings.legacySoundEvents = settings.legacySoundEvents || {};
        settings.legacySoundEvents[select.getAttribute("data-legacy-sound-event")] = select.value;
        configureSoundCenter(settings);
      }, false);
    })(eventSelects[i]);
  }
  var testButtons = document.querySelectorAll("[data-sound-test]");
  for (var j = 0; j < testButtons.length; j += 1) {
    (function(button) {
      if (button.getAttribute("data-bound") === "true") return;
      button.setAttribute("data-bound", "true");
      addLegacyTapListener(button, async function(event) {
        if (event && event.preventDefault) event.preventDefault();
        var success = await unlockPosOrderSound();
        if (!success) {
          showMenuStatusError("音效啟動失敗，請再點一次");
          return;
        }
        playSound(button.getAttribute("data-sound-test"), { force: true, ignoreSilentHours: true });
      });
    })(testButtons[j]);
  }
}

function getSoundThemeLabel(theme) {
  var labels = {
    classic: "經典",
    restaurant: "餐廳",
    cafe: "咖啡館",
    modern: "現代",
    "night-market": "夜市",
    "high-tone-double": "高音雙響",
    "fast-triple": "急促三響",
    "kitchen-alert": "廚房警示音",
    "long-bell": "長鈴提醒"
  };
  return labels[theme] || labels.classic;
}

function buildSoundCenterPanelV656() {
  var card = document.createElement("section");
  card.className = "settings-card settings-sound-center-card sound-center-v656";
  var events = [
    ["new-order", "新訂單"],
    ["payment", "收款成功"],
    ["cooking", "製作中"],
    ["done", "製作完成"],
    ["cancel", "已取消"],
    ["error", "錯誤提示"]
  ];
  card.innerHTML = '<div class="settings-card-title"><span>🔔 音效中心</span><small>音量、音效主題、試聽、重複提醒與靜音時段。</small></div>' +
    '<div class="sound-center-control-stack">' +
      '<label class="sound-center-field sound-volume-field"><span>音量</span><div class="sound-volume-readout"><b>0%</b><span id="soundCenterVolumeValue">100%</span><b>200%</b></div><input id="soundCenterVolumeInput" class="settings-input settings-range-input" type="range" min="0" max="200" step="25" /></label>' +
      '<label class="sound-center-field"><span>音效主題</span><select id="soundThemeSelect" class="settings-input"><option value="classic">經典</option><option value="restaurant">餐廳</option><option value="cafe">咖啡館</option><option value="modern">現代</option><option value="night-market">夜市</option><option value="high-tone-double">高音雙響</option><option value="fast-triple">急促三響</option><option value="kitchen-alert">廚房警示音</option><option value="long-bell">長鈴提醒</option></select></label>' +
    '</div>' +
    '<div class="sound-event-list sound-pack-event-list" id="soundEventList">' +
      events.map(function(item) {
        return '<div class="sound-event-row sound-pack-row"><div><strong>' + item[1] + '</strong><small>音效主題：<span data-sound-row-theme>' + getSoundThemeLabel(posSettings.soundType) + '</span></small></div><button type="button" class="secondary-btn sound-test-btn" data-sound-test="' + item[0] + '">▶ 試聽</button></div>';
      }).join("") +
    '</div>' +
    '<div class="sound-center-control-stack">' +
      '<label class="sound-center-field"><span>重複提醒</span><select id="repeatAlertIntervalInput" class="settings-input"><option value="off">關閉</option><option value="10">10 秒</option><option value="15">15 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="45">45 秒</option><option value="60">60 秒</option><option value="90">90 秒</option><option value="120">120 秒</option><option value="custom">自訂秒數</option></select></label>' +
      '<label class="sound-center-field" id="repeatCustomSecondsField"><span>自訂秒數</span><input id="repeatAlertCustomInput" class="settings-input" type="number" min="1" max="3600" step="1" /></label>' +
      '<label class="sound-center-field"><span>最大提醒次數</span><select id="repeatAlertMaxInput" class="settings-input"><option value="1">1 次</option><option value="3">3 次</option><option value="5">5 次</option><option value="10">10 次</option><option value="until-confirmed">持續提醒直到確認</option></select></label>' +
    '</div>' +
    '<div class="sound-center-silent-box">' +
      '<div class="settings-card-title"><span>靜音時段</span><small>進入時間後全部提示音停止，離開時間後恢復。</small></div>' +
      '<div class="silent-hours-grid"><label class="sound-center-field"><span>開始時間</span><input id="silentHoursStartInput" class="settings-input" type="time" /></label><div class="silent-hours-arrow">↓</div><label class="sound-center-field"><span>結束時間</span><input id="silentHoursEndInput" class="settings-input" type="time" /></label><label class="feature-module-row silent-hours-toggle"><span>啟用靜音時段</span><input id="silentHoursEnabledInput" type="checkbox" /></label></div>' +
    '</div>' +
    '<div class="settings-future-note">僅預留 API：Uber Eats 音效主題、foodpanda 音效主題、自訂 MP3、外接喇叭、多店設定、排程與勿擾模式。</div>';
  return card;
}

function renderSoundCenterControlsV656() {
  var soundThemeSelect = document.getElementById("soundThemeSelect");
  var soundCenterVolumeInput = document.getElementById("soundCenterVolumeInput");
  var soundCenterVolumeValue = document.getElementById("soundCenterVolumeValue");
  var repeatIntervalInput = document.getElementById("repeatAlertIntervalInput");
  var repeatCustomInput = document.getElementById("repeatAlertCustomInput");
  var repeatCustomField = document.getElementById("repeatCustomSecondsField");
  var repeatMaxInput = document.getElementById("repeatAlertMaxInput");
  var silentEnabledInput = document.getElementById("silentHoursEnabledInput");
  var silentStartInput = document.getElementById("silentHoursStartInput");
  var silentEndInput = document.getElementById("silentHoursEndInput");
  var themeLabel = getSoundThemeLabel(posSettings.soundType);
  if (soundThemeSelect) soundThemeSelect.value = posSettings.soundType || defaultSettings.soundType;
  if (soundCenterVolumeInput && document.activeElement !== soundCenterVolumeInput) soundCenterVolumeInput.value = String(posSettings.soundVolume || 0);
  if (soundCenterVolumeValue) soundCenterVolumeValue.textContent = String(posSettings.soundVolume || 0) + "%";
  if (repeatIntervalInput) repeatIntervalInput.value = String(posSettings.repeatAlertInterval || defaultSettings.repeatAlertInterval);
  if (repeatCustomInput) repeatCustomInput.value = String(posSettings.repeatAlertCustomSeconds || defaultSettings.repeatAlertCustomSeconds);
  if (repeatCustomField) repeatCustomField.style.display = posSettings.repeatAlertInterval === "custom" ? "" : "none";
  if (repeatMaxInput) repeatMaxInput.value = String(posSettings.repeatAlertMaxCount || defaultSettings.repeatAlertMaxCount);
  if (silentEnabledInput) silentEnabledInput.checked = posSettings.silentHoursEnabled === true;
  if (silentStartInput) silentStartInput.value = posSettings.silentHoursStart || defaultSettings.silentHoursStart;
  if (silentEndInput) silentEndInput.value = posSettings.silentHoursEnd || defaultSettings.silentHoursEnd;
  var themeNodes = document.querySelectorAll("[data-sound-row-theme]");
  for (var i = 0; i < themeNodes.length; i += 1) themeNodes[i].textContent = themeLabel;
  bindSoundCenterControlsV656();
}

function bindTimeSetting(input, key) {
  if (!input || input.getAttribute("data-bound") === "true") return;
  input.setAttribute("data-bound", "true");
  input.addEventListener("change", function() {
    var value = input.value || (key === "silentHoursStart" ? defaultSettings.silentHoursStart : defaultSettings.silentHoursEnd);
    posSettings[key] = value;
    saveSetting(key, value);
    syncSoundCenterSettings();
  }, false);
}

function bindSoundCenterControlsV656() {
  var soundThemeSelect = document.getElementById("soundThemeSelect");
  var soundCenterVolumeInput = document.getElementById("soundCenterVolumeInput");
  var repeatIntervalInput = document.getElementById("repeatAlertIntervalInput");
  var repeatCustomInput = document.getElementById("repeatAlertCustomInput");
  var repeatMaxInput = document.getElementById("repeatAlertMaxInput");
  var silentEnabledInput = document.getElementById("silentHoursEnabledInput");
  var silentStartInput = document.getElementById("silentHoursStartInput");
  var silentEndInput = document.getElementById("silentHoursEndInput");

  if (soundThemeSelect && soundThemeSelect.getAttribute("data-bound") !== "true") {
    soundThemeSelect.setAttribute("data-bound", "true");
    soundThemeSelect.addEventListener("change", function() {
      posSettings.soundType = isValidSoundType(soundThemeSelect.value) ? soundThemeSelect.value : defaultSettings.soundType;
      if (soundTypeSelect) soundTypeSelect.value = posSettings.soundType;
      saveSetting("soundType", posSettings.soundType);
      renderSoundCenterControlsV656();
      syncSoundCenterSettings();
      syncSoundSettingsToFirebase();
    }, false);
  }

  if (soundCenterVolumeInput && soundCenterVolumeInput.getAttribute("data-bound") !== "true") {
    soundCenterVolumeInput.setAttribute("data-bound", "true");
    soundCenterVolumeInput.addEventListener("input", function() {
      posSettings.soundVolume = Math.min(200, Math.max(0, Math.floor(Number(soundCenterVolumeInput.value) || 0)));
      posSettings.soundVolume = Math.round(posSettings.soundVolume / 25) * 25;
      renderSoundVolume();
      syncSoundCenterSettings();
    }, false);
    soundCenterVolumeInput.addEventListener("change", function() {
      posSettings.soundVolume = Math.min(200, Math.max(0, Math.floor(Number(soundCenterVolumeInput.value) || 0)));
      posSettings.soundVolume = Math.round(posSettings.soundVolume / 25) * 25;
      saveSetting("soundVolume", posSettings.soundVolume);
      renderSoundVolume();
      syncSoundCenterSettings();
      syncSoundSettingsToFirebase();
    }, false);
  }

  if (repeatIntervalInput && repeatIntervalInput.getAttribute("data-bound") !== "true") {
    repeatIntervalInput.setAttribute("data-bound", "true");
    repeatIntervalInput.addEventListener("change", function() {
      var value = repeatIntervalInput.value;
      posSettings.repeatAlertInterval = value === "off" || value === "custom" ? value : Math.min(3600, Math.max(1, Math.floor(Number(value) || defaultSettings.repeatAlertInterval)));
      posSettings.repeatAlertEnabled = posSettings.repeatAlertInterval !== "off";
      saveSetting("repeatAlertInterval", posSettings.repeatAlertInterval);
      saveSetting("repeatAlertEnabled", posSettings.repeatAlertEnabled);
      renderSoundCenterControlsV656();
      if (posSettings.repeatAlertEnabled !== true) stopOrderAlertSound();
      syncSoundCenterSettings();
    }, false);
  }

  if (repeatCustomInput && repeatCustomInput.getAttribute("data-bound") !== "true") {
    repeatCustomInput.setAttribute("data-bound", "true");
    repeatCustomInput.addEventListener("change", function() {
      posSettings.repeatAlertCustomSeconds = Math.min(3600, Math.max(1, Math.floor(Number(repeatCustomInput.value) || defaultSettings.repeatAlertCustomSeconds)));
      repeatCustomInput.value = String(posSettings.repeatAlertCustomSeconds);
      saveSetting("repeatAlertCustomSeconds", posSettings.repeatAlertCustomSeconds);
      syncSoundCenterSettings();
    }, false);
  }

  if (repeatMaxInput && repeatMaxInput.getAttribute("data-bound") !== "true") {
    repeatMaxInput.setAttribute("data-bound", "true");
    repeatMaxInput.addEventListener("change", function() {
      posSettings.repeatAlertMaxCount = repeatMaxInput.value === "until-confirmed" ? "until-confirmed" : Math.min(10, Math.max(1, Math.floor(Number(repeatMaxInput.value) || defaultSettings.repeatAlertMaxCount)));
      saveSetting("repeatAlertMaxCount", posSettings.repeatAlertMaxCount);
      syncSoundCenterSettings();
    }, false);
  }

  if (silentEnabledInput && silentEnabledInput.getAttribute("data-bound") !== "true") {
    silentEnabledInput.setAttribute("data-bound", "true");
    silentEnabledInput.addEventListener("change", function() {
      posSettings.silentHoursEnabled = silentEnabledInput.checked === true;
      saveSetting("silentHoursEnabled", posSettings.silentHoursEnabled);
      syncSoundCenterSettings();
    }, false);
  }

  bindTimeSetting(silentStartInput, "silentHoursStart");
  bindTimeSetting(silentEndInput, "silentHoursEnd");

  var testButtons = document.querySelectorAll("[data-sound-test]");
  for (var j = 0; j < testButtons.length; j += 1) {
    (function(button) {
      if (button.getAttribute("data-bound") === "true") return;
      button.setAttribute("data-bound", "true");
      addLegacyTapListener(button, async function(event) {
        if (event && event.preventDefault) event.preventDefault();
        var success = await unlockPosOrderSound();
        if (!success) {
          showMenuStatusError("音效啟動失敗，請再點一次");
          return;
        }
        playSound(button.getAttribute("data-sound-test"), { force: true, ignoreSilentHours: true });
      });
    })(testButtons[j]);
  }
}

function loadHeldCarts() {
  try {
    var raw = localStorage.getItem(HELD_CARTS_KEY);
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveHeldCarts() {
  try {
    localStorage.setItem(HELD_CARTS_KEY, JSON.stringify(heldCarts || []));
  } catch (e) {}
}

function getCurrentCartLabel() {
  if (currentOrderType === "內用") return String(selectedTable || "1") + "桌";
  return "外帶";
}

function cloneCartItems(items) {
  try {
    return JSON.parse(JSON.stringify(items || []));
  } catch (e) {
    return [];
  }
}

function ensurePosMenuStudioUi() {
  var cartTab = document.querySelector('[data-order-subtab="cart"]');
  if (cartTab && !cartTab.querySelector(".cart-count-badge")) {
    cartTab.innerHTML = '<span class="cart-tab-label">購物車</span><span class="cart-count-badge">0</span>';
  }

  var cartTitle = document.querySelector('.cart-panel .panel-title h2');
  if (cartTitle) cartTitle.textContent = "購物車";

  var cartSubtitle = document.querySelector('.cart-panel .panel-title p');
  if (cartSubtitle) cartSubtitle.textContent = "可保留桌號 / 外帶單，再快速恢復";

  if (clearCartBtn && !document.getElementById("holdCartBtn")) {
    var holdBtn = document.createElement("button");
    holdBtn.id = "holdCartBtn";
    holdBtn.className = "secondary-btn";
    holdBtn.type = "button";
    holdBtn.textContent = "保留";
    clearCartBtn.parentNode.insertBefore(holdBtn, clearCartBtn);
    holdBtn.addEventListener("click", holdCurrentCart, false);
  }

  if (!document.getElementById("heldCartList") && cartList && cartList.parentNode) {
    var panel = document.createElement("section");
    panel.className = "held-cart-panel";
    panel.innerHTML = '<div class="held-cart-title"><strong>保留列表</strong><span>點一下立即恢復</span></div><div id="heldCartList" class="held-cart-list"></div>';
    cartList.parentNode.insertBefore(panel, cartList.nextSibling);
  }

  ensureFeatureModuleSettings();
  updateCartBadge();
  renderHeldCarts();
}

function updateCartBadge() {
  var badge = document.querySelector(".cart-count-badge");
  var count = cart.reduce(function(sum, item) { return sum + itemQty(item); }, 0);
  if (badge) badge.textContent = String(count);
}

function renderHeldCarts() {
  var list = document.getElementById("heldCartList");
  if (!list) return;
  if (!heldCarts.length) {
    list.innerHTML = '<div class="empty small-empty">尚未保留購物車</div>';
    return;
  }
  list.innerHTML = heldCarts.map(function(entry) {
    var holdNumber = entry.holdNumber || entry.heldOrderNumber || entry.label || "保留單";
    var meta = entry.orderType === "內用" ? "內用 " + (entry.table || "-") + "桌" : (entry.orderType || "外帶");
    return '<button type="button" class="held-cart-card" data-id="' + escapeHtml(entry.id) + '">' +
      '<strong>' + escapeHtml(holdNumber) + '</strong>' +
      '<span>' + escapeHtml(meta) + '</span>' +
      '<span>' + Number(entry.itemCount || 0) + ' 項餐點</span>' +
      '<b>' + money(entry.total || 0) + '</b>' +
    '</button>';
  }).join("");
  var buttons = list.querySelectorAll(".held-cart-card");
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].onclick = function() {
      restoreHeldCart(this.getAttribute("data-id"));
    };
  }
}

async function holdCurrentCart(options) {
  options = options || {};
  if (!cart.length) {
    if (!options.silent) alert("購物車沒有餐點可保留");
    return false;
  }
  var businessDate = getBusinessDate();
  var holdNumber = "";
  try {
    holdNumber = await createOrderNumber("hold", { storeId: STORE_ID, businessDate: businessDate });
  } catch (error) {
    console.error("保留單編號建立失敗：", error);
    alert("保留單編號建立失敗，請確認網路後再試一次。");
    return false;
  }
  var label = getCurrentCartLabel();
  var now = Date.now ? Date.now() : new Date().getTime();
  var entry = {
    id: "hold-" + now,
    holdNumber: holdNumber,
    heldOrderNumber: holdNumber,
    label: label,
    originalCartOrderNumber: "",
    businessDate: businessDate,
    businessDay: businessDate,
    orderType: currentOrderType,
    table: currentOrderType === "內用" ? selectedTable : "",
    items: cloneCartItems(cart),
    note: posOrderNoteInput ? posOrderNoteInput.value.trim() : "",
    itemCount: cart.reduce(function(sum, item) { return sum + itemQty(item); }, 0),
    total: calculateOrderTotal(cart),
    heldAt: now,
    createdAt: now
  };
  heldCarts.unshift(entry);
  saveHeldCarts();
  cart = [];
  if (posOrderNoteInput) posOrderNoteInput.value = "";
  renderCart();
  if (!options.silent) alert("已保留：" + holdNumber);
  return true;
}

async function restoreHeldCart(id) {
  var index = -1;
  for (var i = 0; i < heldCarts.length; i += 1) {
    if (String(heldCarts[i].id) === String(id)) index = i;
  }
  if (index < 0) return;
  var entry = heldCarts[index];

  if (cart.length) {
    var shouldHold = confirm("目前購物車已有餐點，為避免混單，不能直接切換保留訂單。\n\n請先完成送單，或按「確定」先保留目前購物車後再切換。");
    if (!shouldHold) {
      return;
    }
    var held = await holdCurrentCart({ silent: true });
    if (!held) return;
  }

  cart = cloneCartItems(entry.items);
  if (entry.orderType === "內用") {
    setPosOrderType("內用");
    selectedTable = entry.table || selectedTable;
    renderTableButtons();
  } else {
    setPosOrderType("外帶");
  }
  if (posOrderNoteInput) posOrderNoteInput.value = entry.note || "";
  heldCarts.splice(index, 1);
  saveHeldCarts();
  renderCart();
  switchOrderSubtab("cart");
}

function ensureFeatureModuleSettings() {
  var settingsGrid = document.getElementById("settingsSectionModules") || document.querySelector("#settingsTab .settings-grid");
  if (!settingsGrid || document.getElementById("featureModuleSettings")) return;
  var section = document.createElement("section");
  section.id = "featureModuleSettings";
  section.className = "settings-card feature-module-card";
  section.innerHTML = '<div class="settings-card-title"><span>功能模組</span><small>店家可自行開關流程模組</small></div><div id="featureModuleList" class="feature-module-list"></div>';
  settingsGrid.appendChild(section);
}

function getFeatureModuleSettings() {
  var defaults = { qr: true, kds: true, print: true, sticker: false, invoice: false, online: false, member: false };
  try {
    var saved = JSON.parse(localStorage.getItem("enpoint_feature_modules") || "{}");
    return Object.assign(defaults, saved || {});
  } catch (e) {
    return defaults;
  }
}

function isKdsEnabled() {
  var settings = getFeatureModuleSettings();
  return settings.kds !== false;
}

function getKitchenStatusForSubmission() {
  if (!isKdsEnabled() || STORE_MODE === "pro") return "not_required";
  return "confirmed";
}

function getOrderStatusForSubmission() {
  if (!isKdsEnabled() && STORE_MODE !== "pro") return "cooking";
  return STORE_MODE === "pro" ? "cooking" : "confirmed";
}

function getSentToKitchenAtForSubmission(now) {
  return getKitchenStatusForSubmission() === "confirmed" ? now : null;
}

function saveFeatureModuleSettings(settings) {
  try {
    localStorage.setItem("enpoint_feature_modules", JSON.stringify(settings || {}));
  } catch (e) {}
}

function renderFeatureModuleSettings() {
  ensureFeatureModuleSettings();
  var list = document.getElementById("featureModuleList");
  if (!list) return;
  var settings = getFeatureModuleSettings();
  var labels = { qr: "QR 點餐", kds: "使用廚房系統", print: "出單", sticker: "貼紙（預留）", invoice: "電子發票（預留）", online: "線上訂餐（預留）", member: "會員（預留）" };
  list.innerHTML = Object.keys(labels).map(function(key) {
    return '<label class="feature-module-row"><span>' + labels[key] + '</span><input type="checkbox" data-module="' + key + '" ' + (settings[key] === true ? "checked" : "") + ' /></label>';
  }).join("");
  var inputs = list.querySelectorAll("input[data-module]");
  for (var i = 0; i < inputs.length; i += 1) {
    inputs[i].onchange = function() {
      var next = getFeatureModuleSettings();
      next[this.getAttribute("data-module")] = this.checked === true;
      saveFeatureModuleSettings(next);
      renderAllOrders();
      renderStats();
    };
  }
}

function updateTableCount(value) {
  const tableCount = Math.min(99, Math.max(1, Math.floor(Number(value) || defaultSettings.tableCount)));
  posSettings.tableCount = tableCount;
  saveSetting("tableCount", tableCount);
  tables = buildTables(tableCount);

  if (!tables.includes(selectedTable)) {
    selectedTable = tables[0] || "1";
  }

  if (tableCountInput) tableCountInput.value = tableCount;
  renderTableButtons();
}

function isToday(timestamp) {
  if (!timestamp) return false;

  const date = new Date(timestamp);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getOrderBusinessDate(order) {
  return order.businessDate || "";
}

function isTodayOrder(order) {
  var businessDate = getOrderBusinessDate(order);
  if (businessDate === getBusinessDate()) return true;
  if (isToday(order.createdAt)) return true;
  if (!businessDate && isToday(order.updatedAt)) return true;
  return false;
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}

function getCategorySettings() {
  const settings = {};

  Object.entries(categoriesData || {}).forEach(([id, category]) => {
    const name = category.name || "未分類";

    settings[name] = {
      id,
      name,
      enabled: category.enabled !== false,
      sortOrder: Number(category.sortOrder !== undefined ? category.sortOrder : 999999999)
    };
  });

  return settings;
}

function getCategorySortOrder(categoryName) {
  const settings = getCategorySettings();

  if (settings[categoryName]) {
    return settings[categoryName].sortOrder;
  }

  if (categoryName === "其他" || categoryName === "未分類") {
    return 999999998;
  }

  return 999999997;
}

function isCategoryVisible(categoryName) {
  const settings = getCategorySettings();

  if (settings[categoryName]) {
    return settings[categoryName].enabled;
  }

  return true;
}

function sortMenuItems(items) {
  return [...items].sort((a, b) => {
    const categoryA = getItemCategory(a);
    const categoryB = getItemCategory(b);

    const categoryOrderA = getCategorySortOrder(categoryA);
    const categoryOrderB = getCategorySortOrder(categoryB);

    if (categoryOrderA !== categoryOrderB) {
      return categoryOrderA - categoryOrderB;
    }

    const itemOrderA = Number(a.sortOrder !== undefined ? a.sortOrder : 999999999);
    const itemOrderB = Number(b.sortOrder !== undefined ? b.sortOrder : 999999999);

    if (itemOrderA !== itemOrderB) {
      return itemOrderA - itemOrderB;
    }

    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function getEnabledItems() {
  return sortMenuItems(
    Object.entries(menuData)
      .map(([id, item]) => ({ id, ...item }))
      .filter(item => item.enabled !== false)
      .filter(item => isCategoryVisible(getItemCategory(item)))
  );
}

function getSaleStatus(item) {
  var status = item && (item.saleStatus || item.posStatus || item.status);
  if (status === "soldout" || status === "sold_out" || status === "todaySoldOut") return "soldout";
  if (status === "paused" || status === "pause" || status === "suspended") return "soldout";
  if (item && (item.soldOut === true || item.paused === true || item.isPaused === true)) return "soldout";
  return "normal";
}

function getSaleStatusText(item) {
  var status = getSaleStatus(item);
  if (status === "soldout") return "今日售完";
  return "正常販售";
}

function buildMenuSaleStatusPatch(action) {
  var isOffline = action === "offline";
  return {
    enabled: !isOffline,
    saleStatus: action === "soldout" ? "soldout" : "normal",
    soldOut: null,
    paused: null,
    isPaused: null,
    posStatus: null,
    status: null,
    updatedAt: Date.now()
  };
}

function canQrOrderItem(item) {
  return getSaleStatus(item) === "normal" && item.enabled !== false;
}

function canPosOrderItem(item) {
  return !!item && item.enabled !== false && getSaleStatus(item) === "normal";
}

function getItemCategory(item) {
  return item.category || "其他";
}

function getImageUrl(item) {
  return item.image || item.imageUrl || item.photo || item.photoUrl || "";
}

var MENU_IMAGE_PLACEHOLDER_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 29h38c0 13-8 22-19 22S13 42 13 29Z"/><path d="M10 27h44M20 54h24M25 23c-5-6 4-8 0-14M35 23c-5-6 4-8 0-14M45 23c-5-6 4-8 0-14"/></svg>';

function getBasePrice(item) {
  return Number(item.price || item.smallPrice || item.priceSmall || 0);
}

function getMenuItemByOrderItem(item) {
  if (!item) return null;

  const possibleId = item.itemId || item.id || item.menuId || item.productId;

  if (possibleId && menuData[possibleId]) {
    return { id: possibleId, ...menuData[possibleId] };
  }

  const found = Object.entries(menuData).find(([id, menuItem]) => {
    return menuItem.name === item.name;
  });

  if (found) {
    return { id: found[0], ...found[1] };
  }

  return item;
}

function getPortionOptions(item) {
  const options = [];

  if (item.sizes && typeof item.sizes === "object") {
    Object.entries(item.sizes).forEach(([name, price]) => {
      options.push({ name, price: Number(price) });
    });
  }

  if (item.smallPrice || item.priceSmall) {
    options.push({
      name: "小份",
      price: Number(item.smallPrice || item.priceSmall)
    });
  }

  if (item.largePrice || item.priceLarge) {
    options.push({
      name: "大份",
      price: Number(item.largePrice || item.priceLarge)
    });
  }

  if (options.length === 0) {
    options.push({
      name: item.size || "一般",
      price: Number(item.basePrice || item.price || item.unitPrice || 0)
    });
  }

  return options;
}

function getExtras(item) {
  if (!item) return [];

  if (item.options && typeof item.options === "object") {
    return Object.entries(item.options).map(([name, price]) => ({
      name,
      price: Number(price || 0)
    }));
  }

  if (Array.isArray(item.addons)) {
    return item.addons.map(addon => ({
      name: addon.name || addon.label || addon,
      price: Number(addon.price || 0)
    }));
  }

  if (Array.isArray(item.extras)) {
    return item.extras.map(extra => ({
      name: extra.name || extra.label || extra,
      price: Number(extra.price || 0)
    }));
  }

  return [];
}

function getRemoveOptions(item) {
  if (!item) return [];
  if (Array.isArray(item.removeOptions)) {
    return item.removeOptions.map(option => String(option || "").trim()).filter(Boolean);
  }
  if (Array.isArray(item.noOptions)) {
    return item.noOptions.map(option => String(option || "").trim()).filter(Boolean);
  }
  if (typeof item.removeOptions === "object") {
    return Object.keys(item.removeOptions || {}).map(option => String(option || "").trim()).filter(Boolean);
  }
  return [];
}

function itemRemoves(item) {
  return item.removes || item.removeOptionsSelected || item.noOptionsSelected || [];
}

function renderSpicyButtons(selectEl, boxId, value, enabled, callbackName) {
  var oldBox = document.getElementById(boxId);
  if (oldBox) oldBox.remove();

  if (!selectEl || !selectEl.parentNode) return;

  var values = ["不辣", "微辣", "小辣", "中辣", "大辣"];
  var box = document.createElement("div");
  box.id = boxId;
  box.className = "option-grid spicy-chip-grid";

  if (!enabled) {
    box.innerHTML = '<p class="muted">此餐點不需要辣度</p>';
    selectEl.parentNode.appendChild(box);
    return;
  }

  box.innerHTML = values.map(function(option) {
    return '<button type="button" class="option-btn ' + (value === option ? 'active' : '') + '" data-value="' + option + '">' + option + '</button>';
  }).join('');

  var buttons = box.querySelectorAll ? box.querySelectorAll("button") : [];
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].onclick = function() {
      if (callbackName === "selectEditSpicy") {
        selectEditSpicy(this.getAttribute("data-value"));
      } else {
        selectSpicy(this.getAttribute("data-value"));
      }
    };
  }

  selectEl.parentNode.appendChild(box);
}

function selectSpicy(value) {
  spicySelect.value = value;
  renderSpicyButtons(spicySelect, "spicyChipBox", spicySelect.value, !spicySelect.disabled, "selectSpicy");
}

function selectEditSpicy(value) {
  editItemSpicySelect.value = value;
  renderSpicyButtons(editItemSpicySelect, "editSpicyChipBox", editItemSpicySelect.value, !editItemSpicySelect.disabled, "selectEditSpicy");
}

function getRequiredOption(item) {
  if (!item || !item.requiredOption) return null;

  const requiredOption = item.requiredOption;

  if (!requiredOption.title) return null;
  if (!Array.isArray(requiredOption.options)) return null;
  if (requiredOption.options.length === 0) return null;

  return requiredOption;
}

function renderRequiredOptionBox() {
  const oldBox = document.getElementById("requiredOptionBox");
  if (oldBox) oldBox.remove();

  const requiredOption = getRequiredOption(currentItem);
  if (!requiredOption) return;

  selectedRequiredOption = "";

  const box = document.createElement("div");
  box.id = "requiredOptionBox";
  box.className = "required-option-select-box";

  box.innerHTML = `
    <h3>${requiredOption.title} <span>必選</span></h3>
    <div class="option-grid">
      ${requiredOption.options.map(option => `
        <button class="option-btn required-option-btn" type="button" data-value="${option}">
          ${option}
        </button>
      `).join("")}
    </div>
  `;

  const extrasSection = extrasBox.parentNode;
  customModal.querySelector(".modal-card").insertBefore(box, extrasSection);

  box.querySelectorAll(".required-option-btn").forEach(button => {
    button.addEventListener("click", () => {
      selectedRequiredOption = button.dataset.value;

      box.querySelectorAll(".required-option-btn").forEach(btn => {
        btn.classList.remove("active");
      });

      button.classList.add("active");
    });
  });
}

function renderItemDescriptionBox() {
  const oldBox = document.getElementById("itemDescriptionBox");
  if (oldBox) oldBox.remove();

  if (!currentItem || !currentItem.description) return;

  const box = document.createElement("div");
  box.id = "itemDescriptionBox";
  box.className = "item-description-box";
  box.textContent = currentItem.description;

  modalItemPrice.insertAdjacentElement("afterend", box);
}



function allowSpicy(item) {
  const category = getItemCategory(item);

  return (
    category.includes("鍋燒") ||
    category.includes("炒麵") ||
    category.includes("炒飯") ||
    category.includes("咖哩") ||
    category.includes("咖喱")
  );
}

function allowSatay(item) {
  const category = getItemCategory(item);

  return category.includes("鍋燒") || category.includes("炒麵");
}

function isCancelled(order) {
  return order.status === "cancelled" || order.kitchenStatus === "cancelled";
}

function isClosed(order) {
  return order.status === "closed";
}

function isDone(order) {
  return order.status === "done" || order.kitchenStatus === "done";
}

function isPaid(order) {
  return order.paymentStatus === "paid" || order.paid === true;
}

function isUnpaid(order) {
  if (!order) return false;
  if (isPaid(order) || isCancelled(order)) return false;
  return order.paymentStatus === "unpaid" || order.paid === false;
}

function canCompleteOrderInPos(order) {
  return (
    order &&
    !isBusinessDayClosed() &&
    !isKdsEnabled() &&
    isPaid(order) &&
    !isDone(order) &&
    !isClosed(order) &&
    !isCancelled(order)
  );
}

function getPaymentStatusText(order) {
  return isPaid(order) ? "已付款" : "未結帳";
}

PaymentStatusManager = {
  isPaid: isPaid,
  isUnpaid: isUnpaid,
  getText: getPaymentStatusText,
  buildFields: function(isPaidMode, paidAt) {
    return {
      paymentStatus: isPaidMode ? "paid" : "unpaid",
      paymentStatusText: isPaidMode ? "已付款" : "未結帳",
      paid: isPaidMode,
      paidAt: isPaidMode ? paidAt : null
    };
  }
};

function isTestOrder(order) {
  return order.isTestOrder === true || order.testOrder === true;
}

function isRevenueExcluded(order) {
  return isCancelled(order) || isTestOrder(order) || order.revenueExcluded === true;
}

function getOrderFlagHtml(order) {
  const flags = [];
  if (isUnpaid(order)) flags.push(`<span class="order-flag unpaid">\u{1F534} \u672a\u7d50\u5e33</span>`);
  if (isTestOrder(order)) flags.push(`<span class="order-flag test">測試單</span>`);
  if (isCancelled(order)) flags.push(`<span class="order-flag cancelled">已作廢</span>`);
  if (order.revenueExcluded === true && !isCancelled(order) && !isTestOrder(order)) flags.push(`<span class="order-flag excluded">不計營收</span>`);
  return flags.length ? `<div class="order-flags">${flags.join("")}</div>` : "";
}

function getOrderStatusText(order) {
  if (isCancelled(order)) return "已作廢 / 不計營收";
  if (isClosed(order)) return "已結案";
  if (isDone(order)) return "已完成，待結案";

  if (order.kitchenStatus === "cooking" || order.status === "cooking") {
    return "製作中";
  }

  if (STORE_MODE === "pro_plus") {
    if (order.kitchenStatus === "confirmed" || order.status === "confirmed") {
      return "已送廚房";
    }
  }

  if (isPaid(order)) {
    return STORE_MODE === "pro" ? "已付款，製作中" : "已確認付款";
  }

  return "待付款確認";
}

function getCustomerLabel(order) {
  if (order.customerLabel) return order.customerLabel;
  if (order.type === "內用" && order.table) return `${order.table}桌`;
  if (order.type === "外帶" && order.orderNumber) return `外帶-${order.orderNumber}`;
  return "未填寫";
}

function normalizeOrderItems(items) {
  return Array.isArray(items) ? items : [];
}

function itemQty(item) {
  if (Array.isArray(item && item.variants) && item.variants.length) {
    return calculateOrderItemPrice(item).quantity;
  }
  return Number(item.qty || item.quantity || 1);
}

function itemDisplayName(item) {
  return item && (item.displayName || item.itemName || item.name) || "未命名餐點";
}

function itemSizeLabel(item) {
  var list = item && item.customOptions;
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i += 1) {
      var option = list[i] || {};
      var groupId = String(option.groupId || "");
      var groupName = String(option.groupName || "").toLowerCase();
      if ((groupId === "__legacy_sizes" || groupName.indexOf("份量") !== -1 || groupName.indexOf("size") !== -1 || groupName.indexOf("大小") !== -1) && option.name) {
        return option.name;
      }
    }
  }
  return item && item.size || "";
}

function itemExtras(item) {
  return item.addons || item.extras || [];
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getStoreDisplayName() {
  return (posSettings && posSettings.storeName ? posSettings.storeName : "").trim() || "恩點 POS";
}

function getCustomerOrderUrl(order) {
  var id = order && (order.id || order.orderId);
  if (!id) return "";
  var basePath = window.location.pathname.replace(/\/pos\.html$/i, "/index.html");
  if (basePath === window.location.pathname) {
    basePath = window.location.pathname.replace(/pos\.html$/i, "index.html");
  }
  if (basePath === window.location.pathname) {
    basePath = "/index.html";
  }
  return window.location.origin + basePath + "?view=order&orderId=" + encodeURIComponent(id);
}

function getQrCodeUrl(order) {
  var url = getCustomerOrderUrl(order);
  return "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=" + encodeURIComponent(url);
}

function buildPrintItemDetailHtml(item, includePrice) {
  var details = formatOrderOptionLines(item, { moduleName: "print" });
  if (includePrice) details.push("單價：" + money(calculateOrderItemPrice(item).unitPrice));

  if (!details.length) return "";
  return '<div class="ticket-item-detail">' + details.map(function(detail) {
    return "<p>" + escapeHtml(detail) + "</p>";
  }).join("") + "</div>";
}

function buildKitchenTicketHtml(order) {
  var items = normalizeOrderItems(order.items);
  return '<section class="ticket ticket-kitchen">' +
    '<h1>廚房單</h1>' +
    '<div class="ticket-meta"><strong>#' + escapeHtml(order.orderNumber || order.id || "") + '</strong></div>' +
    '<div class="ticket-row"><span>類型</span><b>' + escapeHtml(order.type || "") + '</b></div>' +
    '<div class="ticket-row"><span>桌號</span><b>' + escapeHtml(order.table || (order.type === "外帶" ? "外帶" : "-")) + '</b></div>' +
    '<div class="ticket-row"><span>時間</span><b>' + escapeHtml(formatTime(order.createdAt || Date.now())) + '</b></div>' +
    '<div class="ticket-row ticket-payment ' + (isUnpaid(order) ? 'unpaid' : 'paid') + '"><span>付款狀態</span><b>' + escapeHtml(getPaymentStatusText(order)) + '</b></div>' +
    '<div class="ticket-row ticket-payment ' + (isUnpaid(order) ? 'unpaid' : 'paid') + '"><span>應收</span><b>' + money(order.total || calculateOrderTotal(items)) + '</b></div>' +
    '<hr>' +
    items.map(function(item) {
      return '<div class="ticket-item">' +
        '<div class="ticket-item-main"><strong>' + escapeHtml(itemDisplayName(item)) + '</strong><b>× ' + itemQty(item) + '</b></div>' +
        buildPrintItemDetailHtml(item, false) +
      '</div>';
    }).join("") +
    (order.note ? '<div class="ticket-note"><b>整單備註</b><p>' + escapeHtml(order.note) + '</p></div>' : "") +
    '</section>';
}

function buildCustomerTicketHtml(order) {
  var items = normalizeOrderItems(order.items);
  var qrUrl = getQrCodeUrl(order);
  var orderUrl = getCustomerOrderUrl(order);
  return '<section class="ticket ticket-customer">' +
    '<h1>' + escapeHtml(getStoreDisplayName()) + '</h1>' +
    '<div class="ticket-meta"><strong>#' + escapeHtml(order.orderNumber || order.id || "") + '</strong></div>' +
    '<div class="ticket-row"><span>時間</span><b>' + escapeHtml(formatTime(order.createdAt || Date.now())) + '</b></div>' +
    '<div class="ticket-row"><span>類型</span><b>' + escapeHtml(order.type || "") + (order.table ? "｜" + escapeHtml(order.table) + "桌" : "") + '</b></div>' +
    '<div class="ticket-row ticket-payment ' + (isUnpaid(order) ? 'unpaid' : 'paid') + '"><span>付款狀態</span><b>' + escapeHtml(getPaymentStatusText(order)) + '</b></div>' +
    '<div class="ticket-row ticket-payment ' + (isUnpaid(order) ? 'unpaid' : 'paid') + '"><span>應收</span><b>' + money(order.total || calculateOrderTotal(items)) + '</b></div>' +
    '<hr>' +
    items.map(function(item) {
      return '<div class="ticket-item">' +
        '<div class="ticket-item-main"><strong>' + escapeHtml(itemDisplayName(item)) + ' × ' + itemQty(item) + '</strong><b>' + money(calculateOrderItemPrice(item).subtotal) + '</b></div>' +
        buildPrintItemDetailHtml(item, true) +
      '</div>';
    }).join("") +
    '<div class="ticket-total"><span>總計</span><strong>' + money(order.total || calculateOrderTotal(items)) + '</strong></div>' +
    '<div class="ticket-qr"><img src="' + qrUrl + '" alt="訂單查詢 QR Code"><p>掃描查詢訂單進度</p><small>' + escapeHtml(orderUrl) + '</small></div>' +
    '</section>';
}

function buildPrintWindowHtml(title, bodyHtml) {
  var printSettings = arguments.length > 2 && arguments[2] ? arguments[2] : {};
  var width = String(printSettings.paperWidth || "58") === "80" ? "72mm" : "50mm";
  return '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + escapeHtml(title) + '</title>' +
    '<style>' +
    'body{font-family:Arial,"Noto Sans TC",sans-serif;margin:0;background:#f4f4f4;color:#111;}' +
    '.ticket{width:280px;margin:0 auto;padding:16px;background:#fff;}' +
    'h1{text-align:center;font-size:24px;margin:0 0 12px;}' +
    '.ticket-meta{text-align:center;font-size:22px;margin-bottom:12px;}' +
    '.ticket-row,.ticket-item-main,.ticket-total{display:flex;justify-content:space-between;gap:12px;margin:8px 0;}' +
    '.ticket-row span{color:#555;}.ticket-row b{text-align:right;}' +
    '.ticket-payment{padding:8px;border:1px solid #ddd;border-radius:6px;background:#f8f8f8;}' +
    '.ticket-payment.unpaid{border-color:#b42318;background:#fff1f2;color:#b42318;font-weight:800;}' +
    'hr{border:none;border-top:1px dashed #999;margin:12px 0;}' +
    '.ticket-item{padding:10px 0;border-bottom:1px dashed #ccc;}' +
    '.ticket-item-main strong{font-size:18px;}.ticket-item-main b{font-size:18px;white-space:nowrap;}' +
    '.ticket-item-detail p{margin:4px 0;font-size:14px;line-height:1.35;}' +
    '.ticket-note{margin-top:12px;padding:10px;border:1px solid #111;}.ticket-note p{margin:6px 0 0;}' +
    '.ticket-total{font-size:22px;font-weight:800;margin-top:14px;}' +
    '.ticket-qr{text-align:center;margin-top:14px;}.ticket-qr img{width:120px;height:120px;}.ticket-qr p{margin:6px 0;font-weight:700;}.ticket-qr small{display:block;word-break:break-all;font-size:10px;color:#555;}' +
    '@media print{body{background:#fff}.ticket{margin:0;width:' + width + ';box-shadow:none}.no-print{display:none}}' +
    '</style></head><body>' + bodyHtml +
    '</body></html>';
}

function openPrintPreview(title, html) {
  var printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) {
    alert("瀏覽器封鎖了列印預覽視窗，請允許彈出視窗後再試。");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(buildPrintWindowHtml(title, html));
  printWindow.document.close();
}

function printOrderTicket(type, orderId, event) {
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  var nowTime = Date.now ? Date.now() : new Date().getTime();
  var printKey = String(type || "") + ":" + String(orderId || "");
  if (lastPrintOrderKey === printKey && nowTime - lastPrintOrderAt < 1000) {
    return false;
  }
  lastPrintOrderKey = printKey;
  lastPrintOrderAt = nowTime;

  var order = ordersData && ordersData[orderId] ? Object.assign({ id: orderId }, ordersData[orderId]) : null;
  if (!order) {
    alert("找不到此訂單，請稍後再試。");
    return false;
  }

  void executeManualOrderPrint(type, order);
  return false;
}

// v63: LAN/Wi-Fi 出單機串接預留。未來可在這裡改接 WebUSB、WebSocket 或本機列印代理。
function sendOrderToPrinterDevice(type, order) {
  return false;
}

// v63-2 預留，不啟用：
// POS 確認付款送廚房後，未來可在該流程呼叫此函式，
// 依序同步廚房頁面並自動列印廚房單 / 客人單。目前手動補印按鈕維持唯一列印入口。
function queueAutoPrintAfterKitchenConfirm(order) {
  return false;
}

function canEditOrder(order) {
  if (isBusinessDayClosed()) return false;

  return (
    order &&
    !isCancelled(order) &&
    !isDone(order) &&
    !isClosed(order) &&
    !isPaid(order)
  );
}

function isBusinessDayClosed() {
  return businessDayCloseData && businessDayCloseData.closed === true;
}

function getTodayOrders() {
  return Object.entries(ordersData)
    .map(([id, order]) => ({ id, ...order }))
    .filter(order => isTodayOrder(order))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function getEffectiveTodayOrders() {
  return getTodayOrders().filter(order => !isRevenueExcluded(order));
}

function getPendingOrders() {
  return getTodayOrders().filter(order => {
    return !isCancelled(order) && !isClosed(order) && !isPaid(order);
  });
}

function getProcessingOrders() {
  return getTodayOrders().filter(order => {
    return !isCancelled(order) && !isClosed(order) && isPaid(order) && !isDone(order);
  });
}

function getDoneOrders() {
  return getTodayOrders().filter(order => {
    return !isCancelled(order) && (isDone(order) || isClosed(order));
  });
}

function getCancelledOrders() {
  return getTodayOrders().filter(order => isCancelled(order));
}

/* =========================
   v55 UI Helpers
========================= */

function renderStoreModeNotice() {
  const headerText = document.querySelector(".pos-header p");
  if (!headerText) return;

  if (STORE_MODE === "pro") {
    headerText.textContent = "專業版｜POS 自主管理・點餐・收銀・製作流程";
  } else {
    headerText.textContent = "專業 Plus 版｜店員收銀・點餐・確認付款・送廚房";
  }
}

function renderRealtimeBadges() {
  const todayTabBtn = document.querySelector('[data-tab="todayTab"]');
  if (!todayTabBtn) return;

  const pendingCount = getPendingOrders().length;
  const processingCount = getProcessingOrders().length;

  if (pendingCount > 0) {
    todayTabBtn.textContent = `今日訂單 🔴 ${pendingCount}`;
  } else if (processingCount > 0) {
    todayTabBtn.textContent = `今日訂單 (${processingCount})`;
  } else {
    todayTabBtn.textContent = "今日訂單";
  }
}

/* =========================
   Table / Type
========================= */

function renderTableButtons() {
  tableButtons.innerHTML = tables.map(table => `
    <button class="${selectedTable === table ? "active" : ""}" onclick="selectTable('${table}')">
      ${table}桌
    </button>
  `).join("");
}

function selectTable(table) {
  selectedTable = table;
  renderTableButtons();
}

function setPosOrderType(type) {
  currentOrderType = type === "內用" ? "內用" : "外帶";
  if (dineInBtn) {
    if (currentOrderType === "內用") dineInBtn.classList.add("active");
    else dineInBtn.classList.remove("active");
  }
  if (takeOutBtn) {
    if (currentOrderType === "外帶") takeOutBtn.classList.add("active");
    else takeOutBtn.classList.remove("active");
  }
  if (tableSelectBox) tableSelectBox.style.display = currentOrderType === "內用" ? "block" : "none";
  if (takeOutInfo) takeOutInfo.style.display = currentOrderType === "外帶" ? "block" : "none";
}

dineInBtn.addEventListener("click", () => {
  setPosOrderType("內用");
});

takeOutBtn.addEventListener("click", () => {
  setPosOrderType("外帶");
});

setPosOrderType(currentOrderType);

/* =========================
   Menu
========================= */

function renderCategories() {
  const items = getEnabledItems();
  const categorySet = new Set(items.map(item => getItemCategory(item)));

  const sortedCategories = [...categorySet].sort((a, b) => {
    const orderA = getCategorySortOrder(a);
    const orderB = getCategorySortOrder(b);

    if (orderA !== orderB) return orderA - orderB;

    return a.localeCompare(b, "zh-Hant");
  });

  const categories = ["全部", ...sortedCategories];

  categoryList.innerHTML = categories.map(category => `
    <button class="${currentCategory === category ? "active" : ""}" onclick="selectCategory('${category}')">
      ${category}
    </button>
  `).join("");

  if (!categories.includes(currentCategory)) {
    currentCategory = "全部";
  }
}

function selectCategory(category) {
  currentCategory = category;
  renderCategories();
  renderMenu();
}

if (categoryList) {
  addLegacyTapListener(categoryList, function(event) {
    var target = event && (event.target || event.srcElement);
    while (target && target !== categoryList) {
      if (target.tagName && String(target.tagName).toLowerCase() === "button") {
        var text = target.getAttribute("data-category") || target.textContent || "?券";
        if (event && event.preventDefault) event.preventDefault();
        selectCategory(String(text).replace(/^\s+|\s+$/g, ""));
        return false;
      }
      target = target.parentNode;
    }
    return true;
  });
}

// =====================================================
// 恩點系統 v58-3 前置修正
// 日期：2026-05-22
// 端別：POS 點餐端 pos.js
// 用途：「全部」改成依分類分區顯示
// =====================================================
function renderMenu() {
  let items = getEnabledItems();

  if (currentCategory !== "全部") {
    items = items.filter(item => getItemCategory(item) === currentCategory);
  }

  if (items.length === 0) {
    posMenuList.innerHTML = `<div class="empty">目前沒有餐點</div>`;
    return;
  }

  if (currentCategory === "全部") {
    const grouped = {};

    items.forEach(item => {
      const category = getItemCategory(item);

      if (!grouped[category]) {
        grouped[category] = [];
      }

      grouped[category].push(item);
    });

    posMenuList.innerHTML = Object.entries(grouped)
      .sort((a, b) => getCategorySortOrder(a[0]) - getCategorySortOrder(b[0]))
      .map(([category, categoryItems]) => `
        <section class="pos-category-section">
          <h3>${category}</h3>

          <div class="pos-category-grid">
            ${categoryItems.map(renderPosFoodButton).join("")}
          </div>
        </section>
      `).join("");

    bindPosLegacySelectButtons();
    return;
  }

  posMenuList.innerHTML = `
    <section class="pos-category-section">
      <h3>${currentCategory}</h3>

      <div class="pos-category-grid">
        ${items.map(renderPosFoodButton).join("")}
      </div>
    </section>
  `;
  bindPosLegacySelectButtons();
}

function escapeInlineValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

function renderPosFoodButtonV64(item) {
  return renderPosFoodButtonV649(item);
}

function bindPosLegacySelectButtons() {
  var buttons = document.querySelectorAll ? document.querySelectorAll('.pos-select-food-btn, .pos-food-real-btn') : [];

  function getPoint(event) {
    var e = event || window.event;
    if (e.touches && e.touches.length) return e.touches[0];
    if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0];
    return e;
  }

  function openFromElement(el, event) {
    var id = el && el.getAttribute ? el.getAttribute('data-id') : '';
    return window.posOpenFoodById(id, event);
  }

  for (var i = 0; i < buttons.length; i++) {
    (function(button) {
      button._posTouchX = 0;
      button._posTouchY = 0;
      button._posMoved = false;
      button._posTouchEndedAt = 0;

      button.ontouchstart = function(event) {
        var p = getPoint(event);
        button._posTouchX = Number(p.clientX || 0);
        button._posTouchY = Number(p.clientY || 0);
        button._posMoved = false;
        return true;
      };

      button.ontouchmove = function(event) {
        var p = getPoint(event);
        var dx = Math.abs(Number(p.clientX || 0) - button._posTouchX);
        var dy = Math.abs(Number(p.clientY || 0) - button._posTouchY);
        if (dx > 14 || dy > 14) {
          button._posMoved = true;
        }
        return true;
      };

      button.ontouchend = function(event) {
        if (button._posMoved) {
          button._posTouchEndedAt = Date.now ? Date.now() : new Date().getTime();
          return false;
        }

        var now = Date.now ? Date.now() : new Date().getTime();
        if (now - button._posTouchEndedAt < 900) {
          return false;
        }
        button._posTouchEndedAt = now;

        if (event && event.preventDefault) event.preventDefault();
        if (event && event.stopPropagation) event.stopPropagation();
        return openFromElement(button, event);
      };

      button.onclick = function(event) {
        var now = Date.now ? Date.now() : new Date().getTime();
        if (now - button._posTouchEndedAt < 900) {
          if (event && event.preventDefault) event.preventDefault();
          return false;
        }
        return openFromElement(button, event);
      };
    })(buttons[i]);
  }
}



function resetPosCustomModalScroll() {
  try {
    if (customModal) customModal.scrollTop = 0;
    var card = customModal ? customModal.querySelector(".modal-card") : null;
    if (card) card.scrollTop = 0;
    if (document && document.body) document.body.scrollTop = 0;
  } catch (e) {}
}


/* =========================
   v59-final-hotfix：modal 開啟時隱藏右側建立訂單固定按鈕，避免跑進餐點小視窗
========================= */
function addPosModalOpenClass() {
  var body = document.body;
  if (!body) return;
  var className = body.className || "";
  if ((" " + className + " " ).indexOf(" pos-modal-open ") === -1) {
    body.className = className ? className + " pos-modal-open" : "pos-modal-open";
  }
}

function removePosModalOpenClass() {
  var body = document.body;
  if (!body) return;
  body.className = (body.className || "").replace(/\bpos-modal-open\b/g, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

/* =========================
   Add Item Modal
========================= */

function openCustomModal(itemId) {
  const item = menuData[itemId];
  if (!item) return;

  currentItem = { id: itemId, ...item };
  currentQuantity = 1;
  window.posV64SelectedCustomOptions = [];
  selectedExtras = [];
  selectedRemoves = [];
  selectedSatay = "不要";
  selectedRequiredOption = "";

  selectedPortion = { name: "", price: getBasePrice(currentItem) };

  modalItemName.textContent = currentItem.name || "未命名餐點";
  modalItemPrice.textContent = `起價 ${money(getBasePrice(currentItem))}`;
  modalQuantity.textContent = "1";
  noteInput.value = "";

  renderItemDescriptionBox();
  portionBox.innerHTML = "";
  satayBox.innerHTML = "";
  extrasBox.innerHTML = "";
  if (spicySelect && spicySelect.parentNode) spicySelect.parentNode.style.display = "none";
  renderCustomOptionGroups();
  updateCustomModalPricePreview();

  customModal.classList.remove("hidden");
  customModal.className = (customModal.className || "").replace(/\bhidden\b/g, "");
  if ((" " + customModal.className + " ").indexOf(" show-force ") === -1) {
    customModal.className += " show-force";
  }
  customModal.style.display = "flex";
  addPosModalOpenClass();
  resetPosCustomModalScroll();
}


function closeCustomModal() {
  customModal.classList.add("hidden");
  customModal.className = (customModal.className || "") + " hidden";
  customModal.className = customModal.className.replace(/\bshow-force\b/g, "");
  customModal.style.display = "none";
  removePosModalOpenClass();

  currentItem = null;
  editingCartId = null;
  if (confirmCustomBtn) confirmCustomBtn.textContent = "加入訂單";
  currentQuantity = 1;
  selectedPortion = null;
  selectedExtras = [];
  selectedRemoves = [];
  selectedSatay = "不要";
  selectedRequiredOption = "";

  modalQuantity.textContent = "1";
  noteInput.value = "";
  extrasBox.innerHTML = "";
  portionBox.innerHTML = "";
  satayBox.innerHTML = "";

  const requiredOptionBox = document.getElementById("requiredOptionBox");
  if (requiredOptionBox) requiredOptionBox.remove();

  const itemDescriptionBox = document.getElementById("itemDescriptionBox");
  if (itemDescriptionBox) itemDescriptionBox.remove();

  const spicyChipBox = document.getElementById("spicyChipBox");
  if (spicyChipBox) spicyChipBox.remove();

  const removeOptionBox = document.getElementById("removeOptionBox");
  if (removeOptionBox) removeOptionBox.remove();

}

function hasDirtyCustomModalInput() {
  if (!currentItem) return false;
  if (editingCartId) return true;
  if (currentQuantity && currentQuantity !== 1) return true;
  if (selectedExtras && selectedExtras.length) return true;
  if (selectedRemoves && selectedRemoves.length) return true;
  if (selectedRequiredOption) return true;
  if (noteInput && noteInput.value && noteInput.value.trim()) return true;
  if ((window.posV64SelectedCustomOptions || []).length) return true;
  return false;
}

function requestCloseCustomModal(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  if (hasDirtyCustomModalInput() && !confirm("放棄本次新增餐點？")) return false;
  closeCustomModal();
  return false;
}

function renderPortionOptions() {
  const options = getPortionOptions(currentItem);

  portionBox.innerHTML = `
    <h3>份量</h3>
    <div class="option-grid">
      ${options.map(option => `
        <button class="option-btn ${(selectedPortion && selectedPortion.name) === option.name ? "active" : ""}"
          onclick="selectPortion('${option.name}', ${option.price})">
          ${option.name} ${money(option.price)}
        </button>
      `).join("")}
    </div>
  `;
}

function selectPortion(name, price) {
  selectedPortion = { name, price: Number(price) };
  renderPortionOptions();
}

function renderSatayOptions() {
  if (!allowSatay(currentItem)) {
    satayBox.innerHTML = "";
    return;
  }

  satayBox.innerHTML = `
    <h3>沙茶</h3>
    <div class="option-grid">
      <button class="option-btn ${selectedSatay === "要" ? "active" : ""}" onclick="selectSatay('要')">要沙茶</button>
      <button class="option-btn ${selectedSatay === "不要" ? "active" : ""}" onclick="selectSatay('不要')">不要沙茶</button>
    </div>
  `;
}

function selectSatay(value) {
  selectedSatay = value;
  renderSatayOptions();
}

function renderExtrasOptions() {
  const extras = getExtras(currentItem);

  if (extras.length === 0) {
    extrasBox.innerHTML = `<p class="muted">此餐點沒有加料選項</p>`;
    return;
  }

  extrasBox.innerHTML = `
    <div class="option-grid">
      ${extras.map(extra => {
        const active = selectedExtras.some(item => item.name === extra.name);

        return `
          <button class="option-btn ${active ? "active" : ""}"
            onclick="toggleExtra('${extra.name}', ${extra.price})">
            ${extra.name} +${extra.price}
          </button>
        `;
      }).join("")}
    </div>
  `;
}



function renderRemoveOptions() {
  const oldBox = document.getElementById("removeOptionBox");
  if (oldBox) oldBox.remove();

  const removes = getRemoveOptions(currentItem);
  if (!removes.length) return;

  const box = document.createElement("div");
  box.id = "removeOptionBox";
  box.className = "pos-remove-box";

  box.innerHTML = `
    <h3>不要項目</h3>
    <div class="option-grid">
      ${removes.map(name => {
        const active = selectedRemoves.includes(name);
        return `
          <button
            type="button"
            class="option-btn remove-option-btn ${active ? "active" : ""}"
            data-name="${String(name).replace(/"/g, "&quot;")}">
            ${name}
          </button>
        `;
      }).join("")}
    </div>
  `;

  const noteSection = noteInput.parentNode;
  const modalCard = customModal.querySelector(".modal-card");
  modalCard.insertBefore(box, noteSection);

  box.querySelectorAll(".remove-option-btn").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const name = button.getAttribute("data-name");

      if (selectedRemoves.includes(name)) {
        selectedRemoves = selectedRemoves.filter(item => item !== name);
      } else {
        selectedRemoves.push(name);
      }

      renderRemoveOptions();
    });
  });
}

function toggleRemoveOption(name) {
  if (selectedRemoves.indexOf(name) !== -1) {
    selectedRemoves = selectedRemoves.filter(function(item) { return item !== name; });
  } else {
    selectedRemoves.push(name);
  }
  renderRemoveOptions();
}

function toggleExtra(name, price) {
  const exists = selectedExtras.some(extra => extra.name === name);

  if (exists) {
    selectedExtras = selectedExtras.filter(extra => extra.name !== name);
  } else {
    selectedExtras.push({ name, price: Number(price) });
  }

  renderExtrasOptions();
}

function getAppliedCustomGroups(item, moduleName) {
  return getAppliedMenuOptionGroups({
    item: item,
    moduleName: moduleName,
    customGroupsData: customGroupsData,
    customOptionGroupsData: customOptionGroupsData,
    legacyBuilder: buildLegacyCustomGroups
  });
}

function normalizeLegacyNamePriceList(source) {
  var list = [];
  if (Array.isArray(source)) {
    for (var i = 0; i < source.length; i += 1) {
      var item = source[i];
      if (typeof item === "string") list.push({ name: item, price: 0 });
      else if (item) list.push({ name: item.name || item.label || item.value || "", price: Number(item.price || 0) });
    }
  } else if (source && typeof source === "object") {
    Object.keys(source).forEach(function(name) { list.push({ name: name, price: Number(source[name] || 0) }); });
  }
  return list.filter(function(item) { return item.name; });
}

function buildLegacyCustomGroups(item, moduleName) {
  var groups = [];
  if (!item) return groups;
  var base = getBasePrice(item);
  var sizeOptions = normalizeLegacyNamePriceList(item.sizes || item.sizeOptions);
  if (sizeOptions.length) {
    groups.push({ id: "__legacy_sizes", name: "份量", area: "customer", selectionType: "single", required: true, minSelect: 1, maxSelect: 1, options: sizeOptions.map(function(option, index) {
      return { id: "__legacy_size_" + index, name: option.name, price: Number(option.price || 0) - base, enabled: true, sortOrder: (index + 1) * 1000 };
    }) });
  }
  var requiredGroups = [];
  if (Array.isArray(item.requiredGroups)) requiredGroups = item.requiredGroups;
  else if (Array.isArray(item.requiredOptions)) requiredGroups = item.requiredOptions;
  else if (item.requiredOption) requiredGroups = [item.requiredOption];
  for (var r = 0; r < requiredGroups.length; r += 1) {
    var required = requiredGroups[r] || {};
    var requiredOptions = Array.isArray(required.options) ? required.options : [];
    if (required.title && requiredOptions.length) {
      groups.push({ id: "__legacy_required_" + r, name: required.title, area: "customer", selectionType: "single", required: true, minSelect: 1, maxSelect: 1, options: requiredOptions.map(function(name, index) {
        return { id: "__legacy_required_" + r + "_" + index, name: String(name || ""), price: 0, enabled: true, sortOrder: (index + 1) * 1000 };
      }) });
    }
  }
  var addons = normalizeLegacyNamePriceList(item.options || item.addons || item.extras);
  if (addons.length) groups.push({ id: "__legacy_addons", name: "加料", area: "customer", selectionType: "multiple", required: false, options: addons });
  var removes = item.removeOptions || item.noOptions || item.excludedOptions || [];
  if (removes && !Array.isArray(removes) && typeof removes === "object") removes = Object.keys(removes);
  if (Array.isArray(removes) && removes.length) {
    groups.push({ id: "__legacy_removes", name: "不要項目", area: "customer", selectionType: "multiple", required: false, options: removes.map(function(name, index) {
      return { id: "__legacy_remove_" + index, name: String(name || ""), price: 0, enabled: true, sortOrder: (index + 1) * 1000 };
    }) });
  }
  if (allowSpicy(item)) groups.push({ id: "__legacy_spicy", name: "辣度", area: "customer", selectionType: "single", required: false, options: POS_LEGACY_SPICY_OPTIONS.map(function(name, index) { return { id: "__legacy_spicy_" + index, name: name, price: 0, enabled: true, sortOrder: (index + 1) * 1000 }; }) });
  if (allowSatay(item)) groups.push({ id: "__legacy_satay", name: "沙茶", area: "customer", selectionType: "single", required: false, options: ["要沙茶", "不要沙茶"].map(function(name, index) { return { id: "__legacy_satay_" + index, name: name, price: 0, enabled: true, sortOrder: (index + 1) * 1000 }; }) });
  if (moduleName === "qr") return groups.filter(function(group) { return group.area !== "posOnly"; });
  return groups;
}

function updateCustomModalPricePreview() {
  if (!modalItemPrice || !currentItem) return;
  var priced = calculateOrderItemPrice({
    basePrice: Number(getBasePrice(currentItem) || 0),
    customOptions: window.posV64SelectedCustomOptions || [],
    quantity: currentQuantity
  });
  modalItemPrice.textContent = "小計 " + money(priced.subtotal);
}

function isSizeOptionGroup(group) {
  var id = String(group && group.id || "");
  var name = String(group && group.name || "").toLowerCase();
  return id === "__legacy_sizes" || name.indexOf("份量") !== -1 || name.indexOf("size") !== -1 || name.indexOf("大小") !== -1;
}

function normalizeOptionPriceForGroup(group, option, menuItem) {
  var rawPrice = Number(option && option.price || 0);
  if (!isSizeOptionGroup(group) || String(group && group.id || "") === "__legacy_sizes") return rawPrice;

  var basePrice = Number(getBasePrice(menuItem || currentItem) || 0);
  if (basePrice > 0 && rawPrice >= basePrice) return rawPrice - basePrice;
  return rawPrice;
}

function renderCustomOptionGroups() {
  var oldBox = document.getElementById("posCustomOptionGroupsBox");
  if (oldBox && oldBox.parentNode) oldBox.parentNode.removeChild(oldBox);
  if (!currentItem || !customModal) return;
  var groups = getAppliedCustomGroups(currentItem, "pos");
  if (!groups.length) return;
  var box = document.createElement("div");
  box.id = "posCustomOptionGroupsBox";
  box.className = "v64-custom-groups";
  var html = "";
  for (var g = 0; g < groups.length; g += 1) {
    var group = groups[g];
    html += '<div class="v64-custom-group" data-group-id="' + escapeHtml(group.id) + '">';
    html += '<h3>' + escapeHtml(group.name) + '</h3><div class="option-grid">';
    var options = group.options || [];
    for (var o = 0; o < options.length; o += 1) {
      var option = typeof options[o] === "string" ? { name: options[o] } : options[o];
      var optionName = option.name || option.label || option.value || "";
      var selected = findSelectedCustomOption(group.id, optionName);
      var optionPrice = normalizeOptionPriceForGroup(group, option, currentItem);
      var priceText = Number(option.price || 0) > 0 ? " +" + Number(option.price || 0) : (Number(option.price || 0) < 0 ? " " + Number(option.price || 0) : "");
      var modules = group.modules || {};
      html += '<button type="button" class="option-btn v64-custom-option-btn ' + (selected ? "active" : "") + '" data-group-id="' + escapeHtml(group.id) + '" data-group-name="' + escapeHtml(group.name) + '" data-selection-type="' + escapeHtml(group.selectionType || "single") + '" data-option-name="' + escapeHtml(optionName) + '" data-option-price="' + optionPrice + '" data-qty-enabled="' + (group.allowQuantity || option.qtyEnabled || option.quantityEnabled || option.allowQuantity ? "true" : "false") + '" data-max-qty="' + Number(option.maxQty || option.maxQuantity || 1) + '" data-module-qr="' + (modules.qr === true ? "true" : "false") + '" data-module-pos="' + (modules.pos !== false ? "true" : "false") + '" data-module-kds="' + (modules.kds !== false ? "true" : "false") + '" data-module-print="' + (modules.print !== false ? "true" : "false") + '">';
      html += escapeHtml(optionName) + priceText;
      if (selected && Number(selected.qty || 1) > 1) html += " x" + Number(selected.qty || 1);
      html += '</button>';
    }
    html += '</div></div>';
  }
  box.innerHTML = html;
  var noteSection = noteInput ? noteInput.parentNode : null;
  var modalCard = customModal.querySelector(".modal-card");
  if (modalCard && noteSection) modalCard.insertBefore(box, noteSection);
  var buttons = box.querySelectorAll(".v64-custom-option-btn");
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].onclick = function() {
      toggleCustomOption(this);
    };
  }
}

function buildSelectedCustomOption(group, option, quantity, menuItem) {
  var modules = group.modules || {};
  return {
    groupId: group.id,
    groupName: group.name,
    name: option.name || option.label || option.value || "",
    price: normalizeOptionPriceForGroup(group, option, menuItem),
    qty: Math.max(1, Number(quantity || 1)),
    selectionType: group.selectionType || group.choiceType || "single",
    qtyEnabled: group.allowQuantity === true || option.qtyEnabled === true || option.quantityEnabled === true || option.allowQuantity === true,
    maxQty: Number(option.maxQty || option.maxQuantity || 1),
    modules: {
      qr: modules.qr === true,
      pos: modules.pos !== false,
      kds: modules.kds !== false,
      print: modules.print !== false
    }
  };
}

function findGroupOption(group, matcher) {
  var options = group && group.options ? group.options : [];
  for (var i = 0; i < options.length; i += 1) {
    var option = typeof options[i] === "string" ? { name: options[i] } : (options[i] || {});
    if (matcher(option)) return option;
  }
  return null;
}

function selectedOptionExists(list, groupId, name) {
  for (var i = 0; i < list.length; i += 1) {
    if (String(list[i].groupId) === String(groupId) && String(list[i].name) === String(name)) return true;
  }
  return false;
}

function buildCustomOptionsFromOrderItem(cartItem, menuItem) {
  var selected = Array.isArray(cartItem && cartItem.customOptions)
    ? cartItem.customOptions.map(function(option) { return Object.assign({}, option); })
    : [];
  var groups = getAppliedCustomGroups(menuItem, "pos");
  var extras = itemExtras(cartItem);
  var removes = itemRemoves(cartItem);

  function pushMatched(group, option, quantity) {
    if (!group || !option) return;
    var name = option.name || option.label || option.value || "";
    if (!name || selectedOptionExists(selected, group.id, name)) return;
    selected.push(buildSelectedCustomOption(group, option, quantity, menuItem));
  }

  for (var i = 0; i < groups.length; i += 1) {
    var group = groups[i] || {};

    if (isSizeOptionGroup(group) && cartItem.size) {
      pushMatched(group, findGroupOption(group, function(option) {
        return String(option.name || "") === String(cartItem.size || "");
      }), 1);
    }

    if (group.id === "__legacy_addons") {
      for (var e = 0; e < extras.length; e += 1) {
        (function(extra) {
          pushMatched(group, findGroupOption(group, function(option) {
            return String(option.name || "") === String(extra.name || extra.label || extra || "");
          }), extra.qty || extra.quantity || 1);
        })(extras[e] || {});
      }
    }

    if (group.id === "__legacy_removes") {
      for (var r = 0; r < removes.length; r += 1) {
        (function(removeName) {
          pushMatched(group, findGroupOption(group, function(option) {
            return String(option.name || "") === String(removeName || "");
          }), 1);
        })(removes[r]);
      }
    }

    if (group.id === "__legacy_spicy" && cartItem.spicy) {
      pushMatched(group, findGroupOption(group, function(option) {
        return String(option.name || "") === String(cartItem.spicy || "");
      }), 1);
    }

    if (group.id === "__legacy_satay" && cartItem.satay) {
      pushMatched(group, findGroupOption(group, function(option) {
        var name = String(option.name || "");
        var satay = String(cartItem.satay || "");
        return name === satay || name.indexOf(satay) !== -1 || satay.indexOf(name) !== -1;
      }), 1);
    }

    if (String(group.id || "").indexOf("__legacy_required_") === 0 && cartItem.requiredOption && cartItem.requiredOption.value) {
      pushMatched(group, findGroupOption(group, function(option) {
        return String(option.name || "") === String(cartItem.requiredOption.value || "");
      }), 1);
    }
  }

  for (var s = 0; s < selected.length; s += 1) {
    for (var g = 0; g < groups.length; g += 1) {
      if (String(groups[g].id) !== String(selected[s].groupId)) continue;
      if (!isSizeOptionGroup(groups[g])) continue;
      var matchedOption = findGroupOption(groups[g], function(option) {
        return String(option.name || "") === String(selected[s].name || "");
      });
      if (matchedOption) {
        selected[s].groupName = selected[s].groupName || groups[g].name;
        selected[s].price = normalizeOptionPriceForGroup(groups[g], matchedOption, menuItem);
      }
    }
  }

  return selected;
}

function deriveLegacyFieldsFromCustomOptions(customOptions) {
  var fields = {
    size: "",
    addons: [],
    extras: [],
    removes: [],
    removeOptionsSelected: [],
    spicy: "",
    satay: "",
    requiredOption: null
  };
  var list = Array.isArray(customOptions) ? customOptions : [];

  for (var i = 0; i < list.length; i += 1) {
    var option = list[i] || {};
    var groupId = String(option.groupId || "");
    var groupName = option.groupName || "";
    var name = option.name || "";
    var row = { name: name, price: Number(option.price || 0), qty: Number(option.qty || 1) };

    if (groupId === "__legacy_sizes" || isSizeOptionGroup({ id: groupId, name: groupName })) fields.size = name;
    else if (groupId === "__legacy_addons") fields.addons.push(row);
    else if (groupId === "__legacy_removes") fields.removes.push(name);
    else if (groupId === "__legacy_spicy") fields.spicy = name;
    else if (groupId === "__legacy_satay") fields.satay = name;
    else if (groupId.indexOf("__legacy_required_") === 0) fields.requiredOption = { title: groupName || "選項", value: name };
  }

  fields.extras = fields.addons.slice();
  fields.removeOptionsSelected = fields.removes.slice();
  return fields;
}

function findSelectedCustomOption(groupId, optionName) {
  var selected = window.posV64SelectedCustomOptions || [];
  for (var i = 0; i < selected.length; i += 1) {
    if (String(selected[i].groupId) === String(groupId) && String(selected[i].name) === String(optionName)) return selected[i];
  }
  return null;
}

function toggleCustomOption(button) {
  var list = window.posV64SelectedCustomOptions || [];
  var groupId = button.getAttribute("data-group-id");
  var groupName = button.getAttribute("data-group-name");
  var name = button.getAttribute("data-option-name");
  var price = Number(button.getAttribute("data-option-price") || 0);
  var qtyEnabled = button.getAttribute("data-qty-enabled") === "true";
  var maxQty = Math.max(1, Number(button.getAttribute("data-max-qty") || 1));
  var selectionType = button.getAttribute("data-selection-type") || "single";
  var foundIndex = -1;
  for (var i = 0; i < list.length; i += 1) {
    if (String(list[i].groupId) === String(groupId) && String(list[i].name) === String(name)) foundIndex = i;
  }
  if (foundIndex >= 0) {
    if (qtyEnabled && Number(list[foundIndex].qty || 1) < maxQty) {
      list[foundIndex].qty = Number(list[foundIndex].qty || 1) + 1;
    } else {
      list.splice(foundIndex, 1);
    }
  } else {
    if (selectionType === "single") {
      list = list.filter(function(item) { return String(item.groupId) !== String(groupId); });
    }
    list.push({
      groupId: groupId,
      groupName: groupName,
      name: name,
      price: price,
      qty: 1,
      selectionType: selectionType,
      qtyEnabled: qtyEnabled,
      maxQty: maxQty,
      modules: {
        qr: button.getAttribute("data-module-qr") === "true",
        pos: button.getAttribute("data-module-pos") !== "false",
        kds: button.getAttribute("data-module-kds") !== "false",
        print: button.getAttribute("data-module-print") !== "false"
      }
    });
  }
  window.posV64SelectedCustomOptions = list;
  renderCustomOptionGroups();
  updateCustomModalPricePreview();
}

function validatePosRequiredCustomGroups(item) {
  var groups = getAppliedCustomGroups(item, "pos");
  var selected = window.posV64SelectedCustomOptions || [];
  for (var i = 0; i < groups.length; i += 1) {
    var group = groups[i] || {};
    if (group.required !== true && Number(group.minSelect || 0) <= 0) continue;
    var count = 0;
    for (var j = 0; j < selected.length; j += 1) {
      if (String(selected[j].groupId) === String(group.id)) count += 1;
    }
    if (count < Math.max(1, Number(group.minSelect || 1))) return group.name || "必選項目";
  }
  return "";
}

addLegacyTapListener(modalMinusBtn, function(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  currentQuantity = Math.max(1, currentQuantity - 1);
  modalQuantity.textContent = currentQuantity;
  renderCustomOptionGroups();
  updateCustomModalPricePreview();
});

addLegacyTapListener(modalPlusBtn, function(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  currentQuantity += 1;
  modalQuantity.textContent = currentQuantity;
  renderCustomOptionGroups();
  updateCustomModalPricePreview();
});

cancelCustomBtn.addEventListener("click", requestCloseCustomModal);
cancelCustomBtn.addEventListener("touchend", requestCloseCustomModal, false);
if (closeCustomModalBtn) {
  closeCustomModalBtn.addEventListener("click", requestCloseCustomModal, false);
  closeCustomModalBtn.addEventListener("touchend", requestCloseCustomModal, false);
}

customModal.addEventListener("click", event => {
  if (event.target === customModal) requestCloseCustomModal(event);
});

confirmCustomBtn.addEventListener("click", () => {
  if (!currentItem || !selectedPortion) return;

  const latestMenuItem = menuData[currentItem.id];
  if (!canPosOrderItem(latestMenuItem)) {
    showMenuStatusError("此餐點剛剛已售完");
    return;
  }
  
  const missingCustomGroup = validatePosRequiredCustomGroups(currentItem);

  if (missingCustomGroup) {
    alert(`請先選擇「${missingCustomGroup}」`);
    return;
  }
  
  const selectedCustomOptions = (window.posV64SelectedCustomOptions || []).map(function(option) {
    return Object.assign({}, option);
  });
  const legacyFields = deriveLegacyFieldsFromCustomOptions(selectedCustomOptions);
  const basePrice = Number(getBasePrice(currentItem) || 0);

  const nextCartItem = {
    cartId: editingCartId || (Date.now().toString() + Math.random().toString(36).slice(2)),
    id: currentItem.id,
    itemId: currentItem.id,
    name: currentItem.name,
    itemName: currentItem.name,
    category: getItemCategory(currentItem),
    size: legacyFields.size,
    basePrice,
    quantity: currentQuantity,
    qty: currentQuantity,
    spicy: legacyFields.spicy,
    satay: legacyFields.satay,
    requiredOption: legacyFields.requiredOption,
    extras: legacyFields.extras,
    addons: legacyFields.addons,
    customOptions: selectedCustomOptions,
    removes: legacyFields.removes,
    removeOptionsSelected: legacyFields.removeOptionsSelected,
    note: noteInput ? noteInput.value.trim() : ""
  };

  if (editingCartId) {
    const editIndex = cart.findIndex(item => String(item.cartId) === String(editingCartId));
    if (editIndex >= 0) {
      cart.splice(editIndex, 1, nextCartItem);
    } else {
      cart.push(nextCartItem);
    }
    editingCartId = null;
    confirmCustomBtn.textContent = "加入訂單";
  } else {
    cart.push(nextCartItem);
  }

  renderCart();
  closeCustomModal();
  if (posSettings.autoSwitchCartAfterAdd) {
    switchOrderSubtab("cart");
  }
});

/* =========================
   Cart
========================= */

function renderCartV64() {
  if (cart.length === 0) {
    cartList.innerHTML = `<div class="empty">尚未加入餐點</div>`;
    totalAmount.textContent = "$0";
    return;
  }

  cartList.innerHTML = cart.map((item, index) => {
    return `
      <div class="cart-item" data-cart-id="${item.cartId}">
        <button class="swipe-delete-action" type="button" onclick="removeFromCart('${item.cartId}')">刪除</button>
        <div class="cart-item-inner">
          <div>
            <strong>${escapeHtml(itemDisplayName(item))} × ${itemQty(item)}</strong>

            <div class="cart-detail">
              ${formatOrderOptionHtml(item, escapeHtml, { moduleName: "pos" })}
              <p>小計：${money(calculateOrderItemPrice(item).subtotal)}</p>
            </div>
          </div>

          <div class="cart-item-actions">
            <button class="secondary-btn" type="button" onclick="openCartItemEditModal(${index})">修改</button>
            <button class="danger-btn" type="button" onclick="removeFromCart('${item.cartId}')">刪除</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  totalAmount.textContent = money(calculateOrderTotal(cart));
  bindCartCardActions();
}

function removeFromCart(cartId) {
  const item = cart.find(item => String(item.cartId) === String(cartId));
  if (item && !confirm(`確定刪除「${itemDisplayName(item)}」？`)) return;
  cart = cart.filter(item => item.cartId !== cartId);
  renderCart();
}

function bindCartCardActions() {
  if (!cartList) return;

  function isButtonTarget(target, root) {
    while (target && target !== root) {
      if (target.tagName && String(target.tagName).toLowerCase() === "button") return true;
      target = target.parentNode;
    }
    return false;
  }

  function closeSwipeCards(exceptCard) {
    var openCards = cartList.querySelectorAll(".cart-item.swipe-open, .cart-item.swipe-delete-ready");
    for (var i = 0; i < openCards.length; i += 1) {
      if (openCards[i] === exceptCard) continue;
      openCards[i].classList.remove("swipe-open");
      openCards[i].classList.remove("swipe-delete-ready");
    }
  }

  if (cartList.dataset.boundSwipeClose !== "true") {
    cartList.dataset.boundSwipeClose = "true";
    document.addEventListener("click", function(event) {
      var target = event.target;
      if (!target || !cartList.contains(target)) closeSwipeCards(null);
    });
  }

  const cards = cartList.querySelectorAll(".cart-item");
  cards.forEach((card, index) => {
    if (card.dataset.boundCartUx === "true") return;
    card.dataset.boundCartUx = "true";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    let startX = 0;
    let startY = 0;
    let moved = false;

    card.addEventListener("click", event => {
      if (isButtonTarget(event.target, card)) return;
      if (card.classList.contains("swipe-open") || card.classList.contains("swipe-delete-ready")) {
        card.classList.remove("swipe-open");
        card.classList.remove("swipe-delete-ready");
        return;
      }
      closeSwipeCards(card);
      openCartItemEditModal(index);
    });

    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCartItemEditModal(index);
      }
    });

    card.addEventListener("touchstart", event => {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      startX = touch.clientX || 0;
      startY = touch.clientY || 0;
      moved = false;
      closeSwipeCards(card);
    }, { passive: true });

    card.addEventListener("touchmove", event => {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const dx = (touch.clientX || 0) - startX;
      const dy = Math.abs((touch.clientY || 0) - startY);
      if (dx < -58 && dy < 44) {
        moved = true;
        card.classList.add("swipe-open");
        card.classList.add("swipe-delete-ready");
      } else if (dx > 28 && dy < 44) {
        moved = true;
        card.classList.remove("swipe-open");
        card.classList.remove("swipe-delete-ready");
      }
    }, { passive: true });

    card.addEventListener("touchend", event => {
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
    });
  });
}

function openCartItemEditModal(index) {
  const cartItem = cart[Number(index)];
  if (!cartItem) return;

  const menuItem = getMenuItemByOrderItem(cartItem);
  if (!menuItem) {
    alert("找不到原始餐點資料，無法修改");
    return;
  }

  editingCartId = cartItem.cartId;
  openCustomModal(menuItem.id || cartItem.itemId || cartItem.id);

  currentQuantity = itemQty(cartItem);
  modalQuantity.textContent = currentQuantity;
  selectedExtras = itemExtras(cartItem).map(extra => ({ name: extra.name, price: Number(extra.price || 0) }));
  selectedRemoves = itemRemoves(cartItem).slice();
  selectedSatay = cartItem.satay || "不要";
  selectedRequiredOption = cartItem.requiredOption ? cartItem.requiredOption.value : "";
  window.posV64SelectedCustomOptions = buildCustomOptionsFromOrderItem(cartItem, currentItem);
  noteInput.value = cartItem.note || "";

  const portions = getPortionOptions(currentItem);
  const matchedPortion = portions.find(option => option.name === cartItem.size);
  selectedPortion = matchedPortion || { name: cartItem.size || "一般", price: Number(cartItem.basePrice || cartItem.unitPrice || cartItem.price || 0) };

  if (allowSpicy(currentItem)) {
    spicySelect.value = cartItem.spicy || "不辣";
  }

  portionBox.innerHTML = "";
  satayBox.innerHTML = "";
  extrasBox.innerHTML = "";
  if (spicySelect && spicySelect.parentNode) spicySelect.parentNode.style.display = "none";
  renderCustomOptionGroups();
  updateCustomModalPricePreview();

  if (confirmCustomBtn) confirmCustomBtn.textContent = "更新餐點";
}

function clearCart() {
  cart = [];
  if (posOrderNoteInput) posOrderNoteInput.value = "";
  renderCart();
}

/* =========================
   Submit POS Order
========================= */

async function submitOrder() {
  return checkoutOrder(false);
}

async function submitUnpaidOrder() {
  return sendUnpaidOrder();
}

async function submitTestOrder() {
  return checkoutOrder(true);
}

function getCartSubmissionSummary() {
  var total = calculateOrderTotal(cart);
  var orderNote = posOrderNoteInput ? posOrderNoteInput.value.trim() : "";
  var itemsText = cart.map(function(item, index) {
    var detail = formatOrderOptionLines(item, { moduleName: "pos" }).join("｜");
    return (index + 1) + ". " + itemDisplayName(item) + " × " + itemQty(item) + "｜小計 " + money(calculateOrderItemPrice(item).subtotal) + (detail ? "\n   " + detail : "");
  }).join("\n\n");

  return {
    total: total,
    orderNote: orderNote,
    itemsText: itemsText
  };
}

function buildCheckoutConfirmText(summary, isTestMode) {
  return (isTestMode ? "【測試訂單】\n此單會送到廚房、可完整跑流程，但不會計入營收與收班。\n\n" : "") +
    "確認結帳並送出？\n\n" +
    "類型：" + currentOrderType + (currentOrderType === "內用" ? "｜" + selectedTable + "桌" : "｜外帶") + "\n\n" +
    "餐點：\n" + summary.itemsText + "\n\n" +
    "總計：" + money(summary.total) + "\n\n" +
    "確認已收款後，按「確定」會直接送廚房。";
}

function buildUnpaidConfirmText(summary) {
  return "確認送出未結帳訂單？\n\n" +
    "此訂單將直接送至廚房，\n" +
    "付款狀態將維持：\n" +
    "【未付款】\n\n" +
    "可稍後再至今日訂單完成收款。\n\n" +
    "類型：" + currentOrderType + (currentOrderType === "內用" ? "｜" + selectedTable + "桌" : "｜外帶") + "\n\n" +
    "餐點：\n" + summary.itemsText + "\n\n" +
    "總計：" + money(summary.total);
}

function canStartPosSubmission(isTestMode, paymentMode) {
  if (submittingPosOrder) return;
  if (!isTestMode && submitOrderBtn && submitOrderBtn.disabled) return;
  if (!isTestMode && paymentMode === "unpaid" && submitUnpaidOrderBtn && submitUnpaidOrderBtn.disabled) return;
  if (isTestMode && (!posSettings.showTestOrders || (submitTestOrderBtn && submitTestOrderBtn.disabled))) return;
  if (cart.length === 0) {
    alert("請先加入餐點");
    return;
  }

  if (isBusinessDayClosed()) {
    alert("今日已收班，不能再建立新的今日訂單。請明日營業日再開始點餐。");
    return;
  }

  return true;
}

async function checkoutOrder(isTestMode) {
  if (!canStartPosSubmission(isTestMode, "paid")) return;
  var summary = getCartSubmissionSummary();
  var ok = confirm(buildCheckoutConfirmText(summary, isTestMode));
  if (!ok) return;

  return submitOrderCore({
    isTestMode: isTestMode,
    paymentMode: "paid",
    summary: summary,
    loadingText: isTestMode ? "測試送出中..." : "送出中...",
    successText: isTestMode ? "測試訂單已送出" : "結帳完成，已送出",
    errorLogText: isTestMode ? "測試訂單送出失敗：" : "結帳送出失敗：",
    errorAlertText: isTestMode ? "測試訂單送出失敗\n請稍後再試。" : "結帳送出失敗\n請稍後再試。"
  });
}

async function sendUnpaidOrder() {
  if (!canStartPosSubmission(false, "unpaid")) return;
  var summary = getCartSubmissionSummary();
  var ok = confirm(buildUnpaidConfirmText(summary));
  if (!ok) return;

  return submitOrderCore({
    isTestMode: false,
    paymentMode: "unpaid",
    summary: summary,
    loadingText: "未結帳送單中...",
    successText: "未結帳訂單已送出",
    errorLogText: "未結帳訂單送出失敗：",
    errorAlertText: "未結帳訂單送出失敗\n請稍後再試。"
  });
}

function setPosSubmissionUi(options, active) {
  var isTestMode = options.isTestMode === true;
  var paymentMode = options.paymentMode || "paid";
  if (active) {
    submittingPosOrder = true;
    if (isTestMode) {
      if (submitTestOrderBtn) submitTestOrderBtn.disabled = true;
    } else {
      if (submitOrderBtn) submitOrderBtn.disabled = true;
      if (submitUnpaidOrderBtn) submitUnpaidOrderBtn.disabled = true;
    }
    if (!isTestMode && paymentMode === "paid" && submitOrderBtn) submitOrderBtn.textContent = options.loadingText || "送出中...";
    if (!isTestMode && paymentMode === "unpaid" && submitUnpaidOrderBtn) submitUnpaidOrderBtn.textContent = options.loadingText || "未結帳送單中...";
    if (isTestMode && submitTestOrderBtn) submitTestOrderBtn.textContent = options.loadingText || "測試送出中...";
    return;
  }

  submittingPosOrder = false;
  if (submitOrderBtn) submitOrderBtn.disabled = false;
  if (submitUnpaidOrderBtn) submitUnpaidOrderBtn.disabled = false;
  if (submitTestOrderBtn) submitTestOrderBtn.disabled = posSettings.showTestOrders !== true;
  if (submitOrderBtn) submitOrderBtn.textContent = "結帳並送單";
  if (submitUnpaidOrderBtn) submitUnpaidOrderBtn.textContent = "未結帳送單";
  if (submitTestOrderBtn) submitTestOrderBtn.textContent = "測試訂單";
  applyShowTestOrdersSetting();
}

async function submitOrderCore(options) {
  var isTestMode = options.isTestMode === true;
  var isUnpaidMode = options.paymentMode === "unpaid" && !isTestMode;
  var isPaidMode = !isUnpaidMode;
  var summary = options.summary || getCartSubmissionSummary();

  setPosSubmissionUi(options, true);

  try {
    const newOrderRef = push(ordersRef);
    const now = Date.now();
    const businessDate = getBusinessDate();
    const orderNumber = await createOrderNumber("pos", { storeId: STORE_ID, businessDate });
    const paymentFields = PaymentStatusManager.buildFields(isPaidMode, now);

    const customerLabel =
      currentOrderType === "內用"
        ? `${selectedTable}桌`
        : `外帶-${orderNumber}`;

    const order = {
      id: newOrderRef.key,
      orderNumber,
      businessDate,
      businessDay: businessDate,
      storeId: STORE_ID,
      storeName: getStoreDisplayName(),
      storeMode: STORE_MODE,
      orderSource: "POS",
      sourcePrefix: "P",
      deviceType: "pos",
      source: isTestMode ? "店員POS測試" : "店員POS",
      type: currentOrderType,
      table: currentOrderType === "內用" ? selectedTable : "",
      customerName: currentOrderType === "外帶" ? `外帶-${orderNumber}` : "",
      customerLabel: isTestMode ? `測試單-${customerLabel}` : customerLabel,
      isTestOrder: isTestMode,
      revenueExcluded: isTestMode,
      testOrderNote: isTestMode ? "POS 建立的測試訂單，不計入營收 / 收班 / 報表" : "",
      note: summary.orderNote,
      items: cart,
      total: summary.total,
      status: getOrderStatusForSubmission(),
      statusText: isTestMode ? "測試訂單：已送廚房，不計營收" : (isUnpaidMode ? "未結帳，已送廚房" : (STORE_MODE === "pro" ? "已結帳，餐點製作中" : "已結帳，已送廚房")),
      paymentStatus: paymentFields.paymentStatus,
      paymentStatusText: paymentFields.paymentStatusText,
      kitchenStatus: getKitchenStatusForSubmission(),
      confirmed: true,
      paid: paymentFields.paid,
      closed: false,
      cancelled: false,
      paidAt: paymentFields.paidAt,
      sentToKitchenAt: getSentToKitchenAtForSubmission(now),
      createdAt: now,
      updatedAt: now
    };

    await set(newOrderRef, order);

    void triggerPosOrderPrint(order);

    if (!isTestMode && isPaidMode) {
      playSound("payment");
      if (isOrderCookingForSound(order)) playSound("cooking");
    }

    alert((options.successText || "訂單已送出") + "：" + order.customerLabel + "\n單號：" + orderNumber);

    cart = [];
    if (posOrderNoteInput) posOrderNoteInput.value = "";
    renderCart();
  } catch (error) {
    console.error(options.errorLogText || "訂單送出失敗：", error);
    alert(options.errorAlertText || "訂單送出失敗\n請稍後再試。");
  }

  setPosSubmissionUi(options, false);
}

/* =========================
   Orders
========================= */

function renderAllOrders() {
  pendingOrderList.innerHTML = renderOrderList(getPendingOrders(), "目前沒有待確認訂單");
  processingOrderList.innerHTML = renderOrderList(getProcessingOrders(), "目前沒有製作中訂單");
  doneOrderList.innerHTML = renderOrderList(getDoneOrders(), "目前沒有已完成訂單");
  cancelledOrderList.innerHTML = renderOrderList(getCancelledOrders(), "目前沒有已取消訂單");
}

function renderOrderList(orders, emptyText) {
  if (orders.length === 0) return `<div class="empty">${emptyText}</div>`;
  return orders.map(order => renderOrderCard(order)).join("");
}

function renderOrderCard(order) {
  const items = normalizeOrderItems(order.items);
  const statusText = getOrderStatusText(order);
  const locked = isBusinessDayClosed();

  const canConfirm = !locked && !isPaid(order) && !isCancelled(order) && !isClosed(order);
  const canCancel = !locked && !isPaid(order) && !isCancelled(order) && !isClosed(order);
  const canVoid = !locked && !isCancelled(order) && (isPaid(order) || isDone(order) || isClosed(order) || isTestOrder(order));
  const canClose = !locked && isDone(order) && !isClosed(order) && !isCancelled(order) && !isTestOrder(order);
  const canCompleteInPos = canCompleteOrderInPos(order);
  const editable = !locked && canEditOrder(order);

  return `
    <article class="order-card">
      <div class="order-card-head">
        <div>
          <strong>#${order.orderNumber || order.id}</strong>
          <p>${getCustomerLabel(order)}｜${order.source || "未知"}｜${order.type || "未分類"}</p>
          <p>${formatTime(order.createdAt)}</p>
          ${getOrderFlagHtml(order)}
        </div>

        <span class="status-badge">${statusText}</span>
      </div>

      <div class="order-items">
        ${items.map(renderOrderItem).join("")}
      </div>

      ${order.note ? `<div class="order-note">整單備註：${order.note}</div>` : ""}

      <div class="order-total">總金額：${money(order.total)}</div>
      <div class="order-payment-status ${isUnpaid(order) ? "unpaid" : "paid"}">
        <span>${isUnpaid(order) ? "🔴 未結帳" : "已付款"}</span>
        <strong>應收：${money(order.total)}</strong>
      </div>

      <div class="order-actions">
        <div class="reprint-actions">
          <span>補印：</span>
          <button type="button" class="secondary-btn print-btn" onclick="return printOrderTicket('kitchen', '${order.id}', event)" ontouchend="return printOrderTicket('kitchen', '${order.id}', event)">廚房單</button>
          <button type="button" class="secondary-btn print-btn" onclick="return printOrderTicket('customer', '${order.id}', event)" ontouchend="return printOrderTicket('customer', '${order.id}', event)">客人單</button>
        </div>

        ${editable ? `<button class="secondary-btn" onclick="openEditOrderModal('${order.id}')">編輯 / 改單</button>` : ""}

        ${canConfirm ? `<button class="primary-btn" onclick="confirmPaidAndProcess('${order.id}')">確認收款</button>` : ""}

        ${canCompleteInPos ? `<button class="primary-btn" onclick="completeOrderByPOS('${order.id}')">完成訂單</button>` : ""}

        ${STORE_MODE === "pro" && order.status === "cooking" && !canCompleteInPos ? `<button class="primary-btn" onclick="markOrderDoneByPOS('${order.id}')">POS 標記完成</button>` : ""}

        ${canClose ? `<button class="primary-btn" onclick="closeOrder('${order.id}')">結案</button>` : ""}

        ${canVoid ? `<button class="danger-btn" onclick="voidOrder('${order.id}')">作廢 / 不計營收</button>` : ""}

        ${canCancel ? `<button class="danger-btn" onclick="cancelOrder('${order.id}')">取消</button>` : ""}
      </div>
    </article>
  `;
}

function renderOrderItem(item) {
  return `
    <div class="order-item">
      <strong>• ${escapeHtml(itemDisplayName(item))} × ${itemQty(item)}</strong>

      <div class="order-item-detail">
        ${formatOrderOptionHtml(item, escapeHtml, { moduleName: "pos" })}
      </div>
    </div>
  `;
}

/* =========================
   Edit Order
========================= */

function openEditOrderModal(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  if (!canEditOrder(order)) {
    alert("此訂單已結帳、已送廚房、已完成或已取消，不能修改。");
    return;
  }

  editingOrderId = orderId;
  editingItems = normalizeOrderItems(order.items).map(item => ({
    ...item,
    addons: item.addons || item.extras || [],
    extras: item.extras || item.addons || [],
    qty: itemQty(item),
    quantity: itemQty(item),
    subtotal: calculateOrderItemPrice(item).subtotal
  }));

  editOrderTitle.textContent = `編輯訂單 #${order.orderNumber || order.id}`;
  editOrderInfo.textContent = `${getCustomerLabel(order)}｜${order.source || "未知"}｜${formatTime(order.createdAt)}`;
  editOrderNote.value = order.note || "";

  renderEditOrderItems();
  editOrderModal.classList.remove("hidden");
}

function closeEditOrderModal() {
  editOrderModal.classList.add("hidden");
  editingOrderId = null;
  editingItems = [];
  editOrderNote.value = "";
  editOrderItems.innerHTML = "";
}

function renderEditOrderItems() {
  if (editingItems.length === 0) {
    editOrderItems.innerHTML = `<div class="empty">此訂單沒有餐點</div>`;
    editOrderTotal.textContent = "$0";
    return;
  }

  editOrderItems.innerHTML = editingItems.map((item, index) => {
    return `
      <div class="edit-order-item">
        <div>
          <strong>${escapeHtml(itemDisplayName(item))}</strong>

          <div class="order-item-detail">
            ${formatOrderOptionHtml(item, escapeHtml, { moduleName: "pos" })}
            <p>小計：${money(calculateOrderItemPrice(item).subtotal)}</p>
          </div>
        </div>

        <div class="edit-item-actions">
          <button class="primary-btn" onclick="openEditItemModal(${index})">修改餐點</button>
          <button class="secondary-btn" onclick="changeEditItemQty(${index}, -1)">－</button>
          <span>${itemQty(item)}</span>
          <button class="secondary-btn" onclick="changeEditItemQty(${index}, 1)">＋</button>
          <button class="danger-btn" onclick="removeEditItem(${index})">刪除</button>
        </div>
      </div>
    `;
  }).join("");

  editOrderTotal.textContent = money(calculateOrderTotal(editingItems));
}

function changeEditItemQty(index, amount) {
  const item = editingItems[index];
  if (!item) return;

  const nextQty = Math.max(1, itemQty(item) + amount);
  item.qty = nextQty;
  item.quantity = nextQty;
  syncSplitAllocationQuantity(item, nextQty);
  Object.assign(item, applyOrderItemPrice(item));

  renderEditOrderItems();
}

function removeEditItem(index) {
  const item = editingItems[index];
  if (!item) return;

  const ok = confirm(`確定要刪除「${itemDisplayName(item)}」嗎？`);
  if (!ok) return;

  editingItems.splice(index, 1);
  renderEditOrderItems();
}

async function saveEditOrder() {
  if (!editingOrderId) return;

  const order = ordersData[editingOrderId];

  if (!canEditOrder(order)) {
    alert("此訂單已結帳、已送廚房、已完成或已取消，不能修改。");
    closeEditOrderModal();
    return;
  }

  try {
    await update(ref(db, `orders/${editingOrderId}`), {
      items: editingItems,
      total: calculateOrderTotal(editingItems),
      note: editOrderNote.value.trim(),
      updatedAt: Date.now()
    });

    alert("訂單已更新");
    closeEditOrderModal();
  } catch (error) {
    console.error("更新訂單失敗：", error);
    alert("更新訂單失敗");
  }
}

cancelEditOrderBtn.addEventListener("click", closeEditOrderModal);
saveEditOrderBtn.addEventListener("click", saveEditOrder);

editOrderModal.addEventListener("click", event => {
  if (event.target === editOrderModal) closeEditOrderModal();
});

/* =========================
   Edit Single Item
========================= */

function openEditItemModal(index) {
  const item = editingItems[index];
  if (!item) return;

  const sourceMenuItem = getMenuItemByOrderItem(item);

  editingItemIndex = index;
  editingItemData = { ...item };
  editingMenuItem = sourceMenuItem;

  editQuantity = itemQty(item);
  editSelectedExtras = [...(item.addons || item.extras || [])];
  editSelectedRemoves = itemRemoves(item).slice();
  editSelectedSatay = item.satay || "不要";
  editSelectedRequiredOption = (item.requiredOption && item.requiredOption.value) || "";

  editSelectedPortion = {
    name: item.size || "一般",
    price: Number(item.basePrice || item.price || item.unitPrice || 0)
  };

  editItemName.textContent = itemDisplayName(item);
  editItemPrice.textContent = "調整份量、加料、辣度與備註";
  editItemNoteInput.value = item.note || "";
  editItemSpicySelect.value = item.spicy || "";
  editItemQuantity.textContent = editQuantity;
  editItemSpicySelect.disabled = !allowSpicy(editingMenuItem);
  renderSpicyButtons(editItemSpicySelect, "editSpicyChipBox", editItemSpicySelect.value || "不辣", !editItemSpicySelect.disabled, "selectEditSpicy");

  renderEditItemPortions();
  renderEditItemSatay();
  renderEditItemRequiredOption();



  renderEditItemExtras();
  renderEditItemRemoves();
  updateEditItemSubtotal();

  editItemModal.classList.remove("hidden");
}

function closeEditItemModal() {
  editItemModal.classList.add("hidden");

  editSelectedRequiredOption = "";

  const editRequiredOptionBox = document.getElementById("editRequiredOptionBox");
  if (editRequiredOptionBox) editRequiredOptionBox.remove();

  const editSpicyChipBox = document.getElementById("editSpicyChipBox");
  if (editSpicyChipBox) editSpicyChipBox.remove();

  const editRemoveOptionBox = document.getElementById("editRemoveOptionBox");
  if (editRemoveOptionBox) editRemoveOptionBox.remove();

  editingItemIndex = null;
  editingItemData = null;
  editingMenuItem = null;

  editSelectedExtras = [];
  editSelectedRemoves = [];
  editSelectedSatay = "不要";
  editSelectedPortion = null;
  editQuantity = 1;
}

function renderEditItemPortions() {
  const options = getPortionOptions(editingMenuItem || editingItemData);

  editItemPortionBox.innerHTML = `
    <h3>份量</h3>
    <div class="option-grid">
      ${options.map(option => `
        <button
          class="option-btn ${(editSelectedPortion && editSelectedPortion.name) === option.name ? "active" : ""}"
          onclick="selectEditPortion('${option.name}', ${option.price})">
          ${option.name} ${money(option.price)}
        </button>
      `).join("")}
    </div>
  `;
}

function selectEditPortion(name, price) {
  editSelectedPortion = { name, price: Number(price) };
  renderEditItemPortions();
  updateEditItemSubtotal();
}

function renderEditItemSatay() {
  if (!allowSatay(editingMenuItem || editingItemData)) {
    editItemSatayBox.innerHTML = "";
    editSelectedSatay = "";
    return;
  }

  editItemSatayBox.innerHTML = `
    <h3>沙茶</h3>
    <div class="option-grid">
      <button
        class="option-btn ${editSelectedSatay === "要" ? "active" : ""}"
        onclick="selectEditSatay('要')">
        要沙茶
      </button>

      <button
        class="option-btn ${editSelectedSatay === "不要" ? "active" : ""}"
        onclick="selectEditSatay('不要')">
        不要沙茶
      </button>
    </div>
  `;
}

function selectEditSatay(value) {
  editSelectedSatay = value;
  renderEditItemSatay();
}

function renderEditItemRequiredOption() {
  const requiredOption = getRequiredOption(editingMenuItem || editingItemData);

  const oldBox = document.getElementById("editRequiredOptionBox");
  if (oldBox) oldBox.remove();

  if (!requiredOption) return;

  const box = document.createElement("div");
  box.id = "editRequiredOptionBox";
  box.className = "required-option-select-box";

  box.innerHTML = `
    <h3>${requiredOption.title} <span>必選</span></h3>
    <div class="option-grid">
      ${requiredOption.options.map(option => `
        <button
          type="button"
          class="option-btn ${editSelectedRequiredOption === option ? "active" : ""}"
          onclick="selectEditRequiredOption('${option}')">
          ${option}
        </button>
      `).join("")}
    </div>
  `;

  const extrasSection = editItemExtrasBox.parentNode;

  box.style.marginBottom = "18px";
  box.style.paddingBottom = "16px";
  box.style.borderBottom = "1px solid rgba(255,255,255,0.12)";

  extrasSection.parentNode.insertBefore(box, extrasSection);
}

function selectEditRequiredOption(value) {
  editSelectedRequiredOption = value;
  renderEditItemRequiredOption();
}

function renderEditItemExtras() {
  const extras = getExtras(editingMenuItem || editingItemData);

  if (extras.length === 0) {
    editItemExtrasBox.innerHTML = `<p class="muted">此餐點沒有加料</p>`;
    return;
  }

  editItemExtrasBox.innerHTML = `
    <div class="option-grid">
      ${extras.map(extra => {
        const active = editSelectedExtras.some(item => item.name === extra.name);

        return `
          <button
            class="option-btn ${active ? "active" : ""}"
            onclick="toggleEditExtra('${extra.name}', ${extra.price})">
            ${extra.name} +${extra.price}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderEditItemRemoves() {
  const oldBox = document.getElementById("editRemoveOptionBox");
  if (oldBox) oldBox.remove();

  const removes = getRemoveOptions(editingMenuItem || editingItemData);
  if (!removes.length) return;

  const box = document.createElement("div");
  box.id = "editRemoveOptionBox";
  box.className = "pos-remove-box";

  box.innerHTML = `
    <h3>不要項目</h3>
    <div class="option-grid">
      ${removes.map(name => {
        const active = editSelectedRemoves.includes(name);
        return `
          <button
            type="button"
            class="option-btn edit-remove-option-btn ${active ? "active" : ""}"
            data-name="${String(name).replace(/"/g, "&quot;")}">
            ${name}
          </button>
        `;
      }).join("")}
    </div>
  `;

  const noteSection = editItemNoteInput.parentNode;
  const modalCard = editItemModal.querySelector(".modal-card");
  modalCard.insertBefore(box, noteSection);

  box.querySelectorAll(".edit-remove-option-btn").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const name = button.getAttribute("data-name");

      if (editSelectedRemoves.includes(name)) {
        editSelectedRemoves = editSelectedRemoves.filter(item => item !== name);
      } else {
        editSelectedRemoves.push(name);
      }

      renderEditItemRemoves();
    });
  });
}

function toggleEditRemoveOption(name) {
  if (editSelectedRemoves.indexOf(name) !== -1) {
    editSelectedRemoves = editSelectedRemoves.filter(function(item) { return item !== name; });
  } else {
    editSelectedRemoves.push(name);
  }
  renderEditItemRemoves();
}

function toggleEditExtra(name, price) {
  const exists = editSelectedExtras.some(extra => extra.name === name);

  if (exists) {
    editSelectedExtras = editSelectedExtras.filter(extra => extra.name !== name);
  } else {
    editSelectedExtras.push({ name, price: Number(price) });
  }

  renderEditItemExtras();
  renderEditItemRemoves();
  updateEditItemSubtotal();
}

function updateEditItemSubtotal() {
  if (!editSelectedPortion) return;

  const subtotal = calculateOrderItemPrice({
    basePrice: Number(editSelectedPortion.price || 0),
    addons: editSelectedExtras,
    quantity: editQuantity
  }).subtotal;

  editItemSubtotal.textContent = money(subtotal);
}

editItemMinusBtn.addEventListener("click", () => {
  editQuantity = Math.max(1, editQuantity - 1);
  editItemQuantity.textContent = editQuantity;
  updateEditItemSubtotal();
});

editItemPlusBtn.addEventListener("click", () => {
  editQuantity += 1;
  editItemQuantity.textContent = editQuantity;
  updateEditItemSubtotal();
});

cancelEditItemBtn.addEventListener("click", closeEditItemModal);

saveEditItemBtn.addEventListener("click", () => {
  const requiredOption = getRequiredOption(editingMenuItem || editingItemData);

  if (requiredOption && !editSelectedRequiredOption) {
    alert(`請先選擇「${requiredOption.title}」`);
    return;
  }

  if (editingItemIndex === null || !editingItems[editingItemIndex]) return;

  editingItems[editingItemIndex] = applyOrderItemPrice({
    ...editingItems[editingItemIndex],
    itemId: editingItems[editingItemIndex].itemId || (editingMenuItem && editingMenuItem.id) || editingItems[editingItemIndex].id,
    size: editSelectedPortion.name,
    basePrice: Number(editSelectedPortion.price || 0),
    spicy: editItemSpicySelect.value,
    satay: editSelectedSatay,

    requiredOption: requiredOption
      ? {
        title: requiredOption.title,
        value: editSelectedRequiredOption
        }
      : null,
    
    addons: editSelectedExtras,
    extras: [],
    removes: editSelectedRemoves,
    removeOptionsSelected: editSelectedRemoves,
    note: editItemNoteInput.value.trim(),
    qty: editQuantity,
    quantity: editQuantity
  });

  renderEditOrderItems();
  closeEditItemModal();
});

editItemModal.addEventListener("click", event => {
  if (event.target === editItemModal) closeEditItemModal();
});

/* =========================
   確認 / 取消 / 結案
========================= */

async function confirmPaidAndProcess(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  const message =
    STORE_MODE === "pro"
      ? `確認「${getCustomerLabel(order)}」已付款，並開始製作？`
      : `確認「${getCustomerLabel(order)}」已付款，並送到廚房？`;

  const ok = confirm(message);
  if (!ok) return;

  try {
    const now = Date.now();

    if (STORE_MODE === "pro") {
      await update(ref(db, `orders/${orderId}`), {
        storeMode: STORE_MODE,
        status: "cooking",
        statusText: "已確認付款，餐點製作中",
        paymentStatus: "paid",
        paymentStatusText: "已付款",
        kitchenStatus: "not_required",
        confirmed: true,
        paid: true,
        paidAt: now,
        cookingAt: now,
        updatedAt: now
      });

      alert("已確認付款，訂單進入製作中");
      return;
    }

    await update(ref(db, `orders/${orderId}`), {
      storeMode: STORE_MODE,
      status: "confirmed",
      statusText: "已確認付款，等待廚房製作",
      paymentStatus: "paid",
      paymentStatusText: "已付款",
      kitchenStatus: getKitchenStatusForSubmission(),
      confirmed: true,
      paid: true,
      paidAt: now,
      sentToKitchenAt: getSentToKitchenAtForSubmission(now),
      updatedAt: now
    });

    alert("已確認付款並送到廚房");
  } catch (error) {
    console.error("確認付款失敗：", error);
    alert("確認付款失敗");
  }
}

function invalidateQrSessionForOrder(order, reason) {
  var sessionId = order && order.qrSessionId ? String(order.qrSessionId) : "";
  if (!sessionId) return Promise.resolve();
  var now = Date.now ? Date.now() : new Date().getTime();
  return update(ref(db, "qrSessions/" + sessionId), {
    status: "completed",
    invalidReason: reason || "order_done",
    invalidatedAt: now,
    completedAt: now,
    updatedAt: now
  }).catch(function(error) {
    console.error("QR session invalidation failed", error);
  });
}

async function finishOrderByPOS(orderId, options) {
  var order = ordersData[orderId];
  options = options || {};

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  var ok = confirm(options.confirmText || ("確認「" + getCustomerLabel(order) + "」餐點已完成？"));
  if (!ok) return;

  try {
    var now = Date.now();
    var doneUpdates = {
      status: "done",
      statusText: options.statusText || "餐點已完成",
      kitchenStatus: "done",
      completedAt: now,
      doneAt: now,
      updatedAt: now
    };
    await update(ref(db, "orders/" + orderId), doneUpdates);
    ordersData[orderId] = Object.assign({}, order, doneUpdates);
    renderAllOrders();
    renderStats();
    renderRealtimeBadges();
    await invalidateQrSessionForOrder(order, "order_done");
  } catch (error) {
    console.error(options.errorLogText || "完成訂單失敗：", error);
    alert(options.errorAlertText || "完成訂單失敗\n請稍後再試。");
  }
}

async function completeOrderByPOS(orderId) {
  return finishOrderByPOS(orderId, {
    confirmText: "確認是否完成製作？",
    statusText: "餐點已完成",
    errorLogText: "完成訂單失敗：",
    errorAlertText: "完成訂單失敗\n請稍後再試。"
  });
}

async function markOrderDoneByPOS(orderId) {
  return finishOrderByPOS(orderId, {
    statusText: "餐點已完成，等待 POS 結案",
    errorLogText: "標記完成失敗：",
    errorAlertText: "標記完成失敗"
  });
}

async function closeOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  const ok = confirm(`確認「${getCustomerLabel(order)}」已出餐 / 已取餐，並結案？`);
  if (!ok) return;

  try {
    const now = Date.now();
    await update(ref(db, `orders/${orderId}`), {
      status: "closed",
      statusText: "訂單已結案",
      closed: true,
      closedAt: now,
      updatedAt: now
    });
    await invalidateQrSessionForOrder(order, "order_closed");
  } catch (error) {
    console.error("結案失敗：", error);
    alert("結案失敗");
  }
}

async function voidOrder(orderId) {
  return cancelOrder(orderId);
}

async function cancelOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) return;

  const reason = prompt(`請輸入取消原因：\n例如：測試單、客人取消、打錯單、其他`, isTestOrder(order) ? "測試單" : "客人取消");
  if (reason === null) return;

  const ok = confirm(`確定要取消 / 作廢「${getCustomerLabel(order)}」這張訂單嗎？\n原因：${reason || "未填寫"}\n\n此單會保留紀錄，但不會計入營收與有效訂單。`);
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "cancelled",
      statusText: "訂單已取消",
      paymentStatus: "cancelled",
      kitchenStatus: "cancelled",
      cancelled: true,
      revenueExcluded: true,
      cancelReason: reason || "未填寫",
      cancelledAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error("取消訂單失敗：", error);
    alert("取消訂單失敗");
  }
}

/* =========================
   v56 Stats / Closing
========================= */

const statCancelledOrders = document.getElementById("statCancelledOrders");
const statAverageOrder = document.getElementById("statAverageOrder");

const statRevenueLabel = document.getElementById("statRevenueLabel");
const statTotalOrdersLabel = document.getElementById("statTotalOrdersLabel");

const topItemsList = document.getElementById("topItemsList");

const closingRevenue = document.getElementById("closingRevenue");
const closingValidOrders = document.getElementById("closingValidOrders");
const closingCancelledOrders = document.getElementById("closingCancelledOrders");

const closingStatus = document.getElementById("closingStatus");
const closingTime = document.getElementById("closingTime");
const closeBusinessDayBtn = document.getElementById("closeBusinessDayBtn");

const reportRangeButtons = document.querySelectorAll(".report-range-btn");

let currentReportRange = "day";

reportRangeButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentReportRange = button.dataset.range;

    reportRangeButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");

    renderStats();
  });
});

function isThisWeek(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  const firstDay = new Date(now);
  firstDay.setDate(now.getDate() - now.getDay());
  firstDay.setHours(0, 0, 0, 0);

  const lastDay = new Date(firstDay);
  lastDay.setDate(firstDay.getDate() + 7);

  return date >= firstDay && date < lastDay;
}

function isThisMonth(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function getOrdersByRange() {
  const orders = Object.entries(ordersData).map(([id, order]) => ({ id, ...order }));

  if (currentReportRange === "day") {
    return orders.filter(order => isTodayOrder(order));
  }

  if (currentReportRange === "week") {
    return orders.filter(order => isThisWeek(order.createdAt));
  }

  if (currentReportRange === "month") {
    return orders.filter(order => isThisMonth(order.createdAt));
  }

  return orders;
}

function renderTopItems(orders) {
  const counter = {};

  orders.forEach(order => {
    if (isRevenueExcluded(order)) return;

    const items = normalizeOrderItems(order.items);

    items.forEach(item => {
      const name = itemDisplayName(item);
      counter[name] = (counter[name] || 0) + itemQty(item);
    });
  });

  const sorted = Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sorted.length === 0) {
    topItemsList.innerHTML = `<div class="empty">目前沒有銷售資料</div>`;
    return;
  }

  topItemsList.innerHTML = sorted.map((item, index) => `
    <div class="top-item-row">
      <span>${index + 1}. ${item[0]}</span>
      <strong>${item[1]} 份</strong>
    </div>
  `).join("");
}

function renderStats() {
  const orders = getOrdersByRange();

  const effectiveOrders = orders.filter(order => !isRevenueExcluded(order));

  const unpaidOrders = effectiveOrders.filter(order => {
    return !isPaid(order) && !isClosed(order);
  });

  const processingOrders = effectiveOrders.filter(order => {
    return isPaid(order) && !isDone(order) && !isClosed(order);
  });

  const doneOrders = effectiveOrders.filter(order => {
    return isDone(order) || isClosed(order);
  });

  const cancelledOrders = orders.filter(order => isCancelled(order));

  const paidRevenueOrders = doneOrders.filter(order => isPaid(order));

  const revenue = paidRevenueOrders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  const average = paidRevenueOrders.length > 0 ? revenue / paidRevenueOrders.length : 0;

  if (currentReportRange === "day") {
    statRevenueLabel.textContent = "今日營收";
    statTotalOrdersLabel.textContent = "今日有效訂單";
  }

  if (currentReportRange === "week") {
    statRevenueLabel.textContent = "本週營收";
    statTotalOrdersLabel.textContent = "本週有效訂單";
  }

  if (currentReportRange === "month") {
    statRevenueLabel.textContent = "本月營收";
    statTotalOrdersLabel.textContent = "本月有效訂單";
  }

  statTotalOrders.textContent = effectiveOrders.length;
  statUnpaidOrders.textContent = unpaidOrders.length;
  statProcessingOrders.textContent = processingOrders.length;
  statDoneOrders.textContent = doneOrders.length;
  statCancelledOrders.textContent = cancelledOrders.length;

  statTodayRevenue.textContent = money(revenue);
  statAverageOrder.textContent = money(Math.round(average));

  closingRevenue.textContent = money(revenue);
  closingValidOrders.textContent = effectiveOrders.length;
  closingCancelledOrders.textContent = cancelledOrders.length;

  renderTopItems(orders);
}

function getTodayKey() {
  return getBusinessDate();
}

function renderClosingStatus() {
  if (!closingStatus || !closingTime || !closeBusinessDayBtn) return;

  if (!businessDayCloseData || !businessDayCloseData.closed) {
    closingStatus.textContent = "尚未收班";
    closingTime.textContent = "-";
    closeBusinessDayBtn.disabled = false;
    closeBusinessDayBtn.textContent = "確認今日收班";
    submitOrderBtn.disabled = false;
    if (submitUnpaidOrderBtn) submitUnpaidOrderBtn.disabled = false;
    return;
  }

  closingStatus.textContent = "已收班";
  closingTime.textContent = formatTime(businessDayCloseData.closedAt);
  closeBusinessDayBtn.disabled = false;
  closeBusinessDayBtn.textContent = "重新開班";
  submitOrderBtn.disabled = true;
  if (submitUnpaidOrderBtn) submitUnpaidOrderBtn.disabled = true;
}

function watchBusinessDayClose() {
  const closeRef = ref(db, `businessDays/${STORE_ID}/${getTodayKey()}`);

  onValue(closeRef, snapshot => {
    businessDayCloseData = snapshot.exists() ? snapshot.val() : null;

    renderClosingStatus();

    // 🔥 重新刷新訂單畫面
    renderAllOrders();

    // 🔥 重新刷新統計
    renderStats();

    // 🔥 重新刷新角標
    renderRealtimeBadges();
  });
}

async function closeBusinessDay() {
  const ok = confirm("確認今天已完成營收與訂單核對，要執行收班嗎？收班後今天不能再新增訂單。");
  if (!ok) return;

  const orders = getTodayOrders();
  const effectiveOrders = orders.filter(order => !isRevenueExcluded(order));
  const cancelledOrders = orders.filter(order => isCancelled(order));
  const doneOrders = effectiveOrders.filter(order => isDone(order) || isClosed(order));

  const revenue = doneOrders.filter(order => isPaid(order)).reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  try {
    const now = Date.now();
    await update(qrSessionControlRef, {
      closeDayVersion: now,
      closeDayAt: now,
      updatedAt: now
    });

    await set(ref(db, `businessDays/${STORE_ID}/${getTodayKey()}`), {
      storeId: STORE_ID,
      date: getTodayKey(),
      closed: true,
      closedAt: now,
      revenue,
      validOrders: effectiveOrders.length,
      cancelledOrders: cancelledOrders.length,
      totalOrders: orders.length,
      note: "v56 每日收班穩定版",
      createdAt: now,
      updatedAt: now
    });

    alert("今日收班已完成，已禁止新增今日訂單。");
  } catch (error) {
    console.error("收班失敗：", error);
    alert("收班失敗，請稍後再試");
  }
}

async function reopenBusinessDay() {
  const ok = confirm("確定要重新開班嗎？重新開班後，今天可以繼續建立訂單。");
  if (!ok) return;

  const secondOk = confirm("請再次確認：這通常只用在誤按收班的情況。是否確定重新開班？");
  if (!secondOk) return;

  try {
    await remove(ref(db, `businessDays/${STORE_ID}/${getTodayKey()}`));
    alert("已重新開班，可以繼續建立今日訂單。");
  } catch (error) {
    console.error("重新開班失敗：", error);
    alert("重新開班失敗，請稍後再試");
  }
}



/* =========================
   v59-2 舊平板餐點按鈕 fallback
========================= */

var posFoodTouchStartX = 0;
var posFoodTouchStartY = 0;
var posFoodTouchMoved = false;

function findPosFoodButton(target) {
  var el = target;
  while (el && el !== document) {
    if (typeof el.className === "string" && (" " + el.className + " ").indexOf(" pos-food-btn ") !== -1) {
      return el;
    }
    el = el.parentNode;
  }
  return null;
}

if (posMenuList) {
  posMenuList.addEventListener("touchstart", function (event) {
    var touch = event.touches && event.touches.length ? event.touches[0] : null;
    posFoodTouchMoved = false;
    if (touch) {
      posFoodTouchStartX = touch.clientX || 0;
      posFoodTouchStartY = touch.clientY || 0;
    }
  }, true);

  posMenuList.addEventListener("touchmove", function (event) {
    var touch = event.touches && event.touches.length ? event.touches[0] : null;
    if (!touch) return;
    var dx = Math.abs((touch.clientX || 0) - posFoodTouchStartX);
    var dy = Math.abs((touch.clientY || 0) - posFoodTouchStartY);
    if (dx > 28 || dy > 28) posFoodTouchMoved = true;
  }, true);

  posMenuList.addEventListener("touchend", function (event) {
    /* v59-5：舊平板滑動時避免誤開餐點；實際開啟交給 click 處理 */
    if (posFoodTouchMoved) {
      posFoodTouchMoved = false;
    }
  }, true);

  posMenuList.addEventListener("click", function (event) {
    var button = findPosFoodButton(event.target || event.srcElement);
    if (!button) return;
    var itemId = button.getAttribute("data-id");
    if (!itemId) return;
    window.posOpenFoodById(itemId, event);
  }, true);
}

/* =========================
   v64 commercial upgrade
========================= */

function renderPosFoodButtonV649(item) {
  var imageUrl = getImageUrl(item);
  var displayName = item.name || "餐點";
  var saleStatus = getSaleStatus(item);
  return '' +
    '<button type="button" class="pos-food-btn pos-food-real-btn sale-' + saleStatus + '" data-id="' + escapeHtml(item.id) + '" aria-disabled="' + (saleStatus !== "normal") + '">' +
      '<div class="food-img">' + (imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(displayName) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="meal-image-placeholder" style="display:none">' + MENU_IMAGE_PLACEHOLDER_ICON + '</span>' : '<span class="meal-image-placeholder">' + MENU_IMAGE_PLACEHOLDER_ICON + '</span>') + '</div>' +
      '<div class="food-info"><strong>' + escapeHtml(displayName) + '</strong><b>' + money(getBasePrice(item)) + '</b><span class="pos-sale-status">' + getSaleStatusText(item) + '</span></div>' +
    '</button>';
}

function getCartItemCount() {
  var count = 0;
  for (var i = 0; i < cart.length; i += 1) count += itemQty(cart[i]);
  return count;
}

function updateCartSubtabBadge() {
  var buttons = document.querySelectorAll ? document.querySelectorAll('.order-subtab-btn[data-order-subtab="cart"]') : [];
  var count = getCartItemCount();
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].innerHTML = '購物車 <span class="cart-count-badge">' + count + '</span>';
  }
}

function renderCartV649() {
  ensurePosMenuStudioUi();
  updateCartSubtabBadge();
  renderHeldCarts();
  if (!cartList) return;
  if (!cart.length) {
    cartList.innerHTML = '<div class="empty">尚未加入餐點</div>';
    if (totalAmount) totalAmount.textContent = "$0";
    updateCartSubtabBadge();
    renderHeldCarts();
    return;
  }
  var html = "";
  for (var i = 0; i < cart.length; i += 1) {
    var item = cart[i] || {};
    html += '<div class="cart-item" data-cart-id="' + escapeHtml(item.cartId) + '">';
    html += '<button class="swipe-delete-action" type="button" onclick="removeFromCart(\'' + escapeInlineValue(item.cartId) + '\')">刪除</button>';
    html += '<div class="cart-item-inner"><div><strong>' + escapeHtml(itemDisplayName(item)) + ' x ' + itemQty(item) + '</strong><div class="cart-detail">';
    html += formatOrderOptionHtml(item, escapeHtml, { moduleName: "pos" });
    html += '<p>小計：' + money(calculateOrderItemPrice(item).subtotal) + '</p></div></div>';
    html += '<div class="cart-item-actions"><button class="secondary-btn" type="button" onclick="openCartItemEditModal(' + i + ')">編輯</button><button class="danger-btn" type="button" onclick="removeFromCart(\'' + escapeInlineValue(item.cartId) + '\')">刪除</button></div>';
    html += '</div></div>';
  }
  cartList.innerHTML = html;
  if (totalAmount) totalAmount.textContent = money(calculateOrderTotal(cart));
  updateCartSubtabBadge();
  renderHeldCarts();
  bindCartCardActions();
}

function renderPosMenuManage() {
  if (!posMenuManageList) return;
  var keyword = posMenuManageSearch ? String(posMenuManageSearch.value || "").toLowerCase() : "";
  var items = sortMenuItems(Object.entries(menuData || {}).map(function(entry) {
    var item = entry[1] || {};
    item.id = entry[0];
    return item;
  })).filter(function(item) {
    if (!keyword) return true;
    return String(item.name || "").toLowerCase().indexOf(keyword) !== -1 || String(item.category || "").toLowerCase().indexOf(keyword) !== -1;
  });
  if (!items.length) {
    posMenuManageList.innerHTML = '<div class="empty">沒有符合的餐點</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < items.length; i += 1) {
    var item = items[i] || {};
    var currentStatus = item.enabled === false ? "offline" : getSaleStatus(item);
    html += '<div class="pos-menu-manage-row status-' + currentStatus + '" data-id="' + escapeHtml(item.id) + '">';
    var statusLabel = currentStatus === "offline" ? "已下架" : getSaleStatusText(item);
    var lockAttribute = posMenuStatusLocks[item.id] ? ' disabled aria-busy="true"' : '';
    html += '<div class="pos-menu-manage-main"><strong>' + escapeHtml(item.name || "餐點") + '</strong><span>' + escapeHtml(item.category || "") + '</span><b>' + money(getBasePrice(item)) + '</b><em>' + statusLabel + '</em></div>';
    html += '<div class="pos-menu-status-actions">';
    html += '<button type="button" class="status-normal' + (currentStatus === "normal" ? ' active' : '') + '" data-action="normal" aria-pressed="' + (currentStatus === "normal") + '"' + lockAttribute + '>正常</button>';
    html += '<button type="button" class="status-soldout' + (currentStatus === "soldout" ? ' active' : '') + '" data-action="soldout" aria-pressed="' + (currentStatus === "soldout") + '"' + lockAttribute + '>售完</button>';
    html += '<button type="button" class="status-offline' + (currentStatus === "offline" ? ' active' : '') + '" data-action="offline" aria-pressed="' + (currentStatus === "offline") + '"' + lockAttribute + '>下架</button>';
    html += '</div></div>';
  }
  posMenuManageList.innerHTML = html;
  bindPosMenuManageEvents();
}

function bindPosMenuManageEvents() {
  if (!posMenuManageList) return;
  var inputs = posMenuManageList.querySelectorAll("input");
  for (var i = 0; i < inputs.length; i += 1) {
    inputs[i].onchange = function() {
      var row = this.parentNode;
      var id = row && row.getAttribute("data-id");
      var field = this.getAttribute("data-field");
      var value = field === "price" ? Number(this.value || 0) : this.value;
      var data = { updatedAt: Date.now() };
      data[field] = value;
      update(ref(db, "menu/" + id), data);
    };
  }
  var buttons = posMenuManageList.querySelectorAll("button");
  for (var j = 0; j < buttons.length; j += 1) {
    buttons[j].onclick = async function() {
      var row = this.parentNode;
      while (row && row.getAttribute && !row.getAttribute("data-id")) row = row.parentNode;
      var id = row && row.getAttribute("data-id");
      var action = this.getAttribute("data-action");
      if (!id || !menuData[id] || this.disabled || posMenuStatusLocks[id]) return false;
      posMenuStatusLocks[id] = true;
      var rowButtons = row.querySelectorAll("button");
      for (var k = 0; k < rowButtons.length; k += 1) rowButtons[k].disabled = true;
      var previous = menuData[id];
      var next = buildMenuSaleStatusPatch(action);
      try {
        await update(ref(db, "menu/" + id), next);
      } catch (error) {
        console.error("餐點販售狀態更新失敗：", error);
        menuData[id] = previous;
        renderPosMenuManage();
        showMenuStatusError("狀態更新失敗，請檢查網路後再試");
      } finally {
        delete posMenuStatusLocks[id];
        renderPosMenuManage();
      }
      return false;
    };
  }
}

var posMenuStatusLocks = {};

function showMenuStatusError(message) {
  var toast = document.createElement("div");
  toast.className = "pos-menu-status-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2800);
}

if (posMenuManageSearch) posMenuManageSearch.addEventListener("input", renderPosMenuManage, false);
function switchPosMenuManageSubtab(target) {
  var next = target === "studio" ? "studio" : "quick";
  for (var i = 0; i < posMenuManageSubtabButtons.length; i += 1) {
    var active = posMenuManageSubtabButtons[i].getAttribute("data-menu-manage-subtab") === next;
    if (posMenuManageSubtabButtons[i].classList) {
      if (active) posMenuManageSubtabButtons[i].classList.add("active");
      else posMenuManageSubtabButtons[i].classList.remove("active");
    } else {
      posMenuManageSubtabButtons[i].className = active ? "active" : "";
    }
  }
  for (var j = 0; j < posMenuManagePanes.length; j += 1) {
    var paneActive = posMenuManagePanes[j].getAttribute("data-menu-manage-pane") === next;
    if (posMenuManagePanes[j].classList) {
      if (paneActive) posMenuManagePanes[j].classList.add("active");
      else posMenuManagePanes[j].classList.remove("active");
    } else {
      posMenuManagePanes[j].style.display = paneActive ? "" : "none";
    }
  }
}
for (var manageTabIndex = 0; manageTabIndex < posMenuManageSubtabButtons.length; manageTabIndex += 1) {
  posMenuManageSubtabButtons[manageTabIndex].addEventListener("click", function() {
    switchPosMenuManageSubtab(this.getAttribute("data-menu-manage-subtab"));
  }, false);
}
renderPosFoodButton = renderPosFoodButtonV649;
renderCart = renderCartV649;

/* =========================
   Events / Window
========================= */

submitOrderBtn.addEventListener("click", function(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  submitOrder();
}, true);
if (submitUnpaidOrderBtn) {
  submitUnpaidOrderBtn.addEventListener("click", function(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    submitUnpaidOrder();
  }, true);
}
clearCartBtn.addEventListener("click", clearCart);
if (submitTestOrderBtn) submitTestOrderBtn.addEventListener("click", submitTestOrder);

if (fullscreenBtn) {
  let fullscreenLastTouchAt = 0;

  function isPosFullscreenActive() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      document.webkitIsFullScreen
    );
  }

  function updateFullscreenButtonText() {
    fullscreenBtn.textContent = isPosFullscreenActive()
      ? "❎ 關閉全螢幕模式"
      : "🔳 進入全螢幕模式";
  }

  function togglePosFullscreen(event) {
    if (event && event.type === "touchend") {
      fullscreenLastTouchAt = Date.now ? Date.now() : new Date().getTime();
    }

    if (event && event.type === "click" && (Date.now ? Date.now() : new Date().getTime()) - fullscreenLastTouchAt < 500) {
      return;
    }

    if (event && event.preventDefault) event.preventDefault();

    if (isPosFullscreenActive()) {
      const exitFullscreen =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen;

      if (exitFullscreen) {
        exitFullscreen.call(document);
      } else {
        alert("此裝置瀏覽器不支援全螢幕，請使用瀏覽器選單或加入主畫面模式。");
      }

      return;
    }

    const target = document.documentElement;
    const requestFullscreen =
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen;

    if (requestFullscreen) {
      requestFullscreen.call(target);
    } else {
      alert("此裝置瀏覽器不支援全螢幕，請使用瀏覽器選單或加入主畫面模式。");
    }
  }

  fullscreenBtn.addEventListener("click", togglePosFullscreen, false);
  fullscreenBtn.addEventListener("touchend", togglePosFullscreen, false);
  document.addEventListener("fullscreenchange", updateFullscreenButtonText, false);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButtonText, false);
  document.addEventListener("mozfullscreenchange", updateFullscreenButtonText, false);
  document.addEventListener("MSFullscreenChange", updateFullscreenButtonText, false);
  updateFullscreenButtonText();
}

if (storeNameInput) {
  storeNameInput.addEventListener("input", () => {
    posSettings.storeName = storeNameInput.value;
    saveSetting("storeName", posSettings.storeName);
    applyStoreName();
    syncStoreNameToFirebase(posSettings.storeName);
  });
  storeNameInput.addEventListener("change", () => {
    syncStoreNameToFirebaseNow(storeNameInput.value);
  });
  storeNameInput.addEventListener("blur", () => {
    syncStoreNameToFirebaseNow(storeNameInput.value);
  });
}

if (tableCountInput) {
  tableCountInput.addEventListener("change", () => {
    updateTableCount(tableCountInput.value);
  });
}

if (prepTimeInput) {
  prepTimeInput.addEventListener("change", () => {
    const prepTime = Math.min(999, Math.max(1, Math.floor(Number(prepTimeInput.value) || defaultSettings.prepTime)));
    posSettings.prepTime = prepTime;
    prepTimeInput.value = prepTime;
    saveSetting("prepTime", prepTime);
  });
}

if (orderLookupMinutesInput) {
  orderLookupMinutesInput.addEventListener("change", () => {
    const minutes = normalizeOrderLookupMinutes(orderLookupMinutesInput.value);
    posSettings.orderLookupMinutes = minutes;
    orderLookupMinutesInput.value = String(minutes);
    saveSetting("orderLookupMinutes", minutes);
    syncOrderLookupMinutesToFirebase(minutes);
  });
}

if (qrValidMinutesInput) {
  qrValidMinutesInput.addEventListener("change", function() {
    var minutes = normalizeQrValidMinutes(qrValidMinutesInput.value);
    posSettings.qrValidMinutes = minutes;
    qrValidMinutesInput.value = String(minutes);
    saveSetting("qrValidMinutes", minutes);
    syncQrValidMinutesToFirebase(minutes);
  }, false);
}

if (showTestOrdersToggle) {
  showTestOrdersToggle.addEventListener("click", () => {
    posSettings.showTestOrders = !posSettings.showTestOrders;
    saveSetting("showTestOrders", posSettings.showTestOrders);
    setSwitchState(showTestOrdersToggle, posSettings.showTestOrders);
    applyShowTestOrdersSetting();
  });
}

if (enableSoundToggle) {
  enableSoundToggle.addEventListener("click", () => {
    posSettings.enableSound = !posSettings.enableSound;
    saveSetting("enableSound", posSettings.enableSound);
    setSwitchState(enableSoundToggle, posSettings.enableSound);
    if (posSettings.enableSound !== true) stopOrderAlertSound();
    syncSoundCenterSettings();
    syncSoundSettingsToFirebase();
  });
}

if (soundTypeSelect) {
  soundTypeSelect.addEventListener("change", () => {
    var nextType = soundTypeSelect.value;
    posSettings.soundType = isValidSoundType(nextType) ? nextType : defaultSettings.soundType;
    soundTypeSelect.value = posSettings.soundType;
    saveSetting("soundType", posSettings.soundType);
    renderSoundCenterControlsV656();
    syncSoundCenterSettings();
    syncSoundSettingsToFirebase();
  });
}

if (soundVolumeInput) {
  soundVolumeInput.addEventListener("input", () => {
    posSettings.soundVolume = Math.min(200, Math.max(0, Math.floor(Number(soundVolumeInput.value) || 0)));
    if (soundVolumeValue) soundVolumeValue.textContent = String(posSettings.soundVolume) + "%";
    var soundCenterVolumeValue = document.getElementById("soundCenterVolumeValue");
    if (soundCenterVolumeValue) soundCenterVolumeValue.textContent = String(posSettings.soundVolume) + "%";
    syncSoundCenterSettings();
  });

  soundVolumeInput.addEventListener("change", () => {
    posSettings.soundVolume = Math.min(200, Math.max(0, Math.floor(Number(soundVolumeInput.value) || 0)));
    saveSetting("soundVolume", posSettings.soundVolume);
    renderSoundVolume();
    syncSoundCenterSettings();
    syncSoundSettingsToFirebase();
  });
}

if (testSoundBtn) {
  addLegacyTapListener(testSoundBtn, async function(event) {
    if (event && event.preventDefault) event.preventDefault();
    var success = await unlockPosOrderSound();
    if (!success) {
      showMenuStatusError("音效啟動失敗，請再點一次");
      return;
    }
    playNewQrOrderBeep(true);
  });
}

if (autoSwitchCartToggle) {
  autoSwitchCartToggle.addEventListener("click", () => {
    posSettings.autoSwitchCartAfterAdd = !posSettings.autoSwitchCartAfterAdd;
    saveSetting("autoSwitchCartAfterAdd", posSettings.autoSwitchCartAfterAdd);
    setSwitchState(autoSwitchCartToggle, posSettings.autoSwitchCartAfterAdd);
  });
}

if (closeBusinessDayBtn) {
  closeBusinessDayBtn.addEventListener("click", () => {
    if (isBusinessDayClosed()) {
      reopenBusinessDay();
    } else {
      closeBusinessDay();
    }
  });
}

watchBusinessDayClose();


/* =========================
   v59 Legacy Tablet Click Fallback
   舊平板相容：避免只吃 click 或 touchend 其中一種造成按鈕無反應
========================= */
(function () {
  if (typeof document === "undefined") return;

  var lastTouchAt = 0;

  function hasClass(el, name) {
    return el && (" " + (el.className || "") + " ").indexOf(" " + name + " ") !== -1;
  }

  function closestButton(el) {
    while (el && el !== document) {
      if (el.tagName && String(el.tagName).toLowerCase() === "button") return el;
      el = el.parentNode;
    }
    return null;
  }

  function routeLegacyControl(event) {
    if (event && event.defaultPrevented) return;
    var target = event.target || event.srcElement;
    var button = closestButton(target);
    if (!button) return;

    var id = button.id || "";

    if (event.type === "click" && new Date().getTime() - lastTouchAt < 500) return;
    if (event.type === "touchend") lastTouchAt = new Date().getTime();

    if (id === "submitOrderBtn" && typeof window.submitOrder === "function") {
      if (button.disabled) return false;
      event.preventDefault && event.preventDefault();
      window.submitOrder();
      return false;
    }

    if (id === "submitUnpaidOrderBtn" && typeof window.submitUnpaidOrder === "function") {
      if (button.disabled) return false;
      event.preventDefault && event.preventDefault();
      window.submitUnpaidOrder();
      return false;
    }

    if (id === "submitTestOrderBtn" && typeof window.submitTestOrder === "function") {
      if (posSettings && posSettings.showTestOrders !== true) return false;
      if (button.hidden || button.style.display === "none") return false;
      if (button.disabled) return false;
      event.preventDefault && event.preventDefault();
      window.submitTestOrder();
      return false;
    }

    if (id === "clearCartBtn" && typeof window.clearCart === "function") {
      event.preventDefault && event.preventDefault();
      window.clearCart();
      return false;
    }
  }

  document.addEventListener("touchend", routeLegacyControl, false);
  document.addEventListener("click", routeLegacyControl, false);
})();

window.submitOrder = submitOrder;
window.submitUnpaidOrder = submitUnpaidOrder;
window.submitTestOrder = submitTestOrder;
window.clearCart = clearCart;
window.printOrderTicket = printOrderTicket;
window.sendOrderToPrinterDevice = sendOrderToPrinterDevice;
window.queueAutoPrintAfterKitchenConfirm = queueAutoPrintAfterKitchenConfirm;
window.openCustomModal = openCustomModal;
window.selectPortion = selectPortion;
window.selectSatay = selectSatay;
window.toggleExtra = toggleExtra;
window.toggleRemoveOption = toggleRemoveOption;
window.removeFromCart = removeFromCart;
window.openCartItemEditModal = openCartItemEditModal;

window.confirmPaidAndProcess = confirmPaidAndProcess;
window.confirmPaidAndSendKitchen = confirmPaidAndProcess;
window.completeOrderByPOS = completeOrderByPOS;
window.markOrderDoneByPOS = markOrderDoneByPOS;
window.closeOrder = closeOrder;
window.cancelOrder = cancelOrder;
window.voidOrder = voidOrder;

window.openEditOrderModal = openEditOrderModal;
window.changeEditItemQty = changeEditItemQty;
window.removeEditItem = removeEditItem;

window.openEditItemModal = openEditItemModal;
window.selectEditPortion = selectEditPortion;
window.selectEditSatay = selectEditSatay;
window.toggleEditExtra = toggleEditExtra;
window.toggleEditRemoveOption = toggleEditRemoveOption;

window.selectEditRequiredOption = selectEditRequiredOption;

/* =========================
   v59-4 POS inline 餐點點擊修正
   舊 iPad：不用 delegation，直接用餐點 id 開啟
========================= */
var posLastOpenFoodAt = 0;
window.posOpenFoodById = function (itemId, event) {
  if (event) {
    if (event.type === "touchend" && typeof posFoodTouchMoved !== "undefined" && posFoodTouchMoved) {
      posFoodTouchMoved = false;
      return false;
    }
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }

  if (!itemId) return false;

  var latestMenuItem = menuData[String(itemId)];
  if (!latestMenuItem || latestMenuItem.enabled === false) return false;
  if (!canPosOrderItem(latestMenuItem)) {
    showMenuStatusError("今日售完");
    return false;
  }

  var nowTime = new Date().getTime();
  if (nowTime - posLastOpenFoodAt < 1000) {
    return false;
  }
  posLastOpenFoodAt = nowTime;

  try {
    openCustomModal(String(itemId));
    if (customModal) {
      customModal.className = (customModal.className || "").replace(/\bhidden\b/g, "");
      if ((" " + customModal.className + " ").indexOf(" show-force ") === -1) {
        customModal.className += " show-force";
      }
      customModal.style.display = "flex";
      resetPosCustomModalScroll();
    }
  } catch (error) {
    alert("餐點視窗開啟失敗：" + (error && error.message ? error.message : error));
    console.error(error);
  }
  return false;
};


window.selectTable = selectTable;
window.selectCategory = selectCategory;
