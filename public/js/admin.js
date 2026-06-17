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
const adminTabButtons = document.querySelectorAll(".admin-tab-btn");
const adminTabPanels = document.querySelectorAll(".admin-tab-panel");
const adminSharedActions = document.getElementById("adminSharedActions");
const itemTemplateSelect = document.getElementById("itemTemplateSelect");
const applyTemplateBtn = document.getElementById("applyTemplateBtn");
const templateFormTitle = document.getElementById("templateFormTitle");
const templateNameInput = document.getElementById("templateNameInput");
const templateSizesInput = document.getElementById("templateSizesInput");
const templateRequiredTitleInput = document.getElementById("templateRequiredTitleInput");
const templateRequiredChoicesInput = document.getElementById("templateRequiredChoicesInput");
const templateAddonsInput = document.getElementById("templateAddonsInput");
const templateRemoveOptionsInput = document.getElementById("templateRemoveOptionsInput");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const cancelTemplateEditBtn = document.getElementById("cancelTemplateEditBtn");
const optionTemplateList = document.getElementById("optionTemplateList");
let openNewItemModalBtn = document.getElementById("openNewItemModalBtn");
const itemEditorModal = document.getElementById("itemEditorModal") || document.querySelector("#itemAdminTab .admin-form-panel");
let templateSizesRows = document.getElementById("templateSizesRows");
let templateAddonsRows = document.getElementById("templateAddonsRows");
let addTemplateSizeRowBtn = document.getElementById("addTemplateSizeRowBtn");
let addTemplateAddonRowBtn = document.getElementById("addTemplateAddonRowBtn");
let templateRemoveRows = document.getElementById("templateRemoveRows");
let templateRequiredRows = document.getElementById("templateRequiredRows");
let addTemplateRemoveRowBtn = document.getElementById("addTemplateRemoveRowBtn");
let addTemplateRequiredRowBtn = document.getElementById("addTemplateRequiredRowBtn");
let adminOptionGridHome = null;
let adminOptionGridHomeNext = null;
let adminOptionGrid = null;
let adminModalOptionHeading = null;
let itemEditorHome = null;
let itemEditorHomeNext = null;
let itemEditorMode = "hidden";

const menuRef = ref(db, "menu");
const categoriesRef = ref(db, "categories");
const optionTemplatesRef = ref(db, "optionTemplates");

let menuData = {};
let categoriesData = {};
let optionTemplatesData = {};
let editingId = null;
let editingTemplateId = null;
let currentCategoryFilter = "全部";

let draggedCategoryId = null;
let draggedItemId = null;
let draggedItemCategory = null;

let sizeRows = [];
let addonRows = [];
let removeOptionRows = [];
let requiredGroupRows = [];
let templateRequiredGroupRows = [];

/* =========================
   Helpers
========================= */

function money(n) {
  return `NT$${Number(n || 0)}`;
}

function switchAdminTab(tabId) {
  if (!tabId) return;

  for (var i = 0; i < adminTabButtons.length; i += 1) {
    var button = adminTabButtons[i];
    var isActiveButton = button.getAttribute("data-admin-tab") === tabId;
    if (button.classList) {
      if (isActiveButton) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    } else {
      button.className = isActiveButton ? "admin-tab-btn active" : "admin-tab-btn";
    }
  }

  for (var j = 0; j < adminTabPanels.length; j += 1) {
    var panel = adminTabPanels[j];
    var isActivePanel = panel.id === tabId;
    if (panel.classList) {
      if (isActivePanel) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    } else {
      panel.className = isActivePanel ? "admin-tab-panel active" : "admin-tab-panel";
    }
  }

  if (adminSharedActions) {
    var shouldHideActions = tabId === "categoryAdminTab" || tabId === "templateAdminTab";
    if (adminSharedActions.classList) {
      if (shouldHideActions) {
        adminSharedActions.classList.add("hidden");
      } else {
        adminSharedActions.classList.remove("hidden");
      }
    } else {
      adminSharedActions.style.display = shouldHideActions ? "none" : "";
    }
  }
}

function getDataValue(element, name) {
  if (!element) return "";
  if (element.dataset && element.dataset[name]) return element.dataset[name];
  return element.getAttribute("data-" + name.replace(/[A-Z]/g, function(match) {
    return "-" + match.toLowerCase();
  }));
}

