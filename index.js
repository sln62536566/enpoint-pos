// index.js（🔥完整可用版）
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🔥 改用環境變數（重點）
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("🔥 Firebase OK");

app.get("/", (req, res) => {
  res.send("API RUNNING");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 RUNNING ON " + PORT);
});