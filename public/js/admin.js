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

import {
  defaultMenuOptionModules,
  getMenuOptionGroupItems,
  menuSelectionTypeLabel,
  modulesToVisibility as menuModulesToVisibility,
  normalizeMenuOptionGroup,
  normalizeMenuSelectionType,
  visibilityToModules as menuVisibilityToModules
} from "./menu-studio-core.js";

const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemPrice = document.getElementById("itemPrice");
const itemImage = document.getElementById("itemImage");
const itemImageFile = document.getElementById("itemImageFile");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const itemDescription = document.getElementById("itemDescription");
const itemEnabled = document.getElementById("itemEnabled");
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
const customGroupNameInput = document.getElementById("customGroupNameInput");
const customGroupAreaInput = document.getElementById("customGroupAreaInput");
const addCustomGroupBtn = document.getElementById("addCustomGroupBtn");
const customGroupEditorList = document.getElementById("customGroupEditorList");
const itemCustomGroupPicker = document.getElementById("itemCustomGroupPicker");
const templateCustomGroupPicker = document.getElementById("templateCustomGroupPicker");
let openNewItemModalBtn = document.getElementById("openNewItemModalBtn");
const itemEditorModal = document.getElementById("itemEditorModal") || document.querySelector("#addItemAdminTab .admin-form-panel");
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
const customOptionGroupsRef = ref(db, "customOptionGroups");
const customGroupsRef = ref(db, "customGroups");
const customItemsRef = ref(db, "customItems");

let menuData = {};
let categoriesData = {};
let optionTemplatesData = {};
let customOptionGroupsData = {};
let customGroupsData = {};
let customItemsData = {};
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
let itemEditorInitialState = "";
let selectedCustomGroupIds = [];
let selectedTemplateCustomGroupIds = [];
let expandedCustomGroupId = "";
let customGroupModalMode = "create";
let customGroupModalId = "";
let customGroupDraftOptions = [];

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
    var shouldHideActions = tabId !== "addItemAdminTab";
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
  if (optionTabButton) optionTabButton.textContent = "餐點選項";
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
  const inlineNewItemBtn = document.getElementById("openInlineNewItemBtn");
  if (inlineNewItemBtn && inlineNewItemBtn.parentNode) {
    inlineNewItemBtn.parentNode.removeChild(inlineNewItemBtn);
  }
  if (mediaPanel) mediaPanel.style.display = "none";

  adminOptionGrid = optionPanel ? optionPanel.querySelector(".admin-option-grid") : null;
  if (adminOptionGrid && !adminOptionGridHome) {
    adminOptionGridHome = adminOptionGrid.parentNode;
    adminOptionGridHomeNext = adminOptionGrid.nextSibling;
  }

  openNewItemModalBtn = document.getElementById("openNewItemModalBtn");
  if (openNewItemModalBtn && openNewItemModalBtn.parentNode) {
    openNewItemModalBtn.parentNode.removeChild(openNewItemModalBtn);
  }

  if (itemEditorModal) {
    itemEditorModal.classList.remove("item-editor-modal", "hidden");
    itemEditorModal.removeAttribute("aria-modal");
    if (requiredOptionTitle) requiredOptionTitle.classList.add("legacy-required-input");
    if (requiredOptionChoices) requiredOptionChoices.classList.add("legacy-required-input");
    ensureRequiredGroupEditor();
    moveSharedActionsToAddItemBottom();
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
  itemEditorMode = "inline";
  itemEditorModal.classList.remove("item-editor-inline");
  itemEditorModal.classList.remove("item-editor-modal");
  itemEditorModal.classList.remove("hidden");
  setAdminModalOpen(false);
  moveSharedActionsToAddItemBottom();
  updateItemEditorActionLabels();
  itemEditorInitialState = getItemEditorStateSnapshot();
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
  itemEditorMode = "hidden";
  itemEditorModal.classList.remove("item-editor-inline");
  itemEditorModal.classList.remove("item-editor-modal");
  itemEditorModal.classList.remove("hidden");
  setAdminModalOpen(false);
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
  moveSharedActionsToInlineBottom();
  if (adminSharedActions) adminSharedActions.classList.remove("hidden");
  updateItemEditorActionLabels();
  itemEditorInitialState = getItemEditorStateSnapshot();
  if (itemName) itemName.focus();
  return false;
}

