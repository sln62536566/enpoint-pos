let cart = [];
let currentMenu = [];

async function loadMenu() {
  const res = await fetch(API + "/menu?storeId=" + storeId);
  const raw = await res.json() || {};
  currentMenu = Object.values(raw);
}

function addToCart(item) {
  const existing = cart.find(x => x.name === item.name);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      name: item.name,
      price: item.price,
      qty: 1,
      mods: [],
      spicy: "不辣",
      note: ""
    });
  }
  renderCart();
}

function increaseQty(index) {
  cart[index].qty += 1;
  renderCart();
}

function decreaseQty(index) {
  cart[index].qty -= 1;
  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  }
  renderCart();
}

function removeItem(index) {
  cart.splice(index, 1);
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderGuestMenu() {
  loadMenu().then(() => {
    const box = document.getElementById("menu");
    box.innerHTML = "";

    currentMenu.forEach(cat => {
      const catTitle = document.createElement("div");
      catTitle.style.cssText = "font-weight:bold;padding:10px 0;background:#eee;";
      catTitle.textContent = cat.type;
      box.appendChild(catTitle);

      const items = Object.values(cat.items || {});
      items.forEach(i => {
        const item = document.createElement("div");
        item.className = "card";
        item.innerHTML =
          "<img src=\"" + (i.photo || "https://via.placeholder.com/200x120?text=No+Photo") + "\" style=\"width:100%;height:120px;object-fit:cover;border-radius:10px;\">" +
          "<b>" + i.name + "</b>" +
          "<div class=\"price\">" + i.price + " 元</div>" +
          "<div style=\"margin-top:8px;\"><button type=\"button\">加入購物車</button></div>";
        item.querySelector("button").onclick = () => addToCart(i);
        box.appendChild(item);
      });
    });
  });
}

function renderCart() {
  let total = 0;
  cart.forEach(i => {
    total += i.price * i.qty;
  });

  const el = document.getElementById("cart");
  if (!el) return;

  if (cart.length === 0) {
    el.innerHTML = "<b>購物車是空的</b>";
    return;
  }

  let html = "<b>小計：" + total + " 元</b><br><div style='margin-top:8px;'>";
  cart.forEach((i, index) => {
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee;">
        <div style="flex:1;">
          <div>${i.name}</div>
          <div style="font-size:13px;color:#666;">NT$${i.price} x ${i.qty}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button type="button" onclick="decreaseQty(${index})">-</button>
          <span>${i.qty}</span>
          <button type="button" onclick="increaseQty(${index})">+</button>
          <button type="button" onclick="removeItem(${index})">刪除</button>
        </div>
      </div>
    `;
  });
  html += "</div>";
  el.innerHTML = html;
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = "block";
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = "none";
}

function showConfirm() {
  if (cart.length === 0) {
    alert("沒有商品");
    return;
  }

  const tableEl = document.getElementById("table");
  const typeEl = document.getElementById("type");

  let html = "";
  html += "桌號：" + (tableEl ? tableEl.value : "") + "<br>";
  html += "類型：" + (typeEl ? typeEl.value : "") + "<br><br>";

  cart.forEach(i => {
    html += i.name + " x" + i.qty + "<br>";
  });

  html += "<br><b>總計：" + cart.reduce((a, b) => a + b.price * b.qty, 0) + " 元</b>";

  document.getElementById("confirmContent").innerHTML = html;
  openModal("confirmModal");
}

function hideConfirm() {
  closeModal("confirmModal");
}

/* =========================
   🔥 已修正送單（重點）
========================= */
async function sendOrder() {
  if (cart.length === 0) {
    alert("沒有商品");
    return;
  }

  const tableEl = document.getElementById("table");
  const typeEl = document.getElementById("type");
  const noteEl = document.getElementById("note");

  const total = cart.reduce((a, b) => a + b.price * b.qty, 0);

  const data = {
    storeId,
    id: "order_" + Date.now(),
    table: tableEl ? tableEl.value || "外帶" : "外帶",
    type: typeEl ? typeEl.value : "內用",
    note: noteEl ? noteEl.value : "",
    items: cart,
    total,
    status: "pending",
    createdAt: Date.now()
  };

  try {
    const res = await fetch(API + "/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await res.json();

    console.log("🔥 create-order response:", result);

    if (!res.ok) {
      throw new Error(result.error || "API error");
    }

    hideConfirm();

    document.getElementById("checkoutMessage").textContent =
      "訂單已送出，總金額 NT$" + total;

    openModal("checkoutModal");

    cart = [];
    renderCart();

  } catch (err) {
    console.error("❌ 下單失敗:", err);
    alert("下單失敗：" + err.message);
  }
}

function finishAndBackToMenu() {
  closeModal("checkoutModal");
  window.location.href = "index.html";
}

window.addEventListener("DOMContentLoaded", () => {
  renderGuestMenu();
  renderCart();

  document.getElementById("clearCartBtn")
    ?.addEventListener("click", () => {
      if (confirm("確定清空？")) clearCart();
    });

  document.getElementById("confirmCancelBtn")
    ?.addEventListener("click", hideConfirm);

  document.getElementById("confirmSendBtn")
    ?.addEventListener("click", sendOrder);

  document.getElementById("checkoutDoneBtn")
    ?.addEventListener("click", finishAndBackToMenu);
});