import { db, ref, push, onValue, update } from './firebase.js';

const ordersRef = ref(db, 'orders');
const counterRef = ref(db, 'counter/order');

// 🔥 取得 + 更新訂單號（正確版）
async function generateOrderNumber() {
  return new Promise((resolve) => {
    onValue(counterRef, (snap) => {
      let num = snap.val() || 0;
      num++;

      // ⚠️ 只更新一次（避免狂跳）
      update(counterRef, num);

      const orderNo = "A" + String(num).padStart(3, '0');
      resolve(orderNo);
    }, { onlyOnce: true });
  });
}

// 🔥 建立訂單
async function createOrder(items, table = "外帶") {
  const orderNumber = await generateOrderNumber();

  const order = {
    items,
    table,
    orderNumber,
    status: "pending",
    createdAt: Date.now()
  };

  push(ordersRef, order);
}

// 🔥 監聽訂單（廚房用）
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

export { createOrder, listenOrders, updateStatus };