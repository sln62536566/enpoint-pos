const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

// ==========================
// 🔥 Firebase 初始化
// ==========================
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://enpoint-api-default-rtdb.firebaseio.com/"
});

const db = admin.database();

// ==========================
// ⚙️ middleware
// ==========================
app.use(cors());
app.use(express.json());

// 🔥 讓 HTML / JS / CSS 可以被存取（重點）
app.use(express.static(__dirname));

// ==========================
// 🧪 測試API
// ==========================
app.get("/ping", (req, res) => {
  res.send("POS API OK");
});

// ==========================
// 📦 取得訂單
// ==========================
app.get("/orders", async (req, res) => {
  const snapshot = await db.ref("orders").once("value");
  res.json(snapshot.val() || {});
});

// ==========================
// ➕ 新增訂單
// ==========================
app.post("/orders", async (req, res) => {
  const data = req.body;

  const ref = db.ref("orders").push();
  await ref.set({
    ...data,
    createdAt: Date.now()
  });

  res.json({ success: true, id: ref.key });
});

// ==========================
// 🔧 更新狀態
// ==========================
app.put("/orders/:id", async (req, res) => {
  const { id } = req.params;

  await db.ref(`orders/${id}`).update(req.body);

  res.json({ success: true });
});

// ==========================
// 🚀 啟動
// ==========================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🔥 Firebase OK");
  console.log("🚀 RUNNING ON", PORT);
});