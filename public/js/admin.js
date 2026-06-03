// =====================================================
// 恩點系統 v58-2.5
// 日期：2026-05-22
// 端別：菜單後台 admin.js
// 檔案：public/js/admin.js
// 用途：分類管理器 + 加料 UI 編輯器 + 餐點描述 + 必選選項
// =====================================================

import {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  storage,
  storageRef,
  uploadBytes,
  getDownloadURL
} from "./firebase.js";

const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemPrice = document.getElementById("itemPrice");
const itemImage = document.getElementById("itemImage");
const itemImageFile = document.getElementById("itemImageFile");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const itemDescription = document.getElementById("itemDescription");
const requiredOptionTitle = document.getElementById("requiredOptionTitle");
const requiredOptionChoices = document.getElementById("requiredOptionChoices");

const addItemBtn = document.getElementById("addItemBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const formTitle = document.getElementById("formTitle");

const sizeEditor = document.getElementById("sizeEditor");
const addSizeRowBtn = document.getElementById("addSizeRowBtn");

const addonEditor = document.getElementById("addonEditor");
const addAddonRowBtn = document.getElementById("addAddonRowBtn");
const removeOptionEditor = document.getElementById("removeOptionEditor");
const addRemoveOptionRowBtn = document.getElementById("addRemoveOptionRowBtn");

const newCategoryName = document.getElementById("newCategoryName");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const categoryManagerList = document.getElementById("categoryManagerList");

const menuSearchInput = document.getElementById("menuSearchInput");
const categoryFilterList = document.getElementById("categoryFilterList");
const menuList = document.getElementById("menuList");

const menuRef = ref(db, "menu");
const categoriesRef = ref(db, "categories");

let menuData = {};
let categoriesData = {};
let editingId = null;
let currentCategoryFilter = "全部";

let draggedCategoryId = null;
let draggedItemId = null;
let draggedItemCategory = null;

let sizeRows = [];
let addonRows = [];
let removeOptionRows = [];

/* =========================
   Helpers
========================= */

function money(n) {
  return `NT$${Number(n || 0)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getRequiredOptionFromForm() {
  if (!requiredOptionTitle || !requiredOptionChoices) return null;

  const title = requiredOptionTitle.value.trim();
  const choices = requiredOptionChoices.value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

  if (!title || choices.length === 0) {
    return null;
  }

  return {
    title,
    options: choices,
    required: true
  };
}

function setRequiredOptionToForm(requiredOption) {
  if (!requiredOptionTitle || !requiredOptionChoices) return;

  if (!requiredOption) {
    requiredOptionTitle.value = "";
    requiredOptionChoices.value = "";
    return;
  }

  requiredOptionTitle.value = requiredOption.title || "";
  requiredOptionChoices.value = Array.isArray(requiredOption.options)
    ? requiredOption.options.join(",")
    : "";
}


async function compressImageFileToDataUrl(file) {
  return new Promise(function(resolve, reject) {
    if (!file) return resolve("");

    var reader = new FileReader();

    reader.onload = function(event) {
      var originalDataUrl = event && event.target ? event.target.result : "";

      try {
        var img = new Image();

        img.onload = function() {
          try {
            var maxSize = 700;
            var width = img.width || maxSize;
            var height = img.height || maxSize;

            if (width > height && width > maxSize) {
              height = Math.round(height * maxSize / width);
              width = maxSize;
            } else if (height >= width && height > maxSize) {
              width = Math.round(width * maxSize / height);
              height = maxSize;
            }

            var canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            var dataUrl = canvas.toDataURL("image/jpeg", 0.62);
            resolve(dataUrl || originalDataUrl);
          } catch (canvasError) {
            resolve(originalDataUrl);
          }
        };

        img.onerror = function() {
          resolve(originalDataUrl);
        };

        img.src = originalDataUrl;
      } catch (imageError) {
        resolve(originalDataUrl);
      }
    };

    reader.onerror = function() {
      reject(new Error("圖片讀取失敗"));
    };

    reader.readAsDataURL(file);
  });
}

async function uploadMenuImageIfNeeded() {
  if (!itemImageFile || !itemImageFile.files || itemImageFile.files.length === 0) {
    return itemImage.value.trim();
  }

  const file = itemImageFile.files[0];

  if (!file || !file.type || file.type.indexOf("image/") !== 0) {
    alert("請選擇圖片檔案");
    return itemImage.value.trim();
  }

  // v61-3：先用相容模式存圖片，避免 Firebase Storage 權限未開時卡在「上傳中」。
  if (imagePreviewBox) {
    imagePreviewBox.textContent = "圖片壓縮中，請稍候...";
  }

  try {
    const dataUrl = await compressImageFileToDataUrl(file);
    if (!dataUrl) throw new Error("圖片轉換失敗");

    itemImage.value = dataUrl;

    if (imagePreviewBox) {
      imagePreviewBox.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="餐點圖片預覽"><p class="form-help">已使用相容模式儲存圖片。</p>`;
    }

    return dataUrl;
  } catch (fallbackError) {
    console.error("圖片相容模式失敗：", fallbackError);
    alert("圖片處理失敗，請先改用圖片網址，或換一張較小的圖片。\n\n錯誤：" + (fallbackError && fallbackError.message ? fallbackError.message : fallbackError));
    return itemImage.value.trim();
  }
}