function findClosestByClass(element, className) {
  var node = element;
  while (node && node !== document) {
    if ((" " + (node.className || "") + " ").indexOf(" " + className + " ") !== -1) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function addAdminTapListener(element, handler) {
  if (!element || !handler) return;

  var lastTouchAt = 0;

  function handleTap(event) {
    var now = Date.now ? Date.now() : new Date().getTime();

    if (event && event.type === "touchend") {
      lastTouchAt = now;
    }

    if (event && event.type === "click" && now - lastTouchAt < 500) {
      return;
    }

    handler(event);
  }

  element.addEventListener("click", handleTap, false);
  element.addEventListener("touchend", handleTap, false);
}

function initAdminV63Ux() {
  const itemTabButton = document.querySelector('[data-admin-tab="itemAdminTab"]');
  const optionTabButton = document.querySelector('[data-admin-tab="optionAdminTab"]');
  const templateTabButton = document.querySelector('[data-admin-tab="templateAdminTab"]');
  const mediaTabButton = document.querySelector('[data-admin-tab="mediaAdminTab"]');

  if (itemTabButton) itemTabButton.textContent = "餐點列表";
  if (optionTabButton) optionTabButton.textContent = "選項管理";
  if (templateTabButton) templateTabButton.textContent = "選項範本";
  if (mediaTabButton) mediaTabButton.style.display = "none";

  const mediaPanel = document.getElementById("mediaAdminTab");
  const optionPanel = document.querySelector("#optionAdminTab .admin-option-panel");
  const mediaForm = mediaPanel ? mediaPanel.querySelector(".admin-form-panel") : null;
  if (itemEditorModal && !itemEditorHome) {
    itemEditorHome = itemEditorModal.parentNode;
    itemEditorHomeNext = itemEditorModal.nextSibling;
  }
  const oldOptionNewItemBtn = document.getElementById("openNewItemFromOptionsBtn");
  if (oldOptionNewItemBtn && oldOptionNewItemBtn.parentNode) {
    oldOptionNewItemBtn.parentNode.removeChild(oldOptionNewItemBtn);
  }
  if (optionPanel && !document.getElementById("openInlineNewItemBtn")) {
    const optionNewItemBtn = document.createElement("button");
    optionNewItemBtn.id = "openInlineNewItemBtn";
    optionNewItemBtn.className = "secondary-btn inline-new-item-btn";
    optionNewItemBtn.type = "button";
    optionNewItemBtn.textContent = "新增餐點";
    const optionTitleRow = optionPanel.querySelector(".panel-title-row");
    if (optionTitleRow) optionTitleRow.appendChild(optionNewItemBtn);
    addAdminTapListener(optionNewItemBtn, openInlineItemCreate);
  }
  if (optionPanel && mediaForm && !document.getElementById("adminMediaInlineBox")) {
    const box = document.createElement("div");
    box.id = "adminMediaInlineBox";
    box.className = "admin-option-card admin-media-inline-box";
    box.innerHTML = "<label>圖片管理</label>";
    ["itemImage", "itemImageFile", "imagePreviewBox", "itemDescription"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const label = el.previousElementSibling && el.previousElementSibling.tagName === "LABEL" ? el.previousElementSibling : null;
      if (label) box.appendChild(label);
      box.appendChild(el);
    });
    const grid = optionPanel.querySelector(".admin-option-grid");
    if (grid) grid.appendChild(box);
  }
  if (mediaPanel) mediaPanel.style.display = "none";

  adminOptionGrid = optionPanel ? optionPanel.querySelector(".admin-option-grid") : null;
  if (adminOptionGrid && !adminOptionGridHome) {
    adminOptionGridHome = adminOptionGrid.parentNode;
    adminOptionGridHomeNext = adminOptionGrid.nextSibling;
  }

  const itemPanel = document.querySelector("#itemAdminTab .admin-menu-panel");
  if (false && itemPanel && !openNewItemModalBtn) {
    openNewItemModalBtn = document.createElement("button");
    openNewItemModalBtn.id = "openNewItemModalBtn";
    openNewItemModalBtn.className = "primary-btn";
    openNewItemModalBtn.type = "button";
    openNewItemModalBtn.textContent = "新增餐點";
    const titleRow = itemPanel.querySelector(".panel-title-row");
    if (titleRow) titleRow.appendChild(openNewItemModalBtn);
  }
  if (openNewItemModalBtn && openNewItemModalBtn.parentNode) {
    openNewItemModalBtn.parentNode.removeChild(openNewItemModalBtn);
    openNewItemModalBtn = null;
  }

  if (itemEditorModal) {
    itemEditorModal.classList.add("item-editor-modal", "hidden");
    itemEditorModal.setAttribute("aria-modal", "true");
    ensureItemModalCloseButton();
    if (requiredOptionTitle) requiredOptionTitle.classList.add("legacy-required-input");
    if (requiredOptionChoices) requiredOptionChoices.classList.add("legacy-required-input");
    ensureRequiredGroupEditor();
    if (adminSharedActions && !itemEditorModal.contains(adminSharedActions)) itemEditorModal.appendChild(adminSharedActions);
  }

  setupTemplateSubtabs();
  ensureTemplateRowEditorNodes();
  setupTemplateRowEditor(templateSizesInput, templateSizesRows, addTemplateSizeRowBtn);
  setupTemplateRowEditor(templateAddonsInput, templateAddonsRows, addTemplateAddonRowBtn);
  setupTemplateNameListEditor(templateRemoveOptionsInput, templateRemoveRows, addTemplateRemoveRowBtn, "名稱");
  setupTemplateRequiredGroupEditor();
}

function ensureTemplateRowEditorNodes() {
  function ensure(textarea, rowsId, buttonId) {
    if (!textarea) return { rows: null, button: null };
    let rows = document.getElementById(rowsId);
    let button = document.getElementById(buttonId);
    if (!rows) {
      rows = document.createElement("div");
      rows.id = rowsId;
      rows.className = "template-row-editor";
      textarea.insertAdjacentElement("afterend", rows);
    }
    if (!button) {
      button = document.createElement("button");
      button.id = buttonId;
      button.className = "secondary-btn";
      button.type = "button";
      button.textContent = "新增";
      rows.insertAdjacentElement("afterend", button);
    }
    return { rows, button };
  }

  const sizeNodes = ensure(templateSizesInput, "templateSizesRows", "addTemplateSizeRowBtn");
  const addonNodes = ensure(templateAddonsInput, "templateAddonsRows", "addTemplateAddonRowBtn");
  const removeNodes = ensure(templateRemoveOptionsInput, "templateRemoveRows", "addTemplateRemoveRowBtn");
  const requiredNodes = ensure(templateRequiredChoicesInput, "templateRequiredRows", "addTemplateRequiredRowBtn");
  templateSizesRows = sizeNodes.rows;
  addTemplateSizeRowBtn = sizeNodes.button;
  templateAddonsRows = addonNodes.rows;
  addTemplateAddonRowBtn = addonNodes.button;
  templateRemoveRows = removeNodes.rows;
  addTemplateRemoveRowBtn = removeNodes.button;
  templateRequiredRows = requiredNodes.rows;
  addTemplateRequiredRowBtn = requiredNodes.button;
  if (addTemplateSizeRowBtn) addTemplateSizeRowBtn.textContent = "新增份量";
  if (addTemplateAddonRowBtn) addTemplateAddonRowBtn.textContent = "新增加料";
  if (addTemplateRemoveRowBtn) addTemplateRemoveRowBtn.textContent = "新增不要項目";
  if (addTemplateRequiredRowBtn) addTemplateRequiredRowBtn.textContent = "新增選項";
}

function openItemEditorModal() {
  if (!itemEditorModal) return;
  restoreItemEditorToHome();
  itemEditorMode = "modal";
  itemEditorModal.classList.remove("item-editor-inline");
  itemEditorModal.classList.add("item-editor-modal");
  moveOptionGridToItemModal();
  itemEditorModal.classList.remove("hidden");
  if (adminSharedActions) adminSharedActions.classList.remove("hidden");
  updateItemEditorActionLabels();
}

function restoreItemEditorToHome() {
  if (!itemEditorModal || !itemEditorHome) return;
  if (itemEditorHomeNext && itemEditorHomeNext.parentNode === itemEditorHome) {
    itemEditorHome.insertBefore(itemEditorModal, itemEditorHomeNext);
  } else {
    itemEditorHome.appendChild(itemEditorModal);
  }
}

function closeItemEditorModal() {
  if (!itemEditorModal) return;
  restoreOptionGridToOptionTab();
  itemEditorMode = "hidden";
  itemEditorModal.classList.remove("item-editor-inline");
  itemEditorModal.classList.add("item-editor-modal");
  itemEditorModal.classList.add("hidden");
}

function openInlineItemCreate(event) {
  if (event && event.preventDefault) event.preventDefault();
  resetForm();
  editingId = null;
  itemEditorMode = "inline";
  restoreOptionGridToOptionTab();
  const optionPanel = document.querySelector("#optionAdminTab .admin-option-panel");
  if (optionPanel && itemEditorModal && itemEditorModal.parentNode !== optionPanel) {
    const grid = optionPanel.querySelector(".admin-option-grid");
    optionPanel.insertBefore(itemEditorModal, grid || null);
  }
  if (itemEditorModal) {
    itemEditorModal.classList.remove("hidden", "item-editor-modal");
    itemEditorModal.classList.add("item-editor-inline");
  }
  if (adminSharedActions && itemEditorModal && !itemEditorModal.contains(adminSharedActions)) {
    itemEditorModal.appendChild(adminSharedActions);
  }
  if (adminSharedActions) adminSharedActions.classList.remove("hidden");
  updateItemEditorActionLabels();
  if (itemName) itemName.focus();
  return false;
}

function hasDirtyItemForm() {
  if (editingId) return true;
  return !!(
    (itemName && itemName.value.trim()) ||
    (itemPrice && itemPrice.value.trim()) ||
    (itemImage && itemImage.value.trim()) ||
    (itemDescription && itemDescription.value.trim()) ||
    (requiredOptionTitle && requiredOptionTitle.value.trim()) ||
    (requiredOptionChoices && requiredOptionChoices.value.trim()) ||
    sizeRows.length ||
    addonRows.length ||
    removeOptionRows.length
  );
}

function cancelItemEditorWithConfirm(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (hasDirtyItemForm() && !confirm("放棄這次新增/編輯？")) return false;
  resetForm();
  closeItemEditorModal();
  return false;
}

function ensureItemModalCloseButton() {
  if (!itemEditorModal || document.getElementById("closeItemEditorModalBtn")) return;
  const button = document.createElement("button");
  button.id = "closeItemEditorModalBtn";
  button.className = "item-editor-close-btn";
  button.type = "button";
  button.setAttribute("aria-label", "關閉");
  button.textContent = "×";
  itemEditorModal.insertBefore(button, itemEditorModal.firstChild);
  addAdminTapListener(button, cancelItemEditorWithConfirm);
}

function moveOptionGridToItemModal() {
  if (!itemEditorModal || !adminOptionGrid) return;
  if (!adminModalOptionHeading) {
    adminModalOptionHeading = document.createElement("div");
    adminModalOptionHeading.className = "admin-modal-section-title";
    adminModalOptionHeading.innerHTML = "<h3>選項與圖片</h3>";
  }
  if (!itemEditorModal.contains(adminModalOptionHeading)) itemEditorModal.appendChild(adminModalOptionHeading);
  if (!itemEditorModal.contains(adminOptionGrid)) itemEditorModal.appendChild(adminOptionGrid);
  if (adminSharedActions && !itemEditorModal.contains(adminSharedActions)) itemEditorModal.appendChild(adminSharedActions);
  if (adminSharedActions) itemEditorModal.appendChild(adminSharedActions);
}

function restoreOptionGridToOptionTab() {
  if (!adminOptionGrid || !adminOptionGridHome) return;
  if (adminModalOptionHeading && adminModalOptionHeading.parentNode) {
    adminModalOptionHeading.parentNode.removeChild(adminModalOptionHeading);
  }
  if (adminOptionGridHomeNext && adminOptionGridHomeNext.parentNode === adminOptionGridHome) {
    adminOptionGridHome.insertBefore(adminOptionGrid, adminOptionGridHomeNext);
  } else {
    adminOptionGridHome.appendChild(adminOptionGrid);
  }
}

function openItemEditorForCreate(event) {
  if (event && event.preventDefault) event.preventDefault();
  resetForm();
  switchAdminTab("itemAdminTab");
  openItemEditorModal();
  if (itemName) itemName.focus();
  return false;
}

function updateItemEditorActionLabels() {
  if (cancelEditBtn) cancelEditBtn.textContent = "取消";
  if (addItemBtn) addItemBtn.textContent = editingId ? "確認修改" : "確認新增";
}

function setupTemplateSubtabs() {
  const tab = document.getElementById("templateAdminTab");
  if (!tab || tab.querySelector(".admin-subtabs")) return;
  const subtabs = document.createElement("div");
  subtabs.className = "admin-subtabs";
  subtabs.innerHTML = '<button class="admin-subtab-btn active" type="button" data-template-subtab="form">新增範本</button><button class="admin-subtab-btn" type="button" data-template-subtab="list">範本列表</button>';
  tab.insertBefore(subtabs, tab.firstElementChild);
  const panels = tab.querySelectorAll(".admin-v62-two-column > section");
  if (panels[0]) panels[0].setAttribute("data-template-subtab-panel", "form");
  if (panels[1]) panels[1].setAttribute("data-template-subtab-panel", "list");
  var subtabButtons = subtabs.querySelectorAll("button");
  for (var i = 0; i < subtabButtons.length; i += 1) {
    (function(button) {
      addAdminTapListener(button, function(event) {
        if (event && event.preventDefault) event.preventDefault();
        switchTemplateSubtab(getDataValue(button, "templateSubtab"));
      });
    })(subtabButtons[i]);
  }
  switchTemplateSubtab("form");
}

function switchTemplateSubtab(target) {
  var next = target === "list" ? "list" : "form";
  var buttons = document.querySelectorAll(".admin-subtab-btn");
  var panels = document.querySelectorAll("[data-template-subtab-panel]");

  for (var i = 0; i < buttons.length; i += 1) {
    var button = buttons[i];
    var activeButton = getDataValue(button, "templateSubtab") === next;
    if (button.classList) {
      if (activeButton) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    }
  }

  for (var j = 0; j < panels.length; j += 1) {
    var panel = panels[j];
    var activePanel = getDataValue(panel, "templateSubtabPanel") === next;
    if (panel.classList) {
      if (activePanel) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    }
  }
}

function setupTemplateRowEditor(textarea, container, addButton) {
  if (!textarea || !container || !addButton) return;
  textarea.classList.add("legacy-template-textarea");

  function readRows() {
    const parsed = parseNamePriceText(textarea.value || "");
    return Object.entries(parsed).map(([name, price]) => ({ name, price }));
  }

  function syncTextarea() {
    const rows = Array.from(container.querySelectorAll(".template-row")).map(row => {
      const nameInput = row.querySelector('[data-field="name"]');
      const priceInput = row.querySelector('[data-field="price"]');
      const name = nameInput ? nameInput.value.trim() : "";
      const price = Number(priceInput ? priceInput.value : 0);
      return name ? `${name},${Number.isFinite(price) ? price : 0}` : "";
    }).filter(Boolean);
    textarea.value = rows.join("\n");
  }

  function render(rows) {
    container.innerHTML = rows.map(row => `
      <div class="template-row">
        <input data-field="name" type="text" placeholder="名稱" value="${escapeHtml(row.name || "")}" />
        <input data-field="price" type="number" placeholder="價格" value="${Number(row.price || 0)}" />
        <button class="danger-btn" type="button" data-action="remove">刪除</button>
      </div>
    `).join("");
    var inputs = container.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i += 1) {
      inputs[i].addEventListener("input", syncTextarea, false);
    }
    var removeButtons = container.querySelectorAll('[data-action="remove"]');
    for (var j = 0; j < removeButtons.length; j += 1) {
      (function(button) {
        addAdminTapListener(button, function(event) {
          if (event && event.preventDefault) event.preventDefault();
          const row = findClosestByClass(button, "template-row");
          if (row) row.remove();
          syncTextarea();
        });
      })(removeButtons[j]);
    }
    syncTextarea();
  }

  addAdminTapListener(addButton, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    render(readRows().concat({ name: "", price: 0 }));
  });
  textarea.addEventListener("change", function() { render(readRows()); });
  const initialRows = readRows();
  render(initialRows.length ? initialRows : [{ name: "", price: 0 }]);
}

