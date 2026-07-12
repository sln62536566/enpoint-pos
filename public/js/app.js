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
  getBusinessDate,
  createOrderNumber
} from "./firebase.js";

import {
  getAppliedMenuOptionGroups
} from "./menu-studio-core.js";


/* =========================
   v59-5 EARLY QR HARD ADD
   舊平板：加入購物車按鈕直接走這個，不依賴後面事件綁定
========================= */
window.qrHardAddToCart = function(event){
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
  }
  try {
    return qrAddCurrentItemToCart(event);
  } catch (error) {
    alert("加入購物車失敗：" + (error && error.message ? error.message : error));
    return false;
  }
};

const STORE_ID = "defaultStore";
const LAST_ORDER_KEY = "enpoint_last_qr_order_id";
const LAST_ORDER_KEY_COMPAT = "lastQrOrderId";
const DEFAULT_QR_STORE_NAME = "恩點點餐";
const DEFAULT_ORDER_LOOKUP_MINUTES = 60;
const DEFAULT_QR_VALID_MINUTES = 120;

function normalizeQrOrderLookupMinutes(value) {
  var raw = String(value === undefined || value === null ? "" : value);
  if (raw === "0" || raw === "forever" || raw === "permanent") return 0;
  var minutes = Math.floor(Number(value) || DEFAULT_ORDER_LOOKUP_MINUTES);
  return Math.min(1440, Math.max(30, minutes));
}

function normalizeQrValidMinutes(value) {
  var minutes = Math.floor(Number(value) || DEFAULT_QR_VALID_MINUTES);
  return Math.min(1440, Math.max(30, minutes));
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
  try {
    var searchParams = new URLSearchParams(window.location.search || "");
    var view = searchParams.get("view");
    return view === "last" || view === "order";
  } catch (e) {
    return false;
  }
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
  try {
    currentViewingOrderId = localStorage.getItem(LAST_ORDER_KEY) || localStorage.getItem(LAST_ORDER_KEY_COMPAT) || "";
  } catch (e) {
    currentViewingOrderId = "";
  }
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
const closeModalBtn = document.getElementById("closeModalBtn");
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
  if (status === "paused" || status === "pause" || status === "suspended") return "paused";
  return "normal";
}

function getSaleStatusText(item) {
  var status = getSaleStatus(item);
  if (status === "soldout") return "今日售完";
  if (status === "paused") return "此餐點暫停販售，請稍後再試";
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
    box.innerHTML = '<img src="' + imageUrl + '" alt="餐點圖片">';
  } else {
    box.innerHTML = '<div class="qr-modal-no-image">恩點</div>';
  }

  modalItemName.parentNode.insertBefore(box, modalItemName);
}

function openItemModal(item) {
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

  itemModal.classList.remove("hidden");
  itemModal.classList.add("show-force");

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
      var priceText = Number(option.price || 0) > 0 ? " +" + Number(option.price || 0) : (Number(option.price || 0) < 0 ? " " + Number(option.price || 0) : "");
      var modules = group.modules || {};
      html += '<button type="button" class="option-btn qr-v64-option ' + (selected ? "active" : "") + '" data-group-id="' + escapeHtml(group.id) + '" data-group-name="' + escapeHtml(group.name) + '" data-selection-type="' + escapeHtml(group.selectionType || "single") + '" data-option-name="' + escapeHtml(name) + '" data-option-price="' + Number(option.price || 0) + '" data-qty-enabled="' + (group.allowQuantity || option.qtyEnabled || option.quantityEnabled || option.allowQuantity ? "true" : "false") + '" data-max-qty="' + Number(option.maxQty || option.maxQuantity || 1) + '" data-module-qr="' + (modules.qr === true ? "true" : "false") + '" data-module-pos="' + (modules.pos !== false ? "true" : "false") + '" data-module-kds="' + (modules.kds !== false ? "true" : "false") + '" data-module-print="' + (modules.print !== false ? "true" : "false") + '">' + escapeHtml(name) + priceText + (selected && Number(selected.qty || 1) > 1 ? " x" + Number(selected.qty || 1) : "") + '</button>';
    }
    html += '</div></div>';
  }
  box.innerHTML = html;
  addonsSection.appendChild(box);
  var buttons = box.querySelectorAll(".qr-v64-option");
  for (var i = 0; i < buttons.length; i += 1) buttons[i].onclick = function() { toggleQrCustomOption(this); };
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
    if (list[found].qtyEnabled && Number(list[found].qty || 1) < Number(list[found].maxQty || 1)) list[found].qty = Number(list[found].qty || 1) + 1;
    else list.splice(found, 1);
  } else {
    if (selectionType === "single" || selectionType === "toggle") {
      list = list.filter(function(item) { return String(item.groupId) !== String(groupId); });
    }
    list.push({ groupId: groupId, groupName: button.getAttribute("data-group-name"), name: name, price: Number(button.getAttribute("data-option-price") || 0), qty: 1, qtyEnabled: button.getAttribute("data-qty-enabled") === "true", maxQty: Number(button.getAttribute("data-max-qty") || 1), modules: { qr: button.getAttribute("data-module-qr") === "true", pos: button.getAttribute("data-module-pos") !== "false", kds: button.getAttribute("data-module-kds") !== "false", print: button.getAttribute("data-module-print") !== "false" } });
  }
  window.qrV64SelectedCustomOptions = list;
  renderModalOptions();
  updateModalSubtotal();
}

function qrCustomOptionsTotal(list) {
  var total = 0;
  list = list || [];
  for (var i = 0; i < list.length; i += 1) total += Number(list[i].price || 0) * Number(list[i].qty || 1);
  return total;
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
  const base = Number(selectedSize && selectedSize.price || 0);
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0) + qrCustomOptionsTotal(window.qrV64SelectedCustomOptions || []);
  modalSubtotal.textContent = money((base + addonsTotal) * selectedQty);
}

qtyMinusBtn.addEventListener("click", () => {
  selectedQty = Math.max(1, selectedQty - 1);
  modalQty.textContent = selectedQty;
  updateModalSubtotal();
});

qtyPlusBtn.addEventListener("click", () => {
  selectedQty++;
  modalQty.textContent = selectedQty;
  updateModalSubtotal();
});

closeModalBtn.addEventListener("click", function () {
  itemModal.classList.add("hidden");
  itemModal.classList.remove("show-force");
});



/* =========================
   v59-6 QR legacy cart renderer
   舊平板保險：不用 template/arrow/dataset，直接重畫購物車
========================= */
function legacyRenderQrCart() {
  var list = document.getElementById("cartList");
  var totalEl = document.getElementById("cartTotal");
  if (!list) return;

  if (!cart || cart.length === 0) {
    list.innerHTML = '<div class="empty">尚未選擇餐點</div>';
    if (totalEl) totalEl.innerHTML = '$0';
    updateFloatingCartButton && updateFloatingCartButton();
    return;
  }

  var html = '';
  var total = 0;
  for (var i = 0; i < cart.length; i++) {
    var item = cart[i] || {};
    var qty = Number(item.qty || item.quantity || 1);
    var subtotal = Number(item.subtotal || 0);
    total += subtotal;
    html += '<div class="cart-item">';
    html += '<div><strong>' + (item.name || '餐點') + ' × ' + qty + '</strong>';
    html += '<div class="cart-detail">';
    if (item.size) html += '<p>份量：' + item.size + '</p>';
    if (item.requiredOption && item.requiredOption.title) html += '<p>' + item.requiredOption.title + '：' + item.requiredOption.value + '</p>';
    if (item.spicy) html += '<p>辣度：' + item.spicy + '</p>';
    if (item.satay) html += '<p>沙茶：' + item.satay + '</p>';
    var extras = item.addons || item.extras || [];
    if (extras && extras.length) {
      var names = [];
      for (var j = 0; j < extras.length; j++) names.push(extras[j].name || extras[j].label || String(extras[j]));
      html += '<p>加料：' + names.join('、') + '</p>';
    }
    if (item.note) html += '<p>備註：' + item.note + '</p>';
    html += '</div></div>';
    html += '<div class="cart-price"><strong>$' + subtotal + '</strong>';
    html += '<button class="remove-btn" type="button" onclick="return window.legacyRemoveQrCartItem(' + i + ')">刪除</button>';
    html += '</div></div>';
  }
  list.innerHTML = html;
  if (totalEl) totalEl.innerHTML = '$' + total;
  updateFloatingCartButton && updateFloatingCartButton();
}

window.legacyRenderQrCart = legacyRenderQrCart;
window.legacyRemoveQrCartItem = function(index) {
  cart.splice(Number(index), 1);
  legacyRenderQrCart();
  return false;
};

var qrLastAddCartAt = 0;

function qrAddCurrentItemToCart(event) {
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

  var basePrice = Number(getBasePrice(selectedItem) || 0);
  var addonsTotal = 0;
  addonsTotal += qrCustomOptionsTotal(window.qrV64SelectedCustomOptions || []);
  var unitPrice = basePrice + addonsTotal;
  var nowId = selectedItem.id + "-" + new Date().getTime();

  cart.push({
    id: nowId,
    itemId: selectedItem.id,
    name: selectedItem.name,
    category: getItemCategory(selectedItem),
    size: "",
    basePrice: basePrice,
    price: unitPrice,
    unitPrice: unitPrice,
    requiredOption: null,
    customOptions: window.qrV64SelectedCustomOptions || [],
    addons: [],
    extras: [],
    spicy: "",
    satay: "",
    note: itemNote ? itemNote.value.trim() : "",
    qty: selectedQty,
    quantity: selectedQty,
    subtotal: unitPrice * selectedQty
  });

  if (itemModal) {
    itemModal.className = (itemModal.className || "") + " hidden";
    itemModal.className = itemModal.className.replace(/\bshow-force\b/g, "");
    itemModal.style.display = "none";
  }

  try { legacyRenderQrCart(); } catch (e) { try { renderCart(); } catch (err) {} }
  return false;
}

