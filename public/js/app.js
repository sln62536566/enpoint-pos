import {
  db,
  ref,
  onValue,
  push,
  set
} from "./firebase.js";

const STORE_ID = "defaultStore";
const LAST_ORDER_KEY = "enpoint_last_qr_order_id";

const params = new URLSearchParams(window.location.search);
const table = params.get("table") || "";

const orderPage = document.getElementById("orderPage");
const successPage = document.getElementById("successPage");
const successContent = document.getElementById("successContent");
const orderStatusBox = document.getElementById("orderStatusBox");
const newOrderBtn = document.getElementById("newOrderBtn");

const tableInfo = document.getElementById("tableInfo");
const categoryList = document.getElementById("categoryList");
const menuList = document.getElementById("menuList");
const cartList = document.getElementById("cartList");
const cartTotal = document.getElementById("cartTotal");
const submitOrderBtn = document.getElementById("submitOrderBtn");
const customerNameInput = document.getElementById("customerName");
const orderNoteInput = document.getElementById("orderNote");

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

const confirmModal = document.getElementById("confirmModal");
const confirmContent = document.getElementById("confirmContent");
const confirmTotal = document.getElementById("confirmTotal");
const confirmSubmitBtn = document.getElementById("confirmSubmitBtn");
const backToCartBtn = document.getElementById("backToCartBtn");

let menuData = [];
let currentCategory = "全部";
let cart = [];
let selectedItem = null;
let selectedSize = null;
let selectedAddons = [];
let selectedSpicy = "不辣";
let selectedSatay = "不要";
let selectedQty = 1;

const SPICY_OPTIONS = ["不辣", "微辣", "小辣", "中辣", "大辣"];

if (table && tableInfo) {
  tableInfo.textContent = `桌號：${table}`;
}

function money(n) {
  return `$${Number(n || 0)}`;
}

function normalizeMenu(raw) {
  if (!raw) return [];

  return Object.entries(raw)
    .map(([id, item]) => ({
      id,
      ...item
    }))
    .filter(item => item.enabled !== false);
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

function getSizeOptions(item) {
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
      name: "一般",
      price: Number(item.price || 0)
    });
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
  const categories = ["全部", ...new Set(menuData.map(getItemCategory))];

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

function renderMenu() {
  const filtered = currentCategory === "全部"
    ? menuData
    : menuData.filter(item => getItemCategory(item) === currentCategory);

  if (filtered.length === 0) {
    menuList.innerHTML = `<div class="empty">目前沒有餐點</div>`;
    return;
  }

  menuList.innerHTML = filtered.map(item => {
    const imageUrl = getImageUrl(item);

    return `
      <button class="menu-card" data-id="${item.id}">
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
          <strong>${money(getBasePrice(item))}</strong>
        </div>
      </button>
    `;
  }).join("");

  document.querySelectorAll(".menu-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = menuData.find(x => x.id === card.dataset.id);
      openItemModal(item);
    });
  });
}

function openItemModal(item) {
  if (!item) return;

  selectedItem = item;
  selectedAddons = [];
  selectedSpicy = "不辣";
  selectedSatay = "不要";
  selectedQty = 1;
  itemNote.value = "";

  selectedSize = getSizeOptions(item)[0];

  modalItemName.textContent = item.name || "未命名餐點";
  modalItemPrice.textContent = `起價 ${money(getBasePrice(item))}`;

  renderModalOptions();
  updateModalSubtotal();

  itemModal.classList.remove("hidden");
}

