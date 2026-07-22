// =====================================================
// 恩點系統 v58-5
// 日期：2026-05-22
// 端別：QR 客人端 app.js
// 用途：QR 內用/外帶 + 與 POS 共用每日訂單號 + 必選選項
// =====================================================

import {
  db,
  ref,
  onValue,
  push,
  set,
  update,
  getBusinessDate,
  createOrderNumber
} from "./firebase.js";

import {
  getAppliedMenuOptionGroups
} from "./menu-studio-core.js";

import {
  calculateOrderItemPrice,
  calculateOrderTotal
} from "./order-price-core.js";

import {
  formatOrderOptionHtml
} from "./order-option-display.js";

import {
  createQrSessionController,
  createQrTabController
} from "./qr-session.js";

import {
  closeQrModal,
  initQrModalManager,
  openQrModal,
  registerQrModal
} from "./qr-modal.js";


const STORE_ID = "defaultStore";
const LAST_ORDER_KEY = "enpoint_last_qr_order_id";
const LAST_ORDER_KEY_COMPAT = "lastQrOrderId";
const DEFAULT_QR_STORE_NAME = "恩點點餐";
const DEFAULT_ORDER_LOOKUP_MINUTES = 60;
const DEFAULT_QR_VALID_MINUTES = 30;
const QR_SESSION_INVALID_MESSAGE = "本次點餐已失效，請重新掃描桌面 QR Code 開始新的點餐。";

function normalizeQrOrderLookupMinutes(value) {
  var raw = String(value === undefined || value === null ? "" : value);
  if (raw === "0" || raw === "forever" || raw === "permanent") return 0;
  var minutes = Math.floor(Number(value) || DEFAULT_ORDER_LOOKUP_MINUTES);
  return Math.min(1440, Math.max(30, minutes));
}

function normalizeQrValidMinutes(value) {
  var minutes = Math.floor(Number(value) || DEFAULT_QR_VALID_MINUTES);
  var allowed = [15, 30, 45, 60, 75, 90];
  for (var i = 0; i < allowed.length; i += 1) {
    if (minutes === allowed[i]) return minutes;
  }
  return DEFAULT_QR_VALID_MINUTES;
}

const params = new URLSearchParams(window.location.search);
const table = params.get("table") || "";

const orderPage = document.getElementById("orderPage");
const successPage = document.getElementById("successPage");
const successContent = document.getElementById("successContent");
const topOrderPanel = document.getElementById("topOrderPanel");
const topOrderContent = document.getElementById("topOrderContent");
const qrHeaderTitle = document.getElementById("qrStoreNameTitle") || document.querySelector(".qr-header h1");
let currentViewingOrderId = "";
let qrStoreName = DEFAULT_QR_STORE_NAME;
let orderLookupMinutes = DEFAULT_ORDER_LOOKUP_MINUTES;
let qrValidMinutes = DEFAULT_QR_VALID_MINUTES;
let qrHasStoreNameFromFirebase = false;

function addBodyClass(name) {
  if (document.body && (" " + String(document.body.className || "") + " ").indexOf(" " + name + " ") < 0) {
    document.body.className += (document.body.className ? " " : "") + name;
  }
}

function removeBodyClass(name) {
  if (document.body) {
    document.body.className = String(document.body.className || "").replace(new RegExp("\\b" + name + "\\b", "g"), "").replace(/\s+/g, " ");
  }
}

function setQrPageMode(mode) {
  if (mode === "order") {
    removeBodyClass("qr-tab-menu");
    addBodyClass("qr-tab-order");
    addBodyClass("qr-direct-order-mode");
  } else {
    removeBodyClass("qr-tab-order");
    removeBodyClass("qr-direct-order-mode");
    addBodyClass("qr-tab-menu");
  }
}

function qrIsViewOrderMode() {
  return false;
}

function saveCurrentViewingOrderId(orderId) {
  currentViewingOrderId = orderId || "";
  if (!currentViewingOrderId) return;
  try { localStorage.setItem(LAST_ORDER_KEY, currentViewingOrderId); } catch (e) {}
  try { localStorage.setItem(LAST_ORDER_KEY_COMPAT, currentViewingOrderId); } catch (e) {}
  try { localStorage.setItem("enpoint_last_qr_order_saved_at", String(Date.now ? Date.now() : new Date().getTime())); } catch (e) {}
}

function getSavedViewingOrderId() {
  if (currentViewingOrderId) return currentViewingOrderId;
  currentViewingOrderId = getQrSessionController().getOrderId() || "";
  return currentViewingOrderId;
}

function applyQrStoreName(name) {
  qrStoreName = (name || "").trim() || DEFAULT_QR_STORE_NAME;
  if (qrHeaderTitle) qrHeaderTitle.textContent = qrStoreName;
  document.title = qrStoreName + "｜QR 點餐";
}

function keepQrStoreNameVisible() {
  if (!qrHeaderTitle) return;
  if (qrStoreName && qrHeaderTitle.textContent !== qrStoreName) {
    qrHeaderTitle.textContent = qrStoreName;
  }
  if (qrStoreName && document.title !== qrStoreName + "｜QR 點餐") {
    document.title = qrStoreName + "｜QR 點餐";
  }
}

function qrShowOrderMode() {
  keepQrStoreNameVisible();
  setQrPageMode("order");
  if (orderPage) {
    orderPage.className = (orderPage.className || "") + " hidden";
    orderPage.style.display = "none";
  }
  if (successPage) {
    successPage.className = (successPage.className || "") + " hidden";
    successPage.style.display = "none";
  }
  if (topOrderPanel) {
    topOrderPanel.className = String(topOrderPanel.className || "").replace(/\bhidden\b/g, "");
    topOrderPanel.style.display = "block";
  }
  var orderTab = document.getElementById("qrOrderTabLink");
  var viewTab = document.getElementById("qrViewOrderPlainLink");
  if (orderTab) orderTab.className = String(orderTab.className || "").replace(/\bactive\b/g, "");
  if (viewTab && String(viewTab.className || "").indexOf("active") === -1) viewTab.className += " active";
}

function qrShowMenuMode() {
  keepQrStoreNameVisible();
  setQrPageMode("menu");
  if (topOrderPanel) {
    topOrderPanel.className = (topOrderPanel.className || "") + " hidden";
    topOrderPanel.style.display = "none";
  }
  if (orderPage) {
    orderPage.className = String(orderPage.className || "").replace(/\bhidden\b/g, "");
    orderPage.style.display = "";
  }
  if (successPage) {
    successPage.className = (successPage.className || "") + " hidden";
    successPage.style.display = "none";
  }
  if (floatingCartBtn) floatingCartBtn.style.display = "block";
  var orderTab = document.getElementById("qrOrderTabLink");
  var viewTab = document.getElementById("qrViewOrderPlainLink");
  if (viewTab) viewTab.className = String(viewTab.className || "").replace(/\bactive\b/g, "");
  if (orderTab && String(orderTab.className || "").indexOf("active") === -1) orderTab.className += " active";
}
const orderStatusBox = document.getElementById("orderStatusBox");
const newOrderBtn = document.getElementById("newOrderBtn");
const topNewOrderBtn = document.getElementById("topNewOrderBtn");

const tableInfo = document.getElementById("tableInfo");
const categoryList = document.getElementById("categoryList");
const menuList = document.getElementById("menuList");
const cartList = document.getElementById("cartList");
const cartTotal = document.getElementById("cartTotal");
const submitOrderBtn = document.getElementById("submitOrderBtn");
const customerNameInput = document.getElementById("customerName");
const orderNoteInput = document.getElementById("orderNote");

const qrDineInBtn = document.getElementById("qrDineInBtn");
const qrTakeOutBtn = document.getElementById("qrTakeOutBtn");
const qrTableInput = document.getElementById("qrTableInput");
const qrOrderTypeHint = document.getElementById("qrOrderTypeHint");

