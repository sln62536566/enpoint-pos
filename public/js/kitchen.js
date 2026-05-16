import {
  db,
  ref,
  onValue,
  update
} from "./firebase.js";

const STORE_ID = "defaultStore";
const orderList = document.getElementById("orderList");

const STATUS_TEXT = {
  pending: "待確認",
  confirmed: "已送出",
  sent: "已送出",
  cooking: "製作中",
  done: "已完成"
};

function getStatus(order) {
  return order.kitchenStatus || order.status || "pending";
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderItem(item) {
  const addons = Array.isArray(item.addons)
    ? item.addons.map(a => typeof a === "string" ? a : a.name).filter(Boolean)
    : [];

  return `
    <li class="kitchen-item">
      <div class="item-main">
        <strong>${item.name || "未命名餐點"} × ${item.qty || 1}</strong>
      </div>

      <div class="item-detail">
        ${item.size && item.size !== "一般" ? `<p>尺寸：${item.size}</p>` : ""}
        ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
        ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
        ${addons.length ? `<p>加料：${addons.join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${item.note}</p>` : ""}
      </div>
    </li>
  `;
}

function renderOrders(orders) {
  if (!orders.length) {
    orderList.innerHTML = `<div class="empty">目前沒有訂單</div>`;
    return;
  }

  orderList.innerHTML = orders.map(order => {
    const status = getStatus(order);
    const items = Array.isArray(order.items) ? order.items : [];

    return `
      <article class="kitchen-card ${status}">
        <div class="kitchen-card-header">
          <div>
            <h2>${order.customerLabel || order.customerName || order.table || "QR訂單"}</h2>
            <p>${order.type || "未分類"}｜${formatTime(order.createdAt)}</p>
          </div>
          <span class="status-badge">${STATUS_TEXT[status] || status}</span>
        </div>

        <ul class="kitchen-items">
          ${items.map(renderItem).join("")}
        </ul>

        ${order.note ? `<div class="order-note">整單備註：${order.note}</div>` : ""}

        <div class="kitchen-actions">
          <button data-id="${order.id}" data-status="cooking">製作中</button>
          <button data-id="${order.id}" data-status="done">已完成</button>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".kitchen-actions button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.status;

      await update(ref(db, `orders/${id}`), {
        kitchenStatus: status,
        status,
        updatedAt: Date.now()
      });
    });
  });
}

function loadOrders() {
  const ordersRef = ref(db, "orders");

  onValue(ordersRef, snapshot => {
    const raw = snapshot.val() || {};

    const orders = Object.entries(raw)
      .map(([id, order]) => ({
        id,
        ...order
      }))
      .filter(order => {
        const status = getStatus(order);
        return status !== "done";
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    renderOrders(orders);
  });
}

loadOrders();