function renderImagePreview(url) {
  if (!imagePreviewBox) return;
  if (!url) {
    imagePreviewBox.innerHTML = "尚未選擇圖片";
    return;
  }
  imagePreviewBox.innerHTML = `<img src="${escapeHtml(url)}" alt="餐點圖片預覽">`;
}


/* =========================
   份量 UI 編輯器
========================= */

function renderSizeEditor() {
  if (!sizeEditor) return;

  if (sizeRows.length === 0) {
    sizeEditor.innerHTML = `<div class="empty small-empty">尚未設定份量，系統會使用上方價格作為「一般」。</div>`;
    return;
  }

  sizeEditor.innerHTML = sizeRows.map((size, index) => `
    <div class="addon-row size-row">
      <input type="text" placeholder="份量名稱，例如：小份 / 大份" value="${escapeHtml(size.name || "")}" data-index="${index}" data-field="name" />
      <input type="number" placeholder="價格" value="${Number(size.price || 0)}" data-index="${index}" data-field="price" />
      <div class="addon-move-actions">
        <button class="row-move-btn" type="button" data-action="up" data-index="${index}">上移</button>
        <button class="row-move-btn" type="button" data-action="down" data-index="${index}">下移</button>
      </div>
      <button class="danger-btn" type="button" data-action="delete" data-index="${index}">刪除</button>
    </div>
  `).join("");

  sizeEditor.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const field = input.dataset.field;
      if (!sizeRows[index]) return;
      if (field === "name") sizeRows[index].name = input.value;
      if (field === "price") sizeRows[index].price = Number(input.value || 0);
    });
  });

  sizeEditor.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const action = button.dataset.action;
      if (action === "up") moveSizeRow(index, -1);
      if (action === "down") moveSizeRow(index, 1);
      if (action === "delete") { sizeRows.splice(index, 1); renderSizeEditor(); }
    });
  });
}

function addSizeRow() {
  sizeRows.push({ name: "", price: Number(itemPrice && itemPrice.value ? itemPrice.value : 0) });
  renderSizeEditor();
}

function moveSizeRow(index, direction) {
  if (moveArrayItem(sizeRows, index, direction)) renderSizeEditor();
}

function getSizesFromRows() {
  const sizes = {};
  sizeRows.forEach(size => {
    const name = String(size.name || "").trim();
    const price = Number(size.price || 0);
    if (!name) return;
    if (Number.isNaN(price) || price <= 0) return;
    sizes[name] = price;
  });
  return sizes;
}

function setSizeRowsFromSizes(sizes = {}) {
  if (sizes && typeof sizes === "object" && !Array.isArray(sizes)) {
    sizeRows = Object.entries(sizes).map(([name, price]) => ({ name, price: Number(price || 0) }));
  } else {
    sizeRows = [];
  }
  renderSizeEditor();
}

/* =========================
   加料 UI 編輯器
========================= */

function renderAddonEditor() {
  if (!addonEditor) return;

  if (addonRows.length === 0) {
    addonEditor.innerHTML = `<div class="empty small-empty">尚未設定加料</div>`;
    return;
  }

  addonEditor.innerHTML = addonRows.map((addon, index) => `
    <div class="addon-row">
      <input
        type="text"
        placeholder="加料名稱，例如：加蛋"
        value="${escapeHtml(addon.name || "")}" 
        data-index="${index}"
        data-field="name"
      />

      <input
        type="number"
        placeholder="價格"
        value="${Number(addon.price || 0)}"
        data-index="${index}"
        data-field="price"
      />

      <div class="addon-move-actions">
        <button class="row-move-btn" type="button" data-action="up" data-index="${index}">上移</button>
        <button class="row-move-btn" type="button" data-action="down" data-index="${index}">下移</button>
      </div>

      <button class="danger-btn" type="button" data-action="delete" data-index="${index}">
        刪除
      </button>
    </div>
  `).join("");

  addonEditor.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const field = input.dataset.field;

      if (!addonRows[index]) return;

      if (field === "name") {
        addonRows[index].name = input.value;
      }

      if (field === "price") {
        addonRows[index].price = Number(input.value || 0);
      }
    });
  });

  addonEditor.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const action = button.dataset.action;

      if (action === "up") moveAddonRow(index, -1);
      if (action === "down") moveAddonRow(index, 1);
      if (action === "delete") {
        addonRows.splice(index, 1);
        renderAddonEditor();
      }
    });
  });
}

function addAddonRow() {
  addonRows.push({
    name: "",
    price: 0
  });

  renderAddonEditor();
  renderRemoveOptionEditor();
}

