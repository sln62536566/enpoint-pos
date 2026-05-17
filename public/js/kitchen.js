import {
  db,
  ref,
  onValue,
  update
} from "./firebase.js";

const orderList = document.getElementById("orderList");
const ordersRef = ref(db, "orders");

const STATUS_TEXT = {
  confirmed: "等待製作",
  cooking: "製作中",
  done: "已完成"
};

function getStatus(order) {
  return order.kitchenStatus || order.status || "waiting";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}

function renderItem(item) {
  const addons = item.addons || item.extras || [];

  return `
    <li class="kitchen-item">
      <div class="item-main">
        ${item.name || "未命名餐點"} × ${item.qty || item.quantity || 1}
      </div>

      <div class="item-detail">
        ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
        ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
        ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
        ${addons.length ? `<p>加料：${addons.map(a => a.name).join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${item.note}</p>` : ""}
      </div>
    </li>
  `;
}

function renderOrders(orders) {
  if (orders.length === 0) {
    orderList.innerHTML = `<div class="empty">目前沒有廚房訂單</div>`;
    return;
  }

  orderList.innerHTML = orders.map(order => {
    const status = getStatus(order);
    const items = Array.isArray(order.items) ? order.items : [];

    return `
      <article class="kitchen-card ${status}">
        <div class="kitchen-card-header">
          <div>
            <h2>${order.customerLabel || order.table || "訂單"}</h2>
            <p>來源：${order.source || "未知"}｜${order.type || "未分類"}</p>
            <p>時間：${formatTime(order.createdAt)}</p>
          </div>

          <span class="status-badge">
            ${STATUS_TEXT[status] || status}
          </span>
        </div>

        <ul class="kitchen-items">
          ${items.map(renderItem).join("")}
        </ul>

        ${order.note ? `<div class="order-note">整單備註：${order.note}</div>` : ""}

        <div class="kitchen-actions">
          ${
            status === "confirmed"
              ? `<button onclick="setKitchenStatus('${order.id}', 'cooking')">開始製作</button>`
              : ""
          }

          ${
            status === "cooking"
              ? `<button onclick="setKitchenStatus('${order.id}', 'done')">完成</button>`
              : ""
          }
        </div>
      </article>
    `;
  }).join("");
}

function loadOrders() {
  onValue(ordersRef, snapshot => {
    const raw = snapshot.val() || {};

    const orders = Object.entries(raw)
      .map(([id, order]) => ({
        id,
        ...order
      }))
      .filter(order => {
        const status = getStatus(order);

        return (
          status === "confirmed" ||
          status === "cooking"
        );
      })
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

    renderOrders(orders);
  });
}

async function setKitchenStatus(orderId, status) {
  try {
    await update(ref(db, `orders/${orderId}`), {
      status,
      kitchenStatus: status,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error(error);
    alert("更新廚房狀態失敗");
  }
}

window.setKitchenStatus = setKitchenStatus;

loadOrders();