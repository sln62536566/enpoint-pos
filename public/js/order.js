import {
  db,
  ref,
  push,
  set,
  onValue,
  getBusinessDate,
  createOrderNumber
} from "./firebase.js";

const STORE_ID = new URLSearchParams(location.search).get("storeId") || "mainStore";
const TABLE = new URLSearchParams(location.search).get("table") || "現場客人";

const storeNameEl = document.getElementById("storeName");
const tableInfoEl = document.getElementById("tableInfo");
const categoryTabsEl = document.getElementById("categoryTabs");
const menuListEl = document.getElementById("menuList");

const floatingCartBtn = document.getElementById("floatingCartBtn");
const cartPanel = document.getElementById("cartPanel");
const closeCartBtn = document.getElementById("closeCartBtn");
const cartCountEl = document.getElementById("cartCount");
const cartTotalEl = document.getElementById("cartTotal");
const cartItemsEl = document.getElementById("cartItems");
const cartPanelTotalEl = document.getElementById("cartPanelTotal");

const customerNameInput = document.getElementById("customerNameInput");
const orderNoteInput = document.getElementById("orderNoteInput");
const submitOrderBtn = document.getElementById("submitOrderBtn");

const itemModal = document.getElementById("itemModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalDesc = document.getElementById("modalDesc");
const sizeOptionsEl = document.getElementById("sizeOptions");
const addonOptionsEl = document.getElementById("addonOptions");
const spicyOptionsEl = document.getElementById("spicyOptions");
const satayOptionsEl = document.getElementById("satayOptions");
const itemNoteInput = document.getElementById("itemNoteInput");
const minusQtyBtn = document.getElementById("minusQtyBtn");
const plusQtyBtn = document.getElementById("plusQtyBtn");
const itemQtyEl = document.getElementById("itemQty");
const addToCartBtn = document.getElementById("addToCartBtn");

const orderDonePage = document.getElementById("orderDonePage");
const doneOrderInfo = document.getElementById("doneOrderInfo");
const backToMenuBtn = document.getElementById("backToMenuBtn");

let allItems = [];
let categories = [];
let activeCategory = "全部";
let cart = [];
let selectedItem = null;
let modalState = null;
let currentOrderUnsubscribe = null;

storeNameEl.textContent = "🍜 恩點點餐";
tableInfoEl.textContent = `桌號：${TABLE}`;

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=900&q=80";

init();

function init() {
  loadLastOrder();
  watchMenu();
  bindEvents();
}

function bindEvents() {
  floatingCartBtn.addEventListener("click", () => {
    renderCart();
    cartPanel.classList.remove("hidden");
  });

  closeCartBtn.addEventListener("click", () => {
    cartPanel.classList.add("hidden");
  });

  closeModalBtn.addEventListener("click", closeModal);

  minusQtyBtn.addEventListener("click", () => {
    if (!modalState) return;
    modalState.qty = Math.max(1, modalState.qty - 1);
    renderModalPrice();
  });

  plusQtyBtn.addEventListener("click", () => {
    if (!modalState) return;
    modalState.qty += 1;
    renderModalPrice();
  });

  addToCartBtn.addEventListener("click", addCurrentItemToCart);
  submitOrderBtn.addEventListener("click", submitOrder);

  backToMenuBtn.addEventListener("click", () => {
    orderDonePage.classList.add("hidden");
  });
}

function watchMenu() {
  const menuRef = ref(db, "menu");

  onValue(menuRef, (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      allItems = [];
      renderEmptyMenu();
      return;
    }

    allItems = normalizeMenu(data);
    categories = ["全部", ...new Set(allItems.map(item => item.category || "未分類"))];

    renderCategories();
    renderMenu();
  });
}

function normalizeMenu(data) {
  const result = [];

  Object.entries(data).forEach(([key, value]) => {
    if (!value) return;

    result.push(normalizeItem({
      ...value,
      id: value.id || key
    }, key));
  });

  return result.filter(item => item.enabled !== false);
}

