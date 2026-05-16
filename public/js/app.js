import {
  db,
  ref,
  onValue,
  push,
  set
} from "./firebase.js";

const STORE_ID = "defaultStore";

const params = new URLSearchParams(window.location.search);
const table = params.get("table") || "";

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

if (table && tableInfo) {
  tableInfo.textContent = `桌號：${table}`;
}

const DEFAULT_ADDONS = {
  "鍋燒類": [
    { name: "蛋", price: 15 },
    { name: "料", price: 20 },
    { name: "泡菜", price: 20 },
    { name: "肉絲", price: 30 },
    { name: "蝦仁", price: 40 }
  ],
  "炒麵類": [
    { name: "蛋", price: 15 },
    { name: "料", price: 20 },
    { name: "泡菜", price: 20 },
    { name: "肉絲", price: 30 },
    { name: "蝦仁", price: 40 }
  ],
  "炒飯類": [
    { name: "番茄醬", price: 10 },
    { name: "蛋", price: 15 },
    { name: "荷包蛋", price: 15 },
    { name: "泡菜", price: 20 },
    { name: "肉絲", price: 30 },
    { name: "蝦仁", price: 40 }
  ],
  "咖哩類": [
    { name: "荷包蛋", price: 15 }
  ]
};

const SPICY_OPTIONS = ["不辣", "微辣", "小辣", "中辣", "大辣"];

function money(n) {
  return `$${Number(n || 0)}`;
}

function normalizeMenu(raw) {
  if (!raw) return [];

  const list = [];

  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      if (item) {
        list.push({
          id: item.id || `item-${index}`,
          ...item
        });
      }
    });

    return list.filter(item => item.enabled !== false);
  }

  Object.entries(raw).forEach(([key, value]) => {
    if (!value) return;

    if (value.items && typeof value.items === "object") {
      Object.entries(value.items).forEach(([itemKey, item]) => {
        list.push({
          id: itemKey,
          category: value.name || value.category || key,
          ...item
        });
      });
      return;
    }

    if (value.name) {
      list.push({
        id: key,
        ...value
      });
    }
  });

  return list.filter(item => item.enabled !== false);
}

function getItemCategory(item) {
  return item.category || item.type || item.group || item.categoryName || "其他";
}

function getBasePrice(item) {
  if (item.price) return Number(item.price);
  if (item.smallPrice) return Number(item.smallPrice);
  if (item.priceSmall) return Number(item.priceSmall);
  if (item.sizes?.small) return Number(item.sizes.small);
  if (item.sizes?.小) return Number(item.sizes.小);
  return 0;
}

function getImageUrl(item) {
  return item.image || item.imageUrl || item.photo || item.photoUrl || "";
}

function getSizeOptions(item) {
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

  if (item.price && options.length === 0) {
    options.push({
      name: "一般",
      price: Number(item.price)
    });
  }

  const unique = [];
  const seen = new Set();

  options.forEach(opt => {
    if (!seen.has(opt.name)) {
      seen.add(opt.name);
      unique.push(opt);
    }
  });

  return unique.length ? unique : [{ name: "一般", price: 0 }];
}

function normalizeAddon(addon) {
  if (typeof addon === "string") {
    const parts = addon.split("+");
    return {
      name: parts[0].trim(),
      price: Number(parts[1] || 0)
    };
  }

  if (typeof addon === "number") {
    return {
      name: "加料",
      price: addon
    };
  }

  return {
    name: addon.name || addon.label || addon.title || "加料",
    price: Number(addon.price || addon.extra || addon.amount || 0)
  };
}

