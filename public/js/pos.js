import {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  getBusinessDate,
  generateDailyOrderNumber
} from "./firebase.js";

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

const categoryList = document.getElementById("categoryList");
const posMenuList = document.getElementById("posMenuList");
const cartList = document.getElementById("cartList");
const totalAmount = document.getElementById("totalAmount");

const dineInBtn = document.getElementById("dineInBtn");
const takeOutBtn = document.getElementById("takeOutBtn");
const tableSelectBox = document.getElementById("tableSelectBox");
const tableButtons = document.getElementById("tableButtons");
const takeOutInfo = document.getElementById("takeOutInfo");

const submitOrderBtn = document.getElementById("submitOrderBtn");
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

/* =========================
   Firebase
========================= */

const menuRef = ref(db, "menu");
const categoriesRef = ref(db, "categories");
const ordersRef = ref(db, "orders");

/* =========================
   State
========================= */

let menuData = {};
let categoriesData = {};
let ordersData = {};
let currentCategory = "全部";
let cart = [];

let currentOrderType = "內用";
let selectedTable = "1";

let currentItem = null;
let currentQuantity = 1;
let selectedPortion = null;
let selectedExtras = [];
let selectedSatay = "不要";
let selectedRequiredOption = "";

let editingOrderId = null;
let editingItems = [];

let editingItemIndex = null;
let editingItemData = null;
let editingMenuItem = null;
let editSelectedPortion = null;
let editSelectedExtras = [];
let editSelectedSatay = "不要";
let editSelectedRequiredOption = "";
let editQuantity = 1;

let businessDayCloseData = null;

const tables = ["1", "2", "3", "4", "5", "6", "7", "8"];

/* =========================
   Init
========================= */

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderCategories();
  renderMenu();
});

onValue(categoriesRef, snapshot => {
  categoriesData = snapshot.exists() ? snapshot.val() : {};
  renderCategories();
  renderMenu();
});

onValue(ordersRef, snapshot => {
  ordersData = snapshot.exists() ? snapshot.val() : {};
  renderAllOrders();
  renderStats();
  renderRealtimeBadges();
});

renderTableButtons();
renderCart();
renderStoreModeNotice();

/* =========================
   Tabs
========================= */

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.tab;

    tabButtons.forEach(btn => btn.classList.remove("active"));
    tabPanels.forEach(panel => panel.classList.remove("active"));

    button.classList.add("active");
    document.getElementById(target).classList.add("active");
  });
});

/* =========================
   Helpers
========================= */

