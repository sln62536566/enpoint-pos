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
    cartId: Date.now().toString(),
    id: currentItem.id,
    name: currentItem.name,
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
      ? item.extras.map(extra => extra.name).join("、")
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
      </div>
    `;
  }).join("");

  totalAmount.textContent = "$" + total;
}

function calculateTotal(items = cart) {
  return items.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 1);
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

      table: currentOrderType === "內用"
        ? selectedTable
        : "",

      customerLabel,

      items: cart,

      total: calculateTotal(cart),

      status: "pending",

      paymentStatus: "unpaid",

      kitchenStatus: "waiting",

      confirmed: false,

      paid: false,

      createdAt: Date.now(),

      updatedAt: Date.now()

    };

    await set(newOrderRef, order);

    alert(`已建立訂單：${customerLabel}`);

    cart = [];

    renderCart();

  } catch (err) {

    console.error(err);

    alert("建立訂單失敗");

  }

  submitOrderBtn.disabled = false;
  submitOrderBtn.textContent = "建立訂單";

}

function renderTodayOrders() {

  const orders = Object.entries(ordersData)
    .map(([id, order]) => ({ id, ...order }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  todayOrderList.innerHTML = orders.map(order => {

    const itemsText = Array.isArray(order.items)
      ? order.items.map(item => `${item.name}×${item.quantity || 1}`).join("、")
      : "無餐點";

    return `
      <div class="today-order-card">

        <div class="today-order-head">
          <strong>#${order.orderNumber || order.id}</strong>

          <span class="pos-status-badge">
            ${getPosStatusText(order)}
          </span>
        </div>

        <p>取餐資訊：${order.customerLabel || "-"}</p>

        <p>餐點：${itemsText}</p>

        <p class="order-total">
          總金額：$${order.total || 0}
        </p>

        <div class="order-actions">

          ${
            order.paymentStatus !== "paid"
              ? `
                <button
                  class="primary-btn"
                  onclick="confirmPaidAndSendKitchen('${order.id}')">
                  確認結帳並送廚房
                </button>
              `
              : `
                <button disabled>
                  已送廚房
                </button>
              `
          }

        </div>

      </div>
    `;

  }).join("");

}

async function confirmPaidAndSendKitchen(orderId) {

  const order = ordersData[orderId];

  if (!order) {
    alert("找不到訂單");
    return;
  }

  const ok = confirm(
    `確認「${order.customerLabel || "-"}」已付款並送廚房？`
  );

  if (!ok) return;

  try {

    await update(ref(db, "orders/" + orderId), {

      status: "confirmed",

      statusText: "已確認付款，等待廚房製作",

      paymentStatus: "paid",

      kitchenStatus: "confirmed",

      confirmed: true,

      paid: true,

      updatedAt: Date.now()

    });

    alert("已送到廚房");

  } catch (err) {

    console.error(err);

    alert("送廚房失敗");

  }

}

function getPosStatusText(order) {

  if (order.kitchenStatus === "done") {
    return "已完成";
  }

  if (order.kitchenStatus === "cooking") {
    return "製作中";
  }

  if (order.kitchenStatus === "confirmed") {
    return "已確認付款";
  }

  return "等待付款";

}

submitOrderBtn.addEventListener("click", submitOrder);

window.selectCategory = selectCategory;
window.selectTable = selectTable;
window.openCustomModal = openCustomModal;
window.confirmPaidAndSendKitchen = confirmPaidAndSendKitchen;

renderTableButtons();
renderCart();