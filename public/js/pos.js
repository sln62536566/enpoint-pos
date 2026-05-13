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

function calculateTotal() {
  return cart.reduce((sum, item) => {
    return sum + item.price * item.quantity;
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
      total: calculateTotal(),
      status: "unpaid",
      paymentStatus: "unpaid",
      kitchenStatus: "not_sent",
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
    console.error("❌ 建立訂單失敗：", err);
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
    todayOrderList.innerHTML = "<p>今天目前沒有訂單。</p>";
    return;
  }

  todayOrderList.innerHTML = orders.map(order => {
    const label = getCustomerLabel(order);
    const statusText = getPosStatusText(order);
    const itemsText = Array.isArray(order.items)
      ? order.items.map(item => `${item.name}×${item.quantity || item.qty || 1}`).join("、")
      : "無餐點";

    const canSendKitchen =

      order.paymentStatus !== "paid" ||

      order.kitchenStatus !== "sent";

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

          ${

            canSendKitchen

              ? `<button class="primary-btn" onclick="confirmPaidAndSendKitchen('${order.id}')">確認結帳並送廚房</button>`

              : `<button disabled>已送廚房</button>`

          }

        </div>

      </div>

    `;

  }).join("");

}

async function confirmPaidAndSendKitchen(orderId) {

  const order = ordersData[orderId];

  if (!order) return;

  const ok = confirm(`確認「${getCustomerLabel(order)}」已結帳，並送到廚房？`);

  if (!ok) return;

  await update(ref(db, "orders/" + orderId), {

    status: "pending",

    paymentStatus: "paid",

    kitchenStatus: "sent",

    sentToKitchenAt: Date.now(),

    updatedAt: Date.now()

  });

}

function getCustomerLabel(order) {

  if (order.customerLabel) return order.customerLabel;

  if (order.type === "內用" && order.table) return `${order.table}桌`;

  if (order.type === "外帶" && order.orderNumber) return `外帶-${order.orderNumber}`;

  return "未填寫";

}

function getPosStatusText(order) {

  if (order.paymentStatus === "paid" && order.kitchenStatus === "sent") {

    return "已結帳｜已送廚房";

  }

  if (order.paymentStatus === "paid") {

    return "已結帳";

  }

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

renderTableButtons();

renderCart();