window.qrAddCurrentItemToCart = qrAddCurrentItemToCart;
window.qrHardAddToCart = qrAddCurrentItemToCart;
if (addToCartBtn) {
  addToCartBtn.onclick = qrAddCurrentItemToCart;
  addToCartBtn.ontouchend = qrAddCurrentItemToCart;
}

function forceResetQrOrder(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
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
  if (confirmModal) {
    confirmModal.className = (confirmModal.className || "") + " hidden";
    confirmModal.className = confirmModal.className.replace(/\bshow-force\b/g, "");
    confirmModal.style.display = "none";
  }
  if (itemModal) {
    itemModal.className = (itemModal.className || "") + " hidden";
    itemModal.className = itemModal.className.replace(/\bshow-force\b/g, "");
    itemModal.style.display = "none";
  }
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
  newOrderBtn.onclick = forceResetQrOrder;
  newOrderBtn.ontouchend = forceResetQrOrder;
}
if (topNewOrderBtn) {
  topNewOrderBtn.onclick = forceResetQrOrder;
  topNewOrderBtn.ontouchend = forceResetQrOrder;
}

function getQrCartTotal() {
  var total = 0;
  for (var i = 0; i < cart.length; i++) {
    total += Number(cart[i].subtotal || 0);
  }
  return total;
}

function updateFloatingCartButton() {
  if (!floatingCartBtn) return;
  var count = 0;
  for (var i = 0; i < cart.length; i++) {
    count += Number(cart[i].qty || 1);
  }
  floatingCartBtn.innerHTML = "購物車 " + count + " 項｜" + money(getQrCartTotal());
}

function openQrCartPanel(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }
  if (qrCartPanel) {
    qrCartPanel.classList.add("cart-open");
  }
  return false;
}

function closeQrCartPanel(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }
  if (qrCartPanel) {
    qrCartPanel.classList.remove("cart-open");
  }
  return false;
}

window.openQrCartPanel = openQrCartPanel;
window.closeQrCartPanel = closeQrCartPanel;

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
        <strong>${item.name} × ${item.qty}</strong>
        <div class="cart-detail">
          ${renderItemDetail(item)}
        </div>
      </div>

      <div class="cart-price">
        <strong>${money(item.subtotal)}</strong>
        <button class="remove-btn" data-index="${index}">刪除</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      cart.splice(Number(btn.dataset.index), 1);
      renderCart();
    });
  });

  const total = cart.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
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
  if (!validateOrderType()) return;

  const total = cart.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const meta = getOrderMeta();

  confirmTotal.textContent = money(total);

  confirmContent.innerHTML = `
    <div class="confirm-table">${meta.type}${meta.table ? `｜${meta.table}桌` : ""}</div>

    ${cart.map(item => `
      <div class="confirm-item">
        <div class="confirm-item-main">• ${item.name} × ${item.qty}</div>

        <div class="confirm-item-detail">
          ${renderItemDetail(item)}
          <p>小計：${money(item.subtotal)}</p>
        </div>
      </div>
    `).join("")}
  `;

  confirmModal.classList.remove("hidden");
}

window.qrSubmitOrderNow = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

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
  if (typeof window.qrLegacyDirectSubmitOrder === "function") {
    return window.qrLegacyDirectSubmitOrder(event);
  }
  return window.qrSubmitOrderNow(event);
});

backToCartBtn.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
});