function setupTemplateNameListEditor(textarea, container, addButton, placeholder) {
  if (!textarea || !container || !addButton) return;
  textarea.classList.add("legacy-template-textarea");

  function readRows() {
    return parseListText(textarea.value || "").map(name => ({ name }));
  }

  function syncTextarea() {
    const rows = Array.from(container.querySelectorAll(".template-row")).map(row => {
      const nameInput = row.querySelector('[data-field="name"]');
      return nameInput ? nameInput.value.trim() : "";
    }).filter(Boolean);
    textarea.value = rows.join("\n");
  }

  function render(rows) {
    container.innerHTML = rows.map(row => `
      <div class="template-row template-row-single">
        <input data-field="name" type="text" placeholder="${escapeHtml(placeholder || "名稱")}" value="${escapeHtml(row.name || "")}" />
        <button class="danger-btn" type="button" data-action="remove">刪除</button>
      </div>
    `).join("");
    var inputs = container.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i += 1) {
      inputs[i].addEventListener("input", syncTextarea, false);
    }
    var removeButtons = container.querySelectorAll('[data-action="remove"]');
    for (var j = 0; j < removeButtons.length; j += 1) {
      (function(button) {
        addAdminTapListener(button, function(event) {
          if (event && event.preventDefault) event.preventDefault();
          const row = findClosestByClass(button, "template-row");
          if (row) row.remove();
          syncTextarea();
        });
      })(removeButtons[j]);
    }
    syncTextarea();
  }

  addAdminTapListener(addButton, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    render(readRows().concat({ name: "" }));
  });
  textarea.addEventListener("change", function() { render(readRows()); });
  const initialRows = readRows();
  render(initialRows.length ? initialRows : [{ name: "" }]);
}

