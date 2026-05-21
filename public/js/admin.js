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
   恩點系統 v57｜菜單後台商業版
========================= */

const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemPrice = document.getElementById("itemPrice");
const itemImage = document.getElementById("itemImage");
const itemOptions = document.getElementById("itemOptions");
const addItemBtn = document.getElementById("addItemBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const formTitle = document.getElementById("formTitle");

const menuSearchInput = document.getElementById("menuSearchInput");
const categoryFilterList = document.getElementById("categoryFilterList");
const categorySortList = document.getElementById("categorySortList");
const menuList = document.getElementById("menuList");

const menuRef = ref(db, "menu");

let menuData = {};
let editingId = null;
let currentCategoryFilter = "全部";

let draggedCategory = null;
let draggedItemId = null;
let draggedItemCategory = null;

/* =========================
   Helpers
========================= */

function money(n) {
  return `NT$${Number(n || 0)}`;
}

function parseOptions(text) {
  const options = {};

  if (!text || !text.trim()) return options;

  text.split(",").forEach(part => {
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

function optionsToText(options = {}) {
  return Object.entries(options)
    .map(([name, price]) => `${name}:${price}`)
    .join(",");
}

function getMenuItems() {
  return Object.entries(menuData).map(([id, item]) => ({
    id,
    ...item
  }));
}

function getCategoryOrder(category) {
  const items = getMenuItems().filter(item => (item.category || "未分類") === category);

  const existingOrder = items
    .map(item => Number(item.categoryOrder))
    .filter(n => !Number.isNaN(n));

  if (existingOrder.length > 0) {
    return Math.min(...existingOrder);
  }

  return Date.now();
}

function getCategories() {
  const map = {};

  getMenuItems().forEach(item => {
    const category = item.category || "未分類";

    if (!map[category]) {
      map[category] = {
        name: category,
        order: Number(item.categoryOrder ?? 999999999)
      };
    }

    map[category].order = Math.min(map[category].order, Number(item.categoryOrder ?? 999999999));
  });

  return Object.values(map).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
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
      const orderA = Number(a.sortOrder ?? 999999999);
      const orderB = Number(b.sortOrder ?? 999999999);

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
   Form
========================= */

function resetForm() {
  editingId = null;

  itemName.value = "";
  itemCategory.value = "";
  itemPrice.value = "";
  itemImage.value = "";
  itemOptions.value = "";

  formTitle.textContent = "新增餐點";
  addItemBtn.textContent = "新增餐點";
  cancelEditBtn.style.display = "none";
}

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

  const now = Date.now();

  const oldItem = editingId ? menuData[editingId] : null;

  const itemData = {
    name,
    category,
    price,
    image,
    options,
    enabled: oldItem ? oldItem.enabled !== false : true,
    categoryOrder:
      oldItem && oldItem.category === category
        ? Number(oldItem.categoryOrder || getCategoryOrder(category))
        : getCategoryOrder(category),
    sortOrder: oldItem ? Number(oldItem.sortOrder || now) : now,
    updatedAt: now
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
        createdAt: now
      });
      alert("餐點已新增");
    }

    resetForm();
  } catch (err) {
    console.error("儲存餐點失敗：", err);
    alert("儲存失敗，請看 Console");
  } finally {
    addItemBtn.disabled = false;
  }
}

function editItem(id) {
  const item = menuData[id];

  if (!item) return;

  editingId = id;

  itemName.value = item.name || "";
  itemCategory.value = item.category || "";
  itemPrice.value = item.price || "";
  itemImage.value = item.image || "";
  itemOptions.value = optionsToText(item.options || {});

  formTitle.textContent = `編輯餐點｜${item.name || ""}`;
  addItemBtn.textContent = "更新餐點";
  cancelEditBtn.style.display = "block";

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================
   Actions
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

/* =========================
   Drag Sort
========================= */

async function saveCategoryOrder(newCategories) {
  const updates = {};
  const now = Date.now();

  newCategories.forEach((category, index) => {
    getMenuItems()
      .filter(item => (item.category || "未分類") === category)
      .forEach(item => {
        updates[`menu/${item.id}/categoryOrder`] = index * 1000;
        updates[`menu/${item.id}/updatedAt`] = now;
      });
  });

  await update(ref(db), updates);
}

async function reorderCategory(fromCategory, toCategory) {
  if (!fromCategory || !toCategory || fromCategory === toCategory) return;

  const categories = getCategories().map(category => category.name);

  const fromIndex = categories.indexOf(fromCategory);
  const toIndex = categories.indexOf(toCategory);

  if (fromIndex < 0 || toIndex < 0) return;

  const moved = categories.splice(fromIndex, 1)[0];
  categories.splice(toIndex, 0, moved);

  try {
    await saveCategoryOrder(categories);
  } catch (err) {
    console.error("分類排序失敗：", err);
    alert("分類排序失敗");
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

function renderCategoryFilters() {
  const categories = getCategories();

  categoryFilterList.innerHTML = [
    `<button class="${currentCategoryFilter === "全部" ? "active" : ""}" onclick="setCategoryFilter('全部')">全部</button>`,
    ...categories.map(category => `
      <button class="${currentCategoryFilter === category.name ? "active" : ""}" onclick="setCategoryFilter('${category.name}')">
        ${category.name}
      </button>
    `)
  ].join("");
}

function renderCategorySortList() {
  const categories = getCategories();

  if (categories.length === 0) {
    categorySortList.innerHTML = "";
    return;
  }

  categorySortList.innerHTML = categories.map(category => `
    <div
      class="admin-category-pill"
      draggable="true"
      data-category="${category.name}"
      ondragstart="handleCategoryDragStart(event, '${category.name}')"
      ondragover="handleDragOver(event)"
      ondrop="handleCategoryDrop(event, '${category.name}')"
    >
      <span class="drag-icon">☰</span>
      <span>${category.name}</span>
    </div>
  `).join("");
}

function renderMenu() {
  if (!menuList) return;

  const allItems = getMenuItems();

  if (allItems.length === 0) {
    menuList.innerHTML = `<div class="empty">目前沒有菜單資料</div>`;
    renderCategoryFilters();
    renderCategorySortList();
    return;
  }

  const grouped = groupItems();
  const categories = getCategories();

  const html = categories.map(categoryData => {
    const category = categoryData.name;
    const items = getFilteredItems(grouped[category] || []);

    if (items.length === 0) return "";

    return `
      <section class="admin-category-block">
        <div class="admin-category-head">
          <h3>${category}</h3>
          <span>${items.length} 項餐點</span>
        </div>

        <div class="admin-card-grid">
          ${items.map(item => renderMenuCard(item, category)).join("")}
        </div>
      </section>
    `;
  }).join("");

  menuList.innerHTML = html || `<div class="empty">找不到符合條件的餐點</div>`;

  renderCategoryFilters();
  renderCategorySortList();
}

function renderMenuCard(item, category) {
  const image = item.image || item.imageUrl || "";
  const optionsText =
    item.options && Object.keys(item.options).length > 0
      ? Object.entries(item.options).map(([name, price]) => `${name} +${price}`).join("、")
      : "無加料";

  return `
    <article
      class="admin-menu-card-v57 ${item.enabled === false ? "disabled" : ""}"
      draggable="true"
      data-id="${item.id}"
      data-category="${category}"
      ondragstart="handleItemDragStart(event, '${item.id}', '${category}')"
      ondragover="handleDragOver(event)"
      ondrop="handleItemDrop(event, '${item.id}', '${category}')"
    >
      <div class="admin-card-image">
        ${
          image
            ? `<img src="${image}" alt="${item.name || "餐點圖片"}">`
            : `<div class="admin-no-image">恩點</div>`
        }
      </div>

      <div class="admin-card-body">
        <div class="admin-card-title-row">
          <div>
            <strong>${item.name || "未命名餐點"}</strong>
            <p>${category}</p>
          </div>
          <span class="admin-status ${item.enabled === false ? "off" : "on"}">
            ${item.enabled === false ? "下架" : "上架"}
          </span>
        </div>

        <div class="admin-price">${money(item.price)}</div>

        <div class="admin-options">
          ${optionsText}
        </div>

        <div class="admin-actions">
          <button onclick="editItem('${item.id}')">編輯</button>
          <button onclick="toggleItem('${item.id}')">
            ${item.enabled === false ? "上架" : "下架"}
          </button>
          <button class="danger-btn" onclick="deleteItem('${item.id}')">刪除</button>
        </div>
      </div>
    </article>
  `;
}

/* =========================
   Window Events
========================= */

function setCategoryFilter(category) {
  currentCategoryFilter = category;
  renderMenu();
}

function handleCategoryDragStart(event, category) {
  draggedCategory = category;
  event.dataTransfer.effectAllowed = "move";
}

function handleCategoryDrop(event, targetCategory) {
  event.preventDefault();
  reorderCategory(draggedCategory, targetCategory);
  draggedCategory = null;
}

function handleItemDragStart(event, itemId, category) {
  draggedItemId = itemId;
  draggedItemCategory = category;
  event.dataTransfer.effectAllowed = "move";
}

function handleItemDrop(event, targetId, targetCategory) {
  event.preventDefault();

  if (draggedItemCategory !== targetCategory) {
    alert("目前先支援同分類內餐點排序。要移到其他分類，請用編輯修改分類。");
    return;
  }

  reorderItem(targetCategory, draggedItemId, targetId);

  draggedItemId = null;
  draggedItemCategory = null;
}

function handleDragOver(event) {
  event.preventDefault();
}

/* =========================
   Firebase
========================= */

onValue(menuRef, snapshot => {
  menuData = snapshot.exists() ? snapshot.val() : {};
  renderMenu();
});

/* =========================
   Events
========================= */

addItemBtn.addEventListener("click", saveItem);
cancelEditBtn.addEventListener("click", resetForm);

menuSearchInput.addEventListener("input", renderMenu);

resetForm();

/* =========================
   Expose
========================= */

window.editItem = editItem;
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;

window.setCategoryFilter = setCategoryFilter;

window.handleCategoryDragStart = handleCategoryDragStart;
window.handleCategoryDrop = handleCategoryDrop;
window.handleItemDragStart = handleItemDragStart;
window.handleItemDrop = handleItemDrop;
window.handleDragOver = handleDragOver;