function money(n) {
  return `$${Number(n || 0)}`;
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
  if (getOrderBusinessDate(order)) {
    return getOrderBusinessDate(order) === getBusinessDate();
  }

  return isToday(order.createdAt);
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
      sortOrder: Number(category.sortOrder ?? 999999999)
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

    const itemOrderA = Number(a.sortOrder ?? 999999999);
    const itemOrderB = Number(b.sortOrder ?? 999999999);

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

function getItemCategory(item) {
  return item.category || "其他";
}

function getImageUrl(item) {
  return item.image || item.imageUrl || item.photo || item.photoUrl || "";
}

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

function getOrderStatusText(order) {
  if (isCancelled(order)) return "已取消";
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
  return Number(item.qty || item.quantity || 1);
}

function itemUnitPrice(item) {
  return Number(item.price || item.unitPrice || item.basePrice || 0);
}

function itemSubtotal(item) {
  if (item.subtotal) return Number(item.subtotal);
  return itemUnitPrice(item) * itemQty(item);
}

function itemExtras(item) {
  return item.addons || item.extras || [];
}

function calculateTotal(items = cart) {
  return items.reduce((sum, item) => sum + itemSubtotal(item), 0);
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
  return getTodayOrders().filter(order => !isCancelled(order));
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
    return !isCancelled(order) && isDone(order) && !isClosed(order);
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

dineInBtn.addEventListener("click", () => {
  currentOrderType = "內用";
  dineInBtn.classList.add("active");
  takeOutBtn.classList.remove("active");
  tableSelectBox.style.display = "block";
  takeOutInfo.style.display = "none";
});

takeOutBtn.addEventListener("click", () => {
  currentOrderType = "外帶";
  takeOutBtn.classList.add("active");
  dineInBtn.classList.remove("active");
  tableSelectBox.style.display = "none";
  takeOutInfo.style.display = "block";
});

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
}

function renderPosFoodButton(item) {
  const imageUrl = getImageUrl(item);

  return `
    <button class="pos-food-btn" onclick="openCustomModal('${item.id}')">
      <div class="food-img">
        ${imageUrl ? `<img src="${imageUrl}" alt="${item.name || "餐點圖片"}">` : `<span>恩點</span>`}
      </div>

      <div class="food-info">
        <strong>${item.name || "未命名餐點"}</strong>
        <small>${getItemCategory(item)}</small>
        <b>${money(getBasePrice(item))}</b>
      </div>
    </button>
  `;
}

/* =========================
   Add Item Modal
========================= */

function openCustomModal(itemId) {
  const item = menuData[itemId];
  if (!item) return;

  currentItem = { id: itemId, ...item };
  currentQuantity = 1;
  selectedExtras = [];
  selectedSatay = "不要";
  selectedRequiredOption = "";

  const portionOptions = getPortionOptions(currentItem);
  selectedPortion = portionOptions[0];

  modalItemName.textContent = currentItem.name || "未命名餐點";
  modalItemPrice.textContent = `起價 ${money(getBasePrice(currentItem))}`;
  modalQuantity.textContent = "1";
  noteInput.value = "";

  spicySelect.value = allowSpicy(currentItem) ? "不辣" : "";
  spicySelect.disabled = !allowSpicy(currentItem);

  renderItemDescriptionBox();
  renderPortionOptions();
  renderSatayOptions();
  renderRequiredOptionBox();
  renderExtrasOptions();

  customModal.classList.remove("hidden");
}

function closeCustomModal() {
  customModal.classList.add("hidden");

  currentItem = null;
  currentQuantity = 1;
  selectedPortion = null;
  selectedExtras = [];
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

}

function renderPortionOptions() {
  const options = getPortionOptions(currentItem);

  portionBox.innerHTML = `
    <h3>份量</h3>
    <div class="option-grid">
      ${options.map(option => `
        <button class="option-btn ${selectedPortion?.name === option.name ? "active" : ""}"
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

function toggleExtra(name, price) {
  const exists = selectedExtras.some(extra => extra.name === name);

  if (exists) {
    selectedExtras = selectedExtras.filter(extra => extra.name !== name);
  } else {
    selectedExtras.push({ name, price: Number(price) });
  }

  renderExtrasOptions();
}

modalMinusBtn.addEventListener("click", () => {
  currentQuantity = Math.max(1, currentQuantity - 1);
  modalQuantity.textContent = currentQuantity;
});

modalPlusBtn.addEventListener("click", () => {
  currentQuantity += 1;
  modalQuantity.textContent = currentQuantity;
});

cancelCustomBtn.addEventListener("click", closeCustomModal);

customModal.addEventListener("click", event => {
  if (event.target === customModal) closeCustomModal();
});

confirmCustomBtn.addEventListener("click", () => {
  if (!currentItem || !selectedPortion) return;
  
  const requiredOption = getRequiredOption(currentItem);

  if (requiredOption && !selectedRequiredOption) {
    alert(`請先選擇「${requiredOption.title}」`);
    return;
  }
  
  const basePrice = Number(selectedPortion.price || getBasePrice(currentItem));
  const extrasTotal = selectedExtras.reduce((sum, extra) => sum + Number(extra.price || 0), 0);
  const unitPrice = basePrice + extrasTotal;
  const subtotal = unitPrice * currentQuantity;

  cart.push({
    cartId: Date.now().toString() + Math.random().toString(36).slice(2),
    id: currentItem.id,
    itemId: currentItem.id,
    name: currentItem.name,
    category: getItemCategory(currentItem),
    size: selectedPortion.name,
    basePrice,
    price: unitPrice,
    unitPrice,
    quantity: currentQuantity,
    qty: currentQuantity,
    spicy: allowSpicy(currentItem) ? spicySelect.value : "",
    satay: allowSatay(currentItem) ? selectedSatay : "",
    requiredOption: requiredOption
      ? {
          title: requiredOption.title,
          value: selectedRequiredOption
        }
      : null,
    extras: selectedExtras,
    addons: selectedExtras,
    note: noteInput.value.trim(),
    subtotal
  });

  renderCart();
  closeCustomModal();
});

/* =========================
   Cart
========================= */

function renderCart() {
  if (cart.length === 0) {
    cartList.innerHTML = `<div class="empty">尚未加入餐點</div>`;
    totalAmount.textContent = "$0";
    return;
  }

  cartList.innerHTML = cart.map(item => {
    const extras = itemExtras(item);

    return `
      <div class="cart-item">
        <div>
          <strong>${item.name} × ${itemQty(item)}</strong>

          <div class="cart-detail">
            ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
            ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
            ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
            ${item.requiredOption ? `<p>${item.requiredOption.title}：${item.requiredOption.value}</p>` : ""}
            ${extras.length ? `<p>加料：${extras.map(extra => extra.name).join("、")}</p>` : ""}
            ${item.note ? `<p>備註：${item.note}</p>` : ""}
            <p>小計：${money(itemSubtotal(item))}</p>
          </div>
        </div>

        <button class="danger-btn" onclick="removeFromCart('${item.cartId}')">刪除</button>
      </div>
    `;
  }).join("");

  totalAmount.textContent = money(calculateTotal(cart));
}

function removeFromCart(cartId) {
  cart = cart.filter(item => item.cartId !== cartId);
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

/* =========================
   Submit POS Order
========================= */

async function submitOrder() {
  if (cart.length === 0) {
    alert("請先加入餐點");
    return;
  }

  if (isBusinessDayClosed()) {
    alert("今日已收班，不能再建立新的今日訂單。請明日營業日再開始點餐。");
    return;
  }

  submitOrderBtn.disabled = true;
  submitOrderBtn.textContent = "建立中...";

  try {
    const newOrderRef = push(ordersRef);
    const now = Date.now();
    const businessDate = getBusinessDate();
    const orderNumber = await generateDailyOrderNumber();

    const customerLabel =
      currentOrderType === "內用"
        ? `${selectedTable}桌`
        : `外帶-${orderNumber}`;

    const order = {
      id: newOrderRef.key,
      orderNumber,
      businessDate,
      storeId: STORE_ID,
      storeMode: STORE_MODE,
      source: "店員POS",
      type: currentOrderType,
      table: currentOrderType === "內用" ? selectedTable : "",
      customerName: currentOrderType === "外帶" ? `外帶-${orderNumber}` : "",
      customerLabel,
      items: cart,
      total: calculateTotal(cart),
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

    await set(newOrderRef, order);

    alert(`已建立未結帳訂單：${customerLabel}`);

    cart = [];
    renderCart();
  } catch (error) {
    console.error("建立訂單失敗：", error);
    alert("建立訂單失敗");
  }

  submitOrderBtn.disabled = false;
  submitOrderBtn.textContent = "建立未結帳訂單";
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
  const canClose = !locked && isDone(order) && !isClosed(order) && !isCancelled(order);
  const editable = !locked && canEditOrder(order);

  return `
    <article class="order-card">
      <div class="order-card-head">
        <div>
          <strong>#${order.orderNumber || order.id}</strong>
          <p>${getCustomerLabel(order)}｜${order.source || "未知"}｜${order.type || "未分類"}</p>
          <p>${formatTime(order.createdAt)}</p>
        </div>

        <span class="status-badge">${statusText}</span>
      </div>

      <div class="order-items">
        ${items.map(renderOrderItem).join("")}
      </div>

      ${order.note ? `<div class="order-note">整單備註：${order.note}</div>` : ""}

      <div class="order-total">總金額：${money(order.total)}</div>

      <div class="order-actions">
        ${editable ? `<button class="secondary-btn" onclick="openEditOrderModal('${order.id}')">編輯 / 改單</button>` : ""}

        ${canConfirm ? `<button class="primary-btn" onclick="confirmPaidAndProcess('${order.id}')">${STORE_MODE === "pro" ? "確認結帳並開始製作" : "確認結帳並送廚房"}</button>` : ""}

        ${STORE_MODE === "pro" && order.status === "cooking" ? `<button class="primary-btn" onclick="markOrderDoneByPOS('${order.id}')">POS 標記完成</button>` : ""}

        ${canClose ? `<button class="primary-btn" onclick="closeOrder('${order.id}')">結案</button>` : ""}

        ${canCancel ? `<button class="danger-btn" onclick="cancelOrder('${order.id}')">取消</button>` : ""}
      </div>
    </article>
  `;
}

function renderOrderItem(item) {
  const extras = itemExtras(item);

  return `
    <div class="order-item">
      <strong>• ${item.name} × ${itemQty(item)}</strong>

      <div class="order-item-detail">
        ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
        ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
        ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
        ${item.requiredOption ? `<p>${item.requiredOption.title}：${item.requiredOption.value}</p>` : ""}
        ${extras.length ? `<p>加料：${extras.map(extra => extra.name).join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${item.note}</p>` : ""}
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
    subtotal: itemSubtotal(item)
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
    const extras = itemExtras(item);

    return `
      <div class="edit-order-item">
        <div>
          <strong>${item.name}</strong>

          <div class="order-item-detail">
            ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
            ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
            ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
            ${item.requiredOption ? `<p>${item.requiredOption.title}：${item.requiredOption.value}</p>` : ""}
            ${extras.length ? `<p>加料：${extras.map(extra => extra.name).join("、")}</p>` : ""}
            ${item.note ? `<p>備註：${item.note}</p>` : ""}
            <p>小計：${money(itemSubtotal(item))}</p>
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

  editOrderTotal.textContent = money(calculateTotal(editingItems));
}

function changeEditItemQty(index, amount) {
  const item = editingItems[index];
  if (!item) return;

  const nextQty = Math.max(1, itemQty(item) + amount);
  item.qty = nextQty;
  item.quantity = nextQty;
  item.subtotal = itemUnitPrice(item) * nextQty;

  renderEditOrderItems();
}

function removeEditItem(index) {
  const item = editingItems[index];
  if (!item) return;

  const ok = confirm(`確定要刪除「${item.name}」嗎？`);
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
      total: calculateTotal(editingItems),
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
  editSelectedSatay = item.satay || "不要";
  editSelectedRequiredOption = item.requiredOption?.value || "";

  editSelectedPortion = {
    name: item.size || "一般",
    price: Number(item.basePrice || item.price || item.unitPrice || 0)
  };

  editItemName.textContent = item.name;
  editItemPrice.textContent = "調整份量、加料、辣度與備註";
  editItemNoteInput.value = item.note || "";
  editItemSpicySelect.value = item.spicy || "";
  editItemQuantity.textContent = editQuantity;
  editItemSpicySelect.disabled = !allowSpicy(editingMenuItem);

  renderEditItemPortions();
  renderEditItemSatay();
  renderEditItemRequiredOption();



  renderEditItemExtras();
  updateEditItemSubtotal();

  editItemModal.classList.remove("hidden");
}

function closeEditItemModal() {
  editItemModal.classList.add("hidden");

  editSelectedRequiredOption = "";

  const editRequiredOptionBox = document.getElementById("editRequiredOptionBox");
  if (editRequiredOptionBox) editRequiredOptionBox.remove();

  editingItemIndex = null;
  editingItemData = null;
  editingMenuItem = null;

  editSelectedExtras = [];
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
          class="option-btn ${editSelectedPortion?.name === option.name ? "active" : ""}"
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

function toggleEditExtra(name, price) {
  const exists = editSelectedExtras.some(extra => extra.name === name);

  if (exists) {
    editSelectedExtras = editSelectedExtras.filter(extra => extra.name !== name);
  } else {
    editSelectedExtras.push({ name, price: Number(price) });
  }

  renderEditItemExtras();
  updateEditItemSubtotal();
}

function updateEditItemSubtotal() {
  if (!editSelectedPortion) return;

  const extrasTotal = editSelectedExtras.reduce((sum, extra) => {
    return sum + Number(extra.price || 0);
  }, 0);

  const unitPrice = Number(editSelectedPortion.price || 0) + extrasTotal;
  const subtotal = unitPrice * editQuantity;

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

  const extrasTotal = editSelectedExtras.reduce((sum, extra) => {
    return sum + Number(extra.price || 0);
  }, 0);

  const unitPrice = Number(editSelectedPortion.price || 0) + extrasTotal;
  const subtotal = unitPrice * editQuantity;

  editingItems[editingItemIndex] = {
    ...editingItems[editingItemIndex],
    itemId: editingItems[editingItemIndex].itemId || editingMenuItem?.id || editingItems[editingItemIndex].id,
    size: editSelectedPortion.name,
    basePrice: Number(editSelectedPortion.price || 0),
    price: unitPrice,
    unitPrice,
    spicy: editItemSpicySelect.value,
    satay: editSelectedSatay,

    requiredOption: requiredOption
      ? {
        title: requiredOption.title,
        value: editSelectedRequiredOption
        }
      : null,
    
    addons: editSelectedExtras,
    extras: editSelectedExtras,
    note: editItemNoteInput.value.trim(),
    qty: editQuantity,
    quantity: editQuantity,
    subtotal
  };

  renderEditOrderItems();
  closeEditItemModal();
});

editItemModal.addEventListener("click", event => {
  if (event.target === editItemModal) closeEditItemModal();
});

/* =========================
   Confirm / Cancel / Close
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
      kitchenStatus: "confirmed",
      confirmed: true,
      paid: true,
      paidAt: now,
      sentToKitchenAt: now,
      updatedAt: now
    });

    alert("已確認付款並送到廚房");
  } catch (error) {
    console.error("確認付款失敗：", error);
    alert("確認付款失敗");
  }
}

async function markOrderDoneByPOS(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  const ok = confirm(`確認「${getCustomerLabel(order)}」餐點已完成？`);
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "done",
      statusText: "餐點已完成，等待 POS 結案",
      kitchenStatus: "not_required",
      doneAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error("標記完成失敗：", error);
    alert("標記完成失敗");
  }
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
    await update(ref(db, `orders/${orderId}`), {
      status: "closed",
      statusText: "訂單已結案",
      closed: true,
      closedAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error("結案失敗：", error);
    alert("結案失敗");
  }
}

async function cancelOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) return;

  const ok = confirm(`確定要取消「${getCustomerLabel(order)}」這張訂單嗎？取消後不會計入營收與有效訂單。`);
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "cancelled",
      statusText: "訂單已取消",
      paymentStatus: "cancelled",
      kitchenStatus: "cancelled",
      cancelled: true,
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
    if (isCancelled(order)) return;

    const items = normalizeOrderItems(order.items);

    items.forEach(item => {
      const name = item.name || "未命名";
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

  const effectiveOrders = orders.filter(order => !isCancelled(order));

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

  const revenue = doneOrders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  const average = effectiveOrders.length > 0 ? revenue / effectiveOrders.length : 0;

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
    return;
  }

  closingStatus.textContent = "已收班";
  closingTime.textContent = formatTime(businessDayCloseData.closedAt);
  closeBusinessDayBtn.disabled = false;
  closeBusinessDayBtn.textContent = "重新開班";
  submitOrderBtn.disabled = true;
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
  const effectiveOrders = orders.filter(order => !isCancelled(order));
  const cancelledOrders = orders.filter(order => isCancelled(order));
  const doneOrders = effectiveOrders.filter(order => isDone(order) || isClosed(order));

  const revenue = doneOrders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  try {
    const now = Date.now();

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
   Events / Window
========================= */

submitOrderBtn.addEventListener("click", submitOrder);
clearCartBtn.addEventListener("click", clearCart);

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

window.selectCategory = selectCategory;
window.selectTable = selectTable;
window.openCustomModal = openCustomModal;
window.selectPortion = selectPortion;
window.selectSatay = selectSatay;
window.toggleExtra = toggleExtra;
window.removeFromCart = removeFromCart;

window.confirmPaidAndProcess = confirmPaidAndProcess;
window.confirmPaidAndSendKitchen = confirmPaidAndProcess;
window.markOrderDoneByPOS = markOrderDoneByPOS;
window.closeOrder = closeOrder;
window.cancelOrder = cancelOrder;

window.openEditOrderModal = openEditOrderModal;
window.changeEditItemQty = changeEditItemQty;
window.removeEditItem = removeEditItem;

window.openEditItemModal = openEditItemModal;
window.selectEditPortion = selectEditPortion;
window.selectEditSatay = selectEditSatay;
window.toggleEditExtra = toggleEditExtra;

window.selectEditRequiredOption = selectEditRequiredOption;