function setupTemplateRequiredGroupEditor() {
  if (!templateRequiredChoicesInput) return;
  templateRequiredChoicesInput.classList.add("legacy-template-textarea");
  if (templateRequiredTitleInput) templateRequiredTitleInput.classList.add("legacy-template-textarea");
  if (templateRequiredRows) templateRequiredRows.style.display = "none";
  if (addTemplateRequiredRowBtn) addTemplateRequiredRowBtn.style.display = "none";

  let editor = document.getElementById("templateRequiredGroupEditor");
  if (!editor) {
    editor = document.createElement("div");
    editor.id = "templateRequiredGroupEditor";
    editor.className = "required-group-editor template-required-group-editor";
    templateRequiredChoicesInput.insertAdjacentElement("afterend", editor);
  }

  let addButton = document.getElementById("addTemplateRequiredGroupBtn");
  if (!addButton) {
    addButton = document.createElement("button");
    addButton.id = "addTemplateRequiredGroupBtn";
    addButton.className = "secondary-btn";
    addButton.type = "button";
    addButton.textContent = "新增必選群組";
    editor.insertAdjacentElement("afterend", addButton);
  }

  addButton.onclick = function(event) {
    if (event && event.preventDefault) event.preventDefault();
    templateRequiredGroupRows.push({ title: "", options: [""] });
    renderTemplateRequiredGroupEditor();
    return false;
  };

  templateRequiredGroupRows = normalizeRequiredGroups({
    requiredOption: getTemplateRequiredOptionFromLegacyInputs()
  });
  renderTemplateRequiredGroupEditor();
}