function normalizeItem(item, fallbackId) {
  const sizes = normalizeSizes(item);
  const basePrice = sizes.length ? sizes[0].price : Number(item.price || 0);

  return {
    id: item.id || fallbackId,
    name: item.name || "未命名餐點",
    category: item.category || item.type || "未分類",
    description: item.description || item.desc || "",
    image: item.image || item.photo || item.imageUrl || PLACEHOLDER_IMAGE,
    price: basePrice,
    sizes,
    addons: normalizeAddons(item.addons || item.options || item.mods || []),
    tags: normalizeTags(item.tags),
    spicyEnabled: item.spicyEnabled !== false,
    satayEnabled: item.satayEnabled !== false,
    enabled: item.enabled
  };
}

function normalizeSizes(item) {
  if (Array.isArray(item.sizes)) {
    return item.sizes.map(size => ({
      name: size.name || size.label || "一般",
      price: Number(size.price || 0)
    }));
  }

  if (item.sizePrices && typeof item.sizePrices === "object") {
    return Object.entries(item.sizePrices).map(([name, price]) => ({
      name,
      price: Number(price || 0)
    }));
  }

  if (item.largePrice || item.smallPrice) {
    const sizes = [];
    if (item.smallPrice) sizes.push({ name: "小", price: Number(item.smallPrice) });
    if (item.largePrice) sizes.push({ name: "大", price: Number(item.largePrice) });
    return sizes;
  }

  if (item.price) {
    return [{ name: "一般", price: Number(item.price) }];
  }

  return [];
}

function normalizeAddons(addons) {
  if (!Array.isArray(addons)) return [];

  return addons.map(addon => {
    if (typeof addon === "string") {
      const match = addon.match(/(.+?)(\+|：|:)?(\d+)?$/);
      return {
        name: match?.[1]?.trim() || addon,
        price: Number(match?.[3] || 0)
      };
    }

    return {
      name: addon.name || addon.label || "加料",
      price: Number(addon.price || 0)
    };
  });
}

function normalizeTags(tags) {
  if (Array.isArray(tags) && tags.length) return tags;
  return ["推薦"];
}

function renderCategories() {
  categoryTabsEl.innerHTML = "";

  categories.forEach(category => {
    const btn = document.createElement("button");
    btn.className = `category-tab ${category === activeCategory ? "active" : ""}`;
    btn.textContent = category;

    btn.addEventListener("click", () => {
      activeCategory = category;
      renderCategories();
      renderMenu();
    });

    categoryTabsEl.appendChild(btn);
  });
}

function renderMenu() {
  const items = activeCategory === "全部"
    ? allItems
    : allItems.filter(item => item.category === activeCategory);

  if (!items.length) {
    renderEmptyMenu();
    return;
  }

  menuListEl.innerHTML = "";

  items.forEach(item => {
    const card = document.createElement("article");
    card.className = "menu-card";

    card.innerHTML = `
      <img src="${escapeHtml(item.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(item.name)}">
      <div class="menu-card-body">
        <div class="menu-card-title-row">
          <h3>${escapeHtml(item.name)}</h3>
          <div class="price">NT$${item.price}</div>
        </div>

        <div class="tag-row">
          ${item.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>

        <p class="muted">${escapeHtml(item.description || "點擊選擇加料、辣度與備註")}</p>
        <button class="card-btn">選擇餐點</button>
      </div>
    `;

    card.querySelector(".card-btn").addEventListener("click", () => openModal(item));
    menuListEl.appendChild(card);
  });
}

function renderEmptyMenu() {
  menuListEl.innerHTML = `
    <div class="empty">
      目前沒有可顯示的菜單。<br>
      請先到菜單後台新增餐點。
    </div>
  `;
}

function openModal(item) {
  selectedItem = item;
  modalState = {
    size: item.sizes[0] || { name: "一般", price: item.price || 0 },
    addons: [],
    spicy: "不辣",
    satay: "不要",
    qty: 1
  };

  modalImage.src = item.image || PLACEHOLDER_IMAGE;
  modalTitle.textContent = item.name;
  modalDesc.textContent = item.description || "請選擇餐點設定";
  itemNoteInput.value = "";

  renderSizeOptions();
  renderAddonOptions();
  renderSpicyOptions();
  renderSatayOptions();
  renderModalPrice();

  itemModal.classList.remove("hidden");
}