function submitConfirmedQrOrder(event) {
  if (event) {
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }

  var nowTap = Date.now ? Date.now() : new Date().getTime();
  if (qrLastSubmitTapAt && nowTap - qrLastSubmitTapAt < 900) return false;
  qrLastSubmitTapAt = nowTap;

  if (!validateOrderType()) return false;
  if (isQrOrderingExpired()) {
    showQrOrderingExpired();
    return false;
  }
  if (!cart || cart.length === 0) {
    alert("購物車目前是空的");
    return false;
  }

  confirmSubmitBtn.disabled = true;
  confirmSubmitBtn.textContent = "送出中...";

  var total = cart.reduce(function (sum, item) {
    return sum + Number(item.subtotal || 0);
  }, 0);
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
        deviceType: "qr",
        source: "QR",
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

      confirmModal.classList.add("hidden");
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
confirmSubmitBtn.onclick = submitConfirmedQrOrder;
confirmSubmitBtn.ontouchend = submitConfirmedQrOrder;
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
        <div class="success-item-main">• ${item.name} × ${item.qty || item.quantity || 1}</div>

        <div class="success-item-detail">
          ${renderItemDetail(item)}
          <p>小計：${money(item.subtotal || (Number(item.price || item.unitPrice || 0) * Number(item.qty || item.quantity || 1)))}</p>
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

function getDirectOrderIdFromUrl() {
  try {
    var searchParams = new URLSearchParams(window.location.search || "");
    if (searchParams.get("view") !== "order") return "";
    var id = searchParams.get("orderId") || "";
    if (id) saveCurrentViewingOrderId(id);
    return id;
  } catch (e) {
    return "";
  }
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

function getQrItemExtras(item) {
  return (item && (item.addons || item.extras)) || [];
}

function getQrItemRemoves(item) {
  return (item && (item.removes || item.removeOptionsSelected || item.noOptionsSelected)) || [];
}

function renderQrCustomOptionsDetail(item) {
  var list = item && item.customOptions;
  if (!list || !list.length) return "";
  var html = "";
  for (var i = 0; i < list.length; i += 1) {
    var opt = list[i] || {};
    html += '<p>' + escapeHtml(opt.groupName || "選項") + '：' + escapeHtml(opt.name || "") + (Number(opt.qty || 1) > 1 ? ' x' + Number(opt.qty || 1) : '') + '</p>';
  }
  return html;
}

function buildDirectItemDetailHtml(item) {
  var details = [];
  var extras = getQrItemExtras(item);
  var removes = getQrItemRemoves(item);

  if (item.size) details.push("份量：" + item.size);
  if (item.requiredOption && item.requiredOption.title && item.requiredOption.value) {
    details.push(item.requiredOption.title + "：" + item.requiredOption.value);
  }
  if (extras && extras.length) {
    var extraNames = [];
    for (var i = 0; i < extras.length; i++) {
      var extra = extras[i];
      if (typeof extra === "string") extraNames.push(extra);
      else extraNames.push(extra.name || extra.label || "加料");
    }
    details.push("加料：" + extraNames.join("、"));
  }
  if (removes && removes.length) details.push("不要：" + removes.join("、"));
  if (item.spicy) details.push("辣度：" + item.spicy);
  if (item.satay) details.push("沙茶：" + item.satay);
  if (item.note) details.push("備註：" + item.note);

  if (!details.length) return "";
  return '<div class="qr-direct-item-detail">' + details.map(function(detail) {
    return '<p>' + escapeHtml(detail) + '</p>';
  }).join("") + '</div>';
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
          var subtotal = Number(item.subtotal || (Number(item.price || item.unitPrice || 0) * qty));
          return '<div class="qr-direct-item">' +
            '<div class="qr-direct-item-main"><span>' + escapeHtml(item.name || "未命名餐點") + '</span><b>× ' + qty + '</b></div>' +
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
  if (!orderId || !window.history || !window.history.replaceState) return;
  try {
    var nextUrl = window.location.pathname + "?view=order&orderId=" + encodeURIComponent(orderId);
    window.history.replaceState(null, "", nextUrl);
  } catch (e) {}
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
  if (!id) {
    renderDirectOrderMissing();
    return false;
  }
  saveCurrentViewingOrderId(id);
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
    topOrderContent.innerHTML = '<div class="qr-direct-order-card"><div class="empty">找不到此訂單或訂單已過期</div></div>';
  }
}

function initDirectOrderView() {
  var directOrderId = getDirectOrderIdFromUrl();
  if (!directOrderId) {
    try {
      var searchParams = new URLSearchParams(window.location.search || "");
      if (searchParams.get("view") === "order") {
        renderDirectOrderMissing();
        return true;
      }
    } catch (e) {}
    return false;
  }

  return loadViewingOrderById(directOrderId, false);
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
    if (!order) return;
    var fullOrder = { id: orderId, ...order };

    if (getDirectOrderIdFromUrl() || (document.body && (" " + document.body.className + " ").indexOf(" qr-direct-order-mode ") >= 0)) {
      showSubmittedOrderView(fullOrder, false);
    } else if (qrIsViewOrderMode()) {
      renderTopOrderOnly(fullOrder);
    } else {
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
  if (!qrIsViewOrderMode()) {
    qrShowMenuMode();
    return;
  }
  qrShowOrderMode();
  const lastOrderId = localStorage.getItem(LAST_ORDER_KEY);
  if (!lastOrderId) return;

  const orderRef = ref(db, `orders/${lastOrderId}`);

  onValue(orderRef, snapshot => {
    const order = snapshot.val();

    if (!order) {
      localStorage.removeItem(LAST_ORDER_KEY);
      return;
    }

    renderTopOrderOnly({ id: lastOrderId, ...order });
    listenOrderStatus(lastOrderId);
  }, {
    onlyOnce: true
  });
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
  var minutes = normalizeQrValidMinutes(qrValidMinutes);
  var startAt = 0;
  try {
    startAt = Number(sessionStorage.getItem("enpoint_qr_session_started_at") || 0);
    if (!startAt) {
      startAt = Date.now ? Date.now() : new Date().getTime();
      sessionStorage.setItem("enpoint_qr_session_started_at", String(startAt));
    }
  } catch (e) {
    startAt = Date.now ? Date.now() : new Date().getTime();
  }
  return (Date.now ? Date.now() : new Date().getTime()) - startAt > minutes * 60 * 1000;
}

function showQrOrderingExpired() {
  alert("此點餐連結已過期，請重新掃描 QR Code");
}

function renderMenuCardV64(item) {
  var imageUrl = getImageUrl(item);
  var description = item.description || "";
  var requiredOption = getRequiredOption(item);
  var saleStatus = getSaleStatus(item);
  var saleText = getSaleStatusText(item);
  return '' +
    '<button type="button" class="menu-card sale-' + saleStatus + '" data-id="' + escapeHtml(item.id) + '" ' + (canQrOrderItem(item) ? "" : 'aria-disabled="true"') + '>' +
      '<div class="menu-image">' + (imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(item.name || "餐點") + '">' : '<div class="no-image">恩點</div>') + '</div>' +
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

// =========================
// v58-46 舊平板送單強制修正
// =========================

function legacySubmitOrder(event) {
  if (!shouldHandleQrOrderAction(event, "submitOrder", 2200)) return false;
  if (cart.length === 0) {
    alert("購物車目前是空的");
    return false;
  }

  renderConfirmModal();
  return false;
}

window.legacySubmitOrder = legacySubmitOrder;

if (submitOrderBtn) {
  submitOrderBtn.onclick = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    legacySubmitOrder(event);
    return false;
  };

  submitOrderBtn.ontouchend = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    legacySubmitOrder(event);
    return false;
  };
}

/* QR legacy tablet tap bridge.
   Older iPad/Android WebKit can show :active on a card but fail the later delegated click path.
   This bridge records real menu-card touches in capture phase and replays one clean click on the card. */
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var lastTouchAt = 0;
  var lastTouchCard = null;
  var replaying = false;
  var modalControlReplaying = false;
  var orderControlReplaying = false;
  var lastOrderReplayAt = 0;
  var lastOrderReplayControl = null;
  var capturedHandlers = [];
  var touchStartX = 0;
  var touchStartY = 0;
  var touchMoved = false;

  if (typeof EventTarget !== "undefined" && EventTarget.prototype && !window.__ENPOINT_QR_EVENT_PATCHED__) {
    window.__ENPOINT_QR_EVENT_PATCHED__ = true;
    var nativeAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if ((type === "click" || type === "submit") && listener) {
        capturedHandlers.push({
          target: this,
          type: type,
          listener: listener,
        });
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
  }

  function legacyDebug(message) {
    window.__ENPOINT_QR_LEGACY_DEBUG__ = message;
    if (window.location.search.indexOf("qrdebug=1") === -1) return;

    var badge = document.getElementById("qrLegacyDebug");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "qrLegacyDebug";
      badge.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#111;color:#fff;padding:8px 10px;border-radius:6px;font:12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;max-width:85vw;box-shadow:0 2px 10px rgba(0,0,0,.25);";
      document.body.appendChild(badge);
    }
    badge.innerHTML = message;
  }

  window.onerror = function (message, source, line, column, error) {
    legacyDebug(
      "js error: " +
        message +
        (line ? " @" + line : "") +
        (error && error.name ? " " + error.name : "")
    );
    return false;
  };

  legacyDebug("legacy patch loaded v58-45");

  if (typeof EventTarget !== "undefined" && EventTarget.prototype && !window.__ENPOINT_QR_EVENT_PATCHED__) {
    window.__ENPOINT_QR_EVENT_PATCHED__ = true;
    var nativeAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if ((type === "click" || type === "touchend" || type === "pointerup") && listener) {
        capturedHandlers.push({
          target: this,
          type: type,
          listener: listener,
        });
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
  }

  function hasClass(el, className) {
    return !!(
      el &&
      typeof el.className === "string" &&
      (" " + el.className + " ").indexOf(" " + className + " ") !== -1
    );
  }

  function findMenuCard(target) {
    var el = target;
    while (el && el !== document) {
      if (hasClass(el, "menu-card")) return el;
      el = el.parentNode;
    }
    return null;
  }

  function getCardId(card) {
    if (!card) return "";
    if (card.getAttribute) return card.getAttribute("data-id") || "";
    return "";
  }

  function isInsideOrderOrCart(target) {
    var el = target;
    while (el && el !== document) {
      var id = el.id || "";
      var className = typeof el.className === "string" ? el.className : "";
      if (
        id === "submitOrderBTN" ||
        id === "submitOrderBtn" ||
        id === "sendOrderBTN" ||
        id === "checkoutBTN" ||
        id === "checkoutBtn" ||
        id === "cartDrawer" ||
        id === "cartPanel" ||
        id === "cartModal" ||
        id === "cartItems" ||
        id === "qrLegacyModalHost" ||
        className.indexOf("submit-order") !== -1 ||
        className.indexOf("send-order") !== -1 ||
        className.indexOf("checkout-btn") !== -1 ||
        className.indexOf("cart-drawer") !== -1 ||
        className.indexOf("cart-panel") !== -1 ||
        className.indexOf("cart-modal") !== -1
      ) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  function isInsideMenuList(target) {
    var el = target;
    while (el && el !== document) {
      var id = el.id || "";
      var className = typeof el.className === "string" ? el.className : "";
      if (
        id === "menuList" ||
        id === "menu-list" ||
        id === "menuGrid" ||
        id === "menu-grid" ||
        className.indexOf("menu-list") !== -1 ||
        className.indexOf("menu-grid") !== -1
      ) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  function shouldReplayHandler(target) {
    if (!target) return false;
    if (target === document || target === window) return true;
    var id = target.id || "";
    var className = typeof target.className === "string" ? target.className : "";
    return (
      id === "menuList" ||
      id === "menu-list" ||
      id === "menuGrid" ||
      id === "menu-grid" ||
      className.indexOf("menu-list") !== -1 ||
      className.indexOf("menu-grid") !== -1 ||
      className.indexOf("menu-card") !== -1
    );
  }

  function shouldReplayModalHandler(target) {
    if (!target) return false;
    if (target === document || target === window) return true;
    var id = target.id || "";
    var className = typeof target.className === "string" ? target.className : "";
    return (
      id === "itemModal" ||
      id === "item-modal" ||
      id === "itemDetailModal" ||
      id === "item-detail-modal" ||
      id === "qrLegacyModalHost" ||
      className.indexOf("modal") !== -1 ||
      className.indexOf("item-modal") !== -1 ||
      className.indexOf("cart") !== -1 ||
      className.indexOf("option") !== -1 ||
      className.indexOf("addon") !== -1
    );
  }

  function callOriginalHandlers(card, sourceEvent) {
    if (replaying) return;
    replaying = true;

    var fakeEvent = {
      type: "click",
      target: card,
      currentTarget: card,
      srcElement: card,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: function () {
        this.defaultPrevented = true;
      },
      stopPropagation: function () {},
      stopImmediatePropagation: function () {},
      originalEvent: sourceEvent || null,
    };

    capturedHandlers.forEach(function (entry) {
      if (entry.type !== "click" && entry.type !== "touchend" && entry.type !== "pointerup") return;
      if (!shouldReplayHandler(entry.target)) return;
      try {
        fakeEvent.type = entry.type;
        if (typeof entry.listener === "function") {
          fakeEvent.currentTarget = entry.target;
          entry.listener.call(entry.target, fakeEvent);
        } else if (entry.listener && typeof entry.listener.handleEvent === "function") {
          fakeEvent.currentTarget = entry.target;
          entry.listener.handleEvent(fakeEvent);
        }
      } catch (err) {
        window.__ENPOINT_QR_LAST_REPLAY_ERROR__ = err;
      }
    });

    replaying = false;
  }

  function callModalHandlers(target, sourceEvent) {
    if (replaying) return;
    replaying = true;

    var fakeEvent = {
      type: "click",
      target: target,
      currentTarget: target,
      srcElement: target,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: function () {
        this.defaultPrevented = true;
      },
      stopPropagation: function () {},
      stopImmediatePropagation: function () {},
      originalEvent: sourceEvent || null,
    };

    capturedHandlers.forEach(function (entry) {
      if (entry.type !== "click" && entry.type !== "touchend" && entry.type !== "pointerup") return;
      if (!shouldReplayModalHandler(entry.target) && entry.target !== target) return;
      try {
        fakeEvent.type = entry.type;
        fakeEvent.currentTarget = entry.target;
        if (typeof entry.listener === "function") {
          entry.listener.call(entry.target, fakeEvent);
        } else if (entry.listener && typeof entry.listener.handleEvent === "function") {
          entry.listener.handleEvent(fakeEvent);
        }
      } catch (err) {
        window.__ENPOINT_QR_LAST_MODAL_REPLAY_ERROR__ = err;
        legacyDebug("modal handler error: " + (err.message || err));
      }
    });

    replaying = false;
  }

  function findLegacyModalControl(target) {
    var el = target;
    while (el && el !== document) {
      var tag = el.tagName ? el.tagName.toLowerCase() : "";
      var id = el.id || "";
      var className = typeof el.className === "string" ? el.className : "";
      if (
        tag === "button" ||
        tag === "a" ||
        tag === "input" ||
        id.indexOf("cart") !== -1 ||
        id.indexOf("Cart") !== -1 ||
        className.indexOf("btn") !== -1 ||
        className.indexOf("close") !== -1 ||
        className.indexOf("cart") !== -1
      ) {
        return el;
      }
      el = el.parentNode;
    }
    return null;
  }

  function isLegacyCloseControl(el) {
    if (!el) return false;
    var text = (el.textContent || el.value || "").replace(/\s+/g, "");
    var id = el.id || "";
    var className = typeof el.className === "string" ? el.className : "";
    var dismiss =
      (el.getAttribute && (el.getAttribute("data-dismiss") || el.getAttribute("data-bs-dismiss"))) || "";
    return (
      dismiss === "modal" ||
      id.indexOf("close") !== -1 ||
      id.indexOf("Close") !== -1 ||
      className.indexOf("close") !== -1 ||
      className.indexOf("btn-close") !== -1 ||
      text === "×" ||
      text === "x" ||
      text === "X" ||
      text === "取消"
    );
  }

  function isLegacyAddToCartControl(el) {
    if (!el) return false;
    var text = (el.textContent || el.value || "").replace(/\s+/g, "");
    var id = el.id || "";
    var className = typeof el.className === "string" ? el.className : "";
    var action = (el.getAttribute && (el.getAttribute("data-action") || el.getAttribute("data-role"))) || "";
    return (
      id.indexOf("addToCart") !== -1 ||
      id.indexOf("add-to-cart") !== -1 ||
      id.indexOf("cart") !== -1 ||
      className.indexOf("add-to-cart") !== -1 ||
      className.indexOf("addToCart") !== -1 ||
      className.indexOf("cart") !== -1 ||
      action.indexOf("cart") !== -1 ||
      text.indexOf("加入購物車") !== -1 ||
      text.indexOf("加入餐車") !== -1 ||
      text.indexOf("加入") !== -1
    );
  }

  function isLegacyOrderControl(el) {
    if (!el) return false;
    var text = (el.textContent || el.value || "").replace(/\s+/g, "");
    var id = el.id || "";
    var className = typeof el.className === "string" ? el.className : "";
    var action = (el.getAttribute && (el.getAttribute("data-action") || el.getAttribute("data-role"))) || "";
    return (
      id.indexOf("submitOrder") !== -1 ||
      id.indexOf("submit-order") !== -1 ||
      id.indexOf("sendOrder") !== -1 ||
      id.indexOf("send-order") !== -1 ||
      id.indexOf("checkout") !== -1 ||
      className.indexOf("submit-order") !== -1 ||
      className.indexOf("send-order") !== -1 ||
      className.indexOf("checkout") !== -1 ||
      action.indexOf("submit") !== -1 ||
      action.indexOf("order") !== -1 ||
      action.indexOf("checkout") !== -1 ||
      text.indexOf("送出訂單") !== -1 ||
      text.indexOf("送出") !== -1 ||
      text.indexOf("送單") !== -1 ||
      text.indexOf("結帳") !== -1 ||
      text.indexOf("確認訂單") !== -1
    );
  }

  function findLegacyOrderControl(target) {
    var el = target;
    while (el && el !== document) {
      var tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (
        (tag === "button" || tag === "a" || tag === "input") &&
        (el.id === "submitOrderBTN" ||
          el.id === "submitOrderBtn" ||
          el.id === "sendOrderBTN" ||
          el.id === "checkoutBTN" ||
          el.id === "checkoutBtn")
      ) {
        return el;
      }
      el = el.parentNode;
    }
    return null;
  }

  function dispatchLegacyMouseSequence(control) {
    ["touchstart", "touchend", "mousedown", "mouseup", "click", "input", "change"].forEach(function (type) {
      var mouseEvent;
      if (type.indexOf("touch") === 0 && typeof Event === "function") {
        mouseEvent = new Event(type, {
          bubbles: true,
          cancelable: true,
        });
      } else if (typeof MouseEvent === "function" && (type === "mousedown" || type === "mouseup" || type === "click")) {
        mouseEvent = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        });
      } else if (typeof Event === "function") {
        mouseEvent = new Event(type, {
          bubbles: true,
          cancelable: true,
        });
      } else {
        if (type === "mousedown" || type === "mouseup" || type === "click") {
          mouseEvent = document.createEvent("MouseEvents");
          mouseEvent.initMouseEvent(type, true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
        } else {
          mouseEvent = document.createEvent("Event");
          mouseEvent.initEvent(type, true, true);
        }
      }
      control.dispatchEvent(mouseEvent);
    });
  }

  function shouldReplayOrderHandler(target, control) {
    if (!target) return false;
    if (target === document || target === window) return true;
    if (target === control) return true;

    var id = target.id || "";
    var className = typeof target.className === "string" ? target.className : "";
    return (
      id.indexOf("cart") !== -1 ||
      id.indexOf("Cart") !== -1 ||
      id.indexOf("order") !== -1 ||
      id.indexOf("Order") !== -1 ||
      id.indexOf("checkout") !== -1 ||
      id.indexOf("Checkout") !== -1 ||
      className.indexOf("cart") !== -1 ||
      className.indexOf("order") !== -1 ||
      className.indexOf("checkout") !== -1 ||
      className.indexOf("footer") !== -1 ||
      className.indexOf("bar") !== -1
    );
  }

  function replayCapturedOrderHandlers(control) {
    var replayed = 0;

    capturedHandlers.forEach(function (entry) {
      if (entry.type !== "click" && entry.type !== "submit") return;
      if (!shouldReplayOrderHandler(entry.target, control)) return;

      var fakeEvent = {
        type: entry.type,
        target: control,
        currentTarget: entry.target,
        srcElement: control,
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault: function () {
          this.defaultPrevented = true;
        },
        stopPropagation: function () {},
        stopImmediatePropagation: function () {},
      };

      try {
        if (typeof entry.listener === "function") {
          entry.listener.call(entry.target, fakeEvent);
        } else if (entry.listener && typeof entry.listener.handleEvent === "function") {
          entry.listener.handleEvent(fakeEvent);
        }
        replayed += 1;
      } catch (err) {
        window.__ENPOINT_QR_LAST_ORDER_REPLAY_ERROR__ = err;
        legacyDebug("order handler error: " + (err.message || err));
      }
    });

    return replayed;
  }

  function callKnownOrderFunctions(control) {
    var names = [
      "submitOrder",
      "sendOrder",
      "placeOrder",
      "checkout",
      "confirmOrder",
      "handleSubmitOrder",
      "handleSendOrder",
      "submitCart",
      "sendCart",
      "createOrder",
      "createQrOrder",
      "submitQrOrder",
    ];
    var called = 0;

    names.forEach(function (name) {
      if (typeof window[name] !== "function") return;
      try {
        window[name]({
          type: "click",
          target: control,
          currentTarget: control,
          preventDefault: function () {},
          stopPropagation: function () {},
        });
        called += 1;
      } catch (err) {
        window.__ENPOINT_QR_LAST_ORDER_FUNCTION_ERROR__ = err;
        legacyDebug("order function error: " + name + " " + (err.message || err));
      }
    });

    return called;
  }

  function callOrderOnclick(control) {
    if (!control || typeof control.onclick !== "function") return 0;
    try {
      control.onclick.call(control, {
        type: "click",
        target: control,
        currentTarget: control,
        preventDefault: function () {},
        stopPropagation: function () {},
      });
      return 1;
    } catch (err) {
      window.__ENPOINT_QR_LAST_ORDER_ONCLICK_ERROR__ = err;
      legacyDebug("order onclick error: " + (err.message || err));
      return 0;
    }
  }

  function replayLegacyOrderControl(event) {
    if (orderControlReplaying || modalControlReplaying) return;
    if (event && event.type && event.type !== "touchend" && event.type !== "click") return;

    var host = document.getElementById("qrLegacyModalHost");
    if (host && host.style.display !== "none" && host.contains(event.target)) return;

    var control = findLegacyOrderControl(event.target);
    if (!control) return;
    lastTouchCard = null;

    var now = Date.now();
    if (lastOrderReplayControl === control && now - lastOrderReplayAt < 1200) return;
    lastOrderReplayControl = control;
    lastOrderReplayAt = now;

    window.setTimeout(function () {
      orderControlReplaying = true;
      if (typeof control.click === "function") {
        try {
          control.click();
        } catch (err) {
          window.__ENPOINT_QR_LAST_ORDER_CLICK_ERROR__ = err;
        }
      }
      dispatchLegacyMouseSequence(control);

      var form = control.form || (control.closest && control.closest("form"));
      if (form && typeof Event === "function") {
        var submitEvent = new Event("submit", {
          bubbles: true,
          cancelable: true,
        });
        form.dispatchEvent(submitEvent);
        if (typeof form.submit === "function") {
          try {
            form.submit();
          } catch (err) {
            window.__ENPOINT_QR_LAST_ORDER_SUBMIT_ERROR__ = err;
          }
        }
      }

      var onclickCalled = callOrderOnclick(control);
      var replayed = replayCapturedOrderHandlers(control);
      var called = callKnownOrderFunctions(control);

      orderControlReplaying = false;
      legacyDebug(
        "order control click: " +
          (control.tagName || "") +
          "#" +
          (control.id || "") +
          "." +
          (control.className || "") +
          " handlers:" +
          replayed +
          " onclick:" +
          onclickCalled +
          " funcs:" +
          called
      );
    }, 0);
  }

  function closeLegacyModal() {
    var host = document.getElementById("qrLegacyModalHost");
    var modal =
      document.getElementById("itemModal") ||
      document.getElementById("item-modal") ||
      document.getElementById("itemDetailModal") ||
      document.getElementById("item-detail-modal") ||
      document.querySelector(".item-modal");
    var backdrop = document.getElementById("qrLegacyBackdrop");

    if (modal) {
      modal.removeAttribute("open");
      modal.setAttribute("aria-hidden", "true");
      modal.removeAttribute("aria-modal");
      modal.style.display = "none";
      modal.className = (modal.className || "").replace(/\bshow-force\b/g, "").replace(/\bshow\b/g, "");
    }
    if (host) host.style.display = "none";
    if (backdrop) backdrop.style.display = "none";

    document.documentElement.className = document.documentElement.className.replace(/\bmodal-open\b/g, "");
    document.body.className = document.body.className.replace(/\bmodal-open\b/g, "");
    legacyDebug("legacy modal closed");
  }

  function replayLegacyModalControl(event) {
    if (modalControlReplaying) return;
    var host = document.getElementById("qrLegacyModalHost");
    if (!host || host.style.display === "none") return;
    if (!host.contains(event.target)) return;

    var control = findLegacyModalControl(event.target);
    if (!control) return;

    if (event && event.cancelable) event.preventDefault();

    if (isLegacyCloseControl(control)) {
      closeLegacyModal();
      return;
    }

    var shouldCloseAfterClick = isLegacyAddToCartControl(control);

    window.setTimeout(function () {
      modalControlReplaying = true;
      dispatchLegacyMouseSequence(control);
      modalControlReplaying = false;
      legacyDebug("modal control click: " + (control.id || control.className || control.tagName));
      if (shouldCloseAfterClick) {
        window.setTimeout(function () {
          closeLegacyModal();
        }, 180);
      }
    }, 0);
  }

  function modalLooksOpen(modal) {
    if (!modal) return false;
    if (modal.hasAttribute && modal.hasAttribute("open")) return true;
    var className = typeof modal.className === "string" ? modal.className : "";
    if (className.indexOf("show-force") !== -1) return true;
    if (modal.style && modal.style.display && modal.style.display !== "none") return true;
    return false;
  }

  function forceOpenItemModal(card) {
    var modal =
      document.getElementById("itemModal") ||
      document.getElementById("item-modal") ||
      document.getElementById("itemDetailModal") ||
      document.getElementById("item-detail-modal") ||
      document.querySelector(".item-modal") ||
      document.querySelector(".itemModal") ||
      document.querySelector("[data-item-modal]") ||
      document.querySelector("dialog");

    if (!modal) {
      legacyDebug("modal not found: " + getCardId(card));
      return;
    }

    if (!modal.getAttribute("data-legacy-original-parent") && modal.parentNode) {
      var originalId = modal.parentNode.id || "";
      if (!originalId) {
        originalId = "qrLegacyOriginalParent";
        modal.parentNode.id = originalId;
      }
      modal.setAttribute("data-legacy-original-parent", originalId);
    }

    var host = document.getElementById("qrLegacyModalHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "qrLegacyModalHost";
      document.body.appendChild(host);
    }
    if (modal.parentNode !== host) {
      host.appendChild(modal);
    }

    host.style.display = "block";
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.right = "0";
    host.style.bottom = "0";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.zIndex = "2147483000";
    host.style.overflow = "auto";
    host.style.webkitOverflowScrolling = "touch";
    host.style.background = "rgba(0, 0, 0, 0.42)";
    host.style.pointerEvents = "auto";

    modal.setAttribute("open", "");
    modal.removeAttribute("hidden");
    modal.hidden = false;
    modal.style.display = "block";
    modal.style.visibility = "visible";
    modal.style.opacity = "1";
    modal.style.pointerEvents = "auto";
    modal.style.position = "relative";
    modal.style.zIndex = "2147483001";
    modal.style.left = "auto";
    modal.style.top = "auto";
    modal.style.right = "auto";
    modal.style.bottom = "auto";
    modal.style.width = "100%";
    modal.style.minHeight = "100%";
    modal.style.overflow = "auto";
    modal.style.background = "transparent";
    modal.setAttribute("aria-modal", "true");
    modal.removeAttribute("aria-hidden");

    if ((" " + modal.className + " ").indexOf(" show ") === -1) {
      modal.className += " show";
    }
    if ((" " + modal.className + " ").indexOf(" show-force ") === -1) {
      modal.className += " show-force";
    }

    var dialog = modal.querySelector(".modal-dialog") || modal.querySelector("[role='document']");
    if (dialog) {
      dialog.style.display = "block";
      dialog.style.visibility = "visible";
      dialog.style.opacity = "1";
      dialog.style.transform = "none";
      dialog.style.margin = "24px auto";
      dialog.style.maxWidth = "520px";
      dialog.style.width = "92%";
      dialog.style.pointerEvents = "auto";
    }

    var content = modal.querySelector(".modal-content") || modal.firstElementChild;
    if (content) {
      content.style.display = "block";
      content.style.visibility = "visible";
      content.style.opacity = "1";
      content.style.pointerEvents = "auto";
    }

    var backdrop = document.getElementById("qrLegacyBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "qrLegacyBackdrop";
      backdrop.className = "modal-backdrop fade show qr-legacy-backdrop";
      document.body.appendChild(backdrop);
    }
    backdrop.style.display = "block";

    document.documentElement.className += " modal-open";
    document.body.className += " modal-open";
    legacyDebug("force modal open: " + getCardId(card));
  }

  function markTap(event) {
    if (isInsideOrderOrCart(event.target)) return;
    var card = findMenuCard(event.target);
    if (!card || !getCardId(card)) return;

    var touch = event.touches && event.touches.length ? event.touches[0] : null;
    touchMoved = false;
    if (touch) {
      touchStartX = touch.clientX || 0;
      touchStartY = touch.clientY || 0;
    }

    lastTouchAt = Date.now();
    lastTouchCard = card;
    legacyDebug("touch card: " + getCardId(card));
  }

  function replayClick(event) {
    if (replaying) return;
    if (isInsideOrderOrCart(event.target)) return;

    if (event && event.changedTouches && event.changedTouches.length) {
      var touch = event.changedTouches[0];
      var dx = Math.abs((touch.clientX || 0) - touchStartX);
      var dy = Math.abs((touch.clientY || 0) - touchStartY);
      if (dx > 8 || dy > 8) touchMoved = true;
    }

    if (touchMoved) {
      lastTouchCard = null;
      touchMoved = false;
      legacyDebug("scroll ignored");
      return;
    }

    var card = findMenuCard(event.target) || lastTouchCard;
    if (!card || !getCardId(card)) return;
    legacyDebug("replay card: " + getCardId(card));

    if (Date.now() - lastTouchAt > 900) return;
    window.setTimeout(function () {
      if (!card.parentNode) return;

      ["mousedown", "mouseup", "click"].forEach(function (type) {
        var mouseEvent;
        if (typeof MouseEvent === "function") {
          mouseEvent = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
          });
        } else {
          mouseEvent = document.createEvent("MouseEvents");
          mouseEvent.initMouseEvent(
            type,
            true,
            true,
            window,
            1,
            0,
            0,
            0,
            0,
            false,
            false,
            false,
            false,
            0,
            null
          );
        }
        card.dispatchEvent(mouseEvent);
      });

      window.setTimeout(function () {
        forceOpenItemModal(card);
      }, 120);
    }, 0);
  }

  document.addEventListener("touchstart", markTap, true);
  document.addEventListener("touchend", replayLegacyModalControl, true);
  document.addEventListener("touchend", replayLegacyOrderControl, true);
  document.addEventListener("touchend", replayClick, true);
  document.addEventListener("pointerup", replayLegacyModalControl, true);
  document.addEventListener("pointerup", replayClick, true);
  document.addEventListener("mouseup", replayLegacyModalControl, true);
  document.addEventListener("mouseup", replayClick, true);
})();


// =========================
// v58-48 最終舊平板送單修正
// =========================

window.forceLegacySubmitOrder = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  try {
    if (!cart || cart.length === 0) {
      alert("購物車目前是空的");
      return false;
    }

    renderConfirmModal();

    confirmModal.classList.remove("hidden");
    confirmModal.classList.add("show-force");

    return false;
  } catch (error) {
    alert("送單失敗：" + error.message);
    console.error(error);
    return false;
  }
};