const itemModal = document.getElementById("itemModal");
const modalItemName = document.getElementById("modalItemName");
const modalItemPrice = document.getElementById("modalItemPrice");
const sizeSection = document.getElementById("sizeSection");
const addonsSection = document.getElementById("addonsSection");
const spicySection = document.getElementById("spicySection");
const sataySection = document.getElementById("sataySection");
const qtyMinusBtn = document.getElementById("qtyMinusBtn");
const qtyPlusBtn = document.getElementById("qtyPlusBtn");
const modalQty = document.getElementById("modalQty");
const itemNote = document.getElementById("itemNote");
const modalSubtotal = document.getElementById("modalSubtotal");
const addToCartBtn = document.getElementById("addToCartBtn");
const qrCartPanel = document.getElementById("qrCartPanel");
const floatingCartBtn = document.getElementById("floatingCartBtn");
const closeCartBtn = document.getElementById("closeCartBtn");

const confirmModal = document.getElementById("confirmModal");
const confirmContent = document.getElementById("confirmContent");
const confirmTotal = document.getElementById("confirmTotal");
const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");
const backToCartBtn = document.getElementById("backToCartBtn");
const qrHeader = document.querySelector(".qr-header");

initQrModalManager({ headerElements: qrHeader ? [qrHeader] : [] });
registerQrModal(itemModal, {
  openClass: "show-force",
  closeClass: "hidden",
  closeSelector: "[data-qr-modal-close]"
});
registerQrModal(confirmModal, {
  openClass: "show-force",
  closeClass: "hidden",
  closeSelector: "[data-qr-modal-close]"
});
registerQrModal(qrCartPanel, {
  openClass: "cart-open",
  closeClass: "",
  closeSelector: "[data-qr-modal-close]",
  backdropSelector: "[data-cart-close=\"true\"]"
});

const menuRef = ref(db, "menu");
const categoriesRef = ref(db, "categories");
const storeNameRef = ref(db, "settings/storeName");
const qrValidMinutesRef = ref(db, "settings/qrValidMinutes");
const orderLookupMinutesRef = ref(db, "settings/orderLookupMinutes");
const customOptionGroupsRef = ref(db, "customOptionGroups");
const customGroupsRef = ref(db, "customGroups");

let menuData = [];
let categoriesData = {};
let customOptionGroupsData = {};
let customGroupsData = {};
let currentCategory = "全部";
let cart = [];
let qrSessionId = "";
let qrSessionLastActivityAt = 0;
let qrSessionInvalid = false;
let qrSessionInvalidReason = "";
let qrSessionOrderId = "";
window.qrV64SelectedCustomOptions = [];

let currentOrderType = table ? "內用" : "內用";

let selectedItem = null;
let selectedSize = null;
let selectedAddons = [];
let selectedSpicy = "不辣";
let selectedSatay = "不要";
let selectedRequiredOption = "";
let selectedQty = 1;
var qrLastOrderTypeAlertAt = 0;
var qrLastSubmitTapAt = 0;
var qrLastOrderActionAt = 0;
var qrLastOrderActionKey = "";
var qrOrderTypeAlertLocked = false;
var qrSessionController = null;

function getQrSessionController() {
  if (qrSessionController) return qrSessionController;
  qrSessionController = createQrSessionController({
    db: db,
    ref: ref,
    set: set,
    update: update,
    onValue: onValue,
    storeId: STORE_ID,
    table: table || "",
    invalidMessage: QR_SESSION_INVALID_MESSAGE,
    storage: {
      sessionStorage: window.sessionStorage,
      localStorage: window.localStorage
    },
    getTimeoutMinutes: function() {
      return normalizeQrValidMinutes(qrValidMinutes);
    },
    onExpired: function() {
      renderQrSessionExpiredState();
    },
    onError: function(message, error) {
      console.error(message, error);
    }
  });
  return qrSessionController;
}

function getNowMs() {
  return Date.now ? Date.now() : new Date().getTime();
}

function writeQrSessionPatch(patch) {
  getQrSessionController().writePatch(patch);
}

function ensureQrSession() {
  qrSessionId = getQrSessionController().ensure();
  var state = getQrSessionController().getState();
  qrSessionLastActivityAt = state.lastActivityAt;
  qrSessionOrderId = state.orderId || qrSessionOrderId || "";
  return qrSessionId;
}

function markQrSessionActivity(forceSync) {
  getQrSessionController().markActivity(forceSync);
  var state = getQrSessionController().getState();
  qrSessionId = state.id;
  qrSessionLastActivityAt = state.lastActivityAt;
}

function ensureQrSessionExpiredOverlay() {
  var overlay = document.getElementById("qrSessionExpiredOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "qrSessionExpiredOverlay";
  overlay.className = "qr-session-expired-overlay";
  overlay.innerHTML = '<div class="qr-session-expired-card"><h2>點餐已失效</h2><p>' + QR_SESSION_INVALID_MESSAGE + '</p></div>';
  if (document.body) document.body.appendChild(overlay);
  return overlay;
}

function setQrOrderingDisabled(disabled) {
  var buttons = [addToCartBtn, submitOrderBtn, confirmSubmitBtn, floatingCartBtn];
  for (var i = 0; i < buttons.length; i += 1) {
    if (buttons[i]) buttons[i].disabled = disabled;
  }
  if (disabled) addBodyClass("qr-session-expired");
  else removeBodyClass("qr-session-expired");
}

function renderQrSessionExpiredState() {
  qrSessionInvalid = true;
  qrSessionInvalidReason = getQrSessionController().getState().invalidReason || QR_SESSION_INVALID_MESSAGE;
  cart = [];
  renderCart();
  try { closeQrCartPanel(); } catch (e3) {}
  if (itemModal) closeQrModal(itemModal);
  if (confirmModal) closeQrModal(confirmModal);
  var overlay = ensureQrSessionExpiredOverlay();
  overlay.style.display = "flex";
  setQrOrderingDisabled(true);
}

function invalidateQrSession(reason, skipRemoteWrite) {
  getQrSessionController().invalidate(reason || QR_SESSION_INVALID_MESSAGE, skipRemoteWrite);
  var state = getQrSessionController().getState();
  qrSessionInvalid = state.invalid;
  qrSessionInvalidReason = state.invalidReason || QR_SESSION_INVALID_MESSAGE;
  return false;
}

function ensureQrSessionActive() {
  var isActive = getQrSessionController().active();
  var state = getQrSessionController().getState();
  qrSessionInvalid = state.invalid;
  qrSessionInvalidReason = state.invalidReason || "";
  qrSessionId = state.id || qrSessionId;
  qrSessionLastActivityAt = state.lastActivityAt || qrSessionLastActivityAt;
  return isActive;
}

function startQrSessionWatchers() {
  getQrSessionController().start();
  var state = getQrSessionController().getState();
  qrSessionId = state.id;
  qrSessionLastActivityAt = state.lastActivityAt;
  qrSessionOrderId = state.orderId || "";
}

const SPICY_OPTIONS = ["不辣", "微辣", "小辣", "中辣", "大辣"];

function shouldHandleQrOrderAction(event, key, waitMs) {
  var now = Date.now ? Date.now() : new Date().getTime();
  var nextKey = key || "order";
  var interval = waitMs || 900;
  if (qrLastOrderActionKey === nextKey && now - qrLastOrderActionAt < interval) {
    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    return false;
  }
  qrLastOrderActionKey = nextKey;
  qrLastOrderActionAt = now;
  return true;
}

function showQrOrderTypeAlertOnce(message) {
  var now = Date.now ? Date.now() : new Date().getTime();
  if (qrOrderTypeAlertLocked || now - qrLastOrderTypeAlertAt < 2200) return;
  qrOrderTypeAlertLocked = true;
  qrLastOrderTypeAlertAt = now;
  alert(message);
  window.setTimeout(function() {
    qrOrderTypeAlertLocked = false;
  }, 900);
}

function money(n) {
  return `$${Number(n || 0)}`;
}

function initOrderTypeUI() {
  if (table && tableInfo) {
    tableInfo.textContent = `桌號：${table}`;
  }

  if (table) {
    currentOrderType = "內用";
    qrTableInput.value = table;
    qrTableInput.readOnly = true;
    qrDineInBtn.classList.add("active");
    qrTakeOutBtn.classList.remove("active");
    qrOrderTypeHint.textContent = `已鎖定內用 ${table} 桌`;
    return;
  }

  tableInfo.textContent = "掃碼點餐";
  qrTableInput.value = "";
  qrTableInput.readOnly = false;
  qrOrderTypeHint.textContent = "請確認桌號或選擇外帶。";
}

function setOrderType(type) {
  currentOrderType = type;

  if (type === "內用") {
    qrDineInBtn.classList.add("active");
    qrTakeOutBtn.classList.remove("active");
    qrTableInput.style.display = "block";
    qrOrderTypeHint.textContent = "請輸入桌號，或改選外帶。";
    return;
  }

  qrTakeOutBtn.classList.add("active");
  qrDineInBtn.classList.remove("active");
  qrTableInput.style.display = "none";
  qrTableInput.value = "";
  qrOrderTypeHint.textContent = "已選擇外帶，送出後請至櫃檯確認付款。";
}

qrDineInBtn.addEventListener("click", () => {
  if (table) return;
  setOrderType("內用");
});

qrTakeOutBtn.addEventListener("click", () => {
  if (table) return;
  setOrderType("外帶");
});

function normalizeMenu(raw) {
  if (!raw) return [];

  return Object.entries(raw)
    .map(([id, item]) => ({ id, ...item }))
    .filter(item => item.enabled !== false);
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
  return "";
}

function canQrOrderItem(item) {
  return !!item && item.enabled !== false && getSaleStatus(item) === "normal";
}

function getItemCategory(item) {
  return item.category || "其他";
}

function getBasePrice(item) {
  return Number(item.price || item.smallPrice || item.priceSmall || 0);
}

function getImageUrl(item) {
  return item.image || item.imageUrl || item.photo || item.photoUrl || "";
}

var MENU_IMAGE_PLACEHOLDER_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 29h38c0 13-8 22-19 22S13 42 13 29Z"/><path d="M10 27h44M20 54h24M25 23c-5-6 4-8 0-14M35 23c-5-6 4-8 0-14M45 23c-5-6 4-8 0-14"/></svg>';

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

  if (settings[categoryName]) return settings[categoryName].sortOrder;
  if (categoryName === "其他" || categoryName === "未分類") return 999999998;

  return 999999997;
}