function closeModal() {
  itemModal.classList.add("hidden");
  selectedItem = null;
  modalState = null;
}

function renderSizeOptions() {
  sizeOptionsEl.innerHTML = "";

  if (!selectedItem.sizes.length) return;

  sizeOptionsEl.innerHTML = `
    <span class="option-title">份量</span>
    <div class="option-list">
      ${selectedItem.sizes.map(size => `
        <button class="option-chip ${modalState.size.name === size.name ? "active" : ""}" data-size="${escapeHtml(size.name)}">
          ${escapeHtml(size.name)} NT$${size.price}
        </button>
      `).join("")}
    </div>
  `;

  sizeOptionsEl.querySelectorAll(".option-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.size;
      modalState.size = selectedItem.sizes.find(size => size.name === name);
      renderSizeOptions();
      renderModalPrice();
    });
  });
}

function renderAddonOptions() {
  addonOptionsEl.innerHTML = "";

  if (!selectedItem.addons.length) return;

  addonOptionsEl.innerHTML = `
    <span class="option-title">加料</span>
    <div class="option-list">
      ${selectedItem.addons.map(addon => `
        <button class="option-chip" data-addon="${escapeHtml(addon.name)}">
          ${escapeHtml(addon.name)} +${addon.price}
        </button>
      `).join("")}
    </div>
  `;

  addonOptionsEl.querySelectorAll(".option-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.addon;
      const addon = selectedItem.addons.find(item => item.name === name);
      const exists = modalState.addons.some(item => item.name === name);

      if (exists) {
        modalState.addons = modalState.addons.filter(item => item.name !== name);
        btn.classList.remove("active");
      } else {
        modalState.addons.push(addon);
        btn.classList.add("active");
      }

      renderModalPrice();
    });
  });
}

function renderSpicyOptions() {
  spicyOptionsEl.innerHTML = "";

  if (!selectedItem.spicyEnabled) return;

  const options = ["不辣", "微辣", "小辣", "中辣", "大辣"];

  spicyOptionsEl.innerHTML = `
    <span class="option-title">辣度</span>
    <div class="option-list">
      ${options.map(option => `
        <button class="option-chip ${modalState.spicy === option ? "active" : ""}" data-spicy="${option}">
          ${option}
        </button>
      `).join("")}
    </div>
  `;

  spicyOptionsEl.querySelectorAll(".option-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      modalState.spicy = btn.dataset.spicy;
      renderSpicyOptions();
    });
  });
}

function renderSatayOptions() {
  satayOptionsEl.innerHTML = "";

  if (!selectedItem.satayEnabled) return;

  const options = ["不要", "要"];

  satayOptionsEl.innerHTML = `
    <span class="option-title">沙茶</span>
    <div class="option-list">
      ${options.map(option => `
        <button class="option-chip ${modalState.satay === option ? "active" : ""}" data-satay="${option}">
          ${option}
        </button>
      `).join("")}
    </div>
  `;

  satayOptionsEl.querySelectorAll(".option-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      modalState.satay = btn.dataset.satay;
      renderSatayOptions();
    });
  });
}

function getModalItemTotal() {
  const base = Number(modalState.size.price || 0);
  const addons = modalState.addons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  return (base + addons) * modalState.qty;
}

function renderModalPrice() {
  itemQtyEl.textContent = modalState.qty;
  addToCartBtn.textContent = `加入購物車 NT$${getModalItemTotal()}`;
}

function addCurrentItemToCart() {
  if (!selectedItem || !modalState) return;

  const basePrice = Number(modalState.size.price || 0);
  const addonsPrice = modalState.addons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  const unitPrice = basePrice + addonsPrice;

  cart.push({
    cartId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    itemId: selectedItem.id,
    name: selectedItem.name,
    size: modalState.size.name,
    qty: modalState.qty,
    addons: modalState.addons,
    spicy: selectedItem.spicyEnabled ? modalState.spicy : "",
    satay: selectedItem.satayEnabled ? modalState.satay : "",
    note: itemNoteInput.value.trim(),
    unitPrice,
    subtotal: unitPrice * modalState.qty
  });

  closeModal();
  renderCartSummary();
}

