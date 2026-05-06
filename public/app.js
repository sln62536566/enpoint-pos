import { db, ref, push, onValue, update, remove } from './firebase.js';

const ordersRef = ref(db, 'orders');

// 🔢 訂單號生成（簡單版）
let orderCounter = 1;

function generateOrderNumber() {
  const num = String(orderCounter).padStart(3, '0');
  orderCounter++;
  return "A" + num;
}

// 🔥 建立訂單（升級版）
function createOrder(items, table = "外帶") {
  const order = {
    items,
    table,
    orderNumber: generateOrderNumber(),
    status: "pending",
    createdAt: Date.now()
  };
  push(ordersRef, order);
}

// 🔥 監聽訂單
function listenOrders(callback) {
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};
    let list = Object.entries(data).map(([id, val]) => ({
      id,
      ...val
    }));

    list.sort((a, b) => b.createdAt - a.createdAt);

    callback(list);
  });
}

// 🔥 更新狀態
function updateStatus(id, status) {
  update(ref(db, `orders/${id}`), { status });
}

// 🔥 自動清除
function autoClean() {
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};
    const now = Date.now();

    Object.entries(data).forEach(([id, order]) => {
      if (order.status === "done") {
        if (now - order.createdAt > 30 * 60 * 1000) {
          remove(ref(db, `orders/${id}`));
        }
      }
    });
  });
}

export { createOrder, listenOrders, updateStatus, autoClean };