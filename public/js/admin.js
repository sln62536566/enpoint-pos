import {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue
} from "./firebase.js";

/* =========================
   恩點系統｜菜單後台
   檔案位置：public/js/admin.js
========================= */

const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemPrice = document.getElementById("itemPrice");
const itemImage = document.getElementById("itemImage");
const itemOptions = document.getElementById("itemOptions");
const addItemBtn = document.getElementById("addItemBtn");
const menuList = document.getElementById("menuList");

const menuRef = ref(db, "menu");

let menuData = {};
let editingId = null;

/* =========================
   加料格式轉換
   輸入：加蛋:15,加肉:20,泡菜:20
   存入：{ 加蛋: 15, 加肉: 20, 泡菜: 20 }
========================= */
function parseOptions(text) {
  const options = {};

  if (!text || !text.trim()) {
    return options;
  }

  const parts = text.split(",");

  parts.forEach(part => {
    const [name, price] = part.split(":");

    if (!name || price === undefined) return;

    const cleanName = name.trim();
    const cleanPrice = Number(price);

    if (!cleanName) return;
    if (Number.isNaN(cleanPrice)) return;

    options[cleanName] = cleanPrice;
  });

  return options;
}

/* =========================
   加料物件轉文字
========================= */
function optionsToText(options = {}) {
  return Object.entries(options)
    .map(([name, price]) => `${name}:${price}`)
    .join(",");
}

/* =========================
   清空表單
========================= */
function resetForm() {
  editingId = null;

  itemName.value = "";
  itemCategory.value = "";
  itemPrice.value = "";
  itemImage.value = "";
  itemOptions.value = "";

  addItemBtn.textContent = "新增餐點";
}

/* =========================
   新增 / 更新餐點
========================= */
async function saveItem() {
  const name = itemName.value.trim();
  const category = itemCategory.value.trim();
  const price = Number(itemPrice.value);
  const image = itemImage.value.trim();
  const options = parseOptions(itemOptions.value);

  if (!name) {
    alert("請輸入餐點名稱");
    return;
  }

  if (!category) {
    alert("請輸入分類");
    return;
  }

  if (!price || price <= 0) {
    alert("請輸入正確價格");
    return;
  }

  const itemData = {
    name,
    category,
    price,
    image,
    options,
    enabled: true,
    updatedAt: Date.now()
  };

  try {
    addItemBtn.disabled = true;

    if (editingId) {
      await update(ref(db, `menu/${editingId}`), itemData);
      alert("餐點已更新");
    } else {
      const newItemRef = push(menuRef);
      await set(newItemRef, {
        ...itemData,
        createdAt: Date.now()
      });
      alert("餐點已新增");
    }

    resetForm();

  } catch (err) {
    console.error("❌ 儲存餐點失敗：", err);
    alert("儲存失敗，請看 Console");
  } finally {
    addItemBtn.disabled = false;
  }
}

/* =========================
   編輯餐點
========================= */
function editItem(id) {
  const item = menuData[id];

  if (!item) return;

  editingId = id;

  itemName.value = item.name || "";
  itemCategory.value = item.category || "";
  itemPrice.value = item.price || "";
  itemImage.value = item.image || "";
  itemOptions.value = optionsToText(item.options || {});

  addItemBtn.textContent = "更新餐點";

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================
   上架 / 下架
========================= */
async function toggleItem(id) {
  const item = menuData[id];

  if (!item) return;

  try {
    await update(ref(db, `menu/${id}`), {
      enabled: !item.enabled,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error("❌ 上下架失敗：", err);
    alert("上下架失敗");
  }
}

/* =========================
   刪除餐點
========================= */
async function deleteItem(id) {
  const item = menuData[id];

  if (!item) return;

  const ok = confirm(`確定要刪除「${item.name}」嗎？`);

  if (!ok) return;

  try {
    await remove(ref(db, `menu/${id}`));

    if (editingId === id) {
      resetForm();
    }

  } catch (err) {
    console.error("❌ 刪除失敗：", err);
    alert("刪除失敗");
  }
}

/* =========================
   顯示菜單
========================= */
function renderMenu() {
  if (!menuList) return;

  const items = Object.entries(menuData);

  if (items.length === 0) {
    menuList.innerHTML = "<p>目前沒有菜單資料</p>";
    return;
  }

  const grouped = {};

  items.forEach(([id, item]) => {
    const category = item.category || "未分類";

    if (!grouped[category]) {
      grouped[category] = [];
    }

    grouped[category].push({
      id,
      ...item
    });
  });

  menuList.innerHTML = Object.entries(grouped).map(([category, items]) => {
    return `
      <div class="admin-category">
        <h3>${category}</h3>

        ${items.map(item => `
          <div class="admin-menu-card ${item.enabled ? "" : "disabled"}">
            <div>
              <strong>${item.name || "未命名餐點"}</strong>
              <p>價格：NT$${item.price || 0}</p>
              <p>狀態：${item.enabled ? "上架中" : "已下架"}</p>
              <p>加料：${
                item.options && Object.keys(item.options).length > 0
                  ? Object.entries(item.options).map(([name, price]) => `${name} +${price}`).join("、")
                  : "無"
              }</p>
            </div>

            <div class="admin-actions">
              <button onclick="editItem('${item.id}')">編輯</button>
              <button onclick="toggleItem('${item.id}')">
                ${item.enabled ? "下架" : "上架"}
              </button>
              <button class="danger-btn" onclick="deleteItem('${item.id}')">刪除</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }).join("");
}

/* =========================
   即時讀取 Firebase 菜單
========================= */
onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderMenu();
});

/* =========================
   綁定按鈕
========================= */
addItemBtn.addEventListener("click", saveItem);

/* =========================
   讓 HTML onclick 可以用
========================= */
window.editItem = editItem;
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;