/* =========================
   v59-3 QR inline 餐點點擊與浮動購物車
========================= */
window.qrOpenMenuItem = function (button, event) {
  if (event) {
    if (event.type === "touchend" && qrMenuTouchMoved) {
      qrMenuTouchMoved = false;
      return false;
    }
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
  }
  var itemId = button && button.getAttribute ? button.getAttribute("data-id") : "";
  if (!itemId) return false;
  openItemModalById(itemId);
  return false;
};


/* =========================
   v59-5 QR add-to-cart capture fallback
========================= */
(function(){
  if (typeof document === "undefined") return;
  function isAddBtn(el){
    while(el && el !== document){
      if (el.id === "addToCartBtn") return true;
      el = el.parentNode;
    }
    return false;
  }
  function hardAdd(e){
    if (!isAddBtn(e.target || e.srcElement)) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (typeof window.qrAddCurrentItemToCart === "function") {
      window.qrAddCurrentItemToCart(e);
    } else if (typeof window.qrHardAddToCart === "function") {
      window.qrHardAddToCart(e);
    }
  }
  // v59-7：避免 inline + capture 重複觸發，加入購物車只走按鈕本身的事件
})();


/* =========================
   v59-8 QR legacy direct submit
   舊平板：跳過確認 modal，直接用原本資料結構送出
========================= */
var qrLegacySubmitting = false;
var qrLegacySubmitLastAt = 0;

