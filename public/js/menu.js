import {
  db,
  ref,
  push,
  set,
  onValue
} from "./firebase.js";

const menuContainer = document.getElementById("menuContainer");
const cartList = document.getElementById("cartList");
const totalAmount = document.getElementById("totalAmount");
const submitOrderBtn = document.getElementById("submitOrderBtn");

const dineInBtn = document.getElementById("dineInBtn");
const takeOutBtn = document.getElementById("takeOutBtn");
const customerNameInput = document.getElementById("customerNameInput");
const tableNumberInput = document.getElementById("tableNumberInput");

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

let cart = [];
let currentOrderType = "內用";
let currentItem = null;
let currentQuantity = 1;

dineInBtn.addEventListener("click", () => {
  currentOrderType = "內用";
  dineInBtn.classList.add("active");
  takeOutBtn.classList.remove("active");
  tableNumberInput.style.display = "block";
});

takeOutBtn.addEventListener("click", () => {
  currentOrderType = "外帶";
  takeOutBtn.classList.add("active");
  dineInBtn.classList.remove("active");
  tableNumberInput.style.display = "none";
  tableNumberInput.value = "";
});

onValue(menuRef, snapshot => {
  menuContainer.innerHTML = "";

  if (!snapshot.exists()) {
    menuContainer.innerHTML = "<p>目前沒有菜單資料</p>";
    return;
  }

  const data = snapshot.val();
  const grouped = {};

  Object.entries(data).forEach(([id, item]) => {
    if (!item.enabled) return;

    if (!grouped[item.category]) {
      grouped[item.category] = [];
    }

    grouped[item.category].push({
      id,
      ...item
    });
  });

  Object.entries(grouped).forEach(([category, items]) => {
    const section = document.createElement("section");
    section.className = "menu-section";

    const title = document.createElement("h2");
    title.textContent = category;

    const grid = document.createElement("div");
    grid.className = "menu-grid";

    items.forEach(item => {
      const card = document.createElement("div");
      card.className = "food-card";

      const imageBox = document.createElement("div");
      imageBox.className = "food-image";

      if (item.image) {
        const img = document.createElement("img");
        img.src = item.image;
        img.alt = item.name;
        imageBox.appendChild(img);
      } else {
        const noImage = document.createElement("div");
        noImage.className = "no-image";
        noImage.textContent = "🍜";
        imageBox.appendChild(noImage);
      }

      const info = document.createElement("div");
      info.className = "food-info";

      const name = document.createElement("h3");
      name.textContent = item.name;

      const price = document.createElement("p");
      price.className = "price";
      price.textContent = "$" + item.price;

      const button = document.createElement("button");
      button.className = "order-btn";
      button.textContent = "選擇餐點";

      button.addEventListener("click", () => {
        openCustomModal(item);
      });

      info.appendChild(name);
      info.appendChild(price);
      info.appendChild(button);

      card.appendChild(imageBox);
      card.appendChild(info);
      grid.appendChild(card);
    });

    section.appendChild(title);
    section.appendChild(grid);
    menuContainer.appendChild(section);
  });
});

function openCustomModal(item) {
  currentItem = item;
  currentQuantity = 1;

  modalItemName.textContent = item.name;
  modalItemPrice.textContent = "$" + item.price;
  modalQuantity.textContent = "1";
  spicySelect.value = "不辣";
  noteInput.value = "";

  renderExtras(item.options || {});

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

  const optionEntries = Object.entries(options);

  if (optionEntries.length === 0) {
    extrasBox.innerHTML = "<p class='empty-cart'>此餐點目前沒有加料選項</p>";
    return;
  }

  optionEntries.forEach(([name, price]) => {
    const label = document.createElement("label");
    label.className = "extra-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = name;
    checkbox.dataset.price = Number(price);

    const span = document.createElement("span");
    span.textContent = name + " +$" + price;

    label.appendChild(checkbox);
    label.appendChild(span);
    extrasBox.appendChild(label);
  });
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
  if (event.target === customModal) {
    closeCustomModal();
  }
});