function renderModalOptions() {
  const sizeOptions = getSizeOptions(selectedItem);

  sizeSection.innerHTML = `
    <h3>份量</h3>
    <div class="option-grid">
      ${sizeOptions.map(opt => `
        <button class="option-btn size-btn ${selectedSize?.name === opt.name ? "active" : ""}"
          data-name="${opt.name}"
          data-price="${opt.price}">
          ${opt.name} ${money(opt.price)}
        </button>
      `).join("")}
    </div>
  `;

  document.querySelectorAll(".size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSize = {
        name: btn.dataset.name,
        price: Number(btn.dataset.price)
      };

      renderModalOptions();
      updateModalSubtotal();
    });
  });

  const addons = getAddons(selectedItem);

  addonsSection.innerHTML = addons.length ? `
    <h3>加料</h3>
    <div class="option-grid">
      ${addons.map(addon => `
        <button class="option-btn addon-btn ${selectedAddons.some(a => a.name === addon.name) ? "active" : ""}"
          data-name="${addon.name}"
          data-price="${addon.price}">
          ${addon.name} +${addon.price}
        </button>
      `).join("")}
    </div>
  ` : "";

  document.querySelectorAll(".addon-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const addon = {
        name: btn.dataset.name,
        price: Number(btn.dataset.price)
      };

      if (selectedAddons.some(a => a.name === addon.name)) {
        selectedAddons = selectedAddons.filter(a => a.name !== addon.name);
      } else {
        selectedAddons.push(addon);
      }

      renderModalOptions();
      updateModalSubtotal();
    });
  });

  spicySection.innerHTML = allowSpicy(selectedItem) ? `
    <h3>辣度</h3>
    <div class="option-grid">
      ${SPICY_OPTIONS.map(level => `
        <button class="option-btn spicy-btn ${selectedSpicy === level ? "active" : ""}" data-level="${level}">
          ${level}
        </button>
      `).join("")}
    </div>
  ` : "";

  document.querySelectorAll(".spicy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSpicy = btn.dataset.level;
      renderModalOptions();
    });
  });

  sataySection.innerHTML = allowSatay(selectedItem) ? `
    <h3>沙茶</h3>
    <div class="option-grid">
      <button class="option-btn satay-btn ${selectedSatay === "要" ? "active" : ""}" data-value="要">要沙茶</button>
      <button class="option-btn satay-btn ${selectedSatay === "不要" ? "active" : ""}" data-value="不要">不要沙茶</button>
    </div>
  ` : "";

  document.querySelectorAll(".satay-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSatay = btn.dataset.value;
      renderModalOptions();
    });
  });

  modalQty.textContent = selectedQty;
}

function updateModalSubtotal() {
  const base = Number(selectedSize?.price || 0);
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
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

closeModalBtn.addEventListener("click", () => {
  itemModal.classList.add("hidden");
});

addToCartBtn.addEventListener("click", () => {
  const basePrice = Number(selectedSize?.price || 0);
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  const unitPrice = basePrice + addonsTotal;

  cart.push({
    id: `${selectedItem.id}-${Date.now()}`,
    itemId: selectedItem.id,
    name: selectedItem.name,
    category: getItemCategory(selectedItem),
    size: selectedSize?.name || "一般",
    basePrice,
    price: unitPrice,
    unitPrice,
    addons: selectedAddons,
    extras: selectedAddons,
    spicy: allowSpicy(selectedItem) ? selectedSpicy : "",
    satay: allowSatay(selectedItem) ? selectedSatay : "",
    note: itemNote.value.trim(),
    qty: selectedQty,
    quantity: selectedQty,
    subtotal: unitPrice * selectedQty
  });

  itemModal.classList.add("hidden");
  renderCart();
});

function renderCart() {
  if (cart.length === 0) {
    cartList.innerHTML = `<div class="empty">尚未選擇餐點</div>`;
    cartTotal.textContent = money(0);
    return;
  }

  cartList.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <div>
        <strong>${item.name} × ${item.qty}</strong>
        <div class="cart-detail">
          ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
          ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
          ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
          ${item.addons?.length ? `<p>加料：${item.addons.map(a => a.name).join("、")}</p>` : ""}
          ${item.note ? `<p>備註：${item.note}</p>` : ""}
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
}

function renderConfirmModal() {
  const total = cart.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  confirmTotal.textContent = money(total);

  confirmContent.innerHTML = `
    <div class="confirm-table">${table ? `桌號：${table}桌` : "QR 點餐"}</div>

    ${cart.map(item => `
      <div class="confirm-item">
        <div class="confirm-item-main">• ${item.name} × ${item.qty}</div>

        <div class="confirm-item-detail">
          ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
          ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
          ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
          ${item.addons?.length ? `<p>加料：${item.addons.map(a => a.name).join("、")}</p>` : ""}
          ${item.note ? `<p>備註：${item.note}</p>` : ""}
          <p>小計：${money(item.subtotal)}</p>
        </div>
      </div>
    `).join("")}
  `;

  confirmModal.classList.remove("hidden");
}

submitOrderBtn.addEventListener("click", () => {
  if (cart.length === 0) {
    alert("購物車目前是空的");
    return;
  }

  renderConfirmModal();
});

backToCartBtn.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
});

