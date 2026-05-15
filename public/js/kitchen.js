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

      // ✅ 完成或取消，一律不顯示在廚房主畫面
      if (status === "done" || status === "cancelled") return false;
      if (kitchenStatus === "done" || kitchenStatus === "cancelled") return false;

      // ✅ 只顯示已送廚房或正在處理的訂單
      return (
        kitchenStatus === "sent" ||
        status === "confirmed" ||
        status === "pending" ||
        status === "cooking"
      );
    })
    .sort((a, b) => {
      return (b.sentToKitchenAt || b.createdAt || 0) - (a.sentToKitchenAt || a.createdAt || 0);
    });

  if (orders.length === 0) {
    orderList.innerHTML = "<p>目前沒有待製作訂單。</p>";
    return;
  }

  orderList.innerHTML = orders.map(order => renderOrderCard(order)).join("");

  orderList.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      updateOrderStatus(button.dataset.id, button.dataset.action);
    });
  });
});

function renderOrderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const status = String(order.status || "confirmed").toLowerCase();

  return `
    <div class="order-card ${status}">
      <div class="order-header">
        <h3>訂單 #${escapeHtml(order.orderNumber || order.id)}</h3>
        <span class="status-badge ${status}">
          ${getStatusText(status)}
        </span>
      </div>

      <p class="order-time">時間：${formatTime(order.createdAt)}</p>
      <p class="order-time">類型：${escapeHtml(order.type || "現場")}</p>
      <p class="order-time">取餐資訊：${escapeHtml(getCustomerLabel(order))}</p>

      <div class="order-items">
        ${items.length ? items.map(item => renderItem(item)).join("") : "<p>此訂單沒有餐點資料</p>"}
      </div>

      <p class="order-total">總金額：$${Number(order.total || 0)}</p>

      <div class="order-actions">
        ${
          status === "cooking"
            ? `<button class="done-btn" data-action="done" data-id="${order.id}">完成訂單</button>`
            : `<button class="cooking-btn" data-action="cooking" data-id="${order.id}">開始製作</button>`
        }
      </div>
    </div>
  `;
}

function renderItem(item) {
  const addons = item.addons || item.extras || [];
  const qty = item.quantity || item.qty || 1;

  return `
    <div class="kitchen-item-box">
      <div class="order-item-row">${escapeHtml(item.name || "未命名餐點")} × ${qty}</div>
      <div class="kitchen-item-details">
        <p>辣度：${escapeHtml(item.spicy || "不辣")}</p>
        ${item.satay ? `<p>沙茶：${escapeHtml(item.satay)}</p>` : ""}
        ${addons.length ? `<p>加料：${addons.map(extra => escapeHtml(extra.name)).join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${escapeHtml(item.note)}</p>` : ""}
      </div>
    </div>
  `;
}

function updateOrderStatus(id, action) {
  const isDone = action === "done";
  const now = Date.now();

  const updateData = {
    status: isDone ? "done" : "cooking",
    kitchenStatus: isDone ? "done" : "sent",
    statusText: isDone ? "餐點已完成，請留意取餐" : "製作中",
    updatedAt: now
  };

  if (isDone) {
    updateData.completedAt = now;
  } else {
    updateData.startedAt = now;
  }

  update(ref(db, "orders/" + id), updateData)
    .catch(error => {
      console.error("更新廚房狀態失敗：", error);
      alert("更新失敗，請確認網路或 Firebase 權限。");
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
  return "待製作";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}