function getTemplateRequiredOptionFromLegacyInputs() {
  if (!templateRequiredTitleInput || !templateRequiredChoicesInput) return null;
  const title = templateRequiredTitleInput.value.trim();
  const options = parseListText(templateRequiredChoicesInput.value);
  if (!title && !options.length) return null;
  return { title, options, required: true };
}

function syncTemplateLegacyRequiredInputs() {
  const first = firstRequiredOptionFromGroups(templateRequiredGroupRows);
  if (templateRequiredTitleInput) templateRequiredTitleInput.value = first ? first.title : "";
  if (templateRequiredChoicesInput) templateRequiredChoicesInput.value = first ? first.options.join("\n") : "";
}

function renderTemplateRequiredGroupEditor() {
  const editor = document.getElementById("templateRequiredGroupEditor");
  if (!editor) return;

  editor.innerHTML = templateRequiredGroupRows.map((group, groupIndex) => `
    <div class="required-group-card" data-group-index="${groupIndex}">
      <div class="required-group-head">
        <input data-field="title" type="text" placeholder="群組名稱，例如：湯底" value="${escapeHtml(group.title || "")}" />
        <button class="danger-btn" type="button" data-action="removeGroup">刪除群組</button>
      </div>
      <div class="required-group-options">
        ${(group.options && group.options.length ? group.options : [""]).map((option, optionIndex) => `
          <div class="required-group-option" data-option-index="${optionIndex}">
            <input data-field="option" type="text" placeholder="選項內容，例如：原味" value="${escapeHtml(option || "")}" />
            <button class="danger-btn" type="button" data-action="removeOption">刪除</button>
          </div>
        `).join("")}
      </div>
      <button class="secondary-btn" type="button" data-action="addOption">新增選項</button>
    </div>
  `).join("");

  var inputs = editor.querySelectorAll("input");
  for (var i = 0; i < inputs.length; i += 1) {
    (function(input) {
      input.addEventListener("input", function() {
      const groupCard = findClosestByClass(input, "required-group-card");
      const groupIndex = Number(groupCard && groupCard.dataset.groupIndex);
      if (!templateRequiredGroupRows[groupIndex]) return;
      if (input.dataset.field === "title") {
        templateRequiredGroupRows[groupIndex].title = input.value;
      } else {
        const optionRow = findClosestByClass(input, "required-group-option");
        const optionIndex = Number(optionRow && optionRow.dataset.optionIndex);
        templateRequiredGroupRows[groupIndex].options[optionIndex] = input.value;
      }
      syncTemplateLegacyRequiredInputs();
      });
    })(inputs[i]);
  }

  var buttons = editor.querySelectorAll("button");
  for (var j = 0; j < buttons.length; j += 1) {
    (function(button) {
      addAdminTapListener(button, function(event) {
      if (event && event.preventDefault) event.preventDefault();
      const groupCard = findClosestByClass(button, "required-group-card");
      const groupIndex = Number(groupCard && groupCard.dataset.groupIndex);
      if (!templateRequiredGroupRows[groupIndex]) return;
      const action = button.dataset.action;
      if (action === "removeGroup") templateRequiredGroupRows.splice(groupIndex, 1);
      if (action === "addOption") templateRequiredGroupRows[groupIndex].options.push("");
      if (action === "removeOption") {
        const optionRow = findClosestByClass(button, "required-group-option");
        const optionIndex = Number(optionRow && optionRow.dataset.optionIndex);
        templateRequiredGroupRows[groupIndex].options.splice(optionIndex, 1);
        if (!templateRequiredGroupRows[groupIndex].options.length) templateRequiredGroupRows[groupIndex].options.push("");
      }
      syncTemplateLegacyRequiredInputs();
      renderTemplateRequiredGroupEditor();
      });
    })(buttons[j]);
  }

  syncTemplateLegacyRequiredInputs();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseNamePriceText(text) {
  const result = {};
  String(text || "")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const parts = line.split(",");
      const name = String(parts[0] || "").trim();
      const price = Number(String(parts[1] || "0").trim() || 0);
      if (!name || Number.isNaN(price)) return;
      result[name] = price;
    });
  return result;
}

function formatNamePriceText(options) {
  return Object.entries(options || {})
    .map(([name, price]) => `${name},${Number(price || 0)}`)
    .join("\n");
}

function parseListText(text) {
  const seen = {};
  return String(text || "")
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(name => {
      if (seen[name]) return false;
      seen[name] = true;
      return true;
    });
}

