import {
  db,
  ref,
  push,
  set,
  update,
  onValue
} from "./firebase.js";

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
const todayOrderList = document.getElementById("todayOrderList");

const statTotalOrders = document.getElementById("statTotalOrders");
const statUnpaidOrders = document.getElementById("statUnpaidOrders");
const statProcessingOrders = document.getElementById("statProcessingOrders");
const statDoneOrders = document.getElementById("statDoneOrders");
const statTodayRevenue = document.getElementById("statTodayRevenue");

const customModal = document.getElementById("customModal");
const modalItemName = document.getElementById("modalItemName");
const modalItemPrice = document.getElementById("modalItemPrice");
const modalMinusBtn = document.getElementById("modalMinusBtn");
const modalPlusBtn = document.getElementById("modalPlusBtn");
const modalQuantity = document.getElementById("modalQuantity");
const spicySelect = document.getElementById("spicySelect");
const extrasBox = document.getElementById("extrasBox");
const noteInput = document.getElementById("noteInput");
const cancelCustomBtn = document.getElementById("cancelCustomBtn");
const confirmCustomBtn = document.getElementById("confirmCustomBtn");

const menuRef = ref(db, "menu");
const ordersRef = ref(db, "orders");

let menuData = {};
let ordersData = {};
let currentCategory = "全部";
let cart = [];
let currentOrderType = "內用";
let selectedTable = "1";
let currentItem = null;
let currentQuantity = 1;
let expandedOrderId = null;

const tables = ["1", "2", "3", "4", "5", "6", "7", "8"];

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderCategories();
  renderMenu();
});

onValue(ordersRef, snapshot => {
  ordersData = snapshot.exists() ? snapshot.val() : {};
  renderTodayOrders();
});

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

function getEnabledItems() {
  return Object.entries(menuData)
    .map(([id, item]) => ({ id, ...item }))
    .filter(item => item.enabled);
}

