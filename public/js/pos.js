import {
  db,
  ref,
  push,
  set,
  update,
  onValue
} from "./firebase.js";

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
const ordersRef = ref(db, "orders");

/* =========================
   State
========================= */

let menuData = {};
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

let editingOrderId = null;
let editingItems = [];

let editingItemIndex = null;
let editingItemData = null;
let editingMenuItem = null;
let editSelectedPortion = null;
let editSelectedExtras = [];
let editSelectedSatay = "不要";
let editQuantity = 1;

const tables = ["1", "2", "3", "4", "5", "6", "7", "8"];

/* =========================
   Init
========================= */

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderCategories();
  renderMenu();
});

onValue(ordersRef, snapshot => {
  ordersData = snapshot.exists() ? snapshot.val() : {};
  renderAllOrders();
  renderStats();
});

renderTableButtons();
renderCart();

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

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}

function getEnabledItems() {
  return Object.entries(menuData)
    .map(([id, item]) => ({ id, ...item }))
    .filter(item => item.enabled !== false);
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

  const possibleId =
    item.itemId ||
    item.id ||
    item.menuId ||
    item.productId;

  if (possibleId && menuData[possibleId]) {
    return {
      id: possibleId,
      ...menuData[possibleId]
    };
  }

  const found = Object.entries(menuData).find(([id, menuItem]) => {
    return menuItem.name === item.name;
  });

  if (found) {
    return {
      id: found[0],
      ...found[1]
    };
  }

  return item;
}