function formatListText(items) {
  return Array.isArray(items) ? items.join("\n") : "";
}

function normalizeRequiredGroups(source) {
  const rawGroups =
    (source && Array.isArray(source.requiredGroups) && source.requiredGroups) ||
    (source && Array.isArray(source.requiredOptions) && source.requiredOptions) ||
    (Array.isArray(source) && source) ||
    [];

  const groups = rawGroups.map(group => ({
    title: String((group && (group.title || group.name || group.groupName)) || "").trim(),
    options: Array.isArray(group && group.options)
      ? group.options.map(option => String(option || "").trim()).filter(Boolean)
      : parseListText(group && (group.choices || group.values || ""))
  })).filter(group => group.title || group.options.length);

  const legacy = source && source.requiredOption ? source.requiredOption : null;
  if (legacy && (legacy.title || (Array.isArray(legacy.options) && legacy.options.length))) {
    const legacyGroup = {
      title: String(legacy.title || "").trim(),
      options: Array.isArray(legacy.options)
        ? legacy.options.map(option => String(option || "").trim()).filter(Boolean)
        : parseListText(legacy.options || "")
    };
    const exists = groups.some(group => group.title === legacyGroup.title && group.options.join("|") === legacyGroup.options.join("|"));
    if (!exists && (legacyGroup.title || legacyGroup.options.length)) groups.unshift(legacyGroup);
  }

  return groups;
}

function firstRequiredOptionFromGroups(groups) {
  const first = (groups || []).find(group => group.title && Array.isArray(group.options) && group.options.length);
  if (!first) return null;
  return {
    title: first.title,
    options: first.options.slice(),
    required: true
  };
}

function cloneRequiredGroups(groups) {
  return (groups || []).map(group => ({
    title: String(group.title || "").trim(),
    options: (group.options || []).map(option => String(option || "").trim()).filter(Boolean)
  })).filter(group => group.title || group.options.length);
}

function getTemplateRequiredOptionFromForm() {
  return firstRequiredOptionFromGroups(getTemplateRequiredGroupsFromForm());
}

function getTemplateRequiredGroupsFromForm() {
  return cloneRequiredGroups(templateRequiredGroupRows);
}

function getTemplateDataFromForm() {
  const requiredGroups = getTemplateRequiredGroupsFromForm();
  return {
    name: templateNameInput ? templateNameInput.value.trim() : "",
    sizes: parseNamePriceText(templateSizesInput ? templateSizesInput.value : ""),
    requiredOption: getTemplateRequiredOptionFromForm(),
    requiredOptions: requiredGroups,
    requiredGroups,
    options: parseNamePriceText(templateAddonsInput ? templateAddonsInput.value : ""),
    removeOptions: parseListText(templateRemoveOptionsInput ? templateRemoveOptionsInput.value : "")
  };
}

function getOptionTemplates() {
  return Object.entries(optionTemplatesData || {})
    .map(([id, template]) => ({ id, ...template }))
    .sort((a, b) => {
      const orderA = Number(a.updatedAt || a.createdAt || 0);
      const orderB = Number(b.updatedAt || b.createdAt || 0);
      return orderB - orderA;
    });
}

function resetTemplateForm() {
  editingTemplateId = null;
  if (templateFormTitle) templateFormTitle.textContent = "新增選項範本";
  if (templateNameInput) templateNameInput.value = "";
  if (templateSizesInput) templateSizesInput.value = "";
  if (templateRequiredTitleInput) templateRequiredTitleInput.value = "";
  if (templateRequiredChoicesInput) templateRequiredChoicesInput.value = "";
  templateRequiredGroupRows = [];
  if (templateAddonsInput) templateAddonsInput.value = "";
  if (templateRemoveOptionsInput) templateRemoveOptionsInput.value = "";
  if (saveTemplateBtn) saveTemplateBtn.textContent = "儲存範本";
  refreshTemplateRowEditors();
}

function fillTemplateForm(template) {
  if (!template) return;
  if (templateFormTitle) templateFormTitle.textContent = `編輯範本｜${template.name || ""}`;
  if (templateNameInput) templateNameInput.value = template.name || "";
  if (templateSizesInput) templateSizesInput.value = formatNamePriceText(template.sizes || {});
  templateRequiredGroupRows = normalizeRequiredGroups(template);
  syncTemplateLegacyRequiredInputs();
  if (templateAddonsInput) templateAddonsInput.value = formatNamePriceText(template.options || {});
  if (templateRemoveOptionsInput) templateRemoveOptionsInput.value = formatListText(template.removeOptions || []);
  if (saveTemplateBtn) saveTemplateBtn.textContent = "更新範本";
  refreshTemplateRowEditors();
}

function refreshTemplateRowEditors() {
  [templateSizesInput, templateAddonsInput, templateRemoveOptionsInput].forEach(input => {
    if (!input) return;
    try { input.dispatchEvent(new Event("change")); } catch (e) {}
  });
  renderTemplateRequiredGroupEditor();
}

function renderTemplateSelect() {
  if (!itemTemplateSelect) return;

  const templates = getOptionTemplates();
  itemTemplateSelect.innerHTML = [`<option value="">選擇範本</option>`].concat(
    templates.map(template => `
      <option value="${escapeHtml(template.id)}">${escapeHtml(template.name || "未命名範本")}</option>
    `)
  ).join("");
}

function applyOptionTemplate(templateId) {
  const template = optionTemplatesData && optionTemplatesData[templateId];
  if (!template) {
    alert("請先選擇要套用的範本");
    return;
  }

  setRequiredGroupsToForm(template);
  setSizeRowsFromSizes(template.sizes || {});
  setAddonRowsFromOptions(template.options || {});
  setRemoveOptionRows(template.removeOptions || []);
  switchAdminTab("optionAdminTab");
}

