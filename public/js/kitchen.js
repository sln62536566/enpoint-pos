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
    orderList.innerHTML = "<p>目前沒有訂單。</p>";
    return;
  }

  const data = snapshot.val();

  const orders = Object.entries(data)
    .map(([id, order]) => ({ id, ...order }))
    .filter(order => order.kitchenStatus === "sent")
    .filter(order => order.status === "pending" || order.status === "cooking")
    .sort((a, b) => (b.sentToKitchenAt || b.createdAt || 0) - (a.sentToKitchenAt || a.createdAt || 0));

  if (orders.length === 0) {
    orderList.innerHTML = "<p>目前沒有待製作訂單。</p>";
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("div");
    card.className = "order-card";

    const header = document.createElement("div");
    header.className = "order-header";

    const title = document.createElement("h3");
    title.textContent = "訂單 #" + (order.orderNumber || order.id);

    const status = document.createElement("span");
    status.className = "status-badge " + (order.status || "pending");
    status.textContent = getStatusText(order.status);

    header.appendChild(title);
    header.appendChild(status);

    const time = document.createElement("p");
    time.className = "order-time";
    time.textContent = "時間：" + formatTime(order.createdAt);

    const type = document.createElement("p");
    type.className = "order-time";
    type.textContent = "類型：" + (order.type || "現場");

    const customerInfo = document.createElement("p");
    customerInfo.className = "order-time";
    customerInfo.textContent = "取餐資訊：" + getCustomerLabel(order);

    const itemsBox = document.createElement("div");
    itemsBox.className = "order-items";

    const items = Array.isArray(order.items) ? order.items : [];

    items.forEach(item => {
      const itemBox = document.createElement("div");
      itemBox.className = "kitchen-item-box";

      const itemRow = document.createElement("div");
      itemRow.className = "order-item-row";
      itemRow.textContent = `${item.name || "未命名餐點"} × ${item.quantity || item.qty || 1}`;

      itemBox.appendChild(itemRow);

      const details = document.createElement("div");
      details.className = "kitchen-item-details";

      const spicy = document.createElement("p");
      spicy.textContent = "辣度：" + (item.spicy || "不辣");
      details.appendChild(spicy);

      if (item.extras && item.extras.length > 0) {
        const extras = document.createElement("p");
        extras.textContent = "加料：" + item.extras.map(extra => extra.name).join("、");
        details.appendChild(extras);
      }

      if (item.note) {
        const note = document.createElement("p");
        note.textContent = "備註：" + item.note;
        details.appendChild(note);
      }

      itemBox.appendChild(details);
      itemsBox.appendChild(itemBox);
    });

    const total = document.createElement("p");
    total.className = "order-total";
    total.textContent = "總金額：$" + (order.total || 0);

    const actions = document.createElement("div");
    actions.className = "order-actions";

    if (order.status === "pending") {
      const cookingBtn = document.createElement("button");
      cookingBtn.textContent = "開始製作";
      cookingBtn.className = "cooking-btn";
      cookingBtn.addEventListener("click", () => {
        updateOrderStatus(order.id, "cooking");
      });
      actions.appendChild(cookingBtn);
    }

    if (order.status === "cooking") {
      const doneBtn = document.createElement("button");
      doneBtn.textContent = "完成訂單";
      doneBtn.className = "done-btn";
      doneBtn.addEventListener("click", () => {
        updateOrderStatus(order.id, "done");
      });
      actions.appendChild(doneBtn);
    }

    card.appendChild(header);
    card.appendChild(time);
    card.appendChild(type);
    card.appendChild(customerInfo);
    card.appendChild(itemsBox);
    card.appendChild(total);
    card.appendChild(actions);

    orderList.appendChild(card);
  });
});

function updateOrderStatus(id, status) {
  update(ref(db, "orders/" + id), {
    status,
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
  if (status === "pending") return "待製作";
  if (status === "cooking") return "製作中";
  if (status === "done") return "已完成";
  return "未知";
}

function formatTime(timestamp) {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false
  });
}