function isCategoryVisible(categoryName) {
  const settings = getCategorySettings();

  if (settings[categoryName]) return settings[categoryName].enabled;

  return true;
}

function sortMenuItems(items) {
  return [...items].sort((a, b) => {
    const orderA = getCategorySortOrder(getItemCategory(a));
    const orderB = getCategorySortOrder(getItemCategory(b));

    if (orderA !== orderB) return orderA - orderB;

    const itemOrderA = Number(a.sortOrder !== undefined ? a.sortOrder : 999999999);
    const itemOrderB = Number(b.sortOrder !== undefined ? b.sortOrder : 999999999);

    if (itemOrderA !== itemOrderB) return itemOrderA - itemOrderB;

    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

function getEnabledItems() {
  return sortMenuItems(
    menuData
      .filter(item => item.enabled !== false)
      .filter(item => isCategoryVisible(getItemCategory(item)))
  );
}

function getSizeOptions(item) {
  const options = [];

  if (item.sizes && typeof item.sizes === "object") {
    Object.entries(item.sizes).forEach(([name, price]) => {
      options.push({ name, price: Number(price) });
    });
  }

  if (item.smallPrice || item.priceSmall) {
    options.push({ name: "小份", price: Number(item.smallPrice || item.priceSmall) });
  }

  if (item.largePrice || item.priceLarge) {
    options.push({ name: "大份", price: Number(item.largePrice || item.priceLarge) });
  }

  if (options.length === 0) {
    options.push({ name: "一般", price: Number(item.price || 0) });
  }

  return options;
}

function getAddons(item) {
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

  return [];
}

function getRequiredOption(item) {
  if (!item || !item.requiredOption) return null;

  const requiredOption = item.requiredOption;

  if (!requiredOption.title) return null;
  if (!Array.isArray(requiredOption.options)) return null;
  if (requiredOption.options.length === 0) return null;

  return requiredOption;
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

  if (!categories.includes(currentCategory)) {
    currentCategory = "全部";
  }

  categoryList.innerHTML = categories.map(category => `
    <button class="category-btn ${category === currentCategory ? "active" : ""}" data-category="${category}">
      ${category}
    </button>
  `).join("");

  document.querySelectorAll(".category-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.category;
      renderCategories();
      renderMenu();
    });
  });
}

function renderMenuCard(item) {
  const imageUrl = getImageUrl(item);
  const description = item.description || "";
  const requiredOption = getRequiredOption(item);

  return `
  <button type="button" class="menu-card" data-id="${item.id}">
      <div class="menu-image">
        ${
          imageUrl
            ? `<img src="${imageUrl}" alt="${item.name || "餐點圖片"}">`
            : `<div class="no-image">恩點</div>`
        }
      </div>

      <div class="menu-info">
        <h3>${item.name || "未命名餐點"}</h3>
        <p>${getItemCategory(item)}</p>
        ${description ? `<p class="qr-menu-desc">${description}</p>` : ""}
        ${requiredOption ? `<p class="qr-required-tag">必選：${requiredOption.title}</p>` : ""}
        <strong>${money(getBasePrice(item))}</strong>
      </div>
  </button>
  `;
}

function bindMenuCardEvents() {
  // 舊 iPad 相容：不用每張卡片單獨綁，改由 menuList 父層接收
}

function forceOpenMenuCard(card) {
  if (!card) {
    alert("沒有抓到餐點卡片");
    return;
  }

  var itemId = card.getAttribute("data-id");

  if (!itemId) {
    alert("餐點沒有 data-id");
    return;
  }

  openItemModalById(itemId);
}

function openItemModalById(itemId) {
  var items = getEnabledItems();
  var item = null;

  for (var i = 0; i < items.length; i++) {
    if (String(items[i].id) === String(itemId)) {
      item = items[i];
      break;
    }
  }

  if (!item) {
    alert("找不到餐點資料：" + itemId);
    return;
  }

  openItemModal(item);
}

window.openItemModalById = openItemModalById;
window.forceOpenMenuCard = forceOpenMenuCard;


function renderMenu() {
  let items = getEnabledItems();

  if (currentCategory !== "全部") {
    items = items.filter(item => getItemCategory(item) === currentCategory);
  }

  if (items.length === 0) {
    menuList.innerHTML = `<div class="empty">目前沒有餐點</div>`;
    return;
  }

  if (currentCategory === "全部") {
    const grouped = {};

    items.forEach(item => {
      const category = getItemCategory(item);
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(item);
    });

    menuList.innerHTML = Object.entries(grouped)
      .sort((a, b) => getCategorySortOrder(a[0]) - getCategorySortOrder(b[0]))
      .map(([category, categoryItems]) => `
        <section class="qr-category-section">
          <h3>${category}</h3>
          <div class="qr-category-grid">
            ${categoryItems.map(renderMenuCard).join("")}
          </div>
        </section>
      `).join("");

    bindMenuCardEvents();
    return;
  }

  menuList.innerHTML = `
    <section class="qr-category-section">
      <h3>${currentCategory}</h3>
      <div class="qr-category-grid">
        ${items.map(renderMenuCard).join("")}
      </div>
    </section>
  `;

  bindMenuCardEvents();
}


function renderQrModalFoodImage(item) {
  if (!itemModal || !modalItemName) return;

  var oldBox = document.getElementById("qrModalFoodImageBox");
  if (oldBox && oldBox.parentNode) oldBox.parentNode.removeChild(oldBox);

  var imageUrl = getImageUrl(item || {});
  var box = document.createElement("div");
  box.id = "qrModalFoodImageBox";
  box.className = "qr-modal-food-image";

  if (imageUrl) {
    box.innerHTML = '<img src="' + imageUrl + '" alt="餐點圖片" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="qr-modal-no-image meal-image-placeholder" style="display:none">' + MENU_IMAGE_PLACEHOLDER_ICON + '</div>';
  } else {
    box.innerHTML = '<div class="qr-modal-no-image meal-image-placeholder">' + MENU_IMAGE_PLACEHOLDER_ICON + '</div>';
  }

  modalItemName.parentNode.insertBefore(box, modalItemName);
}

