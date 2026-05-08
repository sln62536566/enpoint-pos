// src/firebase/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// 🔥 你的 Firebase 設定
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


// 🔥 統一 export
export const db = getDatabase(app);

export const firestore = getFirestore(app);

export const storage = getStorage(app);

export const auth = getAuth(app);

export default app;