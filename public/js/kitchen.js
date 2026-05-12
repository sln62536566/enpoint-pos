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
    .map(([id, order]) => ({
      id,
      ...order
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeOrders = orders.filter(order => order.status !== "done");

  if (activeOrders.length === 0) {
    orderList.innerHTML = "<p>目前沒有待處理訂單。</p>";
    return;
  }

  activeOrders.forEach(order => {
    const card = document.createElement("div");
    card.className = "order-card";

    const statusText = getStatusText(order.status);

    const header = document.createElement("div");
    header.className = "order-header";

    const title = document.createElement("h3");
    title.textContent = "訂單 #" + order.orderNumber;

    const status = document.createElement("span");
    status.className = "status-badge " + order.status;
    status.textContent = statusText;

    header.appendChild(title);
    header.appendChild(status);

    const time = document.createElement("p");
    time.className = "order-time";
    time.textContent = "時間：" + formatTime(order.createdAt);

    const type = document.createElement("p");
    type.className = "order-time";
    type.textContent = "類型：" + (order.orderType || "現場點餐");

    const customerInfo = document.createElement("p");
    customerInfo.className = "order-time";

    const infoParts = [];

    if (order.customerName) {
      infoParts.push("客人：" + order.customerName);
    }

    if (order.tableNumber) {
      infoParts.push("桌號：" + order.tableNumber);
    }

    customerInfo.textContent = infoParts.length > 0 ? infoParts.join("｜") : "客人資訊：未填寫";

    const itemsBox = document.createElement("div");
    itemsBox.className = "order-items";

    order.items.forEach(item => {
      const itemBox = document.createElement("div");
      itemBox.className = "kitchen-item-box";

      const itemRow = document.createElement("div");
      itemRow.className = "order-item-row";
      itemRow.textContent = item.name + " × " + item.quantity;

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
    total.textContent = "總金額：$" + order.total;

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
    status
  });
}

function getStatusText(status) {
  if (status === "pending") return "待製作";
  if (status === "cooking") return "製作中";
  if (status === "done") return "已完成";
  return "未知";
}

function formatTime(timestamp) {
  const date = new Date(timestamp);

  return date.toLocaleString("zh-TW", {
    hour12: false
  });
}