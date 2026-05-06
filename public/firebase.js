// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBz5ixYBa6q6yB4uObJNdUVqDuL8X4uyw0",
  authDomain: "enpoint-pos.firebaseapp.com",
  databaseURL: "https://enpoint-pos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "enpoint-pos",
  storageBucket: "enpoint-pos.firebasestorage.app",
  messagingSenderId: "1085275616655",
  appId: "1:1085275616655:web:96a86e2d6bf89d2717c7fa",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, push, onValue, update, remove };