function renderRemoveOptionEditor() {
  if (!removeOptionEditor) return;

  if (removeOptionRows.length === 0) {
    removeOptionEditor.innerHTML = `<div class="empty small-empty">尚未設定不要項目</div>`;
    return;
  }

  removeOptionEditor.innerHTML = removeOptionRows.map((name, index) => `
    <div class="addon-row remove-option-row">
      <input
        type="text"
        placeholder="例如：不要蔥"
        value="${escapeHtml(name || "")}" 
        data-index="${index}"
      />
      <div class="addon-move-actions">
        <button class="row-move-btn" type="button" data-action="up" data-index="${index}">上移</button>
        <button class="row-move-btn" type="button" data-action="down" data-index="${index}">下移</button>
      </div>
      <button class="danger-btn" type="button" data-action="delete" data-index="${index}">
        刪除
      </button>
    </div>
  `).join("");

  removeOptionEditor.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      removeOptionRows[index] = input.value;
    });
  });

  removeOptionEditor.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const action = button.dataset.action;

      if (action === "up") moveRemoveOptionRow(index, -1);
      if (action === "down") moveRemoveOptionRow(index, 1);
      if (action === "delete") {
        removeOptionRows.splice(index, 1);
        renderRemoveOptionEditor();
      }
    });
  });
}

function addRemoveOptionRow() {
  removeOptionRows.push("");
  renderRemoveOptionEditor();
}

function getRemoveOptionsFromRows() {
  const seen = {};
  return removeOptionRows
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .filter(name => {
      if (seen[name]) return false;
      seen[name] = true;
      return true;
    });
}

function setRemoveOptionRows(options) {
  removeOptionRows = Array.isArray(options) ? options.slice() : [];
  renderRemoveOptionEditor();
}


function moveArrayItem(list, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return false;
  const moved = list.splice(index, 1)[0];
  list.splice(nextIndex, 0, moved);
  return true;
}

function moveAddonRow(index, direction) {
  if (moveArrayItem(addonRows, index, direction)) {
    renderAddonEditor();
  }
}

function moveRemoveOptionRow(index, direction) {
  if (moveArrayItem(removeOptionRows, index, direction)) {
    renderRemoveOptionEditor();
  }
}

async function moveCategoryByButton(categoryId, direction) {
  const categories = getCategoryItems();
  const index = categories.findIndex(category => String(category.id) === String(categoryId));
  if (index < 0) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= categories.length) return;
  await reorderCategory(categoryId, categories[targetIndex].id);
}

async function moveMenuItemByButton(itemId, category, direction) {
  if (!itemId) return;

  const target = menuData[itemId];
  if (!target) {
    alert("找不到這個餐點資料");
    return;
  }

  const realCategory = target.category || category || "未分類";
  const items = getMenuItems()
    .filter(item => (item.category || "未分類") === realCategory)
    .sort((a, b) => {
      const orderA = Number(a.sortOrder !== undefined ? a.sortOrder : 999999999);
      const orderB = Number(b.sortOrder !== undefined ? b.sortOrder : 999999999);
      if (orderA !== orderB) return orderA - orderB;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
    });

  const index = items.findIndex(item => String(item.id) === String(itemId));
  if (index < 0) return;

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return;

  const moved = items.splice(index, 1)[0];
  items.splice(targetIndex, 0, moved);

  const updates = {};
  const now = Date.now();

  items.forEach((item, idx) => {
    const sortOrder = (idx + 1) * 1000;
    updates[`menu/${item.id}/sortOrder`] = sortOrder;
    updates[`menu/${item.id}/updatedAt`] = now;
    if (menuData[item.id]) {
      menuData[item.id].sortOrder = sortOrder;
      menuData[item.id].updatedAt = now;
    }
  });

  try {
    await update(ref(db), updates);
    renderMenu();
  } catch (error) {
    console.error("餐點上移/下移失敗：", error);
    alert("餐點上移/下移失敗，請確認網路或 Firebase 權限");
  }
}

function getOptionsFromAddonRows() {
  const options = {};

  addonRows.forEach(addon => {
    const name = String(addon.name || "").trim();
    const price = Number(addon.price || 0);

    if (!name) return;
    if (Number.isNaN(price)) return;

    options[name] = price;
  });

  return options;
}

function setAddonRowsFromOptions(options = {}) {
  addonRows = Object.entries(options).map(([name, price]) => ({
    name,
    price: Number(price || 0)
  }));

  renderAddonEditor();
}

/* =========================
   Menu / Category Helpers
========================= */

function getMenuItems() {
  return Object.entries(menuData).map(([id, item]) => ({
    id,
    ...item
  }));
}

