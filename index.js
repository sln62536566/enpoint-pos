const express = require("express");
const app = express();
const cors = require("cors");

// ==========================
// ⚙️ middleware
// ==========================
app.use(cors());
app.use(express.json());

// ==========================
// 📁 靜態檔案
// ==========================
const path = require("path");

console.log("PUBLIC PATH:", path.join(__dirname, "public"));
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// 🧪 test
// ==========================
app.get("/ping", (req, res) => {
  res.send("POS OK");
});

// ==========================
// 🚀 start
// ==========================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 RUNNING ON", PORT);
});