function renderCartSummary() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const total = getCartTotal();

  cartCountEl.textContent = count;
  cartTotalEl.textContent = `NT$${total}`;
  cartPanelTotalEl.textContent = `NT$${total}`;
}

function renderCart() {
  renderCartSummary();

  if (!cart.length) {
    cartItemsEl.innerHTML = `<div class="empty">購物車目前是空的</div>`;
    return;
  }

  cartItemsEl.innerHTML = "";

  cart.forEach(item => {
    const div = document.createElement("div");
    div.className = "cart-item";

    div.innerHTML = `
      <h4>${escapeHtml(item.name)}｜${escapeHtml(item.size)}</h4>
      <div class="cart-item-detail">
        ${item.addons.length ? `加料：${item.addons.map(a => `${a.name}+${a.price}`).join("、")}<br>` : ""}
        ${item.spicy ? `辣度：${escapeHtml(item.spicy)}<br>` : ""}
        ${item.satay ? `沙茶：${escapeHtml(item.satay)}<br>` : ""}
        ${item.note ? `備註：${escapeHtml(item.note)}<br>` : ""}
        小計：NT$${item.subtotal}
      </div>

      <div class="cart-item-actions">
        <div class="qty-mini">
          <button data-action="minus">－</button>
          <strong>${item.qty}</strong>
          <button data-action="plus">＋</button>
        </div>
        <button class="remove-btn" data-action="remove">刪除</button>
      </div>
    `;

    div.querySelector('[data-action="minus"]').addEventListener("click", () => {
      item.qty = Math.max(1, item.qty - 1);
      item.subtotal = item.unitPrice * item.qty;
      renderCart();
    });

    div.querySelector('[data-action="plus"]').addEventListener("click", () => {
      item.qty += 1;
      item.subtotal = item.unitPrice * item.qty;
      renderCart();
    });

    div.querySelector('[data-action="remove"]').addEventListener("click", () => {
      cart = cart.filter(cartItem => cartItem.cartId !== item.cartId);
      renderCart();
    });

    cartItemsEl.appendChild(div);
  });
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
}

async function submitOrder() {
  if (!cart.length) {
    alert("購物車是空的，請先選擇餐點。");
    return;
  }

  submitOrderBtn.disabled = true;
  submitOrderBtn.textContent = "送出中...";

  try {
    const now = Date.now();
    const businessDate = getBusinessDate();
    const orderNumber = await generateDailyOrderNumber();
    const order = {
      storeId: STORE_ID,
      orderNumber,
      businessDate,
      businessDay: businessDate,
      orderSource: "QR",
      deviceType: "qr",
      source: "QR",
      type: TABLE === "現場客人" ? "外帶" : "內用",
      table: TABLE,
      customerName: customerNameInput.value.trim() || "",
      customerLabel: customerNameInput.value.trim() || `${TABLE}`,
      items: cart.map(item => ({
        name: item.name,
        size: item.size,
        qty: item.qty,
        addons: item.addons,
        spicy: item.spicy,
        satay: item.satay,
        note: item.note,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal
      })),
      total: getCartTotal(),
      note: orderNoteInput.value.trim(),
      status: "pending",
      statusText: "等待櫃檯確認",
      paymentStatus: "unpaid",
      paid: false,
      confirmed: false,
      estimatedWaitText: "15～20 分鐘",
      waitNotice: "實際時間依現場狀況為準",
      createdAt: now,
      updatedAt: now
    };

    const newOrderRef = push(ref(db, "orders"));
    await set(newOrderRef, order);

    const savedOrder = {
      id: newOrderRef.key,
      ...order
    };

    localStorage.setItem("lastQrOrder", JSON.stringify(savedOrder));
    showDonePage(savedOrder);
    watchCustomerOrderStatus(newOrderRef.key);

    cart = [];
    customerNameInput.value = "";
    orderNoteInput.value = "";
    renderCartSummary();
    renderCart();
    cartPanel.classList.add("hidden");
  } catch (error) {
    console.error(error);
    alert("訂單送出失敗，請確認網路或 Firebase 設定。");
  } finally {
    submitOrderBtn.disabled = false;
    submitOrderBtn.textContent = "送出訂單";
  }
}

