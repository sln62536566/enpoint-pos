import {
  db,
  ref,
  onValue,
  update
} from "./firebase.js";

const orderList = document.getElementById("orderList");
const ordersRef = ref(db, "orders");

onValue(ordersRef, snapshot => {
  orderList.innerHTML = "";

  if (!snapshot.exists()) {
    orderList.innerHTML = "<p>目前沒有待製作訂單。</p>";
    return;
  }

  const data = snapshot.val();

  const orders = Object.entries(data)
    .map(([id, order]) => ({ id, ...order }))
    .filter(order => {
      const status = String(order.status || "").toLowerCase();
      const kitchenStatus = String(order.kitchenStatus || "").toLowerCase();

      return (
        kitchenStatus === "sent" &&
        (status === "confirmed" || status === "pending" || status === "cooking")
      );
    })
    .sort((a, b) => {
      return (b.sentToKitchenAt || b.createdAt || 0) - (a.sentToKitchenAt || a.createdAt || 0);
    });

  if (orders.length === 0) {
    orderList.innerHTML = "<p>目前沒有待製作訂單。</p>";
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("div");
    card.className = `order-card ${order.status || "confirmed"}`;

    const items = Array.isArray(order.items) ? order.items : [];

    card.innerHTML = `
      <div class="order-header">
        <h3>訂單 #${order.orderNumber || order.id}</h3>
        <span class="status-badge ${order.status || "confirmed"}">
          ${getStatusText(order.status)}
        </span>
      </div>

      <p class="order-time">時間：${formatTime(order.createdAt)}</p>
      <p class="order-time">類型：${order.type || "現場"}</p>
      <p class="order-time">取餐資訊：${getCustomerLabel(order)}</p>

      <div class="order-items">
        ${
          items.length
            ? items.map(item => renderItem(item)).join("")
            : "<p>此訂單沒有餐點資料</p>"
        }
      </div>

      <p class="order-total">總金額：$${order.total || 0}</p>

      <div class="order-actions">
        ${
          order.status === "cooking"
            ? `<button class="done-btn" data-action="done" data-id="${order.id}">完成訂單</button>`
            : `<button class="cooking-btn" data-action="cooking" data-id="${order.id}">開始製作</button>`
        }
      </div>
    `;

    orderList.appendChild(card);
  });

  orderList.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      updateOrderStatus(button.dataset.id, button.dataset.action);
    });
  });
});

function renderItem(item) {
  const addons = item.addons || item.extras || [];
  const qty = item.quantity || item.qty || 1;

  return `
    <div class="kitchen-item-box">
      <div class="order-item-row">${item.name || "未命名餐點"} × ${qty}</div>
      <div class="kitchen-item-details">
        <p>辣度：${item.spicy || "不辣"}</p>
        ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
        ${addons.length ? `<p>加料：${addons.map(extra => extra.name).join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${item.note}</p>` : ""}
      </div>
    </div>
  `;
}

function updateOrderStatus(id, action) {
  const status = action === "done" ? "done" : "cooking";

  update(ref(db, "orders/" + id), {
    status,
    statusText: getCustomerStatusText(status),
    updatedAt: Date.now()
  });
}

function getCustomerLabel(order) {
  if (order.customerLabel) return order.customerLabel;
  if (order.type === "內用" && order.table) return `${order.table}桌`;
  if (order.type === "外帶" && order.orderNumber) return `外帶-${order.orderNumber}`;
  return "未填寫";
}

function getStatusText(status) {
  if (status === "confirmed") return "待製作";
  if (status === "pending") return "待製作";
  if (status === "cooking") return "製作中";
  if (status === "done") return "已完成";
  return "待製作";
}

function getCustomerStatusText(status) {
  if (status === "cooking") return "製作中";
  if (status === "done") return "餐點已完成，請留意取餐";
  if (status === "confirmed") return "櫃檯已確認，等待廚房製作";
  return "等待櫃檯確認";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}