function getCategoryItems() {
  const fromCategories = Object.entries(categoriesData).map(([id, category]) => ({
    id,
    name: category.name || "未命名分類",
    enabled: category.enabled !== false,
    sortOrder: Number(category.sortOrder !== undefined ? category.sortOrder : 999999999),
    createdAt: category.createdAt || 0
  }));

  const existingNames = new Set(fromCategories.map(category => category.name));

  const fromMenu = [];

  getMenuItems().forEach(item => {
    const name = item.category || "未分類";

    if (!existingNames.has(name)) {
      existingNames.add(name);

      fromMenu.push({
        id: `legacy-${name}`,
        name,
        enabled: true,
        sortOrder: Number(item.categoryOrder !== undefined ? item.categoryOrder : 999999999),
        createdAt: 0,
        legacy: true
      });
    }
  });

  return [...fromCategories, ...fromMenu].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

function findCategoryByName(name) {
  return Object.entries(categoriesData).find(([id, category]) => {
    return category.name === name;
  });
}

function getCategoryOrderByName(name) {
  const category = getCategoryItems().find(item => item.name === name);
  return Number(category ? (category.sortOrder !== undefined ? category.sortOrder : 999999999) : 999999999);
}

function groupItems() {
  const grouped = {};

  getMenuItems().forEach(item => {
    const category = item.category || "未分類";

    if (!grouped[category]) grouped[category] = [];

    grouped[category].push(item);
  });

  Object.keys(grouped).forEach(category => {
    grouped[category].sort((a, b) => {
      const orderA = Number(a.sortOrder !== undefined ? a.sortOrder : 999999999);
      const orderB = Number(b.sortOrder !== undefined ? b.sortOrder : 999999999);

      if (orderA !== orderB) return orderA - orderB;

      return (a.name || "").localeCompare(b.name || "", "zh-Hant");
    });
  });

  return grouped;
}

function getFilteredItems(items) {
  const keyword = (menuSearchInput.value || "").trim().toLowerCase();

  return items.filter(item => {
    const category = item.category || "未分類";
    const name = item.name || "";

    const matchCategory =
      currentCategoryFilter === "全部" || category === currentCategoryFilter;

    const matchKeyword =
      !keyword ||
      name.toLowerCase().includes(keyword) ||
      category.toLowerCase().includes(keyword);

    return matchCategory && matchKeyword;
  });
}

/* =========================
   Category Manager
========================= */

async function addCategory() {
  const name = newCategoryName.value.trim();

  if (!name) {
    alert("請輸入分類名稱");
    return;
  }

  const exists = getCategoryItems().some(category => category.name === name);

  if (exists) {
    alert("這個分類已經存在");
    return;
  }

  try {
    const now = Date.now();
    const newRef = push(categoriesRef);

    await set(newRef, {
      name,
      enabled: true,
      sortOrder: now,
      createdAt: now,
      updatedAt: now
    });

    newCategoryName.value = "";
  } catch (error) {
    console.error("新增分類失敗：", error);
    alert("新增分類失敗");
  }
}

async function renameCategory(categoryId, oldName) {
  const category = categoriesData[categoryId];

  if (!category && !String(categoryId).startsWith("legacy-")) return;

  const nextName = prompt("請輸入新的分類名稱", oldName);
  if (!nextName) return;

  const cleanName = nextName.trim();
  if (!cleanName) return;
  if (cleanName === oldName) return;

  const duplicate = getCategoryItems().some(category => category.name === cleanName);

  if (duplicate) {
    alert("這個分類名稱已經存在");
    return;
  }

  const now = Date.now();
  const updates = {};

  if (String(categoryId).startsWith("legacy-")) {
    const newRef = push(categoriesRef);

    updates[`categories/${newRef.key}`] = {
      name: cleanName,
      enabled: true,
      sortOrder: getCategoryOrderByName(oldName),
      createdAt: now,
      updatedAt: now
    };
  } else {
    updates[`categories/${categoryId}/name`] = cleanName;
    updates[`categories/${categoryId}/updatedAt`] = now;
  }

  getMenuItems()
    .filter(item => (item.category || "未分類") === oldName)
    .forEach(item => {
      updates[`menu/${item.id}/category`] = cleanName;
      updates[`menu/${item.id}/updatedAt`] = now;
    });

  try {
    await update(ref(db), updates);

    if (currentCategoryFilter === oldName) {
      currentCategoryFilter = cleanName;
    }
  } catch (error) {
    console.error("分類改名失敗：", error);
    alert("分類改名失敗");
  }
}

async function toggleCategory(categoryId, name) {
  const now = Date.now();
  const updates = {};

  if (String(categoryId).startsWith("legacy-")) {
    const newRef = push(categoriesRef);

    updates[`categories/${newRef.key}`] = {
      name,
      enabled: false,
      sortOrder: getCategoryOrderByName(name),
      createdAt: now,
      updatedAt: now
    };
  } else {
    const current = categoriesData[categoryId];
    updates[`categories/${categoryId}/enabled`] = !(current.enabled !== false);
    updates[`categories/${categoryId}/updatedAt`] = now;
  }

  try {
    await update(ref(db), updates);
  } catch (error) {
    console.error("分類顯示狀態更新失敗：", error);
    alert("分類顯示狀態更新失敗");
  }
}

async function deleteCategory(categoryId, name) {
  const relatedItems = getMenuItems().filter(item => (item.category || "未分類") === name);

  if (relatedItems.length > 0) {
    alert(`「${name}」分類底下還有 ${relatedItems.length} 個餐點，請先移動或刪除餐點後再刪除分類。`);
    return;
  }

  if (String(categoryId).startsWith("legacy-")) {
    alert("這是由舊餐點資料產生的分類，沒有獨立分類資料可刪除。");
    return;
  }

  const ok = confirm(`確定要刪除分類「${name}」嗎？`);
  if (!ok) return;

  try {
    await remove(ref(db, `categories/${categoryId}`));

    if (currentCategoryFilter === name) {
      currentCategoryFilter = "全部";
    }
  } catch (error) {
    console.error("刪除分類失敗：", error);
    alert("刪除分類失敗");
  }
}

async function reorderCategory(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;

  const categories = getCategoryItems();

  const fromIndex = categories.findIndex(category => category.id === fromId);
  const toIndex = categories.findIndex(category => category.id === toId);

  if (fromIndex < 0 || toIndex < 0) return;

  const moved = categories.splice(fromIndex, 1)[0];
  categories.splice(toIndex, 0, moved);

  const updates = {};
  const now = Date.now();

  categories.forEach((category, index) => {
    const order = index * 1000;

    if (String(category.id).startsWith("legacy-")) {
      const newRef = push(categoriesRef);

      updates[`categories/${newRef.key}`] = {
        name: category.name,
        enabled: category.enabled !== false,
        sortOrder: order,
        createdAt: now,
        updatedAt: now
      };
    } else {
      updates[`categories/${category.id}/sortOrder`] = order;
      updates[`categories/${category.id}/updatedAt`] = now;
    }

    getMenuItems()
      .filter(item => (item.category || "未分類") === category.name)
      .forEach(item => {
        updates[`menu/${item.id}/categoryOrder`] = order;
        updates[`menu/${item.id}/updatedAt`] = now;
      });
  });

  try {
    await update(ref(db), updates);
  } catch (error) {
    console.error("分類排序失敗：", error);
    alert("分類排序失敗");
  }
}

/* =========================
   Form
========================= */

function resetForm() {
  editingId = null;

  itemName.value = "";
  itemPrice.value = "";
  itemImage.value = "";
  if (itemImageFile) itemImageFile.value = "";
  renderImagePreview("");

  if (itemDescription) itemDescription.value = "";
  setRequiredOptionToForm(null);

  sizeRows = [];
  addonRows = [];
  removeOptionRows = [];
  renderSizeEditor();
  renderAddonEditor();
  renderRemoveOptionEditor();

  formTitle.textContent = "新增餐點";
  addItemBtn.textContent = "新增餐點";
  cancelEditBtn.style.display = "none";

  renderCategorySelect();
}

function renderCategorySelect() {
  const categories = getCategoryItems();

  if (categories.length === 0) {
    itemCategory.innerHTML = `<option value="">請先新增分類</option>`;
    return;
  }

  const currentValue = itemCategory.value;

  itemCategory.innerHTML = categories.map(category => `
    <option value="${escapeHtml(category.name)}">
      ${escapeHtml(category.name)}${category.enabled === false ? "（已隱藏）" : ""}
    </option>
  `).join("");

  if (currentValue && categories.some(category => category.name === currentValue)) {
    itemCategory.value = currentValue;
  }
}

async function saveItem() {
  const name = itemName.value.trim();
  const category = itemCategory.value.trim();
  const price = Number(itemPrice.value);
  let image = itemImage.value.trim();
  const description = itemDescription ? itemDescription.value.trim() : "";
  const options = getOptionsFromAddonRows();
  const sizes = getSizesFromRows();
  const removeOptions = getRemoveOptionsFromRows();
  const requiredOption = getRequiredOptionFromForm();

  if (!name) {
    alert("請輸入餐點名稱");
    return;
  }

  if (!category) {
    alert("請選擇分類");
    return;
  }

  if (!price || price <= 0) {
    alert("請輸入正確價格");
    return;
  }

  const now = Date.now();
  const oldItem = editingId ? menuData[editingId] : null;
  const foundCategory = findCategoryByName(category);

  const updates = {};

  try {
    addItemBtn.disabled = true;
    addItemBtn.textContent = "圖片處理中...";

    image = await uploadMenuImageIfNeeded();

    const itemData = {
      name,
      category,
      price,
      image,
      sizes,
      description,
      options,
      removeOptions,
      requiredOption,
      enabled: oldItem ? oldItem.enabled !== false : true,
      categoryOrder: getCategoryOrderByName(category),
      sortOrder: oldItem ? Number(oldItem.sortOrder !== undefined ? oldItem.sortOrder : now) : now,
      updatedAt: now
    };

    addItemBtn.textContent = "儲存中...";

    if (!foundCategory) {
      const newCategoryRef = push(categoriesRef);

      updates[`categories/${newCategoryRef.key}`] = {
        name: category,
        enabled: true,
        sortOrder: Date.now(),
        createdAt: now,
        updatedAt: now
      };
    }

    if (editingId) {
      updates[`menu/${editingId}`] = {
        ...oldItem,
        ...itemData
      };

      await update(ref(db), updates);
      alert("餐點已更新");
    } else {
      const newItemRef = push(menuRef);

      updates[`menu/${newItemRef.key}`] = {
        ...itemData,
        createdAt: now
      };

      await update(ref(db), updates);
      alert("餐點已新增");
    }

    resetForm();
  } catch (err) {
    console.error("儲存餐點失敗：", err);
    alert("儲存失敗，請看 Console");
  } finally {
    addItemBtn.disabled = false;
    addItemBtn.textContent = editingId ? "更新餐點" : "新增餐點";
  }
}

function editItem(id) {
  const item = menuData[id];

  if (!item) return;

  editingId = id;

  renderCategorySelect();

  itemName.value = item.name || "";
  itemCategory.value = item.category || "";
  itemPrice.value = item.price || "";
  itemImage.value = item.image || "";
  if (itemImageFile) itemImageFile.value = "";
  renderImagePreview(item.image || "");

  if (itemDescription) {
    itemDescription.value = item.description || "";
  }

  setRequiredOptionToForm(item.requiredOption || null);
  setSizeRowsFromSizes(item.sizes || {});
  setAddonRowsFromOptions(item.options || {});
  setRemoveOptionRows(item.removeOptions || []);

  formTitle.textContent = `編輯餐點｜${item.name || ""}`;
  addItemBtn.textContent = "更新餐點";
  cancelEditBtn.style.display = "block";

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================
   Item Actions
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
    console.error("上下架失敗：", err);
    alert("上下架失敗");
  }
}