function openItemModal(item) {
  if (!ensureQrSessionActive()) return;
  if (!item) {
    alert("找不到這個餐點");
    return;
  }

  selectedItem = item;
  window.qrV64SelectedCustomOptions = [];
  selectedAddons = [];
  selectedSpicy = "不辣";
  selectedSatay = "不要";
  selectedRequiredOption = "";
  selectedQty = 1;

  if (itemNote) {
    itemNote.value = "";
  }

  var sizes = getSizeOptions(item);

  if (sizes && sizes.length > 0) {
    selectedSize = sizes[0];
  } else {
    selectedSize = {
      name: "一般",
      price: getBasePrice(item)
    };
  }

  modalItemName.textContent = item.name || "未命名餐點";
  modalItemPrice.textContent = "起價 " + money(getBasePrice(item));
  renderQrModalFoodImage(item);

  openQrModal(itemModal);

  try {
    renderModalOptions();
    updateModalSubtotal();
  } catch (error) {
    console.error("餐點視窗內容載入失敗：", error);
    alert("餐點視窗內容載入失敗：" + error.message);
  }
}

function renderModalOptions() {
  sizeSection.innerHTML = selectedItem.description ? `<div class="qr-item-description-box">${selectedItem.description}</div>` : "";
  addonsSection.innerHTML = "";
  spicySection.innerHTML = "";
  sataySection.innerHTML = "";

  modalQty.textContent = selectedQty;
  renderQrCustomOptionGroups();
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
  if (allowSpicy(item)) groups.push({ id: "__legacy_spicy", name: "辣度", area: "customer", selectionType: "single", required: false, options: SPICY_OPTIONS.map(function(name, index) { return { id: "__legacy_spicy_" + index, name: name, price: 0, enabled: true, sortOrder: (index + 1) * 1000 }; }) });
  if (allowSatay(item)) groups.push({ id: "__legacy_satay", name: "沙茶", area: "customer", selectionType: "single", required: false, options: ["要沙茶", "不要沙茶"].map(function(name, index) { return { id: "__legacy_satay_" + index, name: name, price: 0, enabled: true, sortOrder: (index + 1) * 1000 }; }) });
  if (moduleName === "qr") return groups.filter(function(group) { return group.area !== "posOnly"; });
  return groups;
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

function findQrSelectedCustomOption(groupId, optionName) {
  var selected = window.qrV64SelectedCustomOptions || [];
  for (var i = 0; i < selected.length; i += 1) {
    if (String(selected[i].groupId) === String(groupId) && String(selected[i].name) === String(optionName)) return selected[i];
  }
  return null;
}

function isQrSizeOptionGroup(group) {
  var id = String(group && group.id || "");
  var name = String(group && group.name || "").toLowerCase();
  return id === "__legacy_sizes" || name.indexOf("份量") !== -1 || name.indexOf("size") !== -1 || name.indexOf("大小") !== -1;
}

function isQrSizeCustomOption(option) {
  var groupId = String(option && option.groupId || "");
  var groupName = String(option && option.groupName || "").toLowerCase();
  return groupId === "__legacy_sizes" || groupName.indexOf("份量") !== -1 || groupName.indexOf("size") !== -1 || groupName.indexOf("大小") !== -1;
}

function getQrSelectedSizeName(customOptions, defaultName) {
  var list = Array.isArray(customOptions) ? customOptions : [];
  for (var i = 0; i < list.length; i += 1) {
    if (isQrSizeCustomOption(list[i]) && list[i].name) return String(list[i].name);
  }
  return defaultName || "";
}

function normalizeQrOptionPriceForGroup(group, option, menuItem) {
  var rawPrice = Number(option && option.price || 0);
  if (!isQrSizeOptionGroup(group) || String(group && group.id || "") === "__legacy_sizes") return rawPrice;

  var basePrice = Number(getBasePrice(menuItem || selectedItem) || 0);
  if (basePrice > 0 && rawPrice >= basePrice) return rawPrice - basePrice;
  return rawPrice;
}

function renderQrCustomOptionGroups() {
  var oldBox = document.getElementById("qrCustomOptionGroupsBox");
  if (oldBox && oldBox.parentNode) oldBox.parentNode.removeChild(oldBox);
  if (!selectedItem || !addonsSection) return;
  var groups = getAppliedCustomGroups(selectedItem, "qr");
  if (!groups.length) return;
  var box = document.createElement("div");
  box.id = "qrCustomOptionGroupsBox";
  box.className = "v64-custom-groups";
  var html = "";
  for (var g = 0; g < groups.length; g += 1) {
    var group = groups[g];
    html += '<div class="v64-custom-group"><h3>' + escapeHtml(group.name) + '</h3><div class="option-grid">';
    for (var o = 0; o < group.options.length; o += 1) {
      var option = typeof group.options[o] === "string" ? { name: group.options[o] } : group.options[o];
      var name = option.name || option.label || option.value || "";
      var selected = findQrSelectedCustomOption(group.id, name);
      var optionPrice = normalizeQrOptionPriceForGroup(group, option, selectedItem);
      var priceText = Number(option.price || 0) > 0 ? " +" + Number(option.price || 0) : (Number(option.price || 0) < 0 ? " " + Number(option.price || 0) : "");
      var modules = group.modules || {};
      html += '<button type="button" class="option-btn qr-v64-option ' + (selected ? "active" : "") + '" data-group-id="' + escapeHtml(group.id) + '" data-group-name="' + escapeHtml(group.name) + '" data-selection-type="' + escapeHtml(group.selectionType || "single") + '" data-option-name="' + escapeHtml(name) + '" data-option-price="' + optionPrice + '" data-qty-enabled="' + (group.allowQuantity || option.qtyEnabled || option.quantityEnabled || option.allowQuantity ? "true" : "false") + '" data-max-qty="' + Number(option.maxQty || option.maxQuantity || 1) + '" data-module-qr="' + (modules.qr === true ? "true" : "false") + '" data-module-pos="' + (modules.pos !== false ? "true" : "false") + '" data-module-kds="' + (modules.kds !== false ? "true" : "false") + '" data-module-print="' + (modules.print !== false ? "true" : "false") + '">' + escapeHtml(name) + priceText + (selected && Number(selected.qty || 1) > 1 ? " x" + Number(selected.qty || 1) : "") + '</button>';
    }
    html += '</div></div>';
  }
  box.innerHTML = html;
  addonsSection.appendChild(box);
  var buttons = box.querySelectorAll(".qr-v64-option");
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].addEventListener("click", function() {
      toggleQrCustomOption(this);
    });
  }
}

function toggleQrCustomOption(button) {
  var list = window.qrV64SelectedCustomOptions || [];
  var groupId = button.getAttribute("data-group-id");
  var name = button.getAttribute("data-option-name");
  var selectionType = button.getAttribute("data-selection-type") || "single";
  var found = -1;
  for (var i = 0; i < list.length; i += 1) {
    if (String(list[i].groupId) === String(groupId) && String(list[i].name) === String(name)) found = i;
  }
  if (found >= 0) {
    if (list[found].qtyEnabled && Number(list[found].qty || 1) < Number(list[found].maxQty || 1)) {
      list[found].qty = Number(list[found].qty || 1) + 1;
      list[found].quantity = list[found].qty;
    } else {
      list.splice(found, 1);
    }
  } else {
    if (selectionType === "single") {
      list = list.filter(function(item) { return String(item.groupId) !== String(groupId); });
    }
    list.push({ groupId: groupId, groupName: button.getAttribute("data-group-name"), name: name, price: Number(button.getAttribute("data-option-price") || 0), qty: 1, quantity: 1, selectionType: selectionType, qtyEnabled: button.getAttribute("data-qty-enabled") === "true", maxQty: Number(button.getAttribute("data-max-qty") || 1), modules: { qr: button.getAttribute("data-module-qr") === "true", pos: button.getAttribute("data-module-pos") !== "false", kds: button.getAttribute("data-module-kds") !== "false", print: button.getAttribute("data-module-print") !== "false" } });
  }
  window.qrV64SelectedCustomOptions = list;
  syncSelectedSizeFromCustomOptions();
  renderModalOptions();
  updateModalSubtotal();
}

