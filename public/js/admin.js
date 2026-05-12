import {
  db,
  ref,
  push,
  set,
  update,
  remove,
  onValue
} from "./firebase.js";

const menuRef = ref(db, "menu");

const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemPrice = document.getElementById("itemPrice");
const itemImage = document.getElementById("itemImage");
const itemOptions = document.getElementById("itemOptions");
const addItemBtn = document.getElementById("addItemBtn");
const menuList = document.getElementById("menuList");

function parseOptions(text) {
  const options = {};

  if (!text.trim()) return options;

  const parts = text.split(",");

  parts.forEach(part => {
    const [name, price] = part.split(":");

    if (name && price) {
      options[name.trim()] = Number(price.trim());
    }
  });

  return options;
}

function clearForm() {
  itemName.value = "";
  itemCategory.value = "";
  itemPrice.value = "";
  itemImage.value = "";
  itemOptions.value = "";
}

addItemBtn.addEventListener("click", async () => {
  const name = itemName.value.trim();
  const category = itemCategory.value.trim();
  const price = Number(itemPrice.value);
  const image = itemImage.value.trim();
  const options = parseOptions(itemOptions.value);

  if (!name || !category || !price) {
    alert("請填寫餐點名稱、分類、價格");
    return;
  }

  const newItemRef = push(menuRef);

  await set(newItemRef, {
    name,
    category,
    price,
    image,
    options,
    enabled: true,
    createdAt: Date.now()
  });

  clearForm();
  alert("餐點新增成功");
});

onValue(menuRef, snapshot => {
  menuList.innerHTML = "";

  if (!snapshot.exists()) {
    menuList.innerHTML = "<p>目前還沒有菜單。</p>";
    return;
  }

  const data = snapshot.val();

  Object.entries(data).forEach(([id, item]) => {
    const card = document.createElement("div");
    card.className = "menu-card";

    card.innerHTML = `
      <div>
        <h3>${item.name}</h3>
        <p>分類：${item.category}</p>
        <p>價格：$${item.price}</p>
        <p>狀態：${item.enabled ? "上架中" : "已下架"}</p>
      </div>

      <div class="card-actions">
        <button data-id="${id}" data-enabled="${item.enabled}" class="toggle-btn">
          ${item.enabled ? "下架" : "上架"}
        </button>
        <button data-id="${id}" class="delete-btn">刪除</button>
      </div>
    `;

    menuList.appendChild(card);
  });

  document.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const nowEnabled = btn.dataset.enabled === "true";

      await update(ref(db, `menu/${id}`), {
        enabled: !nowEnabled
      });
    });
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;

      if (confirm("確定要刪除這個餐點嗎？")) {
        await remove(ref(db, `menu/${id}`));
      }
    });
  });
});