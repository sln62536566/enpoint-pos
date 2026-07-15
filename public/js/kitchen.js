import {
  db,
  ref,
  onValue,
  update
} from "./firebase.js";

import {
  formatOrderOptionHtml,
  formatOrderOptionLines
} from "./order-option-display.js";

const orderList = document.getElementById("orderList");
const ordersRef = ref(db, "orders");

const STATUS_TEXT = {
  cancelled: "已作廢",
  confirmed: "等待製作",
  cooking: "製作中",
  done: "已完成"
};

function getStatus(order) {
  return order.kitchenStatus || order.status || "waiting";
}

function isTestOrder(order) {
  return order.isTestOrder === true || order.testOrder === true;
}

function isCancelled(order) {
  return order.status === "cancelled" || order.kitchenStatus === "cancelled" || order.cancelled === true;
}

function isPaid(order) {
  return order.paymentStatus === "paid" || order.paid === true;
}

function isUnpaid(order) {
  if (!order || isCancelled(order) || isPaid(order)) return false;
  return order.paymentStatus === "unpaid" || order.paid === false;
}

function money(value) {
  return `NT$${Number(value || 0)}`;
}

function getKitchenFlags(order) {
  const flags = [];
  if (isUnpaid(order)) flags.push(`<span class="kitchen-flag unpaid">🔴 未結帳</span>`);
  if (isTestOrder(order)) flags.push(`<span class="kitchen-flag test">測試單</span>`);
  if (isCancelled(order)) flags.push(`<span class="kitchen-flag cancelled">已作廢</span>`);
  return flags.length ? `<div class="kitchen-flags">${flags.join("")}</div>` : "";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}

function getTableText(order) {
  const raw = order.table || order.tableNumber || "";
  if (!raw) return "未選桌";
  const text = String(raw);
  return text.includes("桌") ? text : `${text}桌`;
}

function getOrderTitle(order) {
  if (order.type === "內用") {
    return `內用-${getTableText(order)}`;
  }

  if (order.type === "外帶") {
    return `外帶-${order.orderNumber || order.id || "-"}`;
  }

  return order.customerLabel || order.table || order.customerName || "訂單";
}

function getItemQty(item) {
  return item.qty || item.quantity || 1;
}

function itemDisplayName(item) {
  return item && (item.displayName || item.itemName || item.name) || "未命名餐點";
}

function renderItem(item) {
  return `
    <li class="kitchen-item">
      <div class="item-main">
        ${itemDisplayName(item)} × ${getItemQty(item)}
      </div>

      <div class="item-detail">
        ${formatOrderOptionHtml(item, function(value) { return value; }, { moduleName: "kds" })}
      </div>
    </li>
  `;
}

function buildOrderConfirmText(order) {
  const items = Array.isArray(order.items) ? order.items : [];

  const itemLines = items.map((item, index) => {
    const details = formatOrderOptionLines(item, { moduleName: "kds" });

    return `${index + 1}. ${itemDisplayName(item)} × ${getItemQty(item)}${details.length ? `\n   ${details.join("｜")}` : ""}`;
  }).join("\n\n");

  return `
請再次確認餐點是否全部完成：

訂單：${getOrderTitle(order)}
單號：${order.orderNumber || order.id || "-"}
來源：${order.source || "未知"}
類型：${order.type || "未分類"}
時間：${formatTime(order.createdAt)}

餐點內容：
${itemLines || "沒有餐點資料"}

${order.note ? `整單備註：${order.note}\n` : ""}
確認餐點沒有缺少後，按「確定」完成此訂單。
  `.trim();
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
            <h2>${getOrderTitle(order)}</h2>
            <p>單號：${order.orderNumber || order.id || "-"}</p>
            <p>來源：${order.source || "未知"}｜${order.type || "未分類"}</p>
            ${order.type === "內用" ? `<p>桌號：${getTableText(order)}</p>` : ""}
            <p>時間：${formatTime(order.createdAt)}</p>
            ${isUnpaid(order) ? `<p class="kitchen-payment-due">應收：${money(order.total)}</p>` : ""}
            ${getKitchenFlags(order)}
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
            status === "confirmed" && !isCancelled(order)
              ? `<button onclick="setKitchenStatus('${order.id}', 'cooking')">開始製作</button>`
              : ""
          }

          ${
            status === "cooking" && !isCancelled(order)
              ? `<button onclick="confirmDoneOrder('${order.id}')">完成</button>`
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
          status === "confirmed" && !isCancelled(order) ||
          status === "cooking" && !isCancelled(order)
        );
      })
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

    renderOrders(orders);
  });
}

async function setKitchenStatus(orderId, status) {
  try {
    const now = Date.now();
    const updates = {
      status,
      kitchenStatus: status,
      statusText: status === "cooking" ? "餐點製作中" : status,
      updatedAt: now
    };
    if (status === "cooking") updates.cookingAt = now;
    await update(ref(db, `orders/${orderId}`), updates);
  } catch (error) {
    console.error(error);
    alert("更新廚房狀態失敗");
  }
}

async function confirmDoneOrder(orderId) {
  const order = {};
  let targetOrder = null;

  await new Promise(resolve => {
    onValue(ref(db, `orders/${orderId}`), snapshot => {
      targetOrder = snapshot.exists() ? { id: orderId, ...snapshot.val() } : null;
      resolve();
    }, {
      onlyOnce: true
    });
  });

  if (!targetOrder) {
    alert("找不到這筆訂單");
    return;
  }

  const ok = confirm(buildOrderConfirmText(targetOrder));
  if (!ok) return;

  try {
    await update(ref(db, `orders/${orderId}`), {
      status: "done",
      kitchenStatus: "done",
      statusText: "餐點已完成，等待 POS 結案",
      doneAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error(error);
    alert("完成訂單失敗");
  }
}

window.setKitchenStatus = setKitchenStatus;
window.confirmDoneOrder = confirmDoneOrder;

loadOrders();