async function saveOptionTemplate() {
  const templateData = getTemplateDataFromForm();

  if (!templateData.name) {
    alert("請輸入範本名稱");
    return;
  }

  const now = Date.now();

  try {
    if (saveTemplateBtn) saveTemplateBtn.disabled = true;

    if (editingTemplateId) {
      await update(ref(db, `optionTemplates/${editingTemplateId}`), {
        ...templateData,
        updatedAt: now
      });
    } else {
      const newTemplateRef = push(optionTemplatesRef);
      await set(newTemplateRef, {
        ...templateData,
        createdAt: now,
        updatedAt: now
      });
    }

    resetTemplateForm();
  } catch (error) {
    console.error("選項範本儲存失敗", error);
    alert("選項範本儲存失敗，請稍後再試");
  } finally {
    if (saveTemplateBtn) saveTemplateBtn.disabled = false;
  }
}

function editOptionTemplate(templateId) {
  const template = optionTemplatesData && optionTemplatesData[templateId];
  if (!template) return;
  editingTemplateId = templateId;
  fillTemplateForm(template);
  switchAdminTab("templateAdminTab");
}

async function deleteOptionTemplate(templateId) {
  const template = optionTemplatesData && optionTemplatesData[templateId];
  if (!template) return;
  if (!confirm(`確定刪除範本「${template.name || "未命名範本"}」？`)) return;

  try {
    await remove(ref(db, `optionTemplates/${templateId}`));
    if (editingTemplateId === templateId) resetTemplateForm();
  } catch (error) {
    console.error("選項範本刪除失敗", error);
    alert("選項範本刪除失敗，請稍後再試");
  }
}

function renderOptionTemplates() {
  renderTemplateSelect();

  if (!optionTemplateList) return;

  const templates = getOptionTemplates();

  if (templates.length === 0) {
    optionTemplateList.innerHTML = `<div class="empty">尚未建立選項範本</div>`;
    return;
  }

  optionTemplateList.innerHTML = templates.map(template => {
    const requiredGroups = normalizeRequiredGroups(template);
    const requiredText = requiredGroups.length
      ? requiredGroups.map(group => `${group.title}：${(group.options || []).join("、")}`).join(" / ")
      : "無必選項目";
    const sizeCount = Object.keys(template.sizes || {}).length;
    const addonCount = Object.keys(template.options || {}).length;
    const removeCount = Array.isArray(template.removeOptions) ? template.removeOptions.length : 0;

    return `
      <article class="option-template-card">
        <div>
          <strong>${escapeHtml(template.name || "未命名範本")}</strong>
          <p>${escapeHtml(requiredText)}</p>
          <small>份量 ${sizeCount}｜加料 ${addonCount}｜不要項目 ${removeCount}</small>
        </div>
        <div class="option-template-actions">
          <button type="button" data-action="apply" data-id="${escapeHtml(template.id)}">套用</button>
          <button type="button" data-action="edit" data-id="${escapeHtml(template.id)}">編輯</button>
          <button type="button" class="danger-btn" data-action="delete" data-id="${escapeHtml(template.id)}">刪除</button>
        </div>
      </article>
    `;
  }).join("");

  var templateButtons = optionTemplateList.querySelectorAll("button");
  for (var i = 0; i < templateButtons.length; i += 1) {
    addAdminTapListener(templateButtons[i], function(event) {
      const button = event.currentTarget || event.srcElement;
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === "apply") applyOptionTemplate(id);
      if (action === "edit") editOptionTemplate(id);
      if (action === "delete") deleteOptionTemplate(id);
    });
  }
}

function getRequiredOptionFromForm() {
  return firstRequiredOptionFromGroups(getRequiredGroupsFromForm());
}

function setRequiredOptionToForm(requiredOption) {
  if (!requiredOptionTitle || !requiredOptionChoices) return;

  if (!requiredOption) {
    requiredOptionTitle.value = "";
    requiredOptionChoices.value = "";
    requiredGroupRows = [];
    renderRequiredGroupEditor();
    return;
  }

  const groups = normalizeRequiredGroups({ requiredOption });
  requiredGroupRows = groups;
  syncLegacyRequiredInputs();
  renderRequiredGroupEditor();
}

function setRequiredGroupsToForm(source) {
  requiredGroupRows = normalizeRequiredGroups(source);
  syncLegacyRequiredInputs();
  renderRequiredGroupEditor();
}

function syncLegacyRequiredInputs() {
  if (!requiredOptionTitle || !requiredOptionChoices) return;
  const first = firstRequiredOptionFromGroups(requiredGroupRows);
  requiredOptionTitle.value = first ? first.title : "";
  requiredOptionChoices.value = first ? first.options.join(",") : "";
}

function getRequiredGroupsFromForm() {
  return cloneRequiredGroups(requiredGroupRows);
}

function ensureRequiredGroupEditor() {
  if (!requiredOptionChoices || document.getElementById("requiredGroupEditor")) return;
  const editor = document.createElement("div");
  editor.id = "requiredGroupEditor";
  editor.className = "required-group-editor";
  requiredOptionChoices.insertAdjacentElement("afterend", editor);

  const addButton = document.createElement("button");
  addButton.id = "addRequiredGroupBtn";
  addButton.className = "secondary-btn";
  addButton.type = "button";
  addButton.textContent = "新增必選群組";
  editor.insertAdjacentElement("afterend", addButton);

  addButton.addEventListener("click", function(event) {
    if (event && event.preventDefault) event.preventDefault();
    requiredGroupRows.push({ title: "", options: [""] });
    renderRequiredGroupEditor();
  });
}