confirmSubmitBtn.addEventListener("click", async () => {
  confirmSubmitBtn.disabled = true;
  confirmSubmitBtn.textContent = "送出中...";

  try {
    const total = cart.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const orderRef = push(ref(db, "orders"));
    const now = Date.now();

    const order = {
      id: orderRef.key,
      orderNumber: now.toString().slice(-6),
      storeId: STORE_ID,
      source: "QR",
      type: table ? "內用" : "線上",
      table: table || "",
      customerName: customerNameInput.value.trim(),
      customerLabel: customerNameInput.value.trim() || (table ? `${table}桌` : "QR客人"),
      note: orderNoteInput.value.trim(),
      items: cart,
      total,
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

    await set(orderRef, order);

    localStorage.setItem(LAST_ORDER_KEY, order.id);

    confirmModal.classList.add("hidden");
    showSuccessPage(order);
    listenOrderStatus(order.id);

    cart = [];
    customerNameInput.value = "";
    orderNoteInput.value = "";
    renderCart();
  } catch (error) {
    console.error(error);
    alert("送出失敗，請稍後再試。");
  }

  confirmSubmitBtn.disabled = false;
  confirmSubmitBtn.textContent = "確認送出";
});

function getOrderStatusText(order) {
  if (!order) return "等待櫃檯確認付款";

  if (
    order.status === "cancelled" ||
    order.kitchenStatus === "cancelled" ||
    order.cancelled === true
  ) {
    return "訂單已取消，請洽櫃檯";
  }

  if (
    order.status === "closed" ||
    order.closed === true
  ) {
    return "訂單已結案，謝謝光臨";
  }

  if (
    order.kitchenStatus === "done" ||
    order.status === "done"
  ) {
    return "餐點已完成，請留意取餐或送餐";
  }

  if (
    order.kitchenStatus === "cooking" ||
    order.status === "cooking"
  ) {
    return "餐點製作中，請耐心等候";
  }

  if (
    order.kitchenStatus === "confirmed" ||
    order.status === "confirmed" ||
    order.paymentStatus === "paid"
  ) {
    return "已確認付款，餐點安排製作中";
  }

  if (
    order.status === "pending_payment" ||
    order.status === "pending" ||
    order.paymentStatus === "unpaid"
  ) {
    return "等待櫃檯確認付款";
  }

  return "等待櫃檯確認付款";
}

function showSuccessPage(order) {
  orderPage.classList.add("hidden");
  successPage.classList.remove("hidden");

  if (orderStatusBox) {
    orderStatusBox.textContent = `狀態：${getOrderStatusText(order)}`;
  }

  successContent.innerHTML = `
    <div class="success-order-id">訂單編號：${order.orderNumber || order.id}</div>
    <div class="success-time">時間：${new Date(order.createdAt).toLocaleString("zh-TW", { hour12: false })}</div>
    <div class="success-table">${order.table ? `桌號：${order.table}桌` : "QR 點餐"}</div>

    ${Array.isArray(order.items) ? order.items.map(item => `
      <div class="success-item">
        <div class="success-item-main">• ${item.name} × ${item.qty || item.quantity || 1}</div>

        <div class="success-item-detail">
          ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
          ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
          ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
          ${(item.addons || item.extras || []).length ? `<p>加料：${(item.addons || item.extras || []).map(a => a.name).join("、")}</p>` : ""}
          ${item.note ? `<p>備註：${item.note}</p>` : ""}
          <p>小計：${money(item.subtotal || (Number(item.price || item.unitPrice || 0) * Number(item.qty || item.quantity || 1)))}</p>
        </div>
      </div>
    `).join("") : ""}

    <div class="success-total">總計：${money(order.total)}</div>
  `;
}

function listenOrderStatus(orderId) {
  const orderRef = ref(db, `orders/${orderId}`);

  onValue(orderRef, snapshot => {
    const order = snapshot.val();
    if (!order) return;

    showSuccessPage({ id: orderId, ...order });

    if (orderStatusBox) {
      orderStatusBox.textContent = `狀態：${getOrderStatusText(order)}`;
    }
  });
}

newOrderBtn.addEventListener("click", () => {
  localStorage.removeItem(LAST_ORDER_KEY);
  successPage.classList.add("hidden");
  orderPage.classList.remove("hidden");
});

function loadLastOrderIfExists() {
  const lastOrderId = localStorage.getItem(LAST_ORDER_KEY);
  if (!lastOrderId) return;

  const orderRef = ref(db, `orders/${lastOrderId}`);

  onValue(orderRef, snapshot => {
    const order = snapshot.val();

    if (!order) {
      localStorage.removeItem(LAST_ORDER_KEY);
      return;
    }

    showSuccessPage({ id: lastOrderId, ...order });
    listenOrderStatus(lastOrderId);
  }, {
    onlyOnce: true
  });
}

function loadMenu() {
  const menuRef = ref(db, "menu");

  onValue(menuRef, snapshot => {
    menuData = normalizeMenu(snapshot.val());
    renderCategories();
    renderMenu();
  });
}

loadMenu();
renderCart();
loadLastOrderIfExists();