window.qrLegacyDirectSubmitOrder = function (event) {
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  if (!shouldHandleQrOrderAction(event, "submitOrder", 2200)) return false;

  var nowTime = new Date().getTime();
  if (qrLegacySubmitting || nowTime - qrLegacySubmitLastAt < 2200) {
    return false;
  }
  if (qrLastSubmitTapAt && nowTime - qrLastSubmitTapAt < 900) return false;
  qrLastSubmitTapAt = nowTime;
  qrLegacySubmitLastAt = nowTime;

  try {
    if (!validateOrderType()) return false;
    if (!cart || cart.length === 0) {
      alert("購物車目前是空的");
      return false;
    }

    var ok = true;
    try {
      ok = window.confirm("確定送出訂單嗎？");
    } catch (e) {
      ok = true;
    }
    if (!ok) return false;

    qrLegacySubmitting = true;
    if (submitOrderBtn) {
      submitOrderBtn.disabled = true;
      submitOrderBtn.textContent = "送出中...";
    }
    if (confirmSubmitBtn) {
      confirmSubmitBtn.disabled = true;
      confirmSubmitBtn.textContent = "送出中...";
    }

    var total = 0;
    for (var i = 0; i < cart.length; i++) {
      total += Number(cart[i].subtotal || 0);
    }

    var orderRef = push(ref(db, "orders"));
    var now = Date.now();
    var businessDate = getBusinessDate();
    var meta = getOrderMeta();

    createOrderNumber("qr", { storeId: STORE_ID, businessDate: businessDate })
      .then(function (orderNumber) {
        var safeCustomerName = customerNameInput ? customerNameInput.value.trim() : "";
        var safeOrderNote = orderNoteInput ? orderNoteInput.value.trim() : "";

        var order = {
          id: orderRef.key,
          orderNumber: orderNumber,
          businessDate: businessDate,
          businessDay: businessDate,
          storeId: STORE_ID,
          orderSource: "QR",
          deviceType: "qr",
          source: "QR",
          type: meta.type,
          table: meta.table,
          customerName: safeCustomerName,
          customerLabel: meta.customerLabel,
          note: safeOrderNote,
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

        if (confirmModal) {
          confirmModal.className = (confirmModal.className || "") + " hidden";
          confirmModal.style.display = "none";
        }
        if (itemModal) {
          itemModal.className = (itemModal.className || "") + " hidden";
          itemModal.style.display = "none";
        }
        try { closeQrCartPanel(); } catch (e) {}

        showSubmittedOrderView(order, true);
        listenOrderStatus(order.id);

        cart = [];
        if (customerNameInput) customerNameInput.value = "";
        if (orderNoteInput) orderNoteInput.value = "";
        if (!table && currentOrderType === "內用" && qrTableInput) {
          qrTableInput.value = "";
        }
        try { legacyRenderQrCart(); } catch (e) { try { renderCart(); } catch (err) {} }
      })
      .catch(function (error) {
        console.error("QR 送出失敗：", error);
        alert("送出失敗：" + (error && error.message ? error.message : "請稍後再試。"));
      })
      .then(function () {
        qrLegacySubmitting = false;
        if (submitOrderBtn) {
          submitOrderBtn.disabled = false;
          submitOrderBtn.textContent = "送出訂單";
        }
        if (confirmSubmitBtn) {
          confirmSubmitBtn.disabled = false;
          confirmSubmitBtn.textContent = "確認送出";
        }
      });
  } catch (error) {
    qrLegacySubmitting = false;
    if (submitOrderBtn) {
      submitOrderBtn.disabled = false;
      submitOrderBtn.textContent = "送出訂單";
    }
    if (confirmSubmitBtn) {
      confirmSubmitBtn.disabled = false;
      confirmSubmitBtn.textContent = "確認送出";
    }
    console.error("QR 送出失敗：", error);
    alert("送出失敗：" + (error && error.message ? error.message : error));
  }

  return false;
};

if (submitOrderBtn) {
  submitOrderBtn.onclick = window.qrLegacyDirectSubmitOrder;
  submitOrderBtn.ontouchend = window.qrLegacyDirectSubmitOrder;
}
if (confirmSubmitBtn) {
  confirmSubmitBtn.onclick = window.qrLegacyDirectSubmitOrder;
  confirmSubmitBtn.ontouchend = window.qrLegacyDirectSubmitOrder;
}


/* =========================
   v59-9 QR legacy detail + submit guard
   修正舊平板送出時找不到 renderItemDetail，並攔截舊的確認彈窗流程
========================= */
if (typeof window.renderItemDetail !== "function") {
  window.renderItemDetail = function(item) {
    if (!item) return "";
    var html = "";
    if (item.size) html += "<p>份量：" + item.size + "</p>";
    if (item.requiredOption && item.requiredOption.title && item.requiredOption.value) {
      html += "<p>" + item.requiredOption.title + "：" + item.requiredOption.value + "</p>";
    }
    if (item.spicy) html += "<p>辣度：" + item.spicy + "</p>";
    if (item.satay) html += "<p>沙茶：" + item.satay + "</p>";
    var addons = item.addons || item.extras || [];
    if (addons && addons.length) {
      var names = [];
      for (var i = 0; i < addons.length; i++) {
        var a = addons[i];
        if (typeof a === "string") names.push(a);
        else names.push((a.name || a.label || "加料") + (Number(a.price || 0) ? " +$" + Number(a.price || 0) : ""));
      }
      html += "<p>加料：" + names.join("、") + "</p>";
    }
    if (item.note) html += "<p>備註：" + item.note + "</p>";
    return html;
  };
}
if (typeof renderItemDetail !== "function") {
  var renderItemDetail = window.renderItemDetail;
}

(function(){
  if (typeof document === "undefined") return;
  function isQrSubmitTarget(el){
    while(el && el !== document){
      var id = el.id || "";
      if (id === "submitOrderBtn" || id === "confirmSubmitBtn") return true;
      el = el.parentNode;
    }
    return false;
  }
  function guard(e){
    if (!isQrSubmitTarget(e.target || e.srcElement)) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (typeof window.qrLegacyDirectSubmitOrder === "function") {
      return window.qrLegacyDirectSubmitOrder(e);
    }
    return false;
  }
  document.addEventListener("touchend", guard, true);
  document.addEventListener("click", guard, true);
})();


/* =========================
   v59-10 QR 剛剛訂單置頂按鈕
========================= */
var lastOrderTopBtn = document.getElementById("lastOrderTopBtn");

function showLastOrderTopButton() {
  if (!lastOrderTopBtn) return;
  try {
    var lastOrderId = localStorage.getItem(LAST_ORDER_KEY);
    if (!lastOrderId) return;
  } catch (error) {
    return;
  }
  lastOrderTopBtn.className = String(lastOrderTopBtn.className || "").replace(/\bhidden\b/g, "");
  lastOrderTopBtn.style.display = "block";
}

function hideLastOrderTopButton() {
  if (!lastOrderTopBtn) return;
  if ((" " + lastOrderTopBtn.className + " ").indexOf(" hidden ") === -1) {
    lastOrderTopBtn.className += " hidden";
  }
  lastOrderTopBtn.style.display = "none";
}

function openLastQrOrderFromTop(event) {
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
  }
  try {
    var lastOrderId = localStorage.getItem(LAST_ORDER_KEY);
    if (!lastOrderId) {
      alert("目前沒有可查看的訂單");
      return false;
    }
    var orderRef = ref(db, "orders/" + lastOrderId);
    onValue(orderRef, function(snapshot) {
      var order = snapshot.exists() ? snapshot.val() : null;
      if (!order) {
        alert("找不到訂單資料");
        return;
      }
      var fullOrder = { id: lastOrderId };
      for (var key in order) {
        if (Object.prototype.hasOwnProperty.call(order, key)) {
          fullOrder[key] = order[key];
        }
      }
      showSuccessPage(fullOrder);
      listenOrderStatus(lastOrderId);
    }, { onlyOnce: true });
  } catch (error) {
    alert("開啟剛剛訂單失敗：" + (error && error.message ? error.message : error));
  }
  return false;
}