function setAdminModalOpen(open) {
  var body = document.body;
  if (!body) return;
  var current = " " + (body.className || "") + " ";
  if (open && current.indexOf(" admin-modal-open ") === -1) {
    body.className = (body.className ? body.className + " " : "") + "admin-modal-open";
  }
  if (!open && current.indexOf(" admin-modal-open ") !== -1) {
    body.className = current.replace(" admin-modal-open ", " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
}

function moveSharedActionsToModalBottom() {
  if (!itemEditorModal || !adminSharedActions) return;
  itemEditorModal.appendChild(adminSharedActions);
  adminSharedActions.classList.remove("hidden");
}

function moveSharedActionsToInlineBottom() {
  if (!adminSharedActions) return;
  var optionPanel = document.querySelector("#optionAdminTab .admin-option-panel");
  if (!optionPanel) return;
  if (adminOptionGrid && adminOptionGrid.parentNode === optionPanel) {
    if (adminOptionGrid.nextSibling) {
      optionPanel.insertBefore(adminSharedActions, adminOptionGrid.nextSibling);
    } else {
      optionPanel.appendChild(adminSharedActions);
    }
  } else {
    optionPanel.appendChild(adminSharedActions);
  }
  adminSharedActions.classList.remove("hidden");
}

function moveSharedActionsToAddItemBottom() {
  if (!adminSharedActions) return;
  var addItemPanel = document.querySelector("#addItemAdminTab .admin-form-panel");
  if (!addItemPanel) return;
  addItemPanel.appendChild(adminSharedActions);
  adminSharedActions.classList.remove("hidden");
}

function getItemEditorStateSnapshot() {
  var selectedFileName = "";
  if (itemImageFile && itemImageFile.files && itemImageFile.files[0]) {
    selectedFileName = itemImageFile.files[0].name || "";
  }
  return JSON.stringify({
    editingId: editingId || "",
    name: itemName ? itemName.value.trim() : "",
    category: itemCategory ? itemCategory.value.trim() : "",
    price: itemPrice ? String(itemPrice.value || "").trim() : "",
    enabled: itemEnabled ? itemEnabled.checked === true : true,
    image: itemImage ? itemImage.value.trim() : "",
    selectedFileName: selectedFileName,
    description: itemDescription ? itemDescription.value.trim() : "",
    sizes: getSizesFromRows(),
    options: getOptionsFromAddonRows(),
    removeOptions: getRemoveOptionsFromRows(),
    requiredGroups: getRequiredGroupsFromForm()
  });
}

function hasDirtyItemForm() {
  return getItemEditorStateSnapshot() !== itemEditorInitialState;
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
  button.onclick = cancelItemEditorWithConfirm;
  button.ontouchend = function(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    return cancelItemEditorWithConfirm(event);
  };
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
  moveSharedActionsToModalBottom();
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
  switchAdminTab("addItemAdminTab");
  openItemEditorModal();
  if (itemName) itemName.focus();
  return false;
}

function updateItemEditorActionLabels() {
  if (cancelEditBtn) {
    cancelEditBtn.textContent = "取消";
    cancelEditBtn.style.display = "inline-flex";
  }
  if (addItemBtn) {
    addItemBtn.textContent = editingId ? "確認修改" : "確認新增";
    addItemBtn.style.display = "inline-flex";
  }
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
  if (addButton.dataset && addButton.dataset.v63TemplateBound === "true") return;
  if (addButton.dataset) addButton.dataset.v63TemplateBound = "true";
  textarea.classList.add("legacy-template-textarea");

  function readRows() {
    const parsed = parseNamePriceText(textarea.value || "");
    return Object.entries(parsed).map(([name, price]) => ({ name, price }));
  }

  function readVisibleRows() {
    const rows = Array.from(container.querySelectorAll(".template-row")).map(row => {
      const nameInput = row.querySelector('[data-field="name"]');
      const priceInput = row.querySelector('[data-field="price"]');
      return {
        name: nameInput ? nameInput.value : "",
        price: Number(priceInput ? priceInput.value : 0)
      };
    });
    return rows.length ? rows : readRows();
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
    render(readVisibleRows().concat({ name: "", price: 0 }));
  });
  textarea.addEventListener("change", function() { render(readRows()); });
  const initialRows = readRows();
  render(initialRows.length ? initialRows : [{ name: "", price: 0 }]);
}

function setupTemplateNameListEditor(textarea, container, addButton, placeholder) {
  if (!textarea || !container || !addButton) return;
  if (addButton.dataset && addButton.dataset.v63TemplateBound === "true") return;
  if (addButton.dataset) addButton.dataset.v63TemplateBound = "true";
  textarea.classList.add("legacy-template-textarea");

  function readRows() {
    return parseListText(textarea.value || "").map(name => ({ name }));
  }

  function readVisibleRows() {
    const rows = Array.from(container.querySelectorAll(".template-row")).map(row => {
      const nameInput = row.querySelector('[data-field="name"]');
      return { name: nameInput ? nameInput.value : "" };
    });
    return rows.length ? rows : readRows();
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
    render(readVisibleRows().concat({ name: "" }));
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
        <input data-field="title" type="text" placeholder="區塊名稱，例如：湯底" value="${escapeHtml(group.title || "")}" />
        <button class="danger-btn" type="button" data-action="removeGroup">刪除區塊</button>
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
    customGroupIds: selectedTemplateCustomGroupIds.slice(),
    customOptionGroupIds: selectedTemplateCustomGroupIds.slice(),
    legacySizes: parseNamePriceText(templateSizesInput ? templateSizesInput.value : ""),
    legacyRequiredOption: getTemplateRequiredOptionFromForm(),
    legacyRequiredOptions: requiredGroups,
    legacyOptions: parseNamePriceText(templateAddonsInput ? templateAddonsInput.value : ""),
    legacyRemoveOptions: parseListText(templateRemoveOptionsInput ? templateRemoveOptionsInput.value : "")
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
  selectedTemplateCustomGroupIds = [];
  if (templateAddonsInput) templateAddonsInput.value = "";
  if (templateRemoveOptionsInput) templateRemoveOptionsInput.value = "";
  if (saveTemplateBtn) saveTemplateBtn.textContent = "儲存範本";
  refreshTemplateRowEditors();
  renderTemplateCustomGroupPicker();
}

function fillTemplateForm(template) {
  if (!template) return;
  if (templateFormTitle) templateFormTitle.textContent = `編輯範本｜${template.name || ""}`;
  if (templateNameInput) templateNameInput.value = template.name || "";
  if (templateSizesInput) templateSizesInput.value = formatNamePriceText(template.sizes || {});
  templateRequiredGroupRows = normalizeRequiredGroups(template);
  selectedTemplateCustomGroupIds = Array.isArray(template.customGroupIds || template.customOptionGroupIds) ? (template.customGroupIds || template.customOptionGroupIds).slice() : [];
  syncTemplateLegacyRequiredInputs();
  if (templateAddonsInput) templateAddonsInput.value = formatNamePriceText(template.options || {});
  if (templateRemoveOptionsInput) templateRemoveOptionsInput.value = formatListText(template.removeOptions || []);
  if (saveTemplateBtn) saveTemplateBtn.textContent = "更新範本";
  refreshTemplateRowEditors();
  renderTemplateCustomGroupPicker();
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

  var templateGroupIds = template.customGroupIds || template.customOptionGroupIds || [];
  if (Array.isArray(templateGroupIds)) {
    var existing = {};
    for (var i = 0; i < selectedCustomGroupIds.length; i += 1) existing[selectedCustomGroupIds[i]] = true;
    for (var j = 0; j < templateGroupIds.length; j += 1) {
      if (!existing[templateGroupIds[j]]) selectedCustomGroupIds.push(templateGroupIds[j]);
    }
    renderItemCustomGroupPicker();
  }
}

function refreshItemEditorAfterTemplateApply() {
  try {
    renderRequiredGroupEditor();
    renderSizeEditor();
    renderAddonEditor();
    renderRemoveOptionEditor();
  } catch (error) {
    console.error("apply template refresh failed", error);
  }
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
    switchTemplateSubtab("list");
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
  switchTemplateSubtab("form");
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
    const groupCount = Array.isArray(template.customGroupIds || template.customOptionGroupIds) ? (template.customGroupIds || template.customOptionGroupIds).length : 0;

    return `
      <article class="option-template-card">
        <div>
          <strong>${escapeHtml(template.name || "未命名範本")}</strong>
          <p>餐點選項組合</p>
          <small>餐點選項 ${groupCount}</small>
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
        <input data-field="title" type="text" placeholder="區塊名稱，例如：湯底" value="${escapeHtml(group.title || "")}" />
        <button class="danger-btn" type="button" data-action="removeGroup">刪除區塊</button>
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
  if (itemEnabled) itemEnabled.checked = true;
  if (itemImageFile) itemImageFile.value = "";
  renderImagePreview("");

  if (itemDescription) itemDescription.value = "";
  setRequiredOptionToForm(null);

  sizeRows = [];
  addonRows = [];
  removeOptionRows = [];
  selectedCustomGroupIds = [];
  renderSizeEditor();
  renderAddonEditor();
  renderRemoveOptionEditor();
  renderItemCustomGroupPicker();

  formTitle.textContent = "新增餐點";
  addItemBtn.textContent = "新增餐點";
  cancelEditBtn.style.display = "none";

  renderCategorySelect();
  applyCategoryDefaultTemplateToForm(itemCategory ? itemCategory.value : "");
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

function applyCategoryDefaultTemplateToForm(categoryName) {
  if (editingId) return;
  const category = findCategoryByName(categoryName);
  if (!category || !category.defaultTemplateId) return;
  const template = optionTemplatesData && optionTemplatesData[category.defaultTemplateId];
  if (!template) return;
  const templateGroupIds = template.customGroupIds || template.customOptionGroupIds || [];
  if (!Array.isArray(templateGroupIds)) return;
  selectedCustomGroupIds = templateGroupIds.slice();
  renderItemCustomGroupPicker();
}

async function saveItem() {
  const name = itemName.value.trim();
  const category = itemCategory.value.trim();
  const price = Number(itemPrice.value);
  let image = itemImage.value.trim();
  const description = itemDescription ? itemDescription.value.trim() : "";
  const customGroupIds = selectedCustomGroupIds.slice();

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
      description,
      customGroupIds,
      customOptionGroupIds: customGroupIds,
      enabled: itemEnabled ? itemEnabled.checked === true : (oldItem ? oldItem.enabled !== false : true),
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
  if (itemEnabled) itemEnabled.checked = item.enabled !== false;
  if (itemImageFile) itemImageFile.value = "";
  renderImagePreview(item.image || "");

  if (itemDescription) {
    itemDescription.value = item.description || "";
  }

  setRequiredGroupsToForm(item);
  setSizeRowsFromSizes(item.sizes || {});
  setAddonRowsFromOptions(item.options || {});
  setRemoveOptionRows(item.removeOptions || []);
  selectedCustomGroupIds = Array.isArray(item.customGroupIds || item.customOptionGroupIds) ? (item.customGroupIds || item.customOptionGroupIds).slice() : [];
  renderItemCustomGroupPicker();

  formTitle.textContent = `編輯餐點｜${item.name || ""}`;
  addItemBtn.textContent = "更新餐點";
  cancelEditBtn.style.display = "block";
  switchAdminTab("addItemAdminTab");

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

      <label class="category-template-field">
        預設範本
        <select data-action="defaultTemplate" data-id="${escapeHtml(category.id)}">
          <option value="">不指定</option>
          ${getOptionTemplates().map(template => `
            <option value="${escapeHtml(template.id)}" ${category.defaultTemplateId === template.id ? "selected" : ""}>
              ${escapeHtml(template.name || "未命名範本")}
            </option>
          `).join("")}
        </select>
      </label>

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

  categoryManagerList.querySelectorAll('select[data-action="defaultTemplate"]').forEach(select => {
    select.addEventListener("change", () => {
      const id = select.dataset.id;
      if (!id) return;
      update(ref(db, `categories/${id}`), {
        defaultTemplateId: select.value || "",
        updatedAt: Date.now()
      }).catch(error => {
        console.error("預設範本儲存失敗：", error);
        alert("預設範本儲存失敗");
      });
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
   v64 Custom Option Groups
========================= */

function defaultCustomGroupModules() {
  return defaultMenuOptionModules("customer");
}

function defaultCustomGroupModulesForArea(area) {
  return defaultMenuOptionModules(area === "posOnly" ? "posOnly" : "customer");
}

function normalizeSelectionType(value) {
  return normalizeMenuSelectionType(value);
}

function selectionTypeLabel(value) {
  return menuSelectionTypeLabel(value);
}

function modulesToVisibility(modules) {
  return menuModulesToVisibility(modules || defaultCustomGroupModules());
}

function visibilityToModules(visibility) {
  return menuVisibilityToModules(visibility || {});
}

function normalizeCustomGroup(id, group) {
  return normalizeMenuOptionGroup(id, group);
}

function getCustomGroupItems() {
  return getMenuOptionGroupItems(customGroupsData, customOptionGroupsData);
}

function renderItemCustomGroupPicker() {
  if (!itemCustomGroupPicker) return;
  var groups = getCustomGroupItems();
  var selectedMap = {};
  for (var s = 0; s < selectedCustomGroupIds.length; s += 1) selectedMap[selectedCustomGroupIds[s]] = true;
  if (!groups.length) {
    itemCustomGroupPicker.innerHTML = '<div class="empty small-empty">尚未建立餐點選項</div>';
    return;
  }
  var selectedHtml = "";
  for (var i = 0; i < selectedCustomGroupIds.length; i += 1) {
    var selectedGroup = findGroupInList(groups, selectedCustomGroupIds[i]);
    if (!selectedGroup) continue;
    selectedHtml += '<div class="studio-selected-row" data-id="' + escapeHtml(selectedGroup.id) + '">' +
      '<strong>' + (i + 1) + '. ' + escapeHtml(selectedGroup.name || "餐點選項") + '</strong>' +
      '<span>' + escapeHtml(selectionTypeLabel(selectedGroup.selectionType)) + '｜' + moduleSummary(selectedGroup.modules) + '</span>' +
      '<div><button type="button" data-action="up">上移</button><button type="button" data-action="down">下移</button><button type="button" data-action="remove">移除</button></div>' +
    '</div>';
  }
  var availableHtml = groups.filter(function(group) { return !selectedMap[group.id]; }).map(function(group) {
    return '<button type="button" class="studio-available-chip" data-id="' + escapeHtml(group.id) + '">＋ ' + escapeHtml(group.name || "餐點選項") + '</button>';
  }).join("");
  itemCustomGroupPicker.innerHTML =
    '<div class="studio-picker-block"><h4>目前套用順序</h4>' + (selectedHtml || '<div class="empty small-empty">尚未套用餐點選項</div>') + '</div>' +
    '<div class="studio-picker-block"><h4>增加其他餐點選項</h4><div class="studio-available-list">' + (availableHtml || '<div class="empty small-empty">所有餐點選項都已套用</div>') + '</div></div>' +
    '<p class="form-help">若要修改選項內容，請前往「餐點選項」分頁編輯共用資料。</p>';
  bindOrderedGroupPicker(itemCustomGroupPicker, selectedCustomGroupIds, function(next) {
    selectedCustomGroupIds = next;
    renderItemCustomGroupPicker();
  });
}

function renderTemplateCustomGroupPicker() {
  if (!templateCustomGroupPicker) return;
  var groups = getCustomGroupItems();
  var selectedMap = {};
  for (var s = 0; s < selectedTemplateCustomGroupIds.length; s += 1) selectedMap[selectedTemplateCustomGroupIds[s]] = true;
  if (!groups.length) {
    templateCustomGroupPicker.innerHTML = '<div class="empty small-empty">尚未建立餐點選項</div>';
    return;
  }
  var selectedHtml = "";
  for (var i = 0; i < selectedTemplateCustomGroupIds.length; i += 1) {
    var selectedGroup = findGroupInList(groups, selectedTemplateCustomGroupIds[i]);
    if (!selectedGroup) continue;
    selectedHtml += '<div class="studio-selected-row" data-id="' + escapeHtml(selectedGroup.id) + '">' +
      '<strong>' + (i + 1) + '. ' + escapeHtml(selectedGroup.name || "餐點選項") + '</strong>' +
      '<span>' + escapeHtml(selectionTypeLabel(selectedGroup.selectionType)) + '｜' + moduleSummary(selectedGroup.modules) + '</span>' +
      '<div><button type="button" data-action="up">上移</button><button type="button" data-action="down">下移</button><button type="button" data-action="remove">移除</button></div>' +
    '</div>';
  }
  var availableHtml = groups.filter(function(group) { return !selectedMap[group.id]; }).map(function(group) {
    return '<button type="button" class="studio-available-chip" data-id="' + escapeHtml(group.id) + '">＋ ' + escapeHtml(group.name || "餐點選項") + '</button>';
  }).join("");
  templateCustomGroupPicker.innerHTML =
    '<div class="studio-template-picker"><div class="studio-picker-block"><h4>可用餐點選項</h4><div class="studio-available-list">' + (availableHtml || '<div class="empty small-empty">所有餐點選項都已加入</div>') + '</div></div>' +
    '<div class="studio-picker-block"><h4>已加入範本</h4>' + (selectedHtml || '<div class="empty small-empty">尚未加入餐點選項</div>') + '</div></div>';
  bindOrderedGroupPicker(templateCustomGroupPicker, selectedTemplateCustomGroupIds, function(next) {
    selectedTemplateCustomGroupIds = next;
    renderTemplateCustomGroupPicker();
  });
}

function findGroupInList(groups, id) {
  for (var i = 0; i < (groups || []).length; i += 1) {
    if (String(groups[i].id) === String(id)) return groups[i];
  }
  return null;
}

function moduleSummary(modules) {
  modules = modules || {};
  var labels = [];
  if (modules.qr === true) labels.push("QR");
  if (modules.pos !== false) labels.push("POS");
  if (modules.kds !== false) labels.push("廚房");
  if (modules.print !== false) labels.push("印單");
  return labels.length ? labels.join("、") : "未顯示";
}

function bindOrderedGroupPicker(root, currentIds, onChange) {
  if (!root || !onChange) return;
  var rows = root.querySelectorAll(".studio-selected-row");
  for (var i = 0; i < rows.length; i += 1) {
    (function(row) {
      var id = row.getAttribute("data-id");
      var buttons = row.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b += 1) {
        buttons[b].onclick = function() {
          var action = this.getAttribute("data-action");
          var next = currentIds.slice();
          var index = next.indexOf(id);
          if (index < 0) return false;
          if (action === "up" && index > 0) {
            var prev = next[index - 1];
            next[index - 1] = next[index];
            next[index] = prev;
          }
          if (action === "down" && index < next.length - 1) {
            var after = next[index + 1];
            next[index + 1] = next[index];
            next[index] = after;
          }
          if (action === "remove") next.splice(index, 1);
          onChange(next);
          return false;
        };
      }
    })(rows[i]);
  }
  var chips = root.querySelectorAll(".studio-available-chip");
  for (var c = 0; c < chips.length; c += 1) {
    chips[c].onclick = function() {
      var id = this.getAttribute("data-id");
      if (!id) return false;
      var next = currentIds.slice();
      if (next.indexOf(id) < 0) next.push(id);
      onChange(next);
      return false;
    };
  }
}

function renderCustomGroupEditor() {
  if (!customGroupEditorList) return;
  var groups = getCustomGroupItems();
  if (!groups.length) {
    customGroupEditorList.innerHTML = '<div class="empty small-empty">尚未建立餐點選項</div>';
    renderItemCustomGroupPicker();
    renderTemplateCustomGroupPicker();
    return;
  }
  customGroupEditorList.innerHTML = groups.map(function(group) {
    var modules = group.modules || defaultCustomGroupModules();
    var optionsHtml = (group.options || []).map(function(option, index) {
      option = typeof option === "string" ? { name: option } : option;
      var optionId = option.id || option.itemId || "";
      return '<div class="custom-group-option-row" data-index="' + index + '" data-option-id="' + escapeHtml(optionId) + '">' +
        '<input data-field="name" value="' + escapeHtml(option.name || option.label || "") + '" placeholder="選項名稱" />' +
        '<input data-field="price" type="number" value="' + Number(option.price || 0) + '" placeholder="加價" />' +
        '<label><input data-field="qtyEnabled" type="checkbox" ' + (option.qtyEnabled || option.quantityEnabled ? "checked" : "") + ' /> 可調數量</label>' +
        '<input data-field="maxQty" type="number" min="1" max="99" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" placeholder="最大數量" />' +
        '<button type="button" data-action="deleteOption">刪除</button>' +
      '</div>';
    }).join("");
    return '<div class="custom-group-card" data-id="' + escapeHtml(group.id) + '">' +
      '<div class="custom-group-head"><input data-field="groupName" value="' + escapeHtml(group.name || "") + '" />' +
      '<select data-field="groupType"><option value="customer" ' + (group.type === "customer" ? "selected" : "") + '>客人可選項</option><option value="posOnly" ' + (group.type === "posOnly" ? "selected" : "") + '>POS 內部選項</option></select>' +
      '<button type="button" data-action="addOption">新增選項</button><button type="button" data-action="deleteGroup">刪除餐點選項</button></div>' +
      '<div class="custom-group-rules"><label><input data-field="required" type="checkbox" ' + (group.required ? "checked" : "") + ' /> 必選</label><input data-field="minSelect" type="number" min="0" max="99" value="' + Number(group.minSelect || 0) + '" placeholder="最少" /><input data-field="maxSelect" type="number" min="0" max="99" value="' + Number(group.maxSelect || 0) + '" placeholder="最多" /></div>' +
      '<div class="custom-group-modules">' +
        ["qr","pos","kds","print","sticker","online"].map(function(name) {
          var label = { qr:"QR", pos:"POS", kds:"KDS", print:"出單", sticker:"貼紙", online:"線上訂餐" }[name];
          return '<label><input data-module="' + name + '" type="checkbox" ' + (modules[name] === true ? "checked" : "") + ' /> ' + label + '</label>';
        }).join("") +
      '</div><div class="custom-group-options">' + optionsHtml + '</div></div>';
  }).join("");
  bindCustomGroupEditor();
  renderItemCustomGroupPicker();
  renderTemplateCustomGroupPicker();
}

function bindCustomGroupEditor() {
  var cards = customGroupEditorList ? customGroupEditorList.querySelectorAll(".custom-group-card") : [];
  for (var c = 0; c < cards.length; c += 1) {
    (function(card) {
      var id = card.getAttribute("data-id");
      var inputs = card.querySelectorAll("input, select");
      for (var i = 0; i < inputs.length; i += 1) {
        inputs[i].onchange = function() { saveCustomGroupFromCard(card, id); };
      }
      var buttons = card.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b += 1) {
        buttons[b].onclick = function() {
          var action = this.getAttribute("data-action");
          if (action === "addOption") addCustomGroupOption(id);
          if (action === "deleteGroup") deleteCustomGroup(id);
          if (action === "deleteOption") {
            var row = this.parentNode;
            if (row && row.parentNode) row.parentNode.removeChild(row);
            saveCustomGroupFromCard(card, id);
          }
          return false;
        };
      }
    })(cards[c]);
  }
  var areaButtons = customGroupEditorList ? customGroupEditorList.querySelectorAll('button[data-action="addAreaGroup"]') : [];
  for (var a = 0; a < areaButtons.length; a += 1) {
    areaButtons[a].onclick = function() {
      var area = this.getAttribute("data-area") === "posOnly" ? "posOnly" : "customer";
      var name = prompt(area === "posOnly" ? "請輸入 POS 內部餐點選項名稱" : "請輸入餐點選項名稱");
      if (!name) return false;
      createCustomGroup(name, area);
      return false;
    };
  }
}

async function saveCustomGroupFromCard(card, id, button) {
  if (!card || !id) return false;
  if (button) {
    button.disabled = true;
    button.textContent = "儲存中...";
  }
  try {
  var groupNameInput = card.querySelector('input[data-field="groupName"]');
  var groupTypeInput = card.querySelector('[data-field="groupType"]');
  var selectionTypeInput = card.querySelector('[data-field="selectionType"]') || card.querySelector('[data-field="choiceType"]');
  var descriptionInput = card.querySelector('[data-field="description"]');
  var enabledInput = card.querySelector('input[data-field="enabled"]');
  var allowQuantityInput = card.querySelector('input[data-field="allowQuantity"]');
  var requiredInput = card.querySelector('input[data-field="required"]');
  var minSelectInput = card.querySelector('input[data-field="minSelect"]');
  var maxSelectInput = card.querySelector('input[data-field="maxSelect"]');
  var modules = {};
  var moduleInputs = card.querySelectorAll("input[data-module]");
  for (var m = 0; m < moduleInputs.length; m += 1) modules[moduleInputs[m].getAttribute("data-module")] = moduleInputs[m].checked === true;
  var area = groupTypeInput ? groupTypeInput.value : (modules.qr === true ? "customer" : "posOnly");
  if (groupTypeInput && groupTypeInput.value === "posOnly") {
    modules.qr = false;
    modules.pos = true;
  }
  if (area !== "posOnly" && moduleInputs.length === 0) modules = defaultCustomGroupModulesForArea(area);
  var rows = card.querySelectorAll(".custom-group-option-row");
  var options = [];
  var customItemsUpdates = {};
  for (var r = 0; r < rows.length; r += 1) {
    var optionId = rows[r].getAttribute("data-option-id") || (id + "-item-" + (Date.now ? Date.now() : new Date().getTime()) + "-" + r);
    var nameInput = rows[r].querySelector('input[data-field="name"]');
    var priceInput = rows[r].querySelector('input[data-field="price"]');
    var qtyInput = rows[r].querySelector('input[data-field="qtyEnabled"]');
    var defaultQtyInput = rows[r].querySelector('input[data-field="defaultQuantity"]');
    var maxQtyInput = rows[r].querySelector('input[data-field="maxQty"]');
    var optionEnabledInput = rows[r].querySelector('input[data-field="optionEnabled"]');
    var name = nameInput ? String(nameInput.value || "").trim() : "";
    if (!name) continue;
    var maxQty = Math.max(1, Number(maxQtyInput && maxQtyInput.value || 1));
    var defaultQty = Math.max(1, Math.min(maxQty, Number(defaultQtyInput && defaultQtyInput.value || 1)));
    var groupAllowsQuantity = allowQuantityInput && allowQuantityInput.checked === true;
    var optionData = {
      id: optionId,
      name: name,
      price: Number(priceInput && priceInput.value || 0),
      allowQuantity: groupAllowsQuantity || (qtyInput && qtyInput.checked === true),
      qtyEnabled: groupAllowsQuantity || (qtyInput && qtyInput.checked === true),
      defaultQuantity: defaultQty,
      maxQuantity: maxQty,
      maxQty: maxQty,
      enabled: !optionEnabledInput || optionEnabledInput.checked === true,
      sortOrder: (r + 1) * 1000
    };
    options.push(optionData);
    customItemsUpdates["customItems/" + optionId] = optionData;
  }
  var nowTime = Date.now ? Date.now() : new Date().getTime();
  var name = groupNameInput ? String(groupNameInput.value || "").trim() : "";
  if (!name) {
    alert("請輸入餐點選項名稱");
    return false;
  }
  var selectionType = normalizeSelectionType(selectionTypeInput ? selectionTypeInput.value : "single");
  var formalGroup = {
    id: id,
    name: name,
    area: area,
    type: area,
    selectionType: selectionType,
    choiceType: selectionType,
    visibility: modulesToVisibility(modules),
    modules: modules,
    required: requiredInput && requiredInput.checked === true,
    minSelect: Math.max(0, Number(minSelectInput && minSelectInput.value || 0)),
    maxSelect: Math.max(0, Number(maxSelectInput && maxSelectInput.value || 0)),
    description: descriptionInput ? String(descriptionInput.value || "").trim() : "",
    enabled: !enabledInput || enabledInput.checked === true,
    allowQuantity: allowQuantityInput && allowQuantityInput.checked === true,
    defaultQuantity: 1,
    maxQuantity: 1,
    sortOrder: Number((customGroupsData[id] && customGroupsData[id].sortOrder) || (customOptionGroupsData[id] && customOptionGroupsData[id].sortOrder) || nowTime),
    items: options,
    updatedAt: nowTime
  };
  var updates = {};
  updates["customGroups/" + id] = formalGroup;
  updates["customOptionGroups/" + id] = {
    id: id,
    name: name,
    area: formalGroup.area,
    type: formalGroup.type,
    selectionType: formalGroup.selectionType,
    choiceType: formalGroup.choiceType,
    modules: modules,
    visibility: formalGroup.visibility,
    required: formalGroup.required,
    minSelect: formalGroup.minSelect,
    maxSelect: formalGroup.maxSelect,
    description: formalGroup.description,
    enabled: formalGroup.enabled,
    allowQuantity: formalGroup.allowQuantity,
    sortOrder: formalGroup.sortOrder,
    options: options,
    updatedAt: nowTime
  };
  Object.keys(customItemsUpdates).forEach(function(key) { updates[key] = customItemsUpdates[key]; });
  await update(ref(db), updates);
    expandedCustomGroupId = id;
    if (customGroupsData) customGroupsData[id] = Object.assign({}, formalGroup);
    if (customOptionGroupsData) customOptionGroupsData[id] = Object.assign({}, updates["customOptionGroups/" + id]);
    if (button) button.textContent = "已儲存";
    renderCustomGroupEditor();
    return true;
  } catch (error) {
    console.error("餐點選項儲存失敗：", error);
    alert("餐點選項儲存失敗：" + (error && error.message ? error.message : error));
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function addCustomGroup() {
  var name = customGroupNameInput ? String(customGroupNameInput.value || "").trim() : "";
  if (!name) {
    alert("請輸入餐點選項名稱");
    return;
  }
  var area = customGroupAreaInput && customGroupAreaInput.value === "posOnly" ? "posOnly" : "customer";
  createCustomGroup(name, area);
  if (customGroupNameInput) customGroupNameInput.value = "";
}

function createCustomGroup(name, area) {
  name = String(name || "").trim();
  if (!name) return;
  var newRef = push(customOptionGroupsRef);
  var id = newRef.key;
  var nowTime = Date.now ? Date.now() : new Date().getTime();
  area = area === "posOnly" ? "posOnly" : "customer";
  var modules = defaultCustomGroupModulesForArea(area);
  var updates = {};
  updates["customOptionGroups/" + id] = { id: id, name: name, area: area, type: area, selectionType: "single", choiceType: "single", modules: modules, visibility: modulesToVisibility(modules), required: false, minSelect: 0, maxSelect: 1, description: "", enabled: true, sortOrder: nowTime, options: [], createdAt: nowTime, updatedAt: nowTime };
  updates["customGroups/" + id] = { id: id, name: name, area: area, type: area, selectionType: "single", choiceType: "single", modules: modules, visibility: modulesToVisibility(modules), required: false, minSelect: 0, maxSelect: 1, description: "", enabled: true, allowQuantity: false, defaultQuantity: 1, maxQuantity: 1, sortOrder: nowTime, items: [], createdAt: nowTime, updatedAt: nowTime };
  update(ref(db), updates);
}

function addCustomGroupOption(id) {
  var group = customGroupsData[id] || customOptionGroupsData[id] || {};
  var options = Array.isArray(group.items) ? group.items.slice() : (Array.isArray(group.options) ? group.options.slice() : []);
  options.push({ id: id + "-item-" + (Date.now ? Date.now() : new Date().getTime()), name: "", price: 0, allowQuantity: false, qtyEnabled: false, defaultQuantity: 1, maxQuantity: 1, maxQty: 1, enabled: true, sortOrder: (options.length + 1) * 1000 });
  var updates = {};
  updates["customGroups/" + id + "/items"] = options;
  updates["customGroups/" + id + "/updatedAt"] = Date.now();
  updates["customOptionGroups/" + id + "/options"] = options;
  updates["customOptionGroups/" + id + "/updatedAt"] = Date.now();
  update(ref(db), updates);
}

function deleteCustomGroup(id) {
  if (!confirm("確定刪除此餐點選項？")) return;
  var updates = {};
  updates["customOptionGroups/" + id] = null;
  updates["customGroups/" + id] = null;
  update(ref(db), updates);
  selectedCustomGroupIds = selectedCustomGroupIds.filter(function(item) { return item !== id; });
  renderItemCustomGroupPicker();
}

function renderCustomGroupEditorV650() {
  if (!customGroupEditorList) return;
  var groups = getCustomGroupItems();
  if (!groups.length) {
    customGroupEditorList.innerHTML = '<div class="empty small-empty">尚未建立餐點選項</div>';
    renderItemCustomGroupPicker();
    renderTemplateCustomGroupPicker();
    return;
  }
  var customerGroups = groups.filter(function(group) { return group.area !== "posOnly"; });
  var posOnlyGroups = groups.filter(function(group) { return group.area === "posOnly"; });
  customGroupEditorList.innerHTML =
    '<div class="menu-studio-flow"><span>餐點選項名稱</span><span>選擇方式</span><span>顯示位置</span><span>選項內容</span></div>' +
    renderCustomGroupSectionV649("餐點選項", "QR / POS / KDS / 出單；貼紙與線上訂餐先預留欄位", customerGroups) +
    renderCustomGroupSectionV649("POS 內部選項", "QR 不顯示；POS / KDS / 出單可使用", posOnlyGroups);
  bindCustomGroupEditorV649();
  renderItemCustomGroupPicker();
  renderTemplateCustomGroupPicker();
}

function renderCustomGroupSectionV649(title, subtitle, groups) {
  var area = title.indexOf("POS") >= 0 ? "posOnly" : "customer";
  var html = '<section class="menu-studio-custom-section"><div class="menu-studio-section-head"><div><h3>' + title + '</h3><p>' + subtitle + '</p></div><button type="button" class="secondary-btn add-area-group-btn" data-action="addAreaGroup" data-area="' + area + '">＋ 新增餐點選項</button></div><div class="menu-studio-custom-grid">';
  if (!groups.length) html += '<div class="empty small-empty">尚未建立</div>';
  for (var i = 0; i < groups.length; i += 1) html += renderCustomGroupCardV649(groups[i]);
  html += '</div></section>';
  return html;
}

function renderCustomGroupCardV649(group) {
  var modules = group.modules || defaultCustomGroupModulesForArea(group.area);
  if (group.area === "posOnly") modules.qr = false;
  var options = group.options || [];
  var optionHtml = "";
  for (var i = 0; i < options.length; i += 1) {
    var option = typeof options[i] === "string" ? { name: options[i] } : options[i];
    optionHtml += '<div class="custom-group-option-row" data-option-id="' + escapeHtml(option.id || option.itemId || "") + '">' +
      '<input data-field="name" value="' + escapeHtml(option.name || option.label || "") + '" placeholder="選項名稱" />' +
      '<input data-field="price" type="number" value="' + Number(option.price || 0) + '" placeholder="加價" />' +
      '<label><input data-field="qtyEnabled" type="checkbox" ' + (option.qtyEnabled || option.quantityEnabled || option.allowQuantity ? "checked" : "") + ' /> 可調數量</label>' +
      '<input data-field="defaultQuantity" type="number" min="1" max="99" value="' + Number(option.defaultQuantity || 1) + '" placeholder="預設數量" />' +
      '<input data-field="maxQty" type="number" min="1" max="99" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" placeholder="最大數量" />' +
      '<label><input data-field="optionEnabled" type="checkbox" ' + (option.enabled === false ? "" : "checked") + ' /> 啟用</label>' +
      '<button type="button" data-action="moveOptionUp">上移</button><button type="button" data-action="moveOptionDown">下移</button><button type="button" data-action="deleteOption">刪除</button>' +
    '</div>';
  }
  var summary = selectionTypeLabel(group.selectionType) + "｜" + (group.area === "posOnly" ? "POS 內部" : "客人可選") + "｜" + options.length + " 個內容｜" + (group.enabled === false ? "停用" : "啟用");
  return '<article class="custom-group-card menu-studio-card" data-id="' + escapeHtml(group.id) + '">' +
    '<button type="button" class="custom-group-summary" data-action="toggleCollapse"><span>▼ ' + escapeHtml(group.name || "未命名餐點選項") + '</span><small>' + escapeHtml(summary) + '</small></button>' +
    '<div class="custom-group-head">' +
      '<input data-field="groupName" value="' + escapeHtml(group.name || "") + '" placeholder="餐點選項名稱，例如：辣度、甜度、加急" />' +
      '<select data-field="groupType"><option value="customer" ' + (group.area !== "posOnly" ? "selected" : "") + '>客人可選項</option><option value="posOnly" ' + (group.area === "posOnly" ? "selected" : "") + '>POS 內部選項</option></select>' +
      '<select data-field="selectionType"><option value="single" ' + (group.selectionType === "single" ? "selected" : "") + '>單選</option><option value="multiple" ' + (group.selectionType === "multiple" ? "selected" : "") + '>多選</option><option value="toggle" ' + (group.selectionType === "toggle" ? "selected" : "") + '>開關</option><option value="quantity" ' + (group.selectionType === "quantity" ? "selected" : "") + '>可調數量</option></select>' +
    '</div>' +
    '<div class="custom-group-rules">' +
      '<label><input data-field="enabled" type="checkbox" ' + (group.enabled === false ? "" : "checked") + ' /> 啟用</label>' +
      '<label><input data-field="required" type="checkbox" ' + (group.required ? "checked" : "") + ' /> 必選</label>' +
      '<label><input data-field="allowQuantity" type="checkbox" ' + (group.allowQuantity ? "checked" : "") + ' /> 可調數量</label>' +
      '<input data-field="minSelect" type="number" min="0" max="99" value="' + Number(group.minSelect || 0) + '" placeholder="最少" />' +
      '<input data-field="maxSelect" type="number" min="0" max="99" value="' + Number(group.maxSelect || 0) + '" placeholder="最多" />' +
      '<input data-field="description" value="' + escapeHtml(group.description || "") + '" placeholder="說明文字，可留空" />' +
    '</div>' +
    '<div class="custom-group-modules">' + ["qr","pos","kds","print","sticker","online"].map(function(name) {
      var label = { qr:"QR", pos:"POS", kds:"KDS", print:"出單", sticker:"貼紙", online:"線上訂餐" }[name];
      var disabled = group.area === "posOnly" && name === "qr" ? " disabled" : "";
      return '<label><input data-module="' + name + '" type="checkbox" ' + (modules[name] === true ? "checked" : "") + disabled + ' /> ' + label + '</label>';
    }).join("") + '</div>' +
    '<div class="custom-group-options">' + optionHtml + '</div>' +
    '<div class="menu-studio-card-actions"><button type="button" data-action="previewGroup">查看套用/預覽</button><button type="button" data-action="copyGroup">複製</button><button type="button" data-action="moveGroupUp">上移</button><button type="button" data-action="moveGroupDown">下移</button><button type="button" data-action="addOption">新增選項</button><button type="button" data-action="deleteGroup">刪除</button></div>' +
  '</article>';
}

function bindCustomGroupEditorV649() {
  var cards = customGroupEditorList ? customGroupEditorList.querySelectorAll(".custom-group-card") : [];
  for (var c = 0; c < cards.length; c += 1) {
    (function(card) {
      var id = card.getAttribute("data-id");
      var inputs = card.querySelectorAll("input, select");
      for (var i = 0; i < inputs.length; i += 1) inputs[i].onchange = function() { saveCustomGroupFromCard(card, id); };
      var buttons = card.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b += 1) {
        buttons[b].onclick = function() {
          var action = this.getAttribute("data-action");
          if (action === "addOption") addCustomGroupOption(id);
          if (action === "deleteGroup") deleteCustomGroup(id);
          if (action === "copyGroup") copyCustomGroupV650(id);
          if (action === "moveGroupUp") moveCustomGroup(id, -1);
          if (action === "moveGroupDown") moveCustomGroup(id, 1);
          if (action === "previewGroup") previewCustomGroup(id);
          if (action === "toggleCollapse") {
            card.className = (" " + card.className + " ").indexOf(" collapsed ") >= 0 ? card.className.replace(/\bcollapsed\b/g, "") : card.className + " collapsed";
          }
          if (action === "moveOptionUp" || action === "moveOptionDown") {
            var optionRow = this.parentNode;
            var parent = optionRow && optionRow.parentNode;
            if (parent) {
              if (action === "moveOptionUp" && optionRow.previousElementSibling) parent.insertBefore(optionRow, optionRow.previousElementSibling);
              if (action === "moveOptionDown" && optionRow.nextElementSibling) parent.insertBefore(optionRow.nextElementSibling, optionRow);
              saveCustomGroupFromCard(card, id);
            }
          }
          if (action === "deleteOption") {
            var row = this.parentNode;
            if (row && row.parentNode) row.parentNode.removeChild(row);
            saveCustomGroupFromCard(card, id);
          }
          return false;
        };
      }
    })(cards[c]);
  }
  var areaButtons = customGroupEditorList ? customGroupEditorList.querySelectorAll('button[data-action="addAreaGroup"]') : [];
  for (var a = 0; a < areaButtons.length; a += 1) {
    areaButtons[a].onclick = function() {
      var area = this.getAttribute("data-area") === "posOnly" ? "posOnly" : "customer";
      var name = prompt(area === "posOnly" ? "請輸入 POS 內部餐點選項名稱" : "請輸入餐點選項名稱");
      if (!name) return false;
      createCustomGroup(name, area);
      return false;
    };
  }
}

function copyCustomGroup(id) {
  var source = normalizeCustomGroup(id, customGroupsData[id] || customOptionGroupsData[id]);
  var newId = push(customGroupsRef).key;
  var nowTime = Date.now ? Date.now() : new Date().getTime();
  var copy = {
    id: newId,
    name: (source.name || "餐點選項") + " 複製",
    area: source.area,
    type: source.type,
    selectionType: source.selectionType,
    choiceType: source.selectionType,
    modules: source.modules,
    visibility: source.visibility,
    required: source.required,
    minSelect: source.minSelect,
    maxSelect: source.maxSelect,
    description: source.description,
    enabled: source.enabled,
    allowQuantity: source.allowQuantity,
    defaultQuantity: source.defaultQuantity,
    maxQuantity: source.maxQuantity,
    sortOrder: nowTime,
    items: (source.options || []).map(function(option, index) {
      var next = {};
      Object.keys(option || {}).forEach(function(key) { next[key] = option[key]; });
      next.id = newId + "-item-" + nowTime + "-" + index;
      return next;
    }),
    createdAt: nowTime,
    updatedAt: nowTime
  };
  var updates = {};
  updates["customGroups/" + newId] = copy;
  updates["customOptionGroups/" + newId] = { id: newId, name: copy.name, area: copy.area, type: copy.type, selectionType: copy.selectionType, choiceType: copy.choiceType, visibility: copy.visibility, modules: copy.modules || visibilityToModules(copy.visibility), required: copy.required, minSelect: copy.minSelect, maxSelect: copy.maxSelect, description: copy.description, enabled: copy.enabled, sortOrder: copy.sortOrder, options: copy.items, createdAt: nowTime, updatedAt: nowTime };
  update(ref(db), updates);
}

function moveCustomGroup(id, direction) {
  var groups = getCustomGroupItems();
  var index = -1;
  for (var i = 0; i < groups.length; i += 1) if (groups[i].id === id) index = i;
  var target = index + direction;
  if (index < 0 || target < 0 || target >= groups.length) return;
  var moved = groups.splice(index, 1)[0];
  groups.splice(target, 0, moved);
  var updates = {};
  for (var j = 0; j < groups.length; j += 1) {
    updates["customGroups/" + groups[j].id + "/sortOrder"] = (j + 1) * 1000;
    updates["customOptionGroups/" + groups[j].id + "/sortOrder"] = (j + 1) * 1000;
  }
  update(ref(db), updates);
}

function previewCustomGroup(id) {
  var group = normalizeCustomGroup(id, customGroupsData[id] || customOptionGroupsData[id]);
  var options = group.options || [];
  var names = options.map(function(option) { return (typeof option === "string" ? option : option.name || option.label || "選項"); }).join("、");
  var applied = [];
  Object.keys(menuData || {}).forEach(function(itemId) {
    var item = menuData[itemId] || {};
    var ids = item.customGroupIds || item.customOptionGroupIds || item.optionGroupIds || [];
    if (Array.isArray(ids) && ids.indexOf(id) >= 0) applied.push(item.name || "未命名餐點");
  });
  alert("QR / POS / KDS 預覽\n\n" + (group.name || "餐點選項") + "\n" + (names || "尚未新增內容") + "\n\n目前套用餐點：\n" + (applied.length ? applied.join("、") : "尚未套用"));
}

function getCustomGroupUsage(id) {
  var items = [];
  var templates = [];
  Object.keys(menuData || {}).forEach(function(itemId) {
    var item = menuData[itemId] || {};
    var ids = item.customGroupIds || item.customOptionGroupIds || item.optionGroupIds || [];
    if (Array.isArray(ids) && ids.indexOf(id) >= 0) items.push(item.name || "未命名餐點");
  });
  Object.keys(optionTemplatesData || {}).forEach(function(templateId) {
    var template = optionTemplatesData[templateId] || {};
    var ids = template.customGroupIds || template.customOptionGroupIds || [];
    if (Array.isArray(ids) && ids.indexOf(id) >= 0) templates.push(template.name || "未命名範本");
  });
  return { items: items, templates: templates };
}

function getCustomGroupById(id) {
  return normalizeCustomGroup(id, (customGroupsData && customGroupsData[id]) || (customOptionGroupsData && customOptionGroupsData[id]) || {});
}

function renderCustomGroupEditorV649() {
  if (!customGroupEditorList) return;
  var groups = getCustomGroupItems();
  customGroupEditorList.innerHTML =
    '<div class="menu-studio-option-head"><div><h3>餐點選項</h3><p>先建立餐點選項，再加入範本與餐點。</p></div><button type="button" class="primary-btn" data-action="openCreateOption">＋ 新增餐點選項</button></div>' +
    (groups.length ? '<div class="menu-studio-option-grid">' + groups.map(renderMenuStudioOptionCard).join("") + '</div>' : '<div class="empty small-empty">尚未建立餐點選項</div>');
  bindMenuStudioOptionCards();
  renderItemCustomGroupPicker();
  renderTemplateCustomGroupPicker();
}

function renderMenuStudioOptionCard(group) {
  var usage = getCustomGroupUsage(group.id);
  var modules = group.modules || defaultCustomGroupModulesForArea(group.area);
  var options = group.options || [];
  var expanded = expandedCustomGroupId === group.id;
  var optionRows = options.map(function(option, index) {
    return renderMenuStudioCardOptionRow(group.id, option, index);
  }).join("");
  var expandedHtml = expanded ? (
    '<div class="menu-studio-card-editor">' +
      '<section class="menu-studio-card-section"><h4>基本設定</h4><div class="custom-group-head">' +
        '<input data-field="groupName" value="' + escapeHtml(group.name || "") + '" placeholder="餐點選項名稱，例如：辣度、加料" />' +
        '<select data-field="selectionType"><option value="single" ' + (group.selectionType === "single" ? "selected" : "") + '>一次只能選一個</option><option value="multiple" ' + (group.selectionType === "multiple" ? "selected" : "") + '>可以選很多個</option><option value="toggle" ' + (group.selectionType === "toggle" ? "selected" : "") + '>開關</option><option value="quantity" ' + (group.selectionType === "quantity" ? "selected" : "") + '>數量</option></select>' +
      '</div><div class="custom-group-rules">' +
        '<label><input data-field="enabled" type="checkbox" ' + (group.enabled === false ? "" : "checked") + ' /> 啟用</label>' +
        '<label><input data-field="required" type="checkbox" ' + (group.required ? "checked" : "") + ' /> 必選</label>' +
        '<label><input data-field="allowQuantity" type="checkbox" ' + (group.allowQuantity ? "checked" : "") + ' /> 可調數量</label>' +
        '<input data-field="minSelect" type="number" min="0" max="99" value="' + Number(group.minSelect || 0) + '" placeholder="最少" />' +
        '<input data-field="maxSelect" type="number" min="0" max="99" value="' + Number(group.maxSelect || 0) + '" placeholder="最多" />' +
        '<input data-field="description" value="' + escapeHtml(group.description || "") + '" placeholder="說明文字，可留空" />' +
      '</div></section>' +
      '<section class="menu-studio-card-section"><h4>顯示位置</h4><div class="custom-group-modules">' + ["qr","pos","kds","print"].map(function(name) {
        var label = { qr:"QR", pos:"POS", kds:"KDS", print:"印單" }[name];
        return '<label><input data-module="' + name + '" type="checkbox" ' + (modules[name] === true ? "checked" : "") + ' /> ' + label + '</label>';
      }).join("") + '</div></section>' +
      '<section class="menu-studio-card-section"><div class="studio-option-expanded-head"><strong>目前 ' + options.length + ' 個內容</strong><button type="button" class="secondary-btn" data-action="addContent">＋ 新增內容</button></div>' +
        '<div class="custom-group-options">' + (optionRows || '<div class="empty small-empty">目前 0 個內容，請按「＋ 新增內容」。</div>') + '</div>' +
      '</section>' +
      '<div class="menu-studio-card-save"><button type="button" class="primary-btn" data-action="saveCard">儲存</button></div>' +
    '</div>'
  ) : "";
  return '<article class="custom-group-card menu-studio-card ' + (expanded ? "expanded " : "") + (group.enabled === false ? "disabled" : "") + '" data-id="' + escapeHtml(group.id) + '">' +
    '<button type="button" class="custom-group-summary" data-action="toggleCollapse">' +
      '<span>' + escapeHtml(group.name || "未命名餐點選項") + '</span>' +
      '<small>類型：' + escapeHtml(selectionTypeLabel(group.selectionType)) + '｜內容：' + options.length + ' 個｜使用中：' + usage.items.length + ' 個餐點｜顯示：' + escapeHtml(moduleSummary(modules)) + '｜狀態：' + (group.enabled === false ? '停用' : '啟用') + '</small>' +
    '</button>' +
    '<div class="menu-studio-card-actions">' +
      '<button type="button" data-action="toggleCollapse">' + (expanded ? '收合' : '展開') + '</button>' +
      '<button type="button" data-action="editGroup">編輯</button>' +
      '<button type="button" data-action="copyGroup">複製</button>' +
      '<button type="button" data-action="moveGroupUp">上移</button>' +
      '<button type="button" data-action="moveGroupDown">下移</button>' +
      '<button type="button" data-action="toggleEnabled">' + (group.enabled === false ? '啟用' : '停用') + '</button>' +
      '<button type="button" class="danger-btn" data-action="deleteGroup">刪除</button>' +
    '</div>' +
    expandedHtml +
  '</article>';
}

function renderMenuStudioCardOptionRow(groupId, option, index) {
  option = option || {};
  return '<div class="custom-group-option-row studio-card-option-row" data-option-id="' + escapeHtml(option.id || option.itemId || groupId + "-item-" + index) + '">' +
    '<input data-field="name" value="' + escapeHtml(option.name || "") + '" placeholder="內容名稱，例如：微辣" />' +
    '<input data-field="price" type="number" value="' + Number(option.price || 0) + '" placeholder="加價" />' +
    '<label><input data-field="qtyEnabled" type="checkbox" ' + (option.qtyEnabled || option.allowQuantity ? "checked" : "") + ' /> 可調數量</label>' +
    '<input data-field="defaultQuantity" type="number" min="1" max="99" value="' + Number(option.defaultQuantity || 1) + '" placeholder="預設數量" />' +
    '<input data-field="maxQty" type="number" min="1" max="99" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" placeholder="最大數量" />' +
    '<label><input data-field="optionEnabled" type="checkbox" ' + (option.enabled === false ? "" : "checked") + ' /> 啟用</label>' +
    '<button type="button" data-action="moveOptionUp">上移</button><button type="button" data-action="moveOptionDown">下移</button><button type="button" data-action="deleteOption">刪除</button>' +
  '</div>';
}

function bindMenuStudioOptionCards() {
  var createBtn = customGroupEditorList ? customGroupEditorList.querySelector('[data-action="openCreateOption"]') : null;
  if (createBtn) createBtn.onclick = function() { openCustomGroupModal("create", ""); return false; };
  var cards = customGroupEditorList ? customGroupEditorList.querySelectorAll(".custom-group-card") : [];
  for (var c = 0; c < cards.length; c += 1) {
    (function(card) {
      var id = card.getAttribute("data-id");
      var lastTouchAt = 0;
      card.onclick = function(event) {
        if (Date.now && Date.now() - lastTouchAt < 450) return false;
        return handleMenuStudioOptionCardAction(event, card, id);
      };
      card.ontouchend = function(event) {
        lastTouchAt = Date.now ? Date.now() : new Date().getTime();
        return handleMenuStudioOptionCardAction(event, card, id);
      };
    })(cards[c]);
  }
}

function findActionButton(target, card) {
  var node = target;
  while (node && node !== card) {
    if (node.tagName === "BUTTON" && node.getAttribute("data-action")) return node;
    node = node.parentNode;
  }
  return null;
}

function handleMenuStudioOptionCardAction(event, card, id) {
  event = event || window.event;
  var button = findActionButton(event.target || event.srcElement, card);
  if (!button) return true;
  if (event.preventDefault) event.preventDefault();
  if (event.stopPropagation) event.stopPropagation();
  var action = button.getAttribute("data-action");
  if (action === "toggleCollapse") {
    expandedCustomGroupId = expandedCustomGroupId === id ? "" : id;
    renderCustomGroupEditor();
  }
  if (action === "editGroup") openCustomGroupModal("edit", id);
  if (action === "previewGroup") previewCustomGroup(id);
  if (action === "copyGroup") copyCustomGroup(id);
  if (action === "moveGroupUp") moveCustomGroup(id, -1);
  if (action === "moveGroupDown") moveCustomGroup(id, 1);
  if (action === "toggleEnabled") toggleCustomGroupEnabled(id);
  if (action === "deleteGroup") deleteCustomGroupV650(id);
  if (action === "addContent") addCardContentRow(card, id);
  if (action === "saveCard") saveCustomGroupFromCard(card, id, button);
  if (action === "moveOptionUp" || action === "moveOptionDown") moveCardContentRow(button, action);
  if (action === "deleteOption") deleteCardContentRow(button);
  return false;
}

function addCardContentRow(card, id) {
  if (!card) return;
  var list = card.querySelector(".custom-group-options");
  if (!list) return;
  var empty = list.querySelector(".empty");
  if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
  var wrap = document.createElement("div");
  wrap.innerHTML = renderMenuStudioCardOptionRow(id, createBlankCustomOption(id), list.querySelectorAll(".custom-group-option-row").length);
  var row = wrap.firstChild;
  list.appendChild(row);
  updateCardContentCount(card);
  var nameInput = row.querySelector('input[data-field="name"]');
  if (nameInput) nameInput.focus();
}

function updateCardContentCount(card) {
  if (!card) return;
  var count = card.querySelectorAll(".custom-group-option-row").length;
  var label = card.querySelector(".studio-option-expanded-head strong");
  if (label) label.textContent = "目前 " + count + " 個內容";
}

function moveCardContentRow(button, action) {
  var row = button && button.parentNode;
  var parent = row && row.parentNode;
  if (!row || !parent) return;
  if (action === "moveOptionUp" && row.previousElementSibling) parent.insertBefore(row, row.previousElementSibling);
  if (action === "moveOptionDown" && row.nextElementSibling) parent.insertBefore(row.nextElementSibling, row);
}

function deleteCardContentRow(button) {
  var row = button && button.parentNode;
  var card = row;
  while (card && (!card.className || String(card.className).indexOf("custom-group-card") < 0)) card = card.parentNode;
  if (row && row.parentNode) row.parentNode.removeChild(row);
  updateCardContentCount(card);
}

function ensureCustomGroupModal() {
  var modal = document.getElementById("customGroupModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "customGroupModal";
  modal.className = "menu-studio-modal hidden";
  modal.innerHTML = '<div class="menu-studio-modal-backdrop"></div><section class="menu-studio-modal-card" role="dialog" aria-modal="true"><div id="customGroupModalContent"></div></section>';
  document.body.appendChild(modal);
  var backdrop = modal.querySelector(".menu-studio-modal-backdrop");
  var card = modal.querySelector(".menu-studio-modal-card");
  if (backdrop) {
    backdrop.addEventListener("touchmove", function(event) {
      if (event && event.preventDefault) event.preventDefault();
    }, { passive: false });
  }
  if (card) {
    card.addEventListener("touchmove", function(event) {
      if (event && event.stopPropagation) event.stopPropagation();
    }, { passive: true });
  }
  return modal;
}

function openCustomGroupModal(mode, id, addBlankContent) {
  customGroupModalMode = mode === "edit" ? "edit" : "create";
  customGroupModalId = id || "";
  var group = customGroupModalMode === "edit" ? getCustomGroupById(id) : {
    id: "",
    name: "",
    selectionType: "single",
    required: false,
    minSelect: 0,
    maxSelect: 1,
    description: "",
    enabled: true,
    allowQuantity: false,
    modules: { qr: true, pos: true, kds: true, print: true, sticker: false, online: false },
    options: []
  };
  customGroupDraftOptions = (group.options || []).map(function(option) {
    var next = {};
    Object.keys(option || {}).forEach(function(key) { next[key] = option[key]; });
    return next;
  });
  if (addBlankContent) customGroupDraftOptions.push(createBlankCustomOption(id));
  renderCustomGroupModal(group);
  var modal = ensureCustomGroupModal();
  modal.classList.remove("hidden");
  if (document.body && document.body.className.indexOf("admin-modal-open") < 0) document.body.className += " admin-modal-open";
}

function closeCustomGroupModal() {
  var modal = ensureCustomGroupModal();
  modal.classList.add("hidden");
  customGroupModalId = "";
  customGroupDraftOptions = [];
  if (document.body) document.body.className = document.body.className.replace(/\badmin-modal-open\b/g, "").replace(/\s+/g, " ");
}

function renderCustomGroupModal(group) {
  var modal = ensureCustomGroupModal();
  var content = modal.querySelector("#customGroupModalContent");
  var isEdit = customGroupModalMode === "edit";
  var usage = isEdit ? getCustomGroupUsage(group.id) : { items: [], templates: [] };
  content.innerHTML =
    '<header class="menu-studio-modal-header"><div><h2>' + (isEdit ? '編輯餐點選項｜' + escapeHtml(group.name || "") : '新增餐點選項') + '</h2><p>' + (isEdit ? '修改共用餐點選項，不會建立新群組。' : '第一步只填基本資料，建立後再新增內容。') + '</p></div><button type="button" class="item-editor-close-btn" data-action="cancelModal">×</button></header>' +
    '<div class="menu-studio-modal-body">' +
      renderCustomGroupBasicFields(group) +
      (isEdit ? renderCustomGroupContentEditor(group, usage) : '') +
    '</div>' +
    '<footer class="menu-studio-modal-actions"><button type="button" class="secondary-btn" data-action="cancelModal">取消</button><button type="button" class="primary-btn" data-action="saveModal">' + (isEdit ? '儲存修改' : '建立餐點選項') + '</button></footer>';
  bindCustomGroupModalEvents(group);
}

function renderCustomGroupBasicFields(group) {
  var modules = group.modules || {};
  return '<section class="menu-studio-modal-section"><h3>基本設定</h3>' +
    '<label>餐點選項名稱<input id="groupModalName" value="' + escapeHtml(group.name || "") + '" placeholder="例如：份量、辣度、加料、不要項目" /></label>' +
    '<div class="menu-studio-radio-grid"><label><input type="radio" name="groupModalType" value="single" ' + (group.selectionType === "single" ? "checked" : "") + ' /> 一次只能選一個<span>例如份量、辣度、甜度。</span></label><label><input type="radio" name="groupModalType" value="multiple" ' + (group.selectionType === "multiple" ? "checked" : "") + ' /> 可以選很多個<span>例如加料、不要項目。</span></label><label><input type="radio" name="groupModalType" value="toggle" ' + (group.selectionType === "toggle" ? "checked" : "") + ' /> 開關<span>只有選或不選，例如湯另外裝。</span></label><label><input type="radio" name="groupModalType" value="quantity" ' + (group.selectionType === "quantity" ? "checked" : "") + ' /> 數量<span>直接增加或減少數量，例如餐具、醬包。</span></label></div>' +
    '<div class="menu-studio-inline-fields"><label><input id="groupModalRequired" type="checkbox" ' + (group.required ? "checked" : "") + ' /> 必選</label><label>最少<input id="groupModalMin" type="number" min="0" max="99" value="' + Number(group.minSelect || 0) + '" /></label><label>最多<input id="groupModalMax" type="number" min="0" max="99" value="' + Number(group.maxSelect || 1) + '" /></label><label><input id="groupModalEnabled" type="checkbox" ' + (group.enabled === false ? "" : "checked") + ' /> 啟用</label></div>' +
    '<h3>顯示位置</h3><div class="menu-studio-module-grid">' + ["qr","pos","kds","print"].map(function(name) {
      var label = { qr:"QR", pos:"POS", kds:"廚房", print:"印單" }[name];
      var hint = { qr:"客人掃碼點餐時可看到並選擇。", pos:"店員點餐時可看到並選擇。", kds:"廚房顯示最後選擇結果。", print:"廚房單、客人單顯示結果。" }[name];
      return '<label><input data-modal-module="' + name + '" type="checkbox" ' + (modules[name] === true ? "checked" : "") + ' /> <strong>' + label + '</strong><span>' + hint + '</span></label>';
    }).join("") + '</div>' +
    '<label>說明文字<input id="groupModalDescription" value="' + escapeHtml(group.description || "") + '" placeholder="例如：請選擇辣度" /></label>' +
  '</section>';
}

function renderCustomGroupContentEditor(group, usage) {
  var rows = customGroupDraftOptions.map(function(option, index) {
    return '<div class="custom-group-option-row studio-modal-option-row" data-index="' + index + '" data-option-id="' + escapeHtml(option.id || option.itemId || "") + '">' +
      '<input data-field="name" value="' + escapeHtml(option.name || "") + '" placeholder="選項名稱" />' +
      '<input data-field="price" type="number" value="' + Number(option.price || 0) + '" placeholder="加價" />' +
      '<label><input data-field="qtyEnabled" type="checkbox" ' + (option.qtyEnabled || option.allowQuantity ? "checked" : "") + ' /> 可調數量</label>' +
      '<input data-field="defaultQuantity" type="number" min="1" max="99" value="' + Number(option.defaultQuantity || 1) + '" placeholder="預設數量" />' +
      '<input data-field="maxQty" type="number" min="1" max="99" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" placeholder="最大數量" />' +
      '<label><input data-field="optionEnabled" type="checkbox" ' + (option.enabled === false ? "" : "checked") + ' /> 啟用</label>' +
      '<button type="button" data-action="moveOptionUp">上移</button><button type="button" data-action="moveOptionDown">下移</button><button type="button" data-action="deleteOption">刪除</button>' +
    '</div>';
  }).join("");
  var itemNames = usage.items.slice(0, 5).map(function(name) { return '<li>' + escapeHtml(name) + '</li>'; }).join("");
  var moreText = usage.items.length > 5 ? '<p>另有 ' + (usage.items.length - 5) + ' 個餐點。</p>' : "";
  return '<section class="menu-studio-modal-section"><h3>選項內容</h3><div id="groupModalOptions">' + (rows || '<div class="empty small-empty">尚未新增內容。</div>') + '</div><button type="button" class="secondary-btn" data-action="addOptionRow">＋ 新增內容</button></section>' +
    '<section class="menu-studio-modal-section"><h3>使用狀況</h3><p>目前被 ' + usage.items.length + ' 個餐點使用。</p><p>目前被 ' + usage.templates.length + ' 個範本使用。</p><ul>' + itemNames + '</ul>' + moreText + '</section>';
}

function bindCustomGroupModalEvents(group) {
  var modal = ensureCustomGroupModal();
  var content = modal.querySelector("#customGroupModalContent");
  var cancelButtons = content.querySelectorAll('[data-action="cancelModal"]');
  for (var i = 0; i < cancelButtons.length; i += 1) cancelButtons[i].onclick = closeCustomGroupModal;
  var saveButton = content.querySelector('[data-action="saveModal"]');
  if (saveButton) saveButton.onclick = function() { saveCustomGroupFromModal(group); };
  var addButton = content.querySelector('[data-action="addOptionRow"]');
  if (addButton) addButton.onclick = function() {
    syncCustomGroupDraftFromModal();
    customGroupDraftOptions.push(createBlankCustomOption(customGroupModalId));
    renderCustomGroupModal(group);
    return false;
  };
  var optionButtons = content.querySelectorAll(".studio-modal-option-row button");
  for (var b = 0; b < optionButtons.length; b += 1) {
    optionButtons[b].onclick = function() {
      syncCustomGroupDraftFromModal();
      var row = findClosestByClass(this, "studio-modal-option-row");
      var index = Number(row && row.getAttribute("data-index"));
      var action = this.getAttribute("data-action");
      if (action === "moveOptionUp" && index > 0) {
        var prev = customGroupDraftOptions[index - 1];
        customGroupDraftOptions[index - 1] = customGroupDraftOptions[index];
        customGroupDraftOptions[index] = prev;
      }
      if (action === "moveOptionDown" && index < customGroupDraftOptions.length - 1) {
        var next = customGroupDraftOptions[index + 1];
        customGroupDraftOptions[index + 1] = customGroupDraftOptions[index];
        customGroupDraftOptions[index] = next;
      }
      if (action === "deleteOption") customGroupDraftOptions.splice(index, 1);
      renderCustomGroupModal(group);
      return false;
    };
  }
}

function createBlankCustomOption(groupId) {
  return { id: (groupId || "new") + "-item-" + (Date.now ? Date.now() : new Date().getTime()), name: "", price: 0, allowQuantity: false, qtyEnabled: false, defaultQuantity: 1, maxQuantity: 1, maxQty: 1, enabled: true };
}

function syncCustomGroupDraftFromModal() {
  var modal = ensureCustomGroupModal();
  var rows = modal.querySelectorAll(".studio-modal-option-row");
  var next = [];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var nameInput = row.querySelector('[data-field="name"]');
    var priceInput = row.querySelector('[data-field="price"]');
    var qtyInput = row.querySelector('[data-field="qtyEnabled"]');
    var defaultQtyInput = row.querySelector('[data-field="defaultQuantity"]');
    var maxQtyInput = row.querySelector('[data-field="maxQty"]');
    var enabledInput = row.querySelector('[data-field="optionEnabled"]');
    next.push({
      id: row.getAttribute("data-option-id") || createBlankCustomOption(customGroupModalId).id,
      name: nameInput ? String(nameInput.value || "").trim() : "",
      price: Number(priceInput && priceInput.value || 0),
      allowQuantity: qtyInput && qtyInput.checked === true,
      qtyEnabled: qtyInput && qtyInput.checked === true,
      defaultQuantity: Math.max(1, Number(defaultQtyInput && defaultQtyInput.value || 1)),
      maxQuantity: Math.max(1, Number(maxQtyInput && maxQtyInput.value || 1)),
      maxQty: Math.max(1, Number(maxQtyInput && maxQtyInput.value || 1)),
      enabled: !enabledInput || enabledInput.checked === true,
      sortOrder: (i + 1) * 1000
    });
  }
  customGroupDraftOptions = next;
}

function readCustomGroupModalData(group) {
  var modal = ensureCustomGroupModal();
  syncCustomGroupDraftFromModal();
  var nameInput = modal.querySelector("#groupModalName");
  var typeInput = modal.querySelector('input[name="groupModalType"]:checked');
  var requiredInput = modal.querySelector("#groupModalRequired");
  var minInput = modal.querySelector("#groupModalMin");
  var maxInput = modal.querySelector("#groupModalMax");
  var enabledInput = modal.querySelector("#groupModalEnabled");
  var descriptionInput = modal.querySelector("#groupModalDescription");
  var modules = { qr: false, pos: false, kds: false, print: false, sticker: false, online: false };
  var moduleInputs = modal.querySelectorAll("input[data-modal-module]");
  for (var i = 0; i < moduleInputs.length; i += 1) modules[moduleInputs[i].getAttribute("data-modal-module")] = moduleInputs[i].checked === true;
  var selectionType = normalizeSelectionType(typeInput ? typeInput.value : "single");
  var previousType = group && group.selectionType ? group.selectionType : "single";
  if (previousType !== selectionType && (selectionType === "toggle" || selectionType === "quantity") && customGroupDraftOptions.filter(function(option) { return option.name; }).length > 1) {
    if (!confirm(selectionType === "toggle" ? "開關類型通常只需要一個內容，目前有多筆內容，是否繼續？" : "數量類型通常只保留第一筆作為名稱，目前有多筆內容，是否繼續？")) return null;
  }
  return {
    name: nameInput ? String(nameInput.value || "").trim() : "",
    area: "customer",
    type: "customer",
    selectionType: selectionType,
    choiceType: selectionType,
    modules: modules,
    visibility: modulesToVisibility(modules),
    required: requiredInput && requiredInput.checked === true,
    minSelect: Math.max(0, Number(minInput && minInput.value || 0)),
    maxSelect: Math.max(0, Number(maxInput && maxInput.value || 0)),
    description: descriptionInput ? String(descriptionInput.value || "").trim() : "",
    enabled: !enabledInput || enabledInput.checked === true,
    allowQuantity: selectionType === "quantity",
    defaultQuantity: 1,
    maxQuantity: 1,
    options: customGroupDraftOptions.filter(function(option) { return option.name; }).map(function(option, index) {
      option.sortOrder = (index + 1) * 1000;
      return option;
    })
  };
}

async function saveCustomGroupFromModal(group) {
  var data = readCustomGroupModalData(group || {});
  if (!data) return;
  if (!data.name) {
    alert("請輸入餐點選項名稱");
    return;
  }
  var nowTime = Date.now ? Date.now() : new Date().getTime();
  var id = customGroupModalMode === "edit" ? customGroupModalId : push(customOptionGroupsRef).key;
  var previous = (customGroupsData && customGroupsData[id]) || (customOptionGroupsData && customOptionGroupsData[id]) || {};
  data.id = id;
  data.sortOrder = Number(previous.sortOrder || nowTime);
  data.updatedAt = nowTime;
  if (customGroupModalMode !== "edit") data.createdAt = nowTime;
  var updates = {};
  updates["customGroups/" + id] = Object.assign({}, data, { items: data.options });
  updates["customOptionGroups/" + id] = Object.assign({}, data, { options: data.options });
  for (var i = 0; i < data.options.length; i += 1) updates["customItems/" + data.options[i].id] = data.options[i];
  try {
    await update(ref(db), updates);
    expandedCustomGroupId = id;
    closeCustomGroupModal();
    renderCustomGroupEditor();
  } catch (error) {
    console.error("餐點選項儲存失敗：", error);
    alert("餐點選項儲存失敗");
  }
}

function addCustomGroupV650() {
  var name = customGroupNameInput ? String(customGroupNameInput.value || "").trim() : "";
  openCustomGroupModal("create", "");
  var modal = ensureCustomGroupModal();
  var input = modal.querySelector("#groupModalName");
  if (input && name) input.value = name;
  if (customGroupNameInput) customGroupNameInput.value = "";
}

function toggleCustomGroupEnabled(id) {
  var group = getCustomGroupById(id);
  var nextEnabled = group.enabled === false;
  update(ref(db), {
    ["customGroups/" + id + "/enabled"]: nextEnabled,
    ["customGroups/" + id + "/updatedAt"]: Date.now(),
    ["customOptionGroups/" + id + "/enabled"]: nextEnabled,
    ["customOptionGroups/" + id + "/updatedAt"]: Date.now()
  });
}

function deleteCustomGroupV650(id) {
  var group = getCustomGroupById(id);
  var usage = getCustomGroupUsage(id);
  if (usage.items.length || usage.templates.length) {
    if (confirm((group.name || "餐點選項") + " 目前被 " + usage.items.length + " 個餐點與 " + usage.templates.length + " 個範本使用。\n\n按「確定」改為停用，按「取消」返回。")) {
      if (group.enabled !== false) toggleCustomGroupEnabled(id);
    }
    return;
  }
  if (!confirm("確定刪除「" + (group.name || "餐點選項") + "」？")) return;
  var updates = {};
  updates["customOptionGroups/" + id] = null;
  updates["customGroups/" + id] = null;
  update(ref(db), updates);
}

function copyCustomGroupV650(id) {
  var source = getCustomGroupById(id);
  var newId = push(customGroupsRef).key;
  var nowTime = Date.now ? Date.now() : new Date().getTime();
  var copyOptions = (source.options || []).map(function(option, index) {
    var next = {};
    Object.keys(option || {}).forEach(function(key) { next[key] = option[key]; });
    next.id = newId + "-item-" + nowTime + "-" + index;
    next.sortOrder = (index + 1) * 1000;
    return next;
  });
  var copy = Object.assign({}, source, {
    id: newId,
    name: (source.name || "餐點選項") + "（副本）",
    sortOrder: nowTime,
    options: copyOptions,
    items: copyOptions,
    createdAt: nowTime,
    updatedAt: nowTime
  });
  var updates = {};
  updates["customGroups/" + newId] = copy;
  updates["customOptionGroups/" + newId] = Object.assign({}, copy, { options: copyOptions });
  update(ref(db), updates);
}

renderCustomGroupEditor = renderCustomGroupEditorV649;
addCustomGroup = addCustomGroupV650;
deleteCustomGroup = deleteCustomGroupV650;
copyCustomGroup = copyCustomGroupV650;

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

onValue(customOptionGroupsRef, snapshot => {
  customOptionGroupsData = snapshot.exists() ? snapshot.val() : {};
  renderCustomGroupEditor();
});

onValue(customGroupsRef, snapshot => {
  customGroupsData = snapshot.exists() ? snapshot.val() : {};
  renderCustomGroupEditor();
});

onValue(customItemsRef, snapshot => {
  customItemsData = snapshot.exists() ? snapshot.val() : {};
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

if (itemCategory) {
  itemCategory.addEventListener("change", function() {
    applyCategoryDefaultTemplateToForm(itemCategory.value);
  });
}

if (addSizeRowBtn) {
  addAdminTapListener(addSizeRowBtn, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    addSizeRow();
  });
}

if (addAddonRowBtn) {
  addAdminTapListener(addAddonRowBtn, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    addAddonRow();
  });
}

if (addRemoveOptionRowBtn) {
  addAdminTapListener(addRemoveOptionRowBtn, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    addRemoveOptionRow();
  });
}

if (addCustomGroupBtn) {
  addAdminTapListener(addCustomGroupBtn, function(event) {
    if (event && event.preventDefault) event.preventDefault();
    addCustomGroup();
  });
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

function initMenuStudioV64() {
  var headerTitle = document.querySelector(".admin-topbar h1");
  var headerText = document.querySelector(".admin-topbar p");
  if (headerTitle) headerTitle.textContent = "Menu Studio";
  if (headerText) headerText.textContent = "餐點選項、範本、分類、新增餐點與菜單列表";

  var tabOrder = ["itemAdminTab", "addItemAdminTab", "optionAdminTab", "templateAdminTab", "categoryAdminTab", "mediaAdminTab"];
  var nav = document.querySelector(".admin-page-tabs");
  for (var i = 0; nav && i < tabOrder.length; i += 1) {
    var btn = document.querySelector('[data-admin-tab="' + tabOrder[i] + '"]');
    if (btn) nav.appendChild(btn);
  }

  var labels = {
    itemAdminTab: "菜單列表",
    addItemAdminTab: "新增餐點",
    optionAdminTab: "餐點選項",
    templateAdminTab: "範本管理",
    categoryAdminTab: "分類管理",
    mediaAdminTab: "圖片"
  };
  Object.keys(labels).forEach(function(tabId) {
    var button = document.querySelector('[data-admin-tab="' + tabId + '"]');
    if (button) button.textContent = labels[tabId];
  });

  var mediaBtn = document.querySelector('[data-admin-tab="mediaAdminTab"]');
  var mediaPanel = document.getElementById("mediaAdminTab");
  if (mediaBtn) mediaBtn.style.display = "none";
  if (mediaPanel) mediaPanel.style.display = "none";
}

initAdminV63Ux();
initMenuStudioV64();
resetForm();
switchAdminTab("itemAdminTab");
hideAppLoadingScreen();

function hideAppLoadingScreen() {
  var el = document.getElementById("appLoadingScreen");
  if (el && (" " + (el.className || "") + " ").indexOf(" hidden ") === -1) {
    el.className += " hidden";
  }
}

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
