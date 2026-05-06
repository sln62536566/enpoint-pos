import { db, ref, push, onValue, update, get, set } from './firebase.js';

// ==========================
// 🌐 API（未來擴充用，可不用）
// ==========================
const API = "https://enpoint-api.onrender.com";

// ==========================
// 📦 refs
// ==========================
const ordersRef = ref(db, 'orders');
const counterRef = ref(db, 'counter/order');

// ==========================
// 🔢 訂單號（穩定版）
// ==========================
async function generateOrderNumber() {
  const snap = await get(counterRef);
  let num = snap.exists() ? snap.val().order : 0;

  num++;

  await set(counterRef, { order: num });

  return "A" + String(num).padStart(3, '0');
}

// ==========================
// 🧾 建立訂單（🔥唯一入口）
// ==========================
async function createOrder(items, table = "外帶") {
  try {
    const orderNumber = await generateOrderNumber();

    await push(ordersRef, {
      items,
      table,
      orderNumber,
      status: "pending",
      createdAt: Date.now()
    });

    return true;
  } catch (err) {
    console.error("❌ createOrder error:", err);
    return false;
  }
}

// ==========================
// 📡 廚房監聽
// ==========================
function listenOrders(callback) {
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};

    const list = Object.entries(data).map(([id, val]) => ({
      id,
      ...val
    }));

    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    callback(list);
  });
}

// ==========================
// 🔧 更新狀態
// ==========================
async function updateStatus(id, status) {
  if (!id) return;

  await update(ref(db, `orders/${id}`), { status });
}

// ==========================
// 📤 export
// ==========================
export {
  createOrder,
  listenOrders,
  updateStatus
};