if (lastOrderTopBtn) {
  lastOrderTopBtn.onclick = openLastQrOrderFromTop;
  lastOrderTopBtn.ontouchend = openLastQrOrderFromTop;
  showLastOrderTopButton();
}
window.openLastQrOrderFromTop = openLastQrOrderFromTop;

(function(){
  if (!lastOrderTopBtn) return;
  function isLastOrderBtn(el) {
    while (el && el !== document) {
      if (el.id === "lastOrderTopBtn") return true;
      el = el.parentNode;
    }
    return false;
  }
  function guard(e) {
    if (!isLastOrderBtn(e.target || e.srcElement)) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    return openLastQrOrderFromTop(e);
  }
  document.addEventListener("touchend", guard, true);
  document.addEventListener("click", guard, true);
})();


/* =========================
   v59-12 QR 查看訂單修正
   - 舊 iPad：用 capture 全域攔截
   - 沒有本機紀錄時：測試模式抓今日最新 QR 訂單
========================= */
(function(){
  var btn = document.getElementById("lastOrderTopBtn");
  if (!btn) return;

  function forceShowBtn(){
    btn.className = String(btn.className || "").replace(/\bhidden\b/g, "");
    btn.style.display = "block";
    btn.style.visibility = "visible";
  }

  function showOrderById(orderId){
    if (!orderId) {
      alert("目前沒有可查看的訂單");
      return false;
    }
    try {
      onValue(ref(db, "orders/" + orderId), function(snapshot){
        var order = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
        if (!order) {
          alert("找不到訂單資料");
          return;
        }
        var fullOrder = { id: orderId };
        for (var key in order) {
          if (Object.prototype.hasOwnProperty.call(order, key)) fullOrder[key] = order[key];
        }
        if (orderPage) {
          orderPage.className = (orderPage.className || "") + " hidden";
          orderPage.style.display = "none";
        }
        if (successPage) {
          successPage.className = String(successPage.className || "").replace(/\bhidden\b/g, "");
          successPage.style.display = "block";
        }
        showSuccessPage(fullOrder);
        listenOrderStatus(orderId);
      }, { onlyOnce: true });
    } catch (err) {
      alert("開啟剛剛訂單失敗：" + (err && err.message ? err.message : err));
    }
    return false;
  }

  function openLatestQrOrderFallback(){
    try {
      onValue(ref(db, "orders"), function(snapshot){
        var raw = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
        if (!raw) {
          alert("目前沒有可查看的 QR 訂單");
          return;
        }
        var today = "";
        try { today = getBusinessDate(); } catch(e) {}
        var latestId = "";
        var latestTime = 0;
        for (var id in raw) {
          if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
          var o = raw[id] || {};
          if (o.source && String(o.source).toUpperCase() !== "QR") continue;
          if (today && o.businessDate && o.businessDate !== today) continue;
          var t = Number(o.createdAt || o.updatedAt || 0);
          if (t >= latestTime) {
            latestTime = t;
            latestId = id;
          }
        }
        if (!latestId) {
          alert("目前沒有可查看的 QR 訂單");
          return;
        }
        try { localStorage.setItem(LAST_ORDER_KEY, latestId); } catch(e) {}
        showOrderById(latestId);
      }, { onlyOnce: true });
    } catch (err) {
      alert("開啟最新 QR 訂單失敗：" + (err && err.message ? err.message : err));
    }
    return false;
  }

  window.openLastQrOrderFromTop = function(event){
    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    var lastOrderId = "";
    try { lastOrderId = localStorage.getItem(LAST_ORDER_KEY) || ""; } catch(e) {}
    if (lastOrderId) return showOrderById(lastOrderId);
    return openLatestQrOrderFallback();
  };

  btn.onclick = window.openLastQrOrderFromTop;
  btn.ontouchend = window.openLastQrOrderFromTop;
  btn.onmousedown = window.openLastQrOrderFromTop;
  forceShowBtn();

  function isBtn(el){
    while (el && el !== document) {
      if (el.id === "lastOrderTopBtn") return true;
      el = el.parentNode;
    }
    return false;
  }
  function guard(e){
    if (!isBtn(e.target || e.srcElement)) return;
    return window.openLastQrOrderFromTop(e);
  }
  try { document.addEventListener("touchstart", guard, true); } catch(e) {}
  try { document.addEventListener("touchend", guard, true); } catch(e) {}
  try { document.addEventListener("click", guard, true); } catch(e) {}
})();