function renderCategories() {
  const items = getEnabledItems();
  const categories = ["全部"];

  items.forEach(item => {
    if (item.category && !categories.includes(item.category)) {
      categories.push(item.category);
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
    items = items.filter(item => item.category === currentCategory);
  }

  if (items.length === 0) {
    posMenuList.innerHTML = "<p>目前沒有餐點</p>";
    return;
  }

  posMenuList.innerHTML = items.map(item => `
    <button class="pos-food-btn" onclick="openCustomModal('${item.id}')">
      <strong>${item.name}</strong>
      <span>NT$${item.price}</span>
    </button>
  `).join("");
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

function openCustomModal(itemId) {
  const item = menuData[itemId];
  if (!item) return;

  currentItem = { id: itemId, ...item };
  currentQuantity = 1;

  modalItemName.textContent = currentItem.name;
  modalItemPrice.textContent = "NT$" + currentItem.price;
  modalQuantity.textContent = "1";
  spicySelect.value = "不辣";
  noteInput.value = "";

  renderExtras(currentItem.options || {});
  customModal.classList.remove("hidden");
}

function closeCustomModal() {
  customModal.classList.add("hidden");
  currentItem = null;
  currentQuantity = 1;
  modalQuantity.textContent = "1";
  spicySelect.value = "不辣";
  noteInput.value = "";
  extrasBox.innerHTML = "";
}

function renderExtras(options) {
  extrasBox.innerHTML = "";

  const entries = Object.entries(options);

  if (entries.length === 0) {
    extrasBox.innerHTML = "<p>此餐點沒有加料選項</p>";
    return;
  }

  extrasBox.innerHTML = entries.map(([name, price]) => `
    <label class="extra-option">
      <input type="checkbox" value="${name}" data-price="${price}">
      <span>${name} + NT$${price}</span>
    </label>
  `).join("");
}

modalMinusBtn.addEventListener("click", () => {
  if (currentQuantity > 1) {
    currentQuantity -= 1;
    modalQuantity.textContent = currentQuantity;
  }
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
  if (!currentItem) return;

  const selectedExtras = [];

  extrasBox.querySelectorAll("input[type='checkbox']:checked").forEach(input => {
    selectedExtras.push({
      name: input.value,
      price: Number(input.dataset.price)
    });
  });

  const unitPrice = selectedExtras.reduce((sum, extra) => {
    return sum + Number(extra.price);
  }, Number(currentItem.price));

  cart.push({
    cartId: Date.now().toString() + Math.random().toString(36).slice(2),
    id: currentItem.id,
    name: currentItem.name,
    category: currentItem.category || "",
    basePrice: Number(currentItem.price),
    price: unitPrice,
    quantity: currentQuantity,
    qty: currentQuantity,
    spicy: spicySelect.value,
    extras: selectedExtras,
    note: noteInput.value.trim()
  });

  renderCart();
  closeCustomModal();
});

function renderCart() {
  if (cart.length === 0) {
    cartList.innerHTML = "<p>尚未加入餐點</p>";
    totalAmount.textContent = "$0";
    return;
  }

  let total = 0;

  cartList.innerHTML = cart.map(item => {
    const subtotal = item.price * item.quantity;
    total += subtotal;

    const extrasText = item.extras.length
      ? item.extras.map(extra => `${extra.name}+${extra.price}`).join("、")
      : "無";

    return `
      <div class="cart-item">
        <div>
          <strong>${item.name}</strong>
          <p>NT$${item.price} × ${item.quantity} = NT$${subtotal}</p>
          <p>辣度：${item.spicy}</p>
          <p>加料：${extrasText}</p>
          <p>備註：${item.note || "無"}</p>
        </div>

        <div class="cart-actions">
          <button onclick="changeQuantity('${item.cartId}', -1)">-</button>
          <span>${item.quantity}</span>
          <button onclick="changeQuantity('${item.cartId}', 1)">+</button>
          <button class="danger-btn" onclick="removeFromCart('${item.cartId}')">刪除</button>
        </div>
      </div>
    `;
  }).join("");

  totalAmount.textContent = "$" + total;
}

function changeQuantity(cartId, amount) {
  const item = cart.find(cartItem => cartItem.cartId === cartId);
  if (!item) return;

  item.quantity += amount;
  item.qty = item.quantity;

  if (item.quantity <= 0) {
    removeFromCart(cartId);
    return;
  }

  renderCart();
}

function removeFromCart(cartId) {
  cart = cart.filter(item => item.cartId !== cartId);
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function calculateTotal(items = cart) {
  return items.reduce((sum, item) => {
    return sum + Number(item.price || item.unitPrice || 0) * Number(item.quantity || item.qty || 1);
  }, 0);
}

async function submitOrder() {
  if (cart.length === 0) {
    alert("請先加入餐點");
    return;
  }

  submitOrderBtn.disabled = true;
  submitOrderBtn.textContent = "建立中...";

  try {
    const newOrderRef = push(ordersRef);
    const orderNumber = Date.now().toString().slice(-6);

    const customerLabel =
      currentOrderType === "內用"
        ? `${selectedTable}桌`
        : `外帶-${orderNumber}`;

    const order = {
      orderNumber,
      source: "店員POS",
      type: currentOrderType,
      table: currentOrderType === "內用" ? selectedTable : "",
      customerName: currentOrderType === "外帶" ? `外帶-${orderNumber}` : "",
      customerLabel,
      items: cart,
      total: calculateTotal(cart),
      status: "unpaid",
      statusText: "未結帳",
      paymentStatus: "unpaid",
      kitchenStatus: "not_sent",
      confirmed: false,
      paid: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await set(newOrderRef, order);

    alert(`已建立未結帳訂單：${customerLabel}`);

    cart = [];
    renderCart();

    selectedTable = "1";
    renderTableButtons();
  } catch (err) {
    console.error("建立訂單失敗：", err);
    alert("建立訂單失敗");
  } finally {
    submitOrderBtn.disabled = false;
    submitOrderBtn.textContent = "建立未結帳訂單";
  }
}

function renderTodayOrders() {
  const orders = Object.entries(ordersData)
    .map(([id, order]) => ({ id, ...order }))
    .filter(order => isToday(order.createdAt))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (orders.length === 0) {
    renderTodayStats({
      orders: [],
      unpaidOrders: [],
      processingOrders: [],
      doneOrders: []
    });

    todayOrderList.innerHTML = "<p>今天目前沒有訂單。</p>";
    return;
  }

  const unpaidOrders = orders.filter(order =>
    order.paymentStatus !== "paid" &&
    order.status !== "cancelled"
  );

  const processingOrders = orders.filter(order =>
    order.paymentStatus === "paid" &&
    order.status !== "done" &&
    order.status !== "cancelled"
  );

  const doneOrders = orders.filter(order => order.status === "done");
  const cancelledOrders = orders.filter(order => order.status === "cancelled");

  renderTodayStats({
    orders,
    unpaidOrders,
    processingOrders,
    doneOrders
  });

  todayOrderList.innerHTML = `
    ${renderOrderSection("未結帳", unpaidOrders)}
    ${renderOrderSection("製作中 / 已送廚房", processingOrders)}
    ${renderOrderSection("已完成", doneOrders)}
    ${renderOrderSection("已取消", cancelledOrders)}
  `;
}

function renderTodayStats({
  orders,
  unpaidOrders,
  processingOrders,
  doneOrders
}) {
  const revenue = doneOrders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  if (statTotalOrders) statTotalOrders.textContent = orders.length;
  if (statUnpaidOrders) statUnpaidOrders.textContent = unpaidOrders.length;
  if (statProcessingOrders) statProcessingOrders.textContent = processingOrders.length;
  if (statDoneOrders) statDoneOrders.textContent = doneOrders.length;
  if (statTodayRevenue) statTodayRevenue.textContent = "$" + revenue;
}

function renderOrderSection(title, orders) {
  return `
    <div class="today-order-section">
      <h3>${title}</h3>
      ${
        orders.length === 0
          ? `<p>目前沒有訂單</p>`
          : orders.map(order => renderOrderCard(order)).join("")
      }
    </div>
  `;
}

function renderOrderCard(order) {
  const label = getCustomerLabel(order);
  const statusText = getPosStatusText(order);

  const itemsText = Array.isArray(order.items)
    ? order.items.map(item => `${item.name}×${item.quantity || item.qty || 1}`).join("、")
    : "無餐點";

  const canSendKitchen =
    order.status !== "cancelled" &&
    order.status !== "done" &&
    order.kitchenStatus !== "sent";

  const isExpanded = expandedOrderId === order.id;

  return `
    <div class="today-order-card ${order.paymentStatus || "unpaid"}">
      <div class="today-order-head">
        <strong>#${order.orderNumber || order.id}</strong>
        <span class="pos-status-badge">${statusText}</span>
      </div>

      <p>來源：${order.source || "未知"}｜類型：${order.type || "現場"}</p>
      <p>取餐資訊：${label}</p>
      <p>時間：${formatTime(order.createdAt)}</p>
      <p>餐點：${itemsText}</p>
      <p class="order-total">總金額：$${order.total || 0}</p>

      <div class="order-actions">
        <button onclick="toggleOrderDetail('${order.id}')">
          ${isExpanded ? "收起改單" : "查看 / 改單"}
        </button>

        ${
          canSendKitchen
            ? `<button class="primary-btn" onclick="confirmPaidAndSendKitchen('${order.id}')">確認結帳並送廚房</button>`
            : `<button disabled>已送廚房</button>`
        }
      </div>

      ${
        isExpanded
          ? renderInlineOrderDetail(order)
          : ""
      }
    </div>
  `;
}

function toggleOrderDetail(orderId) {
  expandedOrderId = expandedOrderId === orderId ? null : orderId;
  renderTodayOrders();
}

function renderInlineOrderDetail(order) {
  const editable = canEditOrder(order);
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsHtml = items.map((item, index) => {
    const qty = item.quantity || item.qty || 1;
    const subtotal = Number(item.price || item.unitPrice || 0) * Number(qty);

    const extras = item.extras || item.addons || [];
    const extrasText = extras.length > 0
      ? extras.map(extra => `${extra.name}+${extra.price || 0}`).join("、")
      : "無";

    return `
      <div class="cart-item">
        <div>
          <strong>${item.name}</strong>
          <p>NT$${item.price || item.unitPrice || 0} × ${qty} = NT$${subtotal}</p>
          <p>辣度：${item.spicy || "不辣"}</p>
          <p>加料：${extrasText}</p>
          <p>備註：${item.note || "無"}</p>
        </div>

        <div class="cart-actions">
          ${
            editable
              ? `<button class="danger-btn" onclick="removeItemFromOrder('${order.id}', ${index})">刪除此餐點</button>`
              : `<button disabled>不可修改</button>`
          }
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="inline-order-detail">
      <hr>
      <h4>訂單詳情</h4>
      <p><strong>狀態：</strong>${getPosStatusText(order)}</p>
      <p><strong>說明：</strong>${editable ? "此訂單尚未結帳，可以改單。" : "此訂單已結帳、已送廚房、已完成或已取消，不能改單。"}</p>

      ${itemsHtml || "<p>此訂單沒有餐點</p>"}

      <div class="order-actions">
        ${
          editable
            ? `
              <button class="primary-btn" onclick="addCartToOrder('${order.id}')">把目前點餐加到此訂單</button>
              <button class="danger-btn" onclick="cancelOrder('${order.id}')">取消此訂單</button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function canEditOrder(order) {
  return (
    order.status !== "cancelled" &&
    order.status !== "done" &&
    order.paymentStatus !== "paid" &&
    order.kitchenStatus !== "sent"
  );
}

async function addCartToOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) return;

  if (!canEditOrder(order)) {
    alert("此訂單已送廚房或已結帳，不能加點。");
    return;
  }

  if (cart.length === 0) {
    alert("目前點餐區沒有餐點可以加入。");
    return;
  }

  const oldItems = Array.isArray(order.items) ? order.items : [];
  const newItems = [...oldItems, ...cart];

  await update(ref(db, "orders/" + orderId), {
    items: newItems,
    total: calculateTotal(newItems),
    updatedAt: Date.now()
  });

  cart = [];
  renderCart();

  alert("已加點到此訂單。");
}

async function removeItemFromOrder(orderId, index) {
  const order = ordersData[orderId];

  if (!order) return;

  if (!canEditOrder(order)) {
    alert("此訂單已送廚房或已結帳，不能修改。");
    return;
  }

  const items = Array.isArray(order.items) ? [...order.items] : [];
  const removed = items[index];

  if (!removed) return;

  const ok = confirm(`確定要刪除「${removed.name}」嗎？`);
  if (!ok) return;

  items.splice(index, 1);

  await update(ref(db, "orders/" + orderId), {
    items,
    total: calculateTotal(items),
    updatedAt: Date.now()
  });
}

async function cancelOrder(orderId) {
  const order = ordersData[orderId];

  if (!order) return;

  if (!canEditOrder(order)) {
    alert("此訂單已送廚房或已結帳，不能取消。");
    return;
  }

  const ok = confirm(`確定要取消「${getCustomerLabel(order)}」這張訂單嗎？`);
  if (!ok) return;

  await update(ref(db, "orders/" + orderId), {
    status: "cancelled",
    statusText: "訂單已取消",
    paymentStatus: "cancelled",
    kitchenStatus: "cancelled",
    cancelledAt: Date.now(),
    updatedAt: Date.now()
  });

  expandedOrderId = null;
}

async function confirmPaidAndSendKitchen(orderId) {
  const order = ordersData[orderId];

  if (!order) {
    alert("找不到這筆訂單。");
    return;
  }

  if (order.status === "cancelled") {
    alert("此訂單已取消，不能送廚房。");
    return;
  }

  const ok = confirm(`確認「${getCustomerLabel(order)}」已結帳，並送到廚房？`);
  if (!ok) return;

  try {
    await update(ref(db, "orders/" + orderId), {
      status: "confirmed",
      statusText: "櫃檯已確認，等待廚房製作",
      paymentStatus: "paid",
      kitchenStatus: "sent",
      confirmed: true,
      paid: true,
      sentToKitchenAt: Date.now(),
      updatedAt: Date.now()
    });

    console.log("已送廚房：", orderId);
    alert("已送到廚房。");
    expandedOrderId = null;
  } catch (err) {
    console.error("送廚房失敗：", err);
    alert("送廚房失敗，請檢查 Firebase 權限或網路。");
  }
}

function getCustomerLabel(order) {
  if (order.customerLabel) return order.customerLabel;
  if (order.type === "內用" && order.table) return `${order.table}桌`;
  if (order.type === "外帶" && order.orderNumber) return `外帶-${order.orderNumber}`;
  return "未填寫";
}

function getPosStatusText(order) {
  if (order.status === "cancelled") return "已取消";
  if (order.status === "done") return "已完成";

  if (order.status === "confirmed") {
    return "已結帳｜等待廚房製作";
  }

  if (order.paymentStatus === "paid" && order.status === "cooking") {
    return "已結帳｜製作中";
  }

  if (order.paymentStatus === "paid" && order.kitchenStatus === "sent") {
    return "已結帳｜已送廚房";
  }

  if (order.paymentStatus === "paid") return "已結帳";

  return "未結帳";
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

submitOrderBtn.addEventListener("click", submitOrder);
clearCartBtn.addEventListener("click", clearCart);

window.selectCategory = selectCategory;
window.selectTable = selectTable;
window.openCustomModal = openCustomModal;
window.changeQuantity = changeQuantity;
window.removeFromCart = removeFromCart;
window.confirmPaidAndSendKitchen = confirmPaidAndSendKitchen;
window.toggleOrderDetail = toggleOrderDetail;
window.addCartToOrder = addCartToOrder;
window.removeItemFromOrder = removeItemFromOrder;
window.cancelOrder = cancelOrder;

renderTableButtons();
renderCart();
