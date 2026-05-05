const API = "https://enpoint-api.onrender.com";

let orders = [];
let selectedOrderId = null;

/* =========================
   🔥 即時更新（每 2 秒抓一次）
========================= */
async function loadOrders() {
  try {
    const res = await fetch(`${API}/api/orders`);
    const data = await res.json();

    orders = Array.isArray(data) ? data : [];

    renderOrders();

    if (selectedOrderId) {
      renderDetail();
    }

  } catch (err) {
    console.error("❌ loadOrders error:", err);
  }
}

/* =========================
   UI
========================= */
function renderOrders() {
  const list = document.getElementById("orderList");
  if (!list) return;

  if (!orders.length) {
    list.innerHTML = "<p>目前沒有訂單</p>";
    return;
  }

  list.innerHTML = orders.map(o => `
    <div class="order-card ${selectedOrderId === o.id ? "active" : ""}"
         onclick="selectOrder('${o.id}')">

      <div><b>${o.id}</b></div>
      <div>桌號：${o.table || "-"}</div>
      <div>狀態：${o.status || "pending"}</div>
      <div>金額：NT$${o.total || 0}</div>

    </div>
  `).join("");
}

function selectOrder(id) {
  selectedOrderId = id;
  renderOrders();
  renderDetail();
}

function renderDetail() {
  const box = document.getElementById("orderDetail");
  if (!box) return;

  const order = orders.find(o => o.id === selectedOrderId);

  if (!order) {
    box.innerHTML = "<p>請選擇訂單</p>";
    return;
  }

  box.innerHTML = `
    <h3>${order.id}</h3>
    <p>桌號：${order.table || "-"}</p>
    <p>類型：${order.type || "-"}</p>
    <p>狀態：${order.status}</p>
    <p>備註：${order.note || "-"}</p>

    <hr>

    ${(order.items || []).map(i => `
      <div>
        🍜 ${i.name} x ${i.qty}（NT$${i.price}）
      </div>
    `).join("")}

    <hr>

    <button onclick="updateStatus('pending')">待處理</button>
    <button onclick="updateStatus('cooking')">製作中</button>
    <button onclick="updateStatus('done')">完成</button>
    <button onclick="updateStatus('paid')">已結帳</button>
  `;
}

/* =========================
   🔥 更新狀態（修正版）
========================= */
async function updateStatus(status) {
  const order = orders.find(o => o.id === selectedOrderId);
  if (!order) return;

  try {
    const res = await fetch(`${API}/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    const result = await res.json();

    console.log("🔥 update:", result);

    await loadOrders();

    selectedOrderId = order.id;
    renderDetail();

  } catch (err) {
    console.error(err);
    alert("更新失敗");
  }
}

/* =========================
   🔥 自動刷新（關鍵）
========================= */
setInterval(() => {
  loadOrders();
}, 2000);

/* =========================
   init
========================= */
document.addEventListener("DOMContentLoaded", () => {
  loadOrders();
});