/* =========================
   v59-13 QR：用網址參數 view=last 當作查看訂單的保底入口
   舊 iPad 若按鈕事件不吃，href 重新整理後也會自動開啟。
========================= */
(function(){
  function hasViewLast(){
    try {
      var search = String(window.location.search || "");
      return search.indexOf("view=last") >= 0;
    } catch(e) { return false; }
  }
  function openByParam(){
    if (!hasViewLast()) return;
    if (window.openLastQrOrderFromTop) {
      try { window.openLastQrOrderFromTop(null); } catch(e) {}
    }
  }
  try { setTimeout(openByParam, 700); } catch(e) {}
  var btn = document.getElementById("lastOrderTopBtn");
  if (btn) {
    btn.style.display = "block";
    btn.style.visibility = "visible";
    btn.className = String(btn.className || "").replace(/\bhidden\b/g, "");
    btn.onclick = function(event){
      if (window.openLastQrOrderFromTop) return window.openLastQrOrderFromTop(event);
      return true;
    };
    btn.ontouchend = btn.onclick;
  }
})();


/* =========================
   v59-14 QR 查看訂單：改成真正分頁連結
   - 舊平板按事件不吃時，直接靠 href 進入 ?view=last
   - 文字改成「查看訂單」
========================= */
(function(){
  var btn = document.getElementById("lastOrderTopBtn");
  if (!btn) return;
  btn.innerHTML = "查看訂單";
  btn.setAttribute("href", "#topOrderPanel");
  btn.style.display = "inline-block";
  btn.style.visibility = "visible";
  btn.className = String(btn.className || "").replace(/\bhidden\b/g, "");
})();


/* =========================
   v59-17 QR：點餐/查看訂單分頁模式
   - 一般進入只顯示點餐區
   - 按查看訂單才進入 ?view=last 顯示訂單區
========================= */
(function(){
  var viewLink = document.getElementById("qrViewOrderPlainLink");
  var orderLink = document.getElementById("qrOrderTabLink");
  if (viewLink) {
    viewLink.innerHTML = "查看訂單";
    viewLink.setAttribute("href", "./index.html?view=last");
    viewLink.onclick = null;
    viewLink.ontouchend = null;
  }
  if (orderLink) {
    orderLink.setAttribute("href", "./index.html");
  }
  if (String(window.location.search || "").indexOf("view=last") >= 0) {
    qrShowOrderMode();
    try {
      setTimeout(function(){
        if (topOrderContent && !topOrderContent.innerHTML) {
          topOrderContent.innerHTML = '<div class="empty">正在讀取剛剛的訂單...</div>';
        }
      }, 200);
    } catch(e) {}
  } else {
    qrShowMenuMode();
  }
})();

/* =========================
   v59-18 QR：點餐 / 查看訂單 真正互斥分頁
   - 預設只顯示點餐
   - 按查看訂單只顯示剛剛送出的訂單
========================= */
(function(){
  function hasClass(el, name){
    return el && (" " + (el.className || "") + " ").indexOf(" " + name + " ") >= 0;
  }
  function addClass(el, name){
    if (el && !hasClass(el, name)) el.className = (el.className ? el.className + " " : "") + name;
  }
  function removeClass(el, name){
    if (el) el.className = (el.className || "").replace(new RegExp("\\b" + name + "\\b", "g"), "").replace(/\s+/g, " ");
  }
  function setActive(which){
    var orderTab = document.getElementById("qrOrderTabLink");
    var viewTab = document.getElementById("qrViewOrderPlainLink");
    removeClass(orderTab, "active");
    removeClass(viewTab, "active");
    if (which === "order") addClass(viewTab, "active");
    else addClass(orderTab, "active");
  }
  function prevent(e){
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      e.returnValue = false;
      e.cancelBubble = true;
    }
  }
  function setBodyMode(mode){
    var body = document.body;
    if (!body) return;
    removeClass(body, "qr-tab-menu");
    removeClass(body, "qr-tab-order");
    addClass(body, mode === "order" ? "qr-tab-order" : "qr-tab-menu");
  }
  function showMenu(e){
    prevent(e);
    removeBodyClass("qr-direct-order-mode");
    setBodyMode("menu");
    setActive("menu");
    if (topOrderPanel) {
      addClass(topOrderPanel, "hidden");
      topOrderPanel.style.display = "none";
    }
    if (orderPage) {
      removeClass(orderPage, "hidden");
      orderPage.style.display = "";
    }
    if (successPage) {
      addClass(successPage, "hidden");
      successPage.style.display = "none";
    }
    if (floatingCartBtn) floatingCartBtn.style.display = "block";
    return false;
  }
  function renderEmptyOrder(){
    if (topOrderContent && !topOrderContent.innerHTML) {
      topOrderContent.innerHTML = '<div class="empty">目前還沒有剛剛送出的訂單。</div>';
    }
  }
  function readLastOrder(){
    var id = "";
    try { id = localStorage.getItem(LAST_ORDER_KEY) || ""; } catch(e) {}
    if (!id) {
      renderEmptyOrder();
      return;
    }
    try {
      var orderRef = ref(db, "orders/" + id);
      onValue(orderRef, function(snapshot){
        var order = snapshot.val();
        if (!order) {
          if (topOrderContent) topOrderContent.innerHTML = '<div class="empty">找不到剛剛的訂單。</div>';
          return;
        }
        if (topOrderContent) topOrderContent.innerHTML = buildQrOrderHtml(Object.assign({ id: id }, order));
        if (orderStatusBox) orderStatusBox.textContent = "狀態：" + getOrderStatusText(order);
      }, { onlyOnce: true });
    } catch(err) {
      if (topOrderContent) topOrderContent.innerHTML = '<div class="empty">讀取訂單失敗：' + (err && err.message ? err.message : err) + '</div>';
    }
  }
  function showOrder(e){
    prevent(e);
    setBodyMode("order");
    setActive("order");
    if (orderPage) {
      addClass(orderPage, "hidden");
      orderPage.style.display = "none";
    }
    if (successPage) {
      addClass(successPage, "hidden");
      successPage.style.display = "none";
    }
    if (floatingCartBtn) floatingCartBtn.style.display = "none";
    if (topOrderPanel) {
      removeClass(topOrderPanel, "hidden");
      topOrderPanel.style.display = "block";
    }
    readLastOrder();
    try { window.scrollTo(0, 0); } catch(e2) {}
    return false;
  }
  window.qrShowMenuTab = showMenu;
  window.qrShowOrderTab = showOrder;

  var orderTab = document.getElementById("qrOrderTabLink");
  var viewTab = document.getElementById("qrViewOrderPlainLink");
  if (orderTab) {
    orderTab.href = "javascript:void(0)";
    orderTab.onclick = showMenu;
    orderTab.ontouchend = showMenu;
  }
  if (viewTab) {
    viewTab.innerHTML = "查看訂單";
    viewTab.href = "javascript:void(0)";
    viewTab.onclick = showOrder;
    viewTab.ontouchend = showOrder;
  }
  if (String(window.location.search || "").indexOf("view=last") >= 0) showOrder(null);
  else showMenu(null);
})();