async function deleteItem(id) {
  const item = menuData[id];

  if (!item) return;

  const ok = confirm(`確定要刪除「${item.name}」嗎？`);
  if (!ok) return;

  try {
    await remove(ref(db, `menu/${id}`));

    if (editingId === id) resetForm();
  } catch (err) {
    console.error("刪除失敗：", err);
    alert("刪除失敗");
  }
}

async function reorderItem(category, fromId, toId) {
  if (!category || !fromId || !toId || fromId === toId) return;

  const grouped = groupItems();
  const items = grouped[category] || [];

  const fromIndex = items.findIndex(item => item.id === fromId);
  const toIndex = items.findIndex(item => item.id === toId);

  if (fromIndex < 0 || toIndex < 0) return;

  const moved = items.splice(fromIndex, 1)[0];
  items.splice(toIndex, 0, moved);

  const updates = {};
  const now = Date.now();

  items.forEach((item, index) => {
    updates[`menu/${item.id}/sortOrder`] = index * 1000;
    updates[`menu/${item.id}/updatedAt`] = now;
  });

  try {
    await update(ref(db), updates);
  } catch (err) {
    console.error("餐點排序失敗：", err);
    alert("餐點排序失敗");
  }
}

/* =========================
   Render
========================= */

function renderCategoryManager() {
  const categories = getCategoryItems();

  if (categories.length === 0) {
    categoryManagerList.innerHTML = `<div class="empty">尚未建立分類</div>`;
    return;
  }

  categoryManagerList.innerHTML = categories.map(category => `
    <div
      class="category-manager-card ${category.enabled === false ? "disabled" : ""}"
      draggable="true"
      data-category-id="${escapeHtml(category.id)}"
    >
      <div class="category-manager-main">
        <span class="drag-icon">☰</span>
        <div>
          <strong>${escapeHtml(category.name)}</strong>
          <p>${category.enabled === false ? "已隱藏" : "顯示中"}${category.legacy ? "｜舊資料分類" : ""}</p>
        </div>
      </div>

      <div class="admin-move-actions">
        <button data-action="moveUp" data-id="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}">上移</button>
        <button data-action="moveDown" data-id="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}">下移</button>
      </div>

      <div class="category-manager-actions">
        <button data-action="rename" data-id="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}">改名</button>
        <button data-action="toggle" data-id="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}">
          ${category.enabled === false ? "顯示" : "隱藏"}
        </button>
        <button class="danger-btn" data-action="delete" data-id="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}">刪除</button>
      </div>
    </div>
  `).join("");

  categoryManagerList.querySelectorAll(".category-manager-card").forEach(card => {
    card.addEventListener("dragstart", event => {
      draggedCategoryId = card.dataset.categoryId;
      event.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragover", event => {
      event.preventDefault();
    });

    card.addEventListener("drop", event => {
      event.preventDefault();
      reorderCategory(draggedCategoryId, card.dataset.categoryId);
      draggedCategoryId = null;
    });
  });

  categoryManagerList.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", event => {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      const action = button.dataset.action;
      const id = button.dataset.id;
      const name = button.dataset.name;

      if (action === "moveUp") moveCategoryByButton(id, -1);
      if (action === "moveDown") moveCategoryByButton(id, 1);
      if (action === "rename") renameCategory(id, name);
      if (action === "toggle") toggleCategory(id, name);
      if (action === "delete") deleteCategory(id, name);
    });
  });
}

