const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

// ==========================
// 🔥 Firebase
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

// ==========================
// 📁 靜態檔案（🔥重點）
// ==========================
console.log("PUBLIC PATH:", __dirname + "/public");
app.use(express.static(__dirname + "/public"));

// ==========================
// 🧪 test
// ==========================
app.get("/ping", (req, res) => {
  res.send("POS API OK");
});

// ==========================
// 📦 orders API（保留）
// ==========================
app.get("/orders", async (req, res) => {
  const snap = await db.ref("orders").once("value");
  res.json(snap.val() || {});
});

app.post("/orders", async (req, res) => {
  const ref = db.ref("orders").push();

  await ref.set({
    ...req.body,
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
// 🚀 start
// ==========================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🔥 Firebase OK");
  console.log("🚀 RUNNING ON", PORT);
});