/* =====================================================
   v61-4 QR 回穩版：訂單查詢 60 分鐘時效 + 狀態視覺，不影響 v59 菜單 render
===================================================== */
(function(){
  var LAST_ORDER_KEY_V614 = "enpoint_last_qr_order_id";
  var LAST_ORDER_TIME_KEY_V614 = "enpoint_last_qr_order_saved_at";

  function now(){ return Date.now ? Date.now() : new Date().getTime(); }
  function getLookupTtl(){
    var minutes = normalizeQrOrderLookupMinutes(orderLookupMinutes);
    if (minutes === 0) return 0;
    return minutes * 60 * 1000;
  }
  function getValidLastOrderId(){
    try{
      var id = localStorage.getItem(LAST_ORDER_KEY_V614) || "";
      var savedAt = Number(localStorage.getItem(LAST_ORDER_TIME_KEY_V614) || 0);
      if(!id) return "";
      var ttl = getLookupTtl();
      if(!savedAt || (ttl > 0 && now() - savedAt > ttl)){
        localStorage.removeItem(LAST_ORDER_KEY_V614);
        localStorage.removeItem(LAST_ORDER_TIME_KEY_V614);
        return "";
      }
      return id;
    }catch(e){ return ""; }
  }

  window.enpointQrSaveLastOrderV614 = function(orderId){
    try{
      localStorage.setItem(LAST_ORDER_KEY_V614, orderId);
      localStorage.setItem(LAST_ORDER_TIME_KEY_V614, String(now()));
    }catch(e){}
  };

  var oldBuild = window.buildQrOrderHtml;
  function statusInfo(order){
    var status = (order && (order.kitchenStatus || order.status || order.paymentStatus)) || "pending_payment";
    if(order && (order.cancelled || status === "cancelled")) return {step:1, icon:"⚠️", title:"訂單已取消", text:"請洽櫃檯重新確認。", cls:"qr-status-cancelled"};
    if(order && (order.kitchenStatus === "done" || order.status === "done")) return {step:4, icon:"🎉", title:"餐點已完成", text:"請至櫃檯取餐，謝謝您。", cls:"qr-status-done"};
    if(order && (order.kitchenStatus === "cooking" || order.status === "cooking")) return {step:3, icon:"👨‍🍳", title:"餐點製作中", text:"店家正在為您準備餐點，請稍候。", cls:"qr-status-cooking"};
    if(order && (order.kitchenStatus === "confirmed" || order.status === "confirmed" || order.paymentStatus === "paid" || order.paid === true)) return {step:2, icon:"🧾", title:"店家已確認", text:"餐點已送至廚房，正在等待製作。", cls:""};
    return {step:1, icon:"✅", title:"訂單已送出", text:"請至櫃檯確認付款，店員確認後會送廚房。", cls:""};
  }
  function progressHtml(step){
    var names = ["送出", "確認", "製作", "完成"];
    var width = Math.max(1, Math.min(4, step)) / 4 * 100;
    var html = '<div class="qr-progress-box"><div class="qr-progress-line"><div style="width:'+width+'%"></div></div><div class="qr-progress-steps">';
    for(var i=1;i<=4;i++){
      var cls = i < step ? "done" : (i === step ? "active" : "");
      html += '<div class="qr-progress-step '+cls+'"><span>'+i+'</span><p>'+names[i-1]+'</p></div>';
    }
    html += '</div></div>';
    return html;
  }
  window.buildQrOrderHtml = function(order){
    var base = "";
    try { base = oldBuild ? oldBuild(order) : ""; } catch(e) { base = ""; }
    var info = statusInfo(order || {});
    var number = (order && (order.orderNumber || order.id)) || "-";
    var top = ''+
      '<div class="qr-big-order-number"><span>您的訂單號</span><strong>'+ number +'</strong><p>請用此單號至櫃檯結帳 / 取餐</p></div>'+
      '<div class="qr-status-card '+info.cls+'"><div class="qr-status-icon">'+info.icon+'</div><div class="qr-status-main"><h3>'+info.title+'</h3><p>'+info.text+'</p></div></div>'+
      progressHtml(info.step);
    return top + base;
  };

  // 攔截送單成功後儲存時間，避免共用 QR 下一位客人看到上一位過久訂單
  var tryPatchCount = 0;
  function patchLastOrderSetter(){
    tryPatchCount++;
    try{
      var originalSetItem = localStorage.setItem.bind(localStorage);
      if(!window.__ENPOINT_QR_LOCALSTORAGE_PATCHED_V614__){
        window.__ENPOINT_QR_LOCALSTORAGE_PATCHED_V614__ = true;
        localStorage.setItem = function(key, value){
          var result = originalSetItem(key, value);
          if(String(key) === LAST_ORDER_KEY_V614 && value){
            originalSetItem(LAST_ORDER_TIME_KEY_V614, String(now()));
          }
          return result;
        };
      }
    }catch(e){}
  }
  patchLastOrderSetter();

  // 重新綁定分頁：點餐一定回到 v59 菜單，不被查看訂單覆蓋
  function removeClass(el,name){ if(el) el.className = String(el.className||"").replace(new RegExp("\\b"+name+"\\b","g"),"").replace(/\s+/g," "); }
  function addClass(el,name){ if(el && (" "+String(el.className||"")+" ").indexOf(" "+name+" ")<0) el.className += (el.className?" ":"")+name; }
  function showMenu(e){
    if(e){ e.preventDefault&&e.preventDefault(); e.stopPropagation&&e.stopPropagation(); }
    removeClass(document.body,"qr-direct-order-mode");
    removeClass(document.body,"qr-tab-order"); addClass(document.body,"qr-tab-menu");
    var orderPage=document.getElementById("orderPage"), successPage=document.getElementById("successPage"), topOrderPanel=document.getElementById("topOrderPanel"), floatingCartBtn=document.getElementById("floatingCartBtn");
    removeClass(orderPage,"hidden"); if(orderPage) orderPage.style.display="block";
    addClass(successPage,"hidden"); if(successPage) successPage.style.display="none";
    addClass(topOrderPanel,"hidden"); if(topOrderPanel) topOrderPanel.style.display="none";
    if(floatingCartBtn) floatingCartBtn.style.display="block";
    try{ if(typeof renderCategories === "function") renderCategories(); if(typeof renderMenu === "function") renderMenu(); }catch(err){ console.error("QR v61-4 render menu failed", err); }
    return false;
  }
  function showOrder(e){
    if(e){ e.preventDefault&&e.preventDefault(); e.stopPropagation&&e.stopPropagation(); }
    removeClass(document.body,"qr-tab-menu"); addClass(document.body,"qr-tab-order");
    var orderPage=document.getElementById("orderPage"), successPage=document.getElementById("successPage"), topOrderPanel=document.getElementById("topOrderPanel"), topOrderContent=document.getElementById("topOrderContent"), floatingCartBtn=document.getElementById("floatingCartBtn");
    addClass(orderPage,"hidden"); if(orderPage) orderPage.style.display="none";
    addClass(successPage,"hidden"); if(successPage) successPage.style.display="none";
    if(floatingCartBtn) floatingCartBtn.style.display="none";
    removeClass(topOrderPanel,"hidden"); if(topOrderPanel) topOrderPanel.style.display="block";
    var id = getValidLastOrderId();
    if(!id){ if(topOrderContent) topOrderContent.innerHTML='<div class="empty">目前沒有可查詢的訂單，或上一筆訂單已超過店家設定時間，請重新點餐。</div>'; return false; }
    try{
      onValue(ref(db,"orders/"+id),function(snapshot){
        var order=snapshot.val();
        if(!order){ if(topOrderContent) topOrderContent.innerHTML='<div class="empty">找不到剛剛的訂單，請重新點餐。</div>'; return; }
        if(topOrderContent) topOrderContent.innerHTML=window.buildQrOrderHtml(Object.assign({id:id},order));
      });
    }catch(err){ if(topOrderContent) topOrderContent.innerHTML='<div class="empty">讀取訂單失敗，請重新整理。</div>'; }
    return false;
  }
  window.qrShowMenuTab = showMenu;
  window.qrShowOrderTab = showOrder;
  var a=document.getElementById("qrOrderTabLink"), b=document.getElementById("qrViewOrderPlainLink");
  if(a){ a.href="javascript:void(0)"; a.onclick=showMenu; a.ontouchend=showMenu; }
  if(b){ b.href="javascript:void(0)"; b.onclick=showOrder; b.ontouchend=showOrder; }
  setTimeout(function(){
    if (typeof initDirectOrderView === "function" && initDirectOrderView()) return;
    if(String(window.location.search||"").indexOf("view=last")>=0) showOrder(null);
    else showMenu(null);
  }, 100);
})();

/* =========================
   v64 QR freshness closeout
========================= */
(function(){
  var oldBuildQrOrderHtmlV64 = window.buildQrOrderHtml || buildQrOrderHtml;

  function orderViewExpired(order) {
    return isOrderLookupExpired(order);
  }

  window.buildQrOrderHtml = function(order) {
    if (orderViewExpired(order || {})) {
      return '<div class="qr-direct-order-card qr-direct-expired-card"><div class="qr-direct-expired-message">此訂單已超過查看時間</div></div>';
    }
    return oldBuildQrOrderHtmlV64(order);
  };

  var oldShowOrderTab = window.qrShowOrderTab;
  window.qrShowOrderTab = function(event) {
    if (event && event.preventDefault) event.preventDefault();
    var id = getSavedViewingOrderId();
    if (!id) {
      qrShowMenuMode();
      return false;
    }
    if (typeof oldShowOrderTab === "function") return oldShowOrderTab(event);
    loadViewingOrderById(id, true);
    return false;
  };

  try {
    var searchParams = new URLSearchParams(window.location.search || "");
    var isDirectOrder = searchParams.get("view") === "order" && !!searchParams.get("orderId");
    var isLastOrder = searchParams.get("view") === "last";
    if (!isDirectOrder && !isLastOrder) {
      qrShowMenuMode();
    }
  } catch (e) {
    qrShowMenuMode();
  }
})();

/* =========================
   v63 final tab binding: every View Order tab open reloads Firebase by orderId.
========================= */
(function(){
  function stop(event){
    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
  }

  function openMenu(event){
    stop(event);
    qrShowMenuMode();
    try { renderCategories(); renderMenu(); } catch (error) { console.error("QR 點餐頁重繪失敗：", error); }
    return false;
  }

  function openOrder(event){
    stop(event);
    loadViewingOrderById(getSavedViewingOrderId(), true);
    return false;
  }

  window.qrShowMenuTab = openMenu;
  window.qrShowOrderTab = openOrder;

  var orderTab = document.getElementById("qrOrderTabLink");
  var viewTab = document.getElementById("qrViewOrderPlainLink");
  if (orderTab) {
    orderTab.href = "javascript:void(0)";
    orderTab.onclick = openMenu;
    orderTab.ontouchend = openMenu;
  }
  if (viewTab) {
    viewTab.href = "javascript:void(0)";
    viewTab.onclick = openOrder;
    viewTab.ontouchend = openOrder;
  }
})();

/* v64 final tab guard after v63 binding */
(function(){
  var viewTab = document.getElementById("qrViewOrderPlainLink");
  function openOrderV64(event) {
    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    var id = getSavedViewingOrderId();
    if (!id) {
      qrShowMenuMode();
      return false;
    }
    loadViewingOrderById(id, true);
    return false;
  }
  window.qrShowOrderTab = openOrderV64;
  if (viewTab) {
    viewTab.onclick = openOrderV64;
    viewTab.ontouchend = openOrderV64;
  }
})();