function getPortionOptions(item) {
  const options = [];

  if (item.sizes && typeof item.sizes === "object") {
    Object.entries(item.sizes).forEach(([name, price]) => {
      options.push({
        name,
        price: Number(price)
      });
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

  return (
    category.includes("鍋燒") ||
    category.includes("炒麵")
  );
}

function getOrderStatusText(order) {
  if (order.status === "cancelled" || order.kitchenStatus === "cancelled") {
    return "已取消";
  }

  if (order.status === "done" || order.kitchenStatus === "done") {
    return "已完成";
  }

  if (order.kitchenStatus === "cooking" || order.status === "cooking") {
    return "製作中";
  }

  if (
    order.kitchenStatus === "confirmed" ||
    order.status === "confirmed" ||
    order.paymentStatus === "paid"
  ) {
    return "已確認付款";
  }

  return "等待付款";
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
  return (
    order &&
    order.status !== "cancelled" &&
    order.status !== "done" &&
    order.kitchenStatus !== "done" &&
    order.paymentStatus !== "paid"
  );
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
  const categories = ["全部"];

  items.forEach(item => {
    const category = getItemCategory(item);

    if (!categories.includes(category)) {
      categories.push(category);
    }
  });

  categoryList.innerHTML = categories.map(category => `
    <button class="${currentCategory === category ? "active" : ""}" onclick="selectCategory('${category}')">
      ${category}
    </button>
  `).join("");
}

function selectCategory(category) {
  currentCategory = category;
  renderCategories();
  renderMenu();
}

function renderMenu() {
  let items = getEnabledItems();

  if (currentCategory !== "全部") {
    items = items.filter(item => getItemCategory(item) === currentCategory);
  }

  if (items.length === 0) {
    posMenuList.innerHTML = `<div class="empty">目前沒有餐點</div>`;
    return;
  }

  posMenuList.innerHTML = items.map(item => {
    const imageUrl = getImageUrl(item);

    return `
      <button class="pos-food-btn" onclick="openCustomModal('${item.id}')">
        <div class="food-img">
          ${
            imageUrl
              ? `<img src="${imageUrl}" alt="${item.name || "餐點圖片"}">`
              : `<span>恩點</span>`
          }
        </div>

        <div class="food-info">
          <strong>${item.name || "未命名餐點"}</strong>
          <small>${getItemCategory(item)}</small>
          <b>${money(getBasePrice(item))}</b>
        </div>
      </button>
    `;
  }).join("");
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

  const portionOptions = getPortionOptions(currentItem);
  selectedPortion = portionOptions[0];

  modalItemName.textContent = currentItem.name || "未命名餐點";
  modalItemPrice.textContent = `起價 ${money(getBasePrice(currentItem))}`;
  modalQuantity.textContent = "1";
  noteInput.value = "";

  spicySelect.value = allowSpicy(currentItem) ? "不辣" : "";
  spicySelect.disabled = !allowSpicy(currentItem);

  renderPortionOptions();
  renderSatayOptions();
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

  modalQuantity.textContent = "1";
  noteInput.value = "";
  extrasBox.innerHTML = "";
  portionBox.innerHTML = "";
  satayBox.innerHTML = "";
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
  selectedPortion = {
    name,
    price: Number(price)
  };

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
    selectedExtras.push({
      name,
      price: Number(price)
    });
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
  if (event.target === customModal) {
    closeCustomModal();
  }
});

confirmCustomBtn.addEventListener("click", () => {
  if (!currentItem || !selectedPortion) return;

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

  submitOrderBtn.disabled = true;
  submitOrderBtn.textContent = "建立中...";

  try {
    const newOrderRef = push(ordersRef);
    const now = Date.now();
    const orderNumber = now.toString().slice(-6);

    const customerLabel =
      currentOrderType === "內用"
        ? `${selectedTable}桌`
        : `外帶-${orderNumber}`;

    const order = {
      id: newOrderRef.key,
      orderNumber,
      source: "店員POS",
      type: currentOrderType,
      table: currentOrderType === "內用" ? selectedTable : "",
      customerName: currentOrderType === "外帶" ? `外帶-${orderNumber}` : "",
      customerLabel,
      items: cart,
      total: calculateTotal(cart),
      status: "pending",
      statusText: "等待櫃檯確認付款",
      paymentStatus: "unpaid",
      kitchenStatus: "waiting",
      confirmed: false,
      paid: false,
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

function getTodayOrders() {
  return Object.entries(ordersData)
    .map(([id, order]) => ({ id, ...order }))
    .filter(order => isToday(order.createdAt))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function renderAllOrders() {
  const todayOrders = getTodayOrders();

  const pendingOrders = todayOrders.filter(order => {
    return (
      order.status !== "cancelled" &&
      order.status !== "done" &&
      order.kitchenStatus !== "done" &&
      order.paymentStatus !== "paid"
    );
  });

  const processingOrders = todayOrders.filter(order => {
    return (
      order.paymentStatus === "paid" &&
      order.status !== "done" &&
      order.kitchenStatus !== "done" &&
      order.status !== "cancelled" &&
      order.kitchenStatus !== "cancelled"
    );
  });

  const doneOrders = todayOrders.filter(order => {
    return order.status === "done" || order.kitchenStatus === "done";
  });

  const cancelledOrders = todayOrders.filter(order => {
    return order.status === "cancelled" || order.kitchenStatus === "cancelled";
  });

  pendingOrderList.innerHTML = renderOrderList(pendingOrders, "目前沒有待確認訂單");
  processingOrderList.innerHTML = renderOrderList(processingOrders, "目前沒有製作中訂單");
  doneOrderList.innerHTML = renderOrderList(doneOrders, "目前沒有已完成訂單");
  cancelledOrderList.innerHTML = renderOrderList(cancelledOrders, "目前沒有已取消訂單");
}

function renderOrderList(orders, emptyText) {
  if (orders.length === 0) {
    return `<div class="empty">${emptyText}</div>`;
  }

  return orders.map(order => renderOrderCard(order)).join("");
}

function renderOrderCard(order) {
  const items = normalizeOrderItems(order.items);
  const statusText = getOrderStatusText(order);
  const canConfirm = order.paymentStatus !== "paid" && order.status !== "cancelled";
  const canCancel = order.paymentStatus !== "paid" && order.status !== "cancelled";
  const editable = canEditOrder(order);

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
        ${
          editable
            ? `<button class="secondary-btn" onclick="openEditOrderModal('${order.id}')">編輯 / 改單</button>`
            : ""
        }

        ${
          canConfirm
            ? `<button class="primary-btn" onclick="confirmPaidAndSendKitchen('${order.id}')">確認結帳並送廚房</button>`
            : ""
        }

        ${
          canCancel
            ? `<button class="danger-btn" onclick="cancelOrder('${order.id}')">取消</button>`
            : ""
        }
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
  if (event.target === editOrderModal) {
    closeEditOrderModal();
  }
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
  renderEditItemExtras();
  updateEditItemSubtotal();

  editItemModal.classList.remove("hidden");
}

function closeEditItemModal() {
  editItemModal.classList.add("hidden");

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
  editSelectedPortion = {
    name,
    price: Number(price)
  };

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
    editSelectedExtras.push({
      name,
      price: Number(price)
    });
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
  if (event.target === editItemModal) {
    closeEditItemModal();
  }
});

/* =========================
   Confirm / Cancel
========================= */

async function confirmPaidAndSendKitchen(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單");
    return;
  }

  const ok = confirm(`確認「${getCustomerLabel(order)}」已付款，並送到廚房？`);
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "confirmed",
      statusText: "已確認付款，等待廚房製作",
      paymentStatus: "paid",
      kitchenStatus: "confirmed",
      confirmed: true,
      paid: true,
      sentToKitchenAt: Date.now(),
      updatedAt: Date.now()
    });

    alert("已確認付款並送到廚房");
  } catch (error) {
    console.error("送廚房失敗：", error);
    alert("送廚房失敗");
  }
}

async function cancelOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) return;

  const ok = confirm(`確定要取消「${getCustomerLabel(order)}」這張訂單嗎？`);
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "cancelled",
      statusText: "訂單已取消",
      paymentStatus: "cancelled",
      kitchenStatus: "cancelled",
      cancelledAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error("取消訂單失敗：", error);
    alert("取消訂單失敗");
  }
}

