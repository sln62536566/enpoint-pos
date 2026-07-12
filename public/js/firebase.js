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
  get,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

// ===== 營業日 =====
function getBusinessDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCompactBusinessDate(businessDate = getBusinessDate()) {
  return String(businessDate || getBusinessDate()).replace(/-/g, "");
}

function normalizeOrderNumberSource(source) {
  const value = String(source || "pos").toLowerCase();
  if (value === "q" || value === "qr") return { key: "qr", prefix: "Q" };
  if (value === "o" || value === "online" || value === "line") return { key: "online", prefix: "O" };
  if (value === "h" || value === "hold" || value === "held") return { key: "hold", prefix: "H" };
  return { key: "pos", prefix: "P" };
}

// ===== OrderNumberService =====
async function createOrderNumber(source, options = {}) {
  if (typeof options === "string") {
    options = { businessDate: options };
  }
  const businessDate = options.businessDate || options.businessDay || getBusinessDate();
  const compactDate = getCompactBusinessDate(businessDate);
  const storeId = options.storeId || "defaultStore";
  const sourceMeta = normalizeOrderNumberSource(source);

  const counterRef = ref(db, `orderNumberCounters/${storeId}/${businessDate}/${sourceMeta.key}`);
  const result = await runTransaction(counterRef, current => {
    return Number(current || 0) + 1;
  });

  if (!result.committed) {
    throw new Error("Order number transaction was not committed");
  }

  const current = Number(result.snapshot.val() || 0);

  return `${sourceMeta.prefix}-${compactDate}-${String(current).padStart(4, "0")}`;
}

async function generateDailyOrderNumber(source = "pos") {
  return createOrderNumber(source);
}

export {
  db,
  storage,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get,
  runTransaction,
  storageRef,
  uploadBytes,
  getDownloadURL,
  getBusinessDate,
  getCompactBusinessDate,
  createOrderNumber,
  generateDailyOrderNumber
};