confirmCustomBtn.addEventListener("click", () => {
  if (!currentItem) return;

  const selectedExtras = [];

  extrasBox.querySelectorAll("input[type='checkbox']:checked").forEach(checkbox => {
    selectedExtras.push({
      name: checkbox.value,
      price: Number(checkbox.dataset.price)
    });
  });

  const customItem = {
    cartId: Date.now().toString() + Math.random().toString(36).slice(2),
    id: currentItem.id,
    name: currentItem.name,
    basePrice: Number(currentItem.price),
    price: calculateItemPrice(Number(currentItem.price), selectedExtras),
    quantity: currentQuantity,
    spicy: spicySelect.value,
    extras: selectedExtras,
    note: noteInput.value.trim()
  };

  cart.push(customItem);
  renderCart();
  closeCustomModal();
});

function calculateItemPrice(basePrice, extras) {
  const extrasTotal = extras.reduce((sum, extra) => {
    return sum + Number(extra.price);
  }, 0);

  return basePrice + extrasTotal;
}

function renderCart() {
  cartList.innerHTML = "";

  if (cart.length === 0) {
    cartList.innerHTML = "<p class='empty-cart'>尚未加入餐點</p>";
    totalAmount.textContent = "$0";
    return;
  }

  let total = 0;

  cart.forEach(item => {
    const subtotal = item.price * item.quantity;
    total += subtotal;

    const row = document.createElement("div");
    row.className = "cart-item";

    const info = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = item.name;

    const detail = document.createElement("p");
    detail.textContent = "$" + item.price + " × " + item.quantity + " = $" + subtotal;

    const customDetail = document.createElement("div");
    customDetail.className = "cart-custom-detail";

    const spicy = document.createElement("p");
    spicy.textContent = "辣度：" + item.spicy;

    customDetail.appendChild(spicy);

    if (item.extras.length > 0) {
      const extras = document.createElement("p");
      extras.textContent = "加料：" + item.extras.map(extra => extra.name).join("、");
      customDetail.appendChild(extras);
    }

    if (item.note) {
      const note = document.createElement("p");
      note.textContent = "備註：" + item.note;
      customDetail.appendChild(note);
    }

    info.appendChild(title);
    info.appendChild(detail);
    info.appendChild(customDetail);

    const actions = document.createElement("div");
    actions.className = "cart-actions";

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "-";
    minusBtn.addEventListener("click", () => {
      changeQuantity(item.cartId, -1);
    });

    const qty = document.createElement("span");
    qty.textContent = item.quantity;

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", () => {
      changeQuantity(item.cartId, 1);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "刪除";
    deleteBtn.className = "small-delete-btn";
    deleteBtn.addEventListener("click", () => {
      removeFromCart(item.cartId);
    });

    actions.appendChild(minusBtn);
    actions.appendChild(qty);
    actions.appendChild(plusBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(info);
    row.appendChild(actions);
    cartList.appendChild(row);
  });

  totalAmount.textContent = "$" + total;
}

function changeQuantity(cartId, amount) {
  const item = cart.find(cartItem => cartItem.cartId === cartId);

  if (!item) return;

  item.quantity += amount;

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

  submitOrderBtn.textContent = "送出中...";

  try {

    const newOrderRef = push(ordersRef);

    const order = {

      orderNumber: Date.now().toString().slice(-6),

      items: cart,

      total: calculateTotal(),

      status: "pending",

      orderType: currentOrderType,

      customerName: customerNameInput.value.trim(),

      tableNumber: tableNumberInput.value.trim(),

      createdAt: Date.now()

    };

    await set(newOrderRef, order);

    cart = [];

    renderCart();

    customerNameInput.value = "";

    tableNumberInput.value = "";

    alert("訂單已送出，請等待叫號。");

  } catch (error) {

    console.error(error);

    alert("送出訂單失敗，請稍後再試。");

  }

  submitOrderBtn.disabled = false;

  submitOrderBtn.textContent = "送出訂單";

}

submitOrderBtn.addEventListener("click", submitOrder);

renderCart();