function getAddons(item) {
  const possibleFields = [
    item.addons,
    item.options,
    item.mods,
    item.extraOptions,
    item.addonOptions,
    item.toppings,
    item.extras
  ];

  for (const field of possibleFields) {
    if (Array.isArray(field) && field.length > 0) {
      return field.map(normalizeAddon);
    }

    if (typeof field === "string" && field.trim()) {
      return field
        .split(",")
        .map(x => x.trim())
        .filter(Boolean)
        .map(normalizeAddon);
    }

    if (field && typeof field === "object") {
      return Object.entries(field).map(([name, price]) => ({
        name,
        price: Number(price || 0)
      }));
    }
  }

  const category = getItemCategory(item);

  if (category.includes("鍋燒")) return DEFAULT_ADDONS["鍋燒類"];
  if (category.includes("炒麵")) return DEFAULT_ADDONS["炒麵類"];
  if (category.includes("炒飯")) return DEFAULT_ADDONS["炒飯類"];
  if (category.includes("咖哩") || category.includes("咖喱")) return DEFAULT_ADDONS["咖哩類"];

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

function renderCategories() {
  const categories = ["全部", ...new Set(menuData.map(getItemCategory))];

  categoryList.innerHTML = categories.map(cat => `
    <button class="category-btn ${cat === currentCategory ? "active" : ""}" data-category="${cat}">
      ${cat}
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
              ? `<img src="${imageUrl}" alt="${item.name || "餐點圖片"}" />`
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
      const item = menuData.find(i => i.id === card.dataset.id);
      openItemModal(item);
    });
  });
}

function openItemModal(item) {
  selectedItem = item;
  selectedAddons = [];
  selectedSpicy = "不辣";
  selectedSatay = "不要";
  selectedQty = 1;
  itemNote.value = "";

  const sizeOptions = getSizeOptions(item);
  selectedSize = sizeOptions[0];

  modalItemName.textContent = item.name || "未命名餐點";
  modalItemPrice.textContent = `${getItemCategory(item)}｜起價 ${money(getBasePrice(item))}`;

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
          data-name="${opt.name}" data-price="${opt.price}">
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

  if (addons.length > 0) {
    addonsSection.innerHTML = `
      <h3>加料</h3>
      <div class="option-grid">
        ${addons.map(addon => {
          const active = selectedAddons.some(a => a.name === addon.name);
          return `
            <button class="option-btn addon-btn ${active ? "active" : ""}"
              data-name="${addon.name}" data-price="${addon.price}">
              ${addon.name} +${addon.price}
            </button>
          `;
        }).join("")}
      </div>
    `;
  } else {
    addonsSection.innerHTML = "";
  }

  document.querySelectorAll(".addon-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const addon = {
        name: btn.dataset.name,
        price: Number(btn.dataset.price)
      };

      const exists = selectedAddons.some(a => a.name === addon.name);

      if (exists) {
        selectedAddons = selectedAddons.filter(a => a.name !== addon.name);
      } else {
        selectedAddons.push(addon);
      }

      renderModalOptions();
      updateModalSubtotal();
    });
  });

  if (allowSpicy(selectedItem)) {
    spicySection.innerHTML = `
      <h3>辣度</h3>
      <div class="option-grid">
        ${SPICY_OPTIONS.map(level => `
          <button class="option-btn spicy-btn ${selectedSpicy === level ? "active" : ""}"
            data-level="${level}">
            ${level}
          </button>
        `).join("")}
      </div>
    `;
  } else {
    spicySection.innerHTML = "";
  }

  document.querySelectorAll(".spicy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSpicy = btn.dataset.level;
      renderModalOptions();
    });
  });

  if (allowSatay(selectedItem)) {
    sataySection.innerHTML = `
      <h3>沙茶</h3>
      <div class="option-grid">
        <button class="option-btn satay-btn ${selectedSatay === "要" ? "active" : ""}" data-value="要">要沙茶</button>
        <button class="option-btn satay-btn ${selectedSatay === "不要" ? "active" : ""}" data-value="不要">不要沙茶</button>
      </div>
    `;
  } else {
    sataySection.innerHTML = "";
  }

  document.querySelectorAll(".satay-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSatay = btn.dataset.value;
      renderModalOptions();
    });
  });

  modalQty.textContent = selectedQty;
}

function updateModalSubtotal() {
  const base = Number(selectedSize?.price || getBasePrice(selectedItem));
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  const subtotal = (base + addonsTotal) * selectedQty;

  modalSubtotal.textContent = money(subtotal);
}

qtyMinusBtn.addEventListener("click", () => {
  selectedQty = Math.max(1, selectedQty - 1);
  modalQty.textContent = selectedQty;
  updateModalSubtotal();
});

qtyPlusBtn.addEventListener("click", () => {
  selectedQty += 1;
  modalQty.textContent = selectedQty;
  updateModalSubtotal();
});

closeModalBtn.addEventListener("click", () => {
  itemModal.classList.add("hidden");
});

addToCartBtn.addEventListener("click", () => {
  if (!selectedItem) return;

  const basePrice = Number(selectedSize?.price || getBasePrice(selectedItem));
  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  const unitPrice = basePrice + addonsTotal;

  cart.push({
    id: `${selectedItem.id}-${Date.now()}`,
    itemId: selectedItem.id,
    name: selectedItem.name,
    category: getItemCategory(selectedItem),
    size: selectedSize?.name || "一般",
    basePrice,
    addons: selectedAddons,
    spicy: allowSpicy(selectedItem) ? selectedSpicy : "",
    satay: allowSatay(selectedItem) ? selectedSatay : "",
    note: itemNote.value.trim(),
    qty: selectedQty,
    unitPrice,
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
          ${item.addons.length ? `<p>加料：${item.addons.map(a => a.name).join("、")}</p>` : ""}
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

  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
  cartTotal.textContent = money(total);
}

function renderConfirmModal() {
  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);

  confirmTotal.textContent = money(total);

  confirmContent.innerHTML = `
    <div class="confirm-table">
      ${table ? `桌號：${table}桌` : "QR 點餐"}
    </div>

    ${cart.map(item => `
      <div class="confirm-item">
        <div class="confirm-item-main">
          • ${item.name} × ${item.qty}
        </div>

        <div class="confirm-item-detail">
          ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
          ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
          ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
          ${item.addons.length ? `<p>加料：${item.addons.map(a => a.name).join("、")}</p>` : ""}
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
    const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const orderRef = push(ref(db, "orders"));
    const now = Date.now();

    const order = {
      id: orderRef.key,
      storeId: STORE_ID,
      source: "QR",
      type: table ? "內用" : "線上",
      table: table || "",
      customerName: customerNameInput.value.trim(),
      customerLabel:
        customerNameInput.value.trim() ||
        (table ? `${table}桌` : "QR客人"),
      note: orderNoteInput.value.trim(),
      items: cart,
      total,
      status: "pending",
      kitchenStatus: "pending",
      paid: false,
      createdAt: now,
      updatedAt: now
    };

    await set(orderRef, order);

    alert("訂單已送出，請至櫃檯確認付款。");

    confirmModal.classList.add("hidden");

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

function loadMenu() {
  const possiblePaths = [
    "menu",
    `menu/${STORE_ID}`,
    "menus",
    `menus/${STORE_ID}`,
    `stores/${STORE_ID}/menu`,
    "items"
  ];

  let loaded = false;

  possiblePaths.forEach(path => {
    const menuRef = ref(db, path);

    onValue(menuRef, snapshot => {
      if (loaded) return;

      const raw = snapshot.val();
      const normalized = normalizeMenu(raw);

      console.log("正在嘗試讀取菜單路徑：", path, normalized);

      if (normalized.length > 0) {
        loaded = true;
        menuData = normalized;

        console.log("✅ QR 成功讀到菜單路徑：", path);
        console.log("QR 讀到的菜單資料：", menuData);

        renderCategories();
        renderMenu();
      }
    });
  });
}

loadMenu();
renderCart();