function renderCategoryFilters() {
  const categories = getCategoryItems();

  categoryFilterList.innerHTML = [
    `<button class="${currentCategoryFilter === "全部" ? "active" : ""}" data-category="全部">全部</button>`,
    ...categories.map(category => `
      <button class="${currentCategoryFilter === category.name ? "active" : ""}" data-category="${escapeHtml(category.name)}">
        ${escapeHtml(category.name)}${category.enabled === false ? "（隱藏）" : ""}
      </button>
    `)
  ].join("");

  categoryFilterList.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      currentCategoryFilter = button.dataset.category;
      renderMenu();
    });
  });
}

function renderMenu() {
  if (!menuList) return;

  const allItems = getMenuItems();

  if (allItems.length === 0) {
    menuList.innerHTML = `<div class="empty">目前沒有菜單資料</div>`;
    renderCategoryManager();
    renderCategorySelect();
    renderCategoryFilters();
    renderSizeEditor();
    renderAddonEditor();
    renderRemoveOptionEditor();
    return;
  }

  const grouped = groupItems();
  const categories = getCategoryItems();

  const html = categories.map(categoryData => {
    const category = categoryData.name;
    const items = getFilteredItems(grouped[category] || []);

    if (items.length === 0) return "";

    return `
      <section class="admin-category-block ${categoryData.enabled === false ? "category-hidden" : ""}">
        <div class="admin-category-head">
          <h3>${escapeHtml(category)} ${categoryData.enabled === false ? "（已隱藏）" : ""}</h3>
          <span>${items.length} 項餐點</span>
        </div>

        <div class="admin-card-grid">
          ${items.map(item => renderMenuCard(item, category)).join("")}
        </div>
      </section>
    `;
  }).join("");

  menuList.innerHTML = html || `<div class="empty">找不到符合條件的餐點</div>`;

  bindMenuCardDragEvents();

  renderCategoryManager();
  renderCategorySelect();
  renderCategoryFilters();
  renderSizeEditor();
  renderAddonEditor();
}