function validateQrRequiredCustomGroups(item) {
  var groups = getAppliedCustomGroups(item, "qr");
  var selected = window.qrV64SelectedCustomOptions || [];
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

function updateModalSubtotal() {
  const priced = calculateOrderItemPrice({
    basePrice: Number(selectedSize && selectedSize.price || getBasePrice(selectedItem) || 0),
    addons: selectedAddons,
    customOptions: window.qrV64SelectedCustomOptions || [],
    quantity: selectedQty
  });
  modalSubtotal.textContent = money(priced.subtotal);
}

function syncSelectedSizeFromCustomOptions() {
  var sizeName = getQrSelectedSizeName(window.qrV64SelectedCustomOptions || [], "");
  if (!sizeName) return;
  selectedSize = { name: sizeName, price: getBasePrice(selectedItem) };
}

function addQrStableTapListener(element, handler) {
  if (!element || !handler) return;
  var lastTouchAt = 0;
  function run(event) {
    var now = Date.now ? Date.now() : new Date().getTime();
    if (event && event.type === "touchend") lastTouchAt = now;
    if (event && event.type === "click" && now - lastTouchAt < 500) return;
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    handler(event);
  }
  element.addEventListener("touchend", run, false);
  element.addEventListener("click", run, false);
}

addQrStableTapListener(qtyMinusBtn, function() {
  selectedQty = Math.max(1, selectedQty - 1);
  modalQty.textContent = selectedQty;
  renderModalOptions();
  updateModalSubtotal();
});

addQrStableTapListener(qtyPlusBtn, function() {
  selectedQty++;
  modalQty.textContent = selectedQty;
  renderModalOptions();
  updateModalSubtotal();
});

var qrLastAddCartAt = 0;

function qrAddCurrentItemToCart(event) {
  if (!ensureQrSessionActive()) {
    if (event) {
      event.preventDefault && event.preventDefault();
      event.stopPropagation && event.stopPropagation();
    }
    return false;
  }
  var nowTime = new Date().getTime();
  if (nowTime - qrLastAddCartAt < 650) {
    if (event) {
      event.preventDefault && event.preventDefault();
      event.stopPropagation && event.stopPropagation();
    }
    return false;
  }
  qrLastAddCartAt = nowTime;

  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }

  if (!selectedItem) {
    alert("請先選擇餐點");
    return false;
  }

  var missingCustomGroup = validateQrRequiredCustomGroups(selectedItem);
  if (missingCustomGroup) {
    alert("請先選擇「" + missingCustomGroup + "」");
    return false;
  }

  syncSelectedSizeFromCustomOptions();
  var selectedCustomOptions = window.qrV64SelectedCustomOptions || [];
  var selectedSizeName = getQrSelectedSizeName(selectedCustomOptions, selectedSize ? selectedSize.name : "");
  var basePrice = Number(selectedSize && selectedSize.price || getBasePrice(selectedItem) || 0);
  var nowId = selectedItem.id + "-" + new Date().getTime();

  var nextCartItem = {
    id: nowId,
    cartId: nowId,
    itemId: selectedItem.id,
    name: selectedItem.name,
    itemName: selectedItem.name,
    category: getItemCategory(selectedItem),
    size: selectedSizeName,
    basePrice: basePrice,
    requiredOption: null,
    customOptions: selectedCustomOptions,
    addons: selectedAddons,
    extras: [],
    spicy: "",
    satay: "",
    note: itemNote ? itemNote.value.trim() : "",
    qty: selectedQty,
    quantity: selectedQty
  };
  cart.push(nextCartItem);

  if (itemModal) closeQrModal(itemModal);

  renderCart();
  return false;
}

if (addToCartBtn) {
  addQrStableTapListener(addToCartBtn, qrAddCurrentItemToCart);
}

function forceResetQrOrder(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }

  var sessionOrderId = getQrSessionController().getOrderId() || currentViewingOrderId || "";
  if (sessionOrderId) {
    loadViewingOrderById(sessionOrderId, false);
    return false;
  }

  try {
    localStorage.removeItem(LAST_ORDER_KEY);
  } catch (e) {}
  if (window.history && window.history.replaceState) {
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) {}
  }

  cart = [];
  selectedItem = null;
  if (successPage) {
    successPage.className = (successPage.className || "") + " hidden";
    successPage.style.display = "none";
  }
  if (orderPage) {
    orderPage.className = (orderPage.className || "").replace(/\bhidden\b/g, "");
    orderPage.style.display = "";
  }
  if (confirmModal) closeQrModal(confirmModal);
  if (itemModal) closeQrModal(itemModal);
  qrShowMenuMode();
  keepQrStoreNameVisible();
  closeQrCartPanel();
  renderCart();
  renderCategories();
  renderMenu();
  return false;
}
window.forceResetQrOrder = forceResetQrOrder;
if (newOrderBtn) {
  newOrderBtn.addEventListener("click", forceResetQrOrder);
}
if (topNewOrderBtn) {
  topNewOrderBtn.addEventListener("click", forceResetQrOrder);
}

function getQrCartTotal() {
  return calculateOrderTotal(cart);
}

function updateFloatingCartButton() {
  if (!floatingCartBtn) return;
  var count = 0;
  for (var i = 0; i < cart.length; i++) {
    count += calculateOrderItemPrice(cart[i]).quantity;
  }
  floatingCartBtn.innerHTML = "購物車 " + count + " 項｜" + money(getQrCartTotal());
}

function openQrCartPanel(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }
  if (!ensureQrSessionActive()) return false;
  if (qrCartPanel) openQrModal(qrCartPanel, { openClass: "cart-open", closeClass: "" });
  return false;
}

function closeQrCartPanel(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }
  if (qrCartPanel) closeQrModal(qrCartPanel, event);
  return false;
}

window.openQrCartPanel = openQrCartPanel;
window.closeQrCartPanel = closeQrCartPanel;
if (floatingCartBtn) floatingCartBtn.addEventListener("click", openQrCartPanel);
if (closeCartBtn) closeCartBtn.addEventListener("click", closeQrCartPanel);

if (qrCartPanel) qrCartPanel.setAttribute("aria-hidden", "true");

function removeQrCartItem(index) {
  var nextIndex = Number(index);
  if (nextIndex < 0 || nextIndex >= cart.length) return false;
  cart.splice(nextIndex, 1);
  renderCart();
  return false;
}

