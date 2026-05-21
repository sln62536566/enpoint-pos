// public/js/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBz5ixYBa6q6yB4uObJNdUVqDuL8X4uyw0",
  authDomain: "enpoint-pos.firebaseapp.com",
  databaseURL: "https://enpoint-pos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "enpoint-pos",
  storageBucket: "enpoint-pos.firebasestorage.app",
  messagingSenderId: "1085275616655",
  appId: "1:1085275616655:web:96a86e2d6bf89d2717c7fa",
};

// 初始化
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===== 營業日 =====
function getBusinessDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// ===== 訂單號 =====
async function generateDailyOrderNumber() {
  const businessDate = getBusinessDate();

  const counterRef = ref(db, `dailyCounters/${businessDate}`);

  const snapshot = await get(counterRef);

  let current = 0;

  if (snapshot.exists()) {
    current = snapshot.val();
  }

  current++;

  await set(counterRef, current);

  return `A${String(current).padStart(3, "0")}`;
}

export {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get,
  getBusinessDate,
  generateDailyOrderNumber
};