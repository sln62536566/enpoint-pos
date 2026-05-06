import { db, ref, push, onValue, update, get, set } from './firebase.js';

// ==========================
// 📦 refs
// ==========================
const ordersRef = ref(db, 'orders');
const counterRef = ref(db, 'counter/order');
const menuRef = ref(db, 'menu/default');

// ==========================
// 🔢 訂單號
// ==========================
async function generateOrderNumber() {
  const snap = await get(counterRef);
  let num = snap.exists() ? snap.val().order : 0;

  num++;

  await set(counterRef, { order: num });

  return "A" + String(num).padStart(3, '0');
}

// ==========================
// 🧾 建立訂單
// ==========================
async function createOrder(items, table = "外帶") {
  const orderNumber = await generateOrderNumber();

  await push(ordersRef, {
    items,
    table,
    orderNumber,
    status: "pending",
    createdAt: Date.now()
  });
}

// ==========================
// 📡 訂單監聽
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
  await update(ref(db, `orders/${id}`), { status });
}

// ==========================
// 🍜 取得菜單
// ==========================
function listenMenu(callback) {
  onValue(menuRef, (snap) => {
    const data = snap.val() || {};
    const menu = Object.values(data);
    callback(menu);
  });
}

// ==========================
// export
// ==========================
export {
  createOrder,
  listenOrders,
  updateStatus,
  listenMenu
};