async function generateDailyOrderNumber() {
  return createOrderNumber("qr", { storeId: STORE_ID, businessDate: getBusinessDate() });
}

function showDonePage(order) {
  renderDoneOrderInfo(order);
  orderDonePage.classList.remove("hidden");
}

function renderDoneOrderInfo(order) {
  const createdTime = new Date(order.createdAt).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const statusText = getCustomerStatusText(order);

  doneOrderInfo.innerHTML = `
    <strong>訂單號：</strong>${escapeHtml(order.orderNumber)}<br>
    <strong>類型：</strong>${escapeHtml(order.type)}｜${escapeHtml(order.table)}<br>
    <strong>訂單時間：</strong>${createdTime}<br>
    <strong>狀態：</strong><span class="status-text">${escapeHtml(statusText)}</span><br>
    <strong>總金額：</strong>NT$${order.total}<br>
    <hr>
    ${order.items.map(item => `
      <div>
        ${escapeHtml(item.name)} × ${item.qty}｜NT$${item.subtotal}<br>
        <span class="muted">
          ${item.size ? `份量：${escapeHtml(item.size)} ` : ""}
          ${item.spicy ? `｜辣度：${escapeHtml(item.spicy)} ` : ""}
          ${item.satay ? `｜沙茶：${escapeHtml(item.satay)} ` : ""}
          ${item.addons?.length ? `｜加料：${item.addons.map(a => escapeHtml(a.name)).join("、")}` : ""}
          ${item.note ? `｜備註：${escapeHtml(item.note)}` : ""}
        </span>
      </div>
    `).join("<br>")}
  `;
}

function getCustomerStatusText(order) {
  if (!order) return "等待櫃檯確認";

  const status = String(order.status || "").toLowerCase();
  const kitchenStatus = String(order.kitchenStatus || "").toLowerCase();
  const paymentStatus = String(order.paymentStatus || "").toLowerCase();

  if (status === "done") return "餐點已完成，請留意取餐";
  if (status === "cooking") return "製作中";
  if (status === "confirmed") return "櫃檯已確認，等待廚房製作";

  // ✅ 補強：POS 只要已送廚房，就視為櫃檯已確認
  if (kitchenStatus === "sent") {
    return "櫃檯已確認，等待廚房製作";
  }

  if (paymentStatus === "paid") {
    return "櫃檯已確認，等待廚房製作";
  }

  if (order.confirmed === true) {
    return "櫃檯已確認，等待廚房製作";
  }

  if (status === "pending") return "等待櫃檯確認";

  if (order.statusText) return order.statusText;

  return "等待櫃檯確認";
}

function watchCustomerOrderStatus(orderId) {
  if (!orderId) return;

  if (currentOrderUnsubscribe) {
    currentOrderUnsubscribe();
    currentOrderUnsubscribe = null;
  }

  const orderRef = ref(db, `orders/${orderId}`);

  currentOrderUnsubscribe = onValue(orderRef, (snapshot) => {
    const latestOrder = snapshot.val();

    if (!latestOrder) return;

    const savedOrder = {
      id: orderId,
      ...latestOrder
    };

    localStorage.setItem("lastQrOrder", JSON.stringify(savedOrder));
    renderDoneOrderInfo(savedOrder);
  });
}

function loadLastOrder() {
  const raw = localStorage.getItem("lastQrOrder");
  if (!raw) return;

  try {
    const order = JSON.parse(raw);
    if (!order || !order.createdAt) return;

    const ageMinutes = (Date.now() - order.createdAt) / 1000 / 60;

    if (ageMinutes <= 120) {
      showDonePage(order);
      watchCustomerOrderStatus(order.id);
    }
  } catch {
    localStorage.removeItem("lastQrOrder");
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
