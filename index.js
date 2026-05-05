const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// 🔥 Firebase 初始化
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 🔢 建立訂單
app.post("/createOrder", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "no body" });
    }

    const name = req.body.name || "未填名字";
    const items = req.body.items || "未填餐點";
    const type = req.body.type || "DINE_IN";

    const date = new Date().toISOString().split("T")[0];
    const counterRef = db.collection("dailyCounters").doc(date);

    let orderId;

    await db.runTransaction(async (t) => {
      const doc = await t.get(counterRef);
      let count = doc.exists ? doc.data().count : 0;
      count++;

      t.set(counterRef, { count });

      orderId = `${date.replaceAll("-", "")}-${String(count).padStart(3, "0")}`;
    });

    const order = {
      id: orderId,
      name,
      items,
      type,
      status: "PENDING",
      paid: false,
      createdAt: Date.now()
    };

    await db.collection("orders").doc(orderId).set(order);

    res.json(order);

  } catch (err) {
    console.error("createOrder error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🧾 取得所有訂單（🔥你剛加的）
app.get("/getOrders", async (req, res) => {
  try {
    const snap = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .get();

    const list = snap.docs.map(d => d.data());

    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// 🟠 確認送廚房
app.post("/confirm", async (req, res) => {
  try {
    const { id, paid } = req.body;

    await db.collection("orders").doc(id).update({
      status: "CONFIRMED",
      paid
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// 🍳 廚房更新狀態
app.post("/updateStatus", async (req, res) => {
  try {
    const { id, status } = req.body;

    await db.collection("orders").doc(id).update({ status });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// 🚀 啟動
app.listen(3000, () => {
  console.log("🔥 server running on http://localhost:3000");
});