function renderRequiredGroupEditor() {
  ensureRequiredGroupEditor();
  const editor = document.getElementById("requiredGroupEditor");
  if (!editor) return;

  if (!requiredGroupRows.length) {
    requiredGroupRows = [];
  }

  editor.innerHTML = requiredGroupRows.map((group, groupIndex) => `
    <div class="required-group-card" data-group-index="${groupIndex}">
      <div class="required-group-head">
        <input data-field="title" type="text" placeholder="群組名稱，例如：湯底" value="${escapeHtml(group.title || "")}" />
        <button class="danger-btn" type="button" data-action="removeGroup">刪除群組</button>
      </div>
      <div class="required-group-options">
        ${(group.options && group.options.length ? group.options : [""]).map((option, optionIndex) => `
          <div class="required-group-option" data-option-index="${optionIndex}">
            <input data-field="option" type="text" placeholder="選項內容，例如：原味" value="${escapeHtml(option || "")}" />
            <button class="danger-btn" type="button" data-action="removeOption">刪除</button>
          </div>
        `).join("")}
      </div>
      <button class="secondary-btn" type="button" data-action="addOption">新增選項</button>
    </div>
  `).join("");

  var inputs = editor.querySelectorAll("input");
  for (var i = 0; i < inputs.length; i += 1) {
    (function(input) {
      input.addEventListener("input", function() {
      const groupCard = findClosestByClass(input, "required-group-card");
      const groupIndex = Number(groupCard && groupCard.dataset.groupIndex);
      if (!requiredGroupRows[groupIndex]) return;
      if (input.dataset.field === "title") {
        requiredGroupRows[groupIndex].title = input.value;
      } else {
        const optionRow = findClosestByClass(input, "required-group-option");
        const optionIndex = Number(optionRow && optionRow.dataset.optionIndex);
        requiredGroupRows[groupIndex].options[optionIndex] = input.value;
      }
      syncLegacyRequiredInputs();
      });
    })(inputs[i]);
  }

  var buttons = editor.querySelectorAll("button");
  for (var j = 0; j < buttons.length; j += 1) {
    (function(button) {
      addAdminTapListener(button, function(event) {
      if (event && event.preventDefault) event.preventDefault();
      const groupCard = findClosestByClass(button, "required-group-card");
      const groupIndex = Number(groupCard && groupCard.dataset.groupIndex);
      if (!requiredGroupRows[groupIndex]) return;
      const action = button.dataset.action;
      if (action === "removeGroup") requiredGroupRows.splice(groupIndex, 1);
      if (action === "addOption") requiredGroupRows[groupIndex].options.push("");
      if (action === "removeOption") {
        const optionRow = findClosestByClass(button, "required-group-option");
        const optionIndex = Number(optionRow && optionRow.dataset.optionIndex);
        requiredGroupRows[groupIndex].options.splice(optionIndex, 1);
        if (!requiredGroupRows[groupIndex].options.length) requiredGroupRows[groupIndex].options.push("");
      }
      syncLegacyRequiredInputs();
      renderRequiredGroupEditor();
      });
    })(buttons[j]);
  }
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
  const requiredGroups = getRequiredGroupsFromForm();

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
      requiredOptions: requiredGroups,
      requiredGroups,
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
    closeItemEditorModal();
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

  setRequiredGroupsToForm(item);
  setSizeRowsFromSizes(item.sizes || {});
  setAddonRowsFromOptions(item.options || {});
  setRemoveOptionRows(item.removeOptions || []);

  formTitle.textContent = `編輯餐點｜${item.name || ""}`;
  addItemBtn.textContent = "更新餐點";
  cancelEditBtn.style.display = "block";
  switchAdminTab("itemAdminTab");

  openItemEditorModal();
  if (itemName) itemName.focus();
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
          </div>
          <span class="admin-status ${item.enabled === false ? "off" : "on"}">
            ${item.enabled === false ? "下架" : "上架"}
          </span>
        </div>

        <div class="admin-price">${money(item.price)}</div>

        <div class="admin-list-category">${escapeHtml(category)}</div>

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

onValue(optionTemplatesRef, snapshot => {
  optionTemplatesData = snapshot.exists() ? snapshot.val() : {};
  renderOptionTemplates();
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

if (applyTemplateBtn) {
  addAdminTapListener(applyTemplateBtn, function() {
    applyOptionTemplate(itemTemplateSelect ? itemTemplateSelect.value : "");
  });
}

if (saveTemplateBtn) {
  addAdminTapListener(saveTemplateBtn, saveOptionTemplate);
}

if (cancelTemplateEditBtn) {
  addAdminTapListener(cancelTemplateEditBtn, resetTemplateForm);
}

addItemBtn.addEventListener("click", saveItem);
cancelEditBtn.addEventListener("click", function() {
  cancelItemEditorWithConfirm();
});
menuSearchInput.addEventListener("input", renderMenu);

for (var adminTabIndex = 0; adminTabIndex < adminTabButtons.length; adminTabIndex += 1) {
  (function(button) {
    var lastTouchAt = 0;

    function handleAdminTabEvent(event) {
      if (event && event.type === "touchend") {
        lastTouchAt = Date.now ? Date.now() : new Date().getTime();
      }

      if (event && event.type === "click" && (Date.now ? Date.now() : new Date().getTime()) - lastTouchAt < 500) {
        return;
      }

      if (event && event.preventDefault) event.preventDefault();
      switchAdminTab(button.getAttribute("data-admin-tab"));
    }

    button.addEventListener("click", handleAdminTabEvent, false);
    button.addEventListener("touchend", handleAdminTabEvent, false);
  })(adminTabButtons[adminTabIndex]);
}

if (itemImageFile) {
  itemImageFile.addEventListener("change", function() {
    if (itemImageFile.files && itemImageFile.files[0]) {
      try { renderImagePreview(URL.createObjectURL(itemImageFile.files[0])); } catch(e) {}
    }
  });
}

initAdminV63Ux();
resetForm();
switchAdminTab("categoryAdminTab");

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
