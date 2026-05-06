const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

// ==========================
// 🔥 Firebase（env版）
// ==========================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n')
  }),
  databaseURL: "https://enpoint-pos-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const db = admin.database();

// ==========================
// ⚙️ middleware
// ==========================
app.use(cors());
app.use(express.json());

// 🔥 重點：前端在 public 資料夾
app.use(express.static("public"));

// ==========================
// 🧪 測試
// ==========================
app.get("/ping", (req, res) => {
  res.send("POS API OK");
});

// ==========================
// 📦 訂單 API
// ==========================
app.get("/orders", async (req, res) => {
  const snapshot = await db.ref("orders").once("value");
  res.json(snapshot.val() || {});
});

app.post("/orders", async (req, res) => {
  const data = req.body;
  const ref = db.ref("orders").push();

  await ref.set({
    ...data,
    createdAt: Date.now()
  });

  res.json({ success: true, id: ref.key });
});

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