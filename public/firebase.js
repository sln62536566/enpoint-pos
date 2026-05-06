// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "你的KEY",
  authDomain: "你的DOMAIN",
  databaseURL: "你的DB",
  projectId: "你的ID",
  storageBucket: "你的BUCKET",
  messagingSenderId: "你的SENDER",
  appId: "你的APPID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, push, onValue, update, remove };