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

function getOrderTitle(order) {
  return order.customerLabel || order.table || order.customerName || "訂單";
}

function getItemQty(item) {
  return item.qty || item.quantity || 1;
}

function getItemAddons(item) {
  return item.addons || item.extras || [];
}

function renderItem(item) {
  const addons = getItemAddons(item);

  return `
    <li class="kitchen-item">
      <div class="item-main">
        ${item.name || "未命名餐點"} × ${getItemQty(item)}
      </div>

      <div class="item-detail">
        ${item.size && item.size !== "一般" ? `<p>份量：${item.size}</p>` : ""}
        ${item.requiredOption ? `<p>${item.requiredOption.title}：${item.requiredOption.value}</p>` : ""}
        ${item.spicy ? `<p>辣度：${item.spicy}</p>` : ""}
        ${item.satay ? `<p>沙茶：${item.satay}</p>` : ""}
        ${addons.length ? `<p>加料：${addons.map(a => a.name).join("、")}</p>` : ""}
        ${item.note ? `<p>備註：${item.note}</p>` : ""}
      </div>
    </li>
  `;
}

function buildOrderConfirmText(order) {
  const items = Array.isArray(order.items) ? order.items : [];

  const itemLines = items.map((item, index) => {
    const addons = getItemAddons(item);

    const details = [
      item.size && item.size !== "一般" ? `份量：${item.size}` : "",
      item.requiredOption ? `${item.requiredOption.title}：${item.requiredOption.value}` : "",
      item.spicy ? `辣度：${item.spicy}` : "",
      item.satay ? `沙茶：${item.satay}` : "",
      addons.length ? `加料：${addons.map(a => a.name).join("、")}` : "",
      item.note ? `備註：${item.note}` : ""
    ].filter(Boolean);

    return `${index + 1}. ${item.name || "未命名餐點"} × ${getItemQty(item)}${details.length ? `\n   ${details.join("｜")}` : ""}`;
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
          status === "confirmed" ||
          status === "cooking"
        );
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

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