import { db, ref, push, onValue, update } from './firebase.js';

// ==========================
// 📦 Firebase refs
// ==========================
const ordersRef = ref(db, 'orders');
const counterRef = ref(db, 'counter/order');

// ==========================
// 🔢 生成訂單號（安全版）
// ==========================
async function generateOrderNumber() {
  return new Promise((resolve) => {
    onValue(counterRef, (snap) => {
      let num = snap.val()?.order || 0;
      num++;

      // ✔ 一定要是 object
      update(counterRef, {
        order: num
      });

      const orderNo = "A" + String(num).padStart(3, '0');
      resolve(orderNo);

    }, { onlyOnce: true });
  });
}

// ==========================
// 🧾 建立訂單
// ==========================
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

// ==========================
// 📡 廚房監聽訂單
// ==========================
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

// ==========================
// 🔧 更新狀態
// ==========================
function updateStatus(id, status) {
  update(ref(db, `orders/${id}`), { status });
}

// ==========================
// 📤 export
// ==========================
export {
  createOrder,
  listenOrders,
  updateStatus
};