function renderMenuCard(item, category) {
  const image = item.image || item.imageUrl || "";

  const descriptionText = item.description || "尚未填寫餐點描述";

  const requiredOptionText = item.requiredOption && item.requiredOption.title
    ? `${item.requiredOption.title}：${(item.requiredOption.options || []).join("、")}`
    : "無必選項目";

  const sizesText =
    item.sizes && Object.keys(item.sizes).length > 0
      ? Object.entries(item.sizes).map(([name, price]) => `${name} ${money(price)}`).join("、")
      : "一般：" + money(item.price || 0);

  const optionsText =
    item.options && Object.keys(item.options).length > 0
      ? Object.entries(item.options).map(([name, price]) => `${name} +${price}`).join("、")
      : "無加料";

  const removeOptionsText = Array.isArray(item.removeOptions) && item.removeOptions.length > 0
    ? item.removeOptions.join("、")
    : "無不要項目";

  return `
    <article
      class="admin-menu-card-v57 ${item.enabled === false ? "disabled" : ""}"
      draggable="true"
      data-id="${escapeHtml(item.id)}"
      data-category="${escapeHtml(category)}"
    >
      <div class="admin-card-image">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name || "餐點圖片")}">`
            : `<div class="admin-no-image">恩點</div>`
        }
      </div>

      <div class="admin-card-body">
        <div class="admin-card-title-row">
          <div>
            <strong>${escapeHtml(item.name || "未命名餐點")}</strong>
            <p>${escapeHtml(category)}</p>
          </div>
          <span class="admin-status ${item.enabled === false ? "off" : "on"}">
            ${item.enabled === false ? "下架" : "上架"}
          </span>
        </div>

        <div class="admin-price">${money(item.price)}</div>

        <div class="admin-description">
          ${escapeHtml(descriptionText)}
        </div>

        <div class="admin-options">
          份量：${escapeHtml(sizesText)}
        </div>

        <div class="admin-required-option">
          必選：${escapeHtml(requiredOptionText)}
        </div>

        <div class="admin-options">
          加料：${escapeHtml(optionsText)}
        </div>

        <div class="admin-options">
          不要：${escapeHtml(removeOptionsText)}
        </div>

        <div class="admin-move-actions">
          <button data-action="moveUp" data-id="${escapeHtml(item.id)}" data-category="${escapeHtml(category)}">上移</button>
          <button data-action="moveDown" data-id="${escapeHtml(item.id)}" data-category="${escapeHtml(category)}">下移</button>
        </div>

        <div class="admin-actions">
          <button data-action="edit" data-id="${escapeHtml(item.id)}">編輯</button>
          <button data-action="toggle" data-id="${escapeHtml(item.id)}">
            ${item.enabled === false ? "上架" : "下架"}
          </button>
          <button class="danger-btn" data-action="delete" data-id="${escapeHtml(item.id)}">刪除</button>
        </div>
      </div>
    </article>
  `;
}

function bindMenuCardDragEvents() {
  menuList.querySelectorAll(".admin-menu-card-v57").forEach(card => {
    card.addEventListener("dragstart", event => {
      draggedItemId = card.dataset.id;
      draggedItemCategory = card.dataset.category;
      event.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragover", event => {
      event.preventDefault();
    });

    card.addEventListener("drop", event => {
      event.preventDefault();

      const targetId = card.dataset.id;
      const targetCategory = card.dataset.category;

      if (draggedItemCategory !== targetCategory) {
        alert("目前先支援同分類內餐點排序。要移到其他分類，請用編輯修改分類。");
        return;
      }

      reorderItem(targetCategory, draggedItemId, targetId);

      draggedItemId = null;
      draggedItemCategory = null;
    });
  });

  menuList.querySelectorAll(".admin-actions button, .admin-move-actions button").forEach(button => {
    button.onclick = function(event) {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      const action = button.dataset.action;
      const id = button.dataset.id;
      const category = button.dataset.category;

      if (action === "moveUp") moveMenuItemByButton(id, category, -1);
      if (action === "moveDown") moveMenuItemByButton(id, category, 1);
      if (action === "edit") editItem(id);
      if (action === "toggle") toggleItem(id);
      if (action === "delete") deleteItem(id);
      return false;
    };
  });
}

/* =========================
   Firebase
========================= */

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderMenu();
});

onValue(categoriesRef, snapshot => {
  categoriesData = snapshot.exists() ? snapshot.val() : {};
  renderMenu();
});

/* =========================
   Events
========================= */

addCategoryBtn.addEventListener("click", addCategory);

newCategoryName.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    addCategory();
  }
});

if (addSizeRowBtn) {
  addSizeRowBtn.addEventListener("click", addSizeRow);
}

if (addAddonRowBtn) {
  addAddonRowBtn.addEventListener("click", addAddonRow);
}

if (addRemoveOptionRowBtn) {
  addRemoveOptionRowBtn.addEventListener("click", addRemoveOptionRow);
}

addItemBtn.addEventListener("click", saveItem);
cancelEditBtn.addEventListener("click", resetForm);
menuSearchInput.addEventListener("input", renderMenu);

if (itemImageFile) {
  itemImageFile.addEventListener("change", function() {
    if (itemImageFile.files && itemImageFile.files[0]) {
      try { renderImagePreview(URL.createObjectURL(itemImageFile.files[0])); } catch(e) {}
    }
  });
}

resetForm();

/* =====================================================
   v60 FINAL ADMIN ITEM MOVE
   目的：舊平板點「餐點上移／下移」一定有反應。
===================================================== */
async function adminMoveMenuItemFinal(itemId, category, direction) {
  if (!itemId || !category) return false;

  var grouped = groupItems();
  var items = grouped[category] || [];
  var index = items.findIndex(function(item) {
    return String(item.id) === String(itemId);
  });

  if (index < 0) return false;

  var targetIndex = index + Number(direction || 0);
  if (targetIndex < 0 || targetIndex >= items.length) return false;

  var moved = items.splice(index, 1)[0];
  items.splice(targetIndex, 0, moved);

  var updates = {};
  var nowTime = Date.now ? Date.now() : new Date().getTime();

  items.forEach(function(item, nextIndex) {
    updates["menu/" + item.id + "/sortOrder"] = (nextIndex + 1) * 1000;
    updates["menu/" + item.id + "/updatedAt"] = nowTime;
  });

  try {
    await update(ref(db), updates);
    return true;
  } catch (error) {
    console.error("餐點上移下移失敗：", error);
    alert("餐點排序失敗");
    return false;
  }
}

window.adminMoveMenuItemFinal = adminMoveMenuItemFinal;

(function () {
  if (typeof document === "undefined") return;
  var lastTouchAt = 0;

  function closestMoveButton(el) {
    while (el && el !== document) {
      if (el.getAttribute) {
        var action = el.getAttribute("data-action");
        if (action === "moveUp" || action === "moveDown") return el;
      }
      el = el.parentNode;
    }
    return null;
  }

  function stop(e) {
    if (!e) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function handle(e) {
    var button = closestMoveButton(e.target || e.srcElement);
    if (!button) return;

    var id = button.getAttribute("data-id");
    var category = button.getAttribute("data-category");
    if (!id || !category) return;

    if (e.type === "click" && (Date.now ? Date.now() : new Date().getTime()) - lastTouchAt < 700) {
      stop(e);
      return false;
    }

    if (e.type === "touchend") lastTouchAt = Date.now ? Date.now() : new Date().getTime();

    stop(e);
    var action = button.getAttribute("data-action");
    var direction = action === "moveUp" ? -1 : 1;
    adminMoveMenuItemFinal(id, category, direction);
    return false;
  }

  document.addEventListener("touchend", handle, true);
  document.addEventListener("click", handle, true);
})();