/* =========================
   Stats
========================= */

function renderStats() {
  const todayOrders = getTodayOrders();

  const unpaidOrders = todayOrders.filter(order => order.paymentStatus !== "paid" && order.status !== "cancelled");
  const processingOrders = todayOrders.filter(order => order.paymentStatus === "paid" && order.status !== "done" && order.kitchenStatus !== "done");
  const doneOrders = todayOrders.filter(order => order.status === "done" || order.kitchenStatus === "done");

  const revenue = doneOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  statTotalOrders.textContent = todayOrders.length;
  statUnpaidOrders.textContent = unpaidOrders.length;
  statProcessingOrders.textContent = processingOrders.length;
  statDoneOrders.textContent = doneOrders.length;
  statTodayRevenue.textContent = money(revenue);
}

/* =========================
   Events / Window
========================= */

submitOrderBtn.addEventListener("click", submitOrder);
clearCartBtn.addEventListener("click", clearCart);

window.selectCategory = selectCategory;
window.selectTable = selectTable;
window.openCustomModal = openCustomModal;
window.selectPortion = selectPortion;
window.selectSatay = selectSatay;
window.toggleExtra = toggleExtra;
window.removeFromCart = removeFromCart;

window.confirmPaidAndSendKitchen = confirmPaidAndSendKitchen;
window.cancelOrder = cancelOrder;

window.openEditOrderModal = openEditOrderModal;
window.changeEditItemQty = changeEditItemQty;
window.removeEditItem = removeEditItem;

window.openEditItemModal = openEditItemModal;
window.selectEditPortion = selectEditPortion;
window.selectEditSatay = selectEditSatay;
window.toggleEditExtra = toggleEditExtra;