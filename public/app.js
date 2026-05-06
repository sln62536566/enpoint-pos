import { db, ref, push, onValue, update, remove } from './firebase.js';

const ordersRef = ref(db, 'orders');

// 🔥 建立訂單
function createOrder(items) {
  const order = {
    items,
    status: "pending",
    createdAt: Date.now()
  };
  push(ordersRef, order);
}

// 🔥 監聽訂單（給廚房）
function listenOrders(callback) {
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};
    let list = Object.entries(data).map(([id, val]) => ({
      id,
      ...val
    }));

    // 最新在上面
    list.sort((a, b) => b.createdAt - a.createdAt);

    callback(list);
  });
}

// 🔥 更新狀態
function updateStatus(id, status) {
  update(ref(db, `orders/${id}`), { status });
}

// 🔥 自動清除完成訂單（30分鐘）
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