function renderCart() {
  if (cart.length === 0) {
    cartList.innerHTML = `<div class="empty">尚未選擇餐點</div>`;
    cartTotal.textContent = money(0);
    updateFloatingCartButton();
    return;
  }

  cartList.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <div>
        <strong>${escapeHtml(itemDisplayName(item))} × ${item.qty}</strong>
        <div class="cart-detail">
          ${renderItemDetail(item)}
        </div>
      </div>

      <div class="cart-price">
        <strong>${money(calculateOrderItemPrice(item).subtotal)}</strong>
        <button class="remove-btn" data-index="${index}">刪除</button>
      </div>
    </div>
  `).join("");

  cartList.querySelectorAll(".remove-btn").forEach(btn => {
    addQrStableTapListener(btn, function() {
      removeQrCartItem(btn.getAttribute("data-index"));
      return false;
    });
  });

  const total = calculateOrderTotal(cart);
  cartTotal.textContent = money(total);
  updateFloatingCartButton();
}

function getOrderMeta() {
  if (currentOrderType === "內用") {
    const tableValue = (table || qrTableInput.value.trim()).trim();

    return {
      type: "內用",
      table: tableValue,
      customerLabel: customerNameInput.value.trim() || (tableValue ? `${tableValue}桌` : "內用客人")
    };
  }

  return {
    type: "外帶",
    table: "",
    customerLabel: customerNameInput.value.trim() || "外帶客人"
  };
}

function validateOrderType() {
  if (currentOrderType === "內用") {
    var tableValueForAlert = (table || qrTableInput.value.trim()).trim();
    if (!tableValueForAlert) {
      showQrOrderTypeAlertOnce("請輸入桌號，或改選外帶。");
      return false;
    }
  }

  if (currentOrderType === "內用") {
    const tableValue = (table || qrTableInput.value.trim()).trim();

    if (!tableValue) {
      var nowTime = Date.now ? Date.now() : new Date().getTime();
      if (nowTime - qrLastOrderTypeAlertAt > 1200) {
        qrLastOrderTypeAlertAt = nowTime;
        alert("請輸入桌號，或改選外帶。");
      }
      return false;
    }
  }

  return true;
}

function renderConfirmModal() {
  if (!ensureQrSessionActive()) return;
  if (!validateOrderType()) return;

  const total = calculateOrderTotal(cart);
  const meta = getOrderMeta();

  confirmTotal.textContent = money(total);

  confirmContent.innerHTML = `
    <div class="confirm-table">${meta.type}${meta.table ? `｜${meta.table}桌` : ""}</div>

    ${cart.map(item => `
      <div class="confirm-item">
        <div class="confirm-item-main">• ${escapeHtml(itemDisplayName(item))} × ${item.qty}</div>

        <div class="confirm-item-detail">
          ${renderItemDetail(item)}
          <p>小計：${money(calculateOrderItemPrice(item).subtotal)}</p>
        </div>
      </div>
    `).join("")}
  `;

  openQrModal(confirmModal);
}

window.qrSubmitOrderNow = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!ensureQrSessionActive()) return false;

  if (!shouldHandleQrOrderAction(event, "submitOrder", 2200)) return false;

  if (cart.length === 0) {
    alert("購物車目前是空的");
    return false;
  }

  renderConfirmModal();
  return false;
};

submitOrderBtn.addEventListener("click", event => {
  if (event && event.defaultPrevented) return false;
  return window.qrSubmitOrderNow(event);
});

backToCartBtn.addEventListener("click", event => {
  closeQrModal(confirmModal, event);
});

function submitConfirmedQrOrder(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }

  var nowTap = Date.now ? Date.now() : new Date().getTime();
  if (qrLastSubmitTapAt && nowTap - qrLastSubmitTapAt < 900) return false;
  qrLastSubmitTapAt = nowTap;

  if (!ensureQrSessionActive()) return false;
  if (!validateOrderType()) return false;
  if (!cart || cart.length === 0) {
    alert("購物車目前是空的");
    return false;
  }

  confirmSubmitBtn.disabled = true;
  confirmSubmitBtn.textContent = "送出中...";

  var total = calculateOrderTotal(cart);
  var orderRef = push(ref(db, "orders"));
  var now = Date.now();
  var businessDate = getBusinessDate();
  var meta = getOrderMeta();

  createOrderNumber("qr", { storeId: STORE_ID, businessDate: businessDate })
    .then(function (orderNumber) {
      var order = {
        id: orderRef.key,
        orderNumber: orderNumber,
        businessDate: businessDate,
        businessDay: businessDate,
        storeId: STORE_ID,
        orderSource: "QR",
        sourcePrefix: "Q",
        deviceType: "qr",
        source: "QR",
        qrSessionId: qrSessionId,
        type: meta.type,
        table: meta.table,
        customerName: customerNameInput.value.trim(),
        customerLabel: meta.customerLabel,
        note: orderNoteInput.value.trim(),
        items: cart,
        total: total,
        status: "pending_payment",
        statusText: "等待櫃檯確認付款",
        paymentStatus: "unpaid",
        kitchenStatus: "waiting",
        confirmed: false,
        paid: false,
        closed: false,
        cancelled: false,
        createdAt: now,
        updatedAt: now
      };

      return set(orderRef, order).then(function () {
        return order;
      });
    })
    .then(function (order) {
      saveCurrentViewingOrderId(order.id);
      qrSessionOrderId = order.id;
      getQrSessionController().setSubmittedOrder(order.id);

      closeQrModal(confirmModal);
      closeQrCartPanel();
      showSubmittedOrderView(order, true);
      listenOrderStatus(order.id);

      cart = [];
      customerNameInput.value = "";
      orderNoteInput.value = "";
      if (!table && currentOrderType === "內用") {
        qrTableInput.value = "";
      }
      renderCart();
    })
    .catch(function (error) {
      console.error("QR 送出失敗：", error);
      alert("送出失敗：" + (error && error.message ? error.message : "請稍後再試。"));
    })
    .then(function () {
      confirmSubmitBtn.disabled = false;
      confirmSubmitBtn.textContent = "確認送出";
    });

  return false;
}

confirmSubmitBtn.addEventListener("click", submitConfirmedQrOrder);
window.submitConfirmedQrOrder = submitConfirmedQrOrder;

function getOrderStatusText(order) {
  if (!order) return "等待櫃檯確認付款";

  if (order.status === "cancelled" || order.kitchenStatus === "cancelled" || order.cancelled === true) {
    return "訂單已取消，請洽櫃檯";
  }

  if (order.status === "closed" || order.closed === true) {
    return "訂單已結案，謝謝光臨";
  }

  if (order.kitchenStatus === "done" || order.status === "done") {
    return "餐點已完成，請留意取餐或送餐";
  }

  if (order.kitchenStatus === "cooking" || order.status === "cooking") {
    return "餐點製作中，請耐心等候";
  }

  if (order.kitchenStatus === "confirmed" || order.status === "confirmed" || order.paymentStatus === "paid") {
    return "已確認付款，餐點安排製作中";
  }

  return "等待櫃檯確認付款";
}

function buildQrOrderHtml(order) {
  return `
    <div class="success-order-id">訂單編號：${order.orderNumber || order.id}</div>
    <div class="success-time">時間：${new Date(order.createdAt).toLocaleString("zh-TW", { hour12: false })}</div>
    <div class="success-table">${order.type || "QR 點餐"}${order.table ? `｜${order.table}桌` : ""}</div>

    ${Array.isArray(order.items) ? order.items.map(item => `
      <div class="success-item">
        <div class="success-item-main">• ${escapeHtml(itemDisplayName(item))} × ${item.qty || item.quantity || 1}</div>

        <div class="success-item-detail">
          ${renderItemDetail(item)}
          <p>小計：${money(calculateOrderItemPrice(item).subtotal)}</p>
        </div>
      </div>
    `).join("") : ""}

    <div class="success-total">總計：${money(order.total)}</div>
  `;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderItemDetail(item) {
  return formatOrderOptionHtml(item, escapeHtml, { moduleName: "qr" });
}

window.renderItemDetail = renderItemDetail;

function getDirectOrderIdFromUrl() {
  return "";
}

function getPaymentStatusText(order) {
  if (!order) return "未知";
  if (order.paymentStatus === "paid" || order.paid === true) return "已付款";
  if (order.paymentStatus === "cancelled" || order.status === "cancelled") return "已取消";
  return "未付款 / 待櫃檯確認";
}

function getKitchenStatusText(order) {
  if (!order) return "未知";
  if (order.status === "cancelled" || order.kitchenStatus === "cancelled" || order.cancelled === true) return "訂單已取消";
  if (order.status === "closed" || order.closed === true) return "訂單已結案";
  if (order.kitchenStatus === "done" || order.status === "done") return "餐點已完成";
  if (order.kitchenStatus === "cooking" || order.status === "cooking") return "製作中";
  if (order.kitchenStatus === "confirmed" || order.status === "confirmed" || order.paymentStatus === "paid") return "已送廚房 / 等待製作";
  return "等待櫃檯確認";
}

function isOrderDoneForLookup(order) {
  return !!order && (order.status === "done" || order.kitchenStatus === "done");
}

function getOrderCompletedTime(order) {
  if (!order) return 0;
  return Number(order.completedAt || order.doneAt || 0);
}

function isOrderLookupExpired(order) {
  var minutes = normalizeQrOrderLookupMinutes(orderLookupMinutes);
  if (minutes === 0) return false;
  var startedAt = Number(order && (order.createdAt || order.timestamp || order.updatedAt || 0));
  if (!startedAt) return false;
  var now = Date.now ? Date.now() : new Date().getTime();
  return now - startedAt > minutes * 60 * 1000;
}

function itemDisplayName(item) {
  return item && (item.displayName || item.itemName || item.name) || "未命名餐點";
}

function buildDirectItemDetailHtml(item) {
  var html = formatOrderOptionHtml(item, escapeHtml, { moduleName: "qr" });
  return html ? '<div class="qr-direct-item-detail">' + html + '</div>' : "";
}

function buildDirectOrderViewHtml(order) {
  if (isOrderLookupExpired(order)) {
    return '' +
      '<div class="qr-direct-order-card qr-direct-expired-card">' +
        '<div class="qr-direct-store-name">' + escapeHtml(qrStoreName || DEFAULT_QR_STORE_NAME) + '</div>' +
        '<div class="qr-direct-expired-message">此訂單已超過查看保留時間，請重新點餐或洽店員。</div>' +
      '</div>';
  }

  var items = Array.isArray(order.items) ? order.items : [];
  return '' +
    '<div class="qr-direct-order-card">' +
      '<div class="qr-direct-store-name">' + escapeHtml(qrStoreName || DEFAULT_QR_STORE_NAME) + '</div>' +
      '<div class="qr-direct-number"><span>訂單號</span><strong>' + escapeHtml(order.orderNumber || order.id || "-") + '</strong></div>' +
      '<div class="qr-direct-status-grid">' +
        '<div><span>付款狀態</span><strong>' + escapeHtml(getPaymentStatusText(order)) + '</strong></div>' +
        '<div><span>製作狀態</span><strong>' + escapeHtml(getKitchenStatusText(order)) + '</strong></div>' +
      '</div>' +
      '<div class="qr-direct-meta">' +
        '<p>' + escapeHtml(order.type || "訂單") + (order.table ? '｜' + escapeHtml(order.table) + '桌' : '') + '</p>' +
        '<p>時間：' + escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString("zh-TW", { hour12: false }) : "-") + '</p>' +
      '</div>' +
      '<h3>餐點摘要</h3>' +
      '<div class="qr-direct-items">' +
        (items.length ? items.map(function(item) {
          var qty = Number(item.qty || item.quantity || 1);
          var subtotal = calculateOrderItemPrice(item).subtotal;
          return '<div class="qr-direct-item">' +
            '<div class="qr-direct-item-main"><span>' + escapeHtml(itemDisplayName(item)) + '</span><b>× ' + qty + '</b></div>' +
            buildDirectItemDetailHtml(item) +
            '<div class="qr-direct-item-subtotal">小計：' + money(subtotal) + '</div>' +
          '</div>';
        }).join("") : '<div class="empty">此訂單沒有餐點資料</div>') +
      '</div>' +
      '<div class="qr-direct-total">總計：' + money(order.total || 0) + '</div>' +
    '</div>';
}

function showDirectOrderShell() {
  setQrPageMode("order");
  qrShowOrderMode();
  if (orderPage) orderPage.style.display = "none";
  if (successPage) successPage.style.display = "none";
  if (floatingCartBtn) floatingCartBtn.style.display = "none";
  if (topOrderPanel) {
    topOrderPanel.className = String(topOrderPanel.className || "").replace(/\bhidden\b/g, "");
    topOrderPanel.style.display = "block";
  }
}

function updateOrderUrl(orderId) {
  return;
}

function showSubmittedOrderView(order, updateUrl) {
  if (!order) return;
  if (order.id) saveCurrentViewingOrderId(order.id);
  if (updateUrl !== false) updateOrderUrl(order.id);
  showDirectOrderShell();
  if (topOrderContent) topOrderContent.innerHTML = buildDirectOrderViewHtml(order);
  if (orderStatusBox) orderStatusBox.textContent = "狀態：" + getOrderStatusText(order);
  try { window.scrollTo(0, 0); } catch (e) {}
}

function loadViewingOrderById(orderId, updateUrl) {
  var id = orderId || getSavedViewingOrderId();
  if (!id || !getQrSessionController().canViewOrder(id)) {
    renderDirectOrderMissing();
    return false;
  }
  showDirectOrderShell();
  if (topOrderContent) topOrderContent.innerHTML = '<div class="qr-direct-order-card"><div class="empty">讀取訂單中...</div></div>';
  try {
    onValue(ref(db, "orders/" + id), function(snapshot) {
      var order = snapshot && snapshot.val ? snapshot.val() : null;
      if (!order) {
        renderDirectOrderMissing();
        return;
      }
      var fullOrder = Object.assign({ id: id }, order);
      showSubmittedOrderView(fullOrder, updateUrl);
    }, { onlyOnce: true });
  } catch (error) {
    console.error("讀取 QR 訂單失敗：", error);
    renderDirectOrderMissing();
  }
  return true;
}

function renderDirectOrderMissing() {
  showDirectOrderShell();
  if (topOrderContent) {
    topOrderContent.innerHTML = '<div class="qr-direct-order-card"><div class="empty">目前沒有可查看的訂單。</div></div>';
  }
}

function initDirectOrderView() {
  return false;
}

function renderTopOrderOnly(order) {
  if (topOrderContent) {
    topOrderContent.innerHTML = buildQrOrderHtml(order);
  }
  qrShowOrderMode();
  if (orderStatusBox) {
    orderStatusBox.textContent = `狀態：${getOrderStatusText(order)}`;
  }
}

function showSuccessPage(order) {
  orderPage.classList.add("hidden");
  successPage.classList.remove("hidden");

  if (orderStatusBox) {
    orderStatusBox.textContent = `狀態：${getOrderStatusText(order)}`;
  }

  var orderHtml = buildQrOrderHtml(order);

  successContent.innerHTML = orderHtml;

  if (topOrderContent) {
    topOrderContent.innerHTML = orderHtml;
  }
}

function listenOrderStatus(orderId) {
  const orderRef = ref(db, `orders/${orderId}`);

  onValue(orderRef, snapshot => {
    const order = snapshot.val();
    if (!order) {
      if (getQrSessionController().canViewOrder(orderId)) {
        getQrSessionController().expireForCompletedOrder(orderId);
      }
      return;
    }
    var fullOrder = { id: orderId, ...order };
    if (
      getQrSessionController().canViewOrder(orderId) &&
      (fullOrder.status === "closed" ||
        fullOrder.status === "done" ||
        fullOrder.status === "completed" ||
        fullOrder.closed === true)
    ) {
      getQrSessionController().expireForCompletedOrder(orderId);
      return;
    }
    var bodyClass = document.body ? " " + String(document.body.className || "") + " " : "";
    var isOrderVisible = bodyClass.indexOf(" qr-direct-order-mode ") >= 0 || bodyClass.indexOf(" qr-tab-order ") >= 0;
    var isSuccessVisible = successPage && (" " + String(successPage.className || "") + " ").indexOf(" hidden ") === -1 && successPage.style.display !== "none";

    if (getDirectOrderIdFromUrl() || isOrderVisible) {
      showSubmittedOrderView(fullOrder, false);
    } else if (qrIsViewOrderMode()) {
      renderTopOrderOnly(fullOrder);
    } else if (isSuccessVisible) {
      showSuccessPage(fullOrder);
    }

    if (orderStatusBox) {
      orderStatusBox.textContent = `狀態：${getOrderStatusText(fullOrder)}`;
    }
  });
}

if (newOrderBtn) {
  newOrderBtn.addEventListener("click", forceResetQrOrder);
}

function loadLastOrderIfExists() {
  qrShowMenuMode();
}

function loadMenu() {
  onValue(menuRef, snapshot => {
    menuData = normalizeMenu(snapshot.val());
    renderCategories();
    renderMenu();
  });

  onValue(categoriesRef, snapshot => {
    categoriesData = snapshot.exists() ? snapshot.val() : {};
    renderCategories();
    renderMenu();
  });

  onValue(customOptionGroupsRef, function(snapshot) {
    customOptionGroupsData = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : {};
    renderMenu();
  });

  onValue(customGroupsRef, function(snapshot) {
    customGroupsData = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : {};
    renderMenu();
  });
}

function loadQrStoreName() {
  try {
    applyQrStoreName(localStorage.getItem("storeName") || DEFAULT_QR_STORE_NAME);
  } catch (e) {
    applyQrStoreName(DEFAULT_QR_STORE_NAME);
  }

  onValue(storeNameRef, function(snapshot) {
    var name = snapshot && snapshot.exists && snapshot.exists() ? String(snapshot.val() || "").trim() : "";
    if (name) {
      qrHasStoreNameFromFirebase = true;
      applyQrStoreName(name);
    } else if (!qrHasStoreNameFromFirebase && (!qrStoreName || qrStoreName === DEFAULT_QR_STORE_NAME)) {
      applyQrStoreName(DEFAULT_QR_STORE_NAME);
    } else {
      keepQrStoreNameVisible();
    }
    try {
      if (name) localStorage.setItem("storeName", name);
    } catch (e) {}
  });
}

function applyOrderLookupMinutes(value) {
  orderLookupMinutes = normalizeQrOrderLookupMinutes(value);
  try { localStorage.setItem("orderLookupMinutes", String(orderLookupMinutes)); } catch (e) {}
}

function loadOrderLookupMinutes() {
  try {
    applyOrderLookupMinutes(localStorage.getItem("orderLookupMinutes") || DEFAULT_ORDER_LOOKUP_MINUTES);
  } catch (e) {
    applyOrderLookupMinutes(DEFAULT_ORDER_LOOKUP_MINUTES);
  }

  onValue(orderLookupMinutesRef, function(snapshot) {
    var value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : DEFAULT_ORDER_LOOKUP_MINUTES;
    applyOrderLookupMinutes(value);
    if (currentViewingOrderId && document.body && (" " + (document.body.className || "") + " ").indexOf(" qr-tab-order ") >= 0) {
      loadViewingOrderById(currentViewingOrderId, false);
    }
  });
}

function applyQrValidMinutes(value) {
  qrValidMinutes = normalizeQrValidMinutes(value);
  try { localStorage.setItem("qrValidMinutes", String(qrValidMinutes)); } catch (e) {}
}

function loadQrValidMinutes() {
  try {
    applyQrValidMinutes(localStorage.getItem("qrValidMinutes") || DEFAULT_QR_VALID_MINUTES);
  } catch (e) {
    applyQrValidMinutes(DEFAULT_QR_VALID_MINUTES);
  }
  onValue(qrValidMinutesRef, function(snapshot) {
    var value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : DEFAULT_QR_VALID_MINUTES;
    applyQrValidMinutes(value);
  });
}

function isQrOrderingExpired() {
  return getQrSessionController().isExpired();
}

function showQrOrderingExpired() {
  invalidateQrSession(QR_SESSION_INVALID_MESSAGE, false);
  return;
}

function renderMenuCardV64(item) {
  var imageUrl = getImageUrl(item);
  var description = item.description || "";
  var requiredOption = getRequiredOption(item);
  var saleStatus = getSaleStatus(item);
  var saleText = getSaleStatusText(item);
  return '' +
    '<button type="button" class="menu-card sale-' + saleStatus + '" data-id="' + escapeHtml(item.id) + '" ' + (canQrOrderItem(item) ? "" : 'aria-disabled="true"') + '>' +
      '<div class="menu-image">' + (imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(item.name || "餐點") + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="no-image meal-image-placeholder" style="display:none">' + MENU_IMAGE_PLACEHOLDER_ICON + '</div>' : '<div class="no-image meal-image-placeholder">' + MENU_IMAGE_PLACEHOLDER_ICON + '</div>') + '</div>' +
      '<div class="menu-info"><h3>' + escapeHtml(item.name || "餐點") + '</h3><p>' + escapeHtml(getItemCategory(item)) + '</p>' +
      (description ? '<p class="qr-menu-desc">' + escapeHtml(description) + '</p>' : '') +
      (requiredOption ? '<p class="qr-required-tag">必選：' + escapeHtml(requiredOption.title) + '</p>' : '') +
      (saleText ? '<p class="qr-sale-status">' + escapeHtml(saleText) + '</p>' : '') +
      '<strong>' + money(getBasePrice(item)) + '</strong></div></button>';
}

function openItemModalByIdV64(itemId) {
  var items = getEnabledItems();
  var item = null;
  for (var i = 0; i < items.length; i += 1) {
    if (String(items[i].id) === String(itemId)) {
      item = items[i];
      break;
    }
  }
  if (!item) {
    alert("找不到餐點");
    return;
  }
  if (!canQrOrderItem(item)) {
    alert(getSaleStatusText(item) || "此餐點目前不可點選");
    return;
  }
  if (isQrOrderingExpired()) {
    showQrOrderingExpired();
    return;
  }
  openItemModal(item);
}

renderMenuCard = renderMenuCardV64;
openItemModalById = openItemModalByIdV64;

initOrderTypeUI();
loadQrStoreName();
loadOrderLookupMinutes();
loadQrValidMinutes();
startQrSessionWatchers();
loadMenu();
hideAppLoadingScreen();

function hideAppLoadingScreen() {
  var el = document.getElementById("appLoadingScreen");
  if (el && (" " + (el.className || "") + " ").indexOf(" hidden ") === -1) {
    el.className += " hidden";
  }
}

var qrMenuTouchStartX = 0;
var qrMenuTouchStartY = 0;
var qrMenuTouchMoved = false;
var qrLastTouchOpenAt = 0;

menuList.addEventListener("touchstart", function (event) {
  var touch = event.touches && event.touches.length ? event.touches[0] : null;
  qrMenuTouchMoved = false;
  if (touch) {
    qrMenuTouchStartX = touch.clientX || 0;
    qrMenuTouchStartY = touch.clientY || 0;
  }
}, true);

menuList.addEventListener("touchmove", function (event) {
  var touch = event.touches && event.touches.length ? event.touches[0] : null;
  if (!touch) return;
  var dx = Math.abs((touch.clientX || 0) - qrMenuTouchStartX);
  var dy = Math.abs((touch.clientY || 0) - qrMenuTouchStartY);
  if (dx > 18 || dy > 18) qrMenuTouchMoved = true;
}, true);

menuList.addEventListener("click", function (event) {
  var now = Date.now ? Date.now() : new Date().getTime();
  if (now - qrLastTouchOpenAt < 900) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    return false;
  }

  var target = event.target;

  while (target && target !== menuList) {
    if (target.classList && target.classList.contains("menu-card")) {
      var itemId = target.getAttribute("data-id");
      openItemModalById(itemId);
      return;
    }

    target = target.parentNode;
  }
}, true);

menuList.addEventListener("touchend", function (event) {
  if (qrMenuTouchMoved) {
    qrMenuTouchMoved = false;
    return;
  }

  var target = event.target;

  while (target && target !== menuList) {
    if (target.classList && target.classList.contains("menu-card")) {
      event.preventDefault();

      var itemId = target.getAttribute("data-id");
      qrLastTouchOpenAt = Date.now ? Date.now() : new Date().getTime();
      openItemModalById(itemId);
      return;
    }

    target = target.parentNode;
  }
}, true);

renderCart();
loadLastOrderIfExists();

/* v65.2 QR single tab controller */
(function(){
  function renderQrMenuIfReady() {
    try {
      if (typeof renderCategories === "function") renderCategories();
      if (typeof renderMenu === "function") renderMenu();
    } catch (error) {
      console.error("QR menu render failed", error);
    }
  }

  var qrTabController = createQrTabController({
    onMenu: function() {
      qrShowMenuMode();
      renderQrMenuIfReady();
    },
    onOrder: function() {
      loadViewingOrderById(getSavedViewingOrderId(), false);
    }
  });

  window.qrShowMenuTab = qrTabController.openMenu;
  window.qrShowOrderTab = qrTabController.openOrder;
  qrTabController.start();
})();
