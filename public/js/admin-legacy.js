(function() {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyBz5ixYBa6q6yB4uObJNdUVqDuL8X4uyw0",
    authDomain: "enpoint-pos.firebaseapp.com",
    databaseURL: "https://enpoint-pos-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "enpoint-pos",
    storageBucket: "enpoint-pos.firebasestorage.app",
    messagingSenderId: "1085275616655",
    appId: "1:1085275616655:web:96a86e2d6bf89d2717c7fa"
  };

  var db = null;
  var data = {
    menu: {},
    menuItems: {},
    categories: {},
    customGroups: {},
    customOptionGroups: {},
    optionGroups: {},
    optionTemplates: {},
    templates: {},
    settings: {}
  };
  var state = {
    activeTab: "menu",
    categoryFilter: "全部",
    editingItemId: "",
    editingGroupId: "",
    editingTemplateId: "",
    selectedItemGroupIds: [],
    modalScrollY: 0
  };

  function $(id) {
    return document.getElementById(id);
  }

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setStatus(message, isError) {
    var el = $("legacyStatus");
    if (!el) return;
    el.className = isError ? "legacy-status legacy-error" : "legacy-status";
    el.innerHTML = escapeHtml(message);
  }

  function setBox(id, message, isError) {
    var el = $(id);
    if (!el) return;
    el.className = isError ? "legacy-list-state legacy-error" : "legacy-list-state legacy-empty";
    el.innerHTML = escapeHtml(message);
  }

  function hasClass(el, name) {
    return (" " + (el.className || "") + " ").indexOf(" " + name + " ") >= 0;
  }

  function addClass(el, name) {
    if (!el || hasClass(el, name)) return;
    el.className = el.className ? el.className + " " + name : name;
  }

  function removeClass(el, name) {
    if (!el) return;
    el.className = (" " + (el.className || "") + " ").replace(" " + name + " ", " ").replace(/^\s+|\s+$/g, "");
  }

  function bindTap(el, handler) {
    if (!el || !handler) return;
    var lastTouchAt = 0;
    function run(event) {
      var t = now();
      event = event || window.event;
      if (event.type === "touchend") lastTouchAt = t;
      if (event.type === "click" && t - lastTouchAt < 500) return;
      handler(event);
    }
    el.addEventListener("click", run, false);
    el.addEventListener("touchend", run, false);
  }

  function getKeys(obj) {
    return Object.keys(obj || {});
  }

  function copyObject(source) {
    var out = {};
    var keys = getKeys(source);
    var i;
    for (i = 0; i < keys.length; i += 1) out[keys[i]] = source[keys[i]];
    return out;
  }

  function mergeById(primary, fallback) {
    var out = {};
    var keys;
    var i;
    keys = getKeys(fallback);
    for (i = 0; i < keys.length; i += 1) out[keys[i]] = fallback[keys[i]];
    keys = getKeys(primary);
    for (i = 0; i < keys.length; i += 1) out[keys[i]] = primary[keys[i]];
    return out;
  }

  function firebasePushKey(path) {
    return db.ref(path).push().key;
  }

  function normalizeSelectionType(value) {
    if (value === "multi") return "multiple";
    if (value === "multiple" || value === "quantity" || value === "toggle") return value;
    return "single";
  }

  function selectionLabel(value) {
    value = normalizeSelectionType(value);
    if (value === "multiple") return "多選";
    if (value === "quantity") return "數量";
    if (value === "toggle") return "開關";
    return "單選";
  }

  function defaultModules(area) {
    return {
      qr: area === "posOnly" ? false : true,
      pos: true,
      kds: true,
      print: true,
      sticker: false,
      online: false
    };
  }

  function modulesToVisibility(modules) {
    modules = modules || defaultModules("customer");
    return {
      qr: modules.qr === true,
      pos: modules.pos !== false,
      kds: modules.kds !== false,
      print: modules.print !== false,
      sticker: modules.sticker === true,
      onlineOrder: modules.online === true
    };
  }

  function visibilityToModules(visibility) {
    visibility = visibility || {};
    return {
      qr: visibility.qr === true,
      pos: visibility.pos !== false,
      kds: visibility.kds !== false,
      print: visibility.print !== false,
      sticker: visibility.sticker === true,
      online: visibility.onlineOrder === true || visibility.online === true
    };
  }

  function normalizeGroup(id, group) {
    var source = group || {};
    var area = source.area || source.type || "customer";
    var rawOptions = [];
    var options = [];
    var modules;
    var i;
    var row;
    var maxQty;
    if (area !== "posOnly") area = "customer";
    modules = source.modules || visibilityToModules(source.visibility);
    modules = mergeById(modules, defaultModules(area));
    if (area === "posOnly") modules.qr = false;
    if (source.options && source.options.length) rawOptions = source.options;
    else if (source.items && source.items.length) rawOptions = source.items;
    for (i = 0; i < rawOptions.length; i += 1) {
      row = typeof rawOptions[i] === "string" ? { name: rawOptions[i] } : (rawOptions[i] || {});
      if (!row.name && !row.label && !row.value) continue;
      maxQty = Math.max(1, Number(row.maxQuantity || row.maxQty || 1));
      options.push({
        id: row.id || row.itemId || id + "-item-" + i,
        name: row.name || row.label || row.value || "",
        price: Number(row.price || 0),
        allowQuantity: row.allowQuantity === true || row.qtyEnabled === true || row.quantityEnabled === true,
        qtyEnabled: row.allowQuantity === true || row.qtyEnabled === true || row.quantityEnabled === true,
        defaultQuantity: Math.max(1, Number(row.defaultQuantity || 1)),
        maxQuantity: maxQty,
        maxQty: maxQty,
        enabled: row.enabled !== false,
        sortOrder: Number(row.sortOrder || ((i + 1) * 1000))
      });
    }
    options.sort(function(a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
    return {
      id: id,
      name: source.name || source.title || "未命名餐點選項",
      area: area,
      type: area,
      selectionType: normalizeSelectionType(source.selectionType || source.choiceType || (source.allowQuantity ? "quantity" : "single")),
      choiceType: normalizeSelectionType(source.selectionType || source.choiceType || (source.allowQuantity ? "quantity" : "single")),
      modules: modules,
      visibility: source.visibility || modulesToVisibility(modules),
      required: source.required === true,
      minSelect: Math.max(0, Number(source.minSelect || 0)),
      maxSelect: Math.max(0, Number(source.maxSelect || 0)),
      description: source.description || "",
      enabled: source.enabled !== false,
      options: options,
      items: options,
      sortOrder: Number(source.sortOrder || 0)
    };
  }

  function getMenuMap() {
    return mergeById(data.menu, data.menuItems);
  }

  function getTemplateMap() {
    return mergeById(data.optionTemplates, data.templates);
  }

  function getGroupMap() {
    return mergeById(data.customGroups, mergeById(data.customOptionGroups, data.optionGroups));
  }

  function getMenuItems() {
    var map = getMenuMap();
    var keys = getKeys(map);
    var list = [];
    var i;
    var item;
    for (i = 0; i < keys.length; i += 1) {
      item = copyObject(map[keys[i]] || {});
      item.id = keys[i];
      list.push(item);
    }
    list.sort(function(a, b) {
      return Number(a.sortOrder || 999999999) - Number(b.sortOrder || 999999999);
    });
    return list;
  }

  function getGroups() {
    var map = getGroupMap();
    var keys = getKeys(map);
    var list = [];
    var i;
    for (i = 0; i < keys.length; i += 1) list.push(normalizeGroup(keys[i], map[keys[i]]));
    list.sort(function(a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
    return list;
  }

  function getTemplates() {
    var map = getTemplateMap();
    var keys = getKeys(map);
    var list = [];
    var i;
    var item;
    for (i = 0; i < keys.length; i += 1) {
      item = copyObject(map[keys[i]] || {});
      item.id = keys[i];
      list.push(item);
    }
    list.sort(function(a, b) {
      return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    });
    return list;
  }

  function getCategories() {
    var keys = getKeys(data.categories);
    var names = {};
    var list = [];
    var items = getMenuItems();
    var i;
    var cat;
    for (i = 0; i < keys.length; i += 1) {
      cat = copyObject(data.categories[keys[i]] || {});
      cat.id = keys[i];
      cat.name = cat.name || "未分類";
      cat.enabled = cat.enabled !== false;
      cat.sortOrder = Number(cat.sortOrder || 999999999);
      names[cat.name] = true;
      list.push(cat);
    }
    for (i = 0; i < items.length; i += 1) {
      if (!names[items[i].category || "未分類"]) {
        names[items[i].category || "未分類"] = true;
        list.push({ id: "legacy-" + (items[i].category || "未分類"), name: items[i].category || "未分類", enabled: true, sortOrder: 999999999 });
      }
    }
    list.sort(function(a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
    return list;
  }

  function groupIdsFromTemplate(template) {
    var ids = template && (template.customGroupIds || template.customOptionGroupIds || template.optionGroupIds);
    var out = [];
    var keys;
    var i;
    if (ids && ids.length) {
      for (i = 0; i < ids.length; i += 1) out.push(ids[i]);
      return out;
    }
    if (ids) {
      keys = getKeys(ids);
      for (i = 0; i < keys.length; i += 1) if (ids[keys[i]] !== false) out.push(keys[i]);
    }
    return out;
  }

  function groupIdsFromItem(item) {
    return groupIdsFromTemplate(item || {});
  }

  function setActiveTab(tabName) {
    var buttons = document.querySelectorAll("#legacyTabs button");
    var panels = document.querySelectorAll(".legacy-panel");
    var i;
    state.activeTab = tabName;
    for (i = 0; i < buttons.length; i += 1) {
      if (buttons[i].getAttribute("data-tab") === tabName) addClass(buttons[i], "active");
      else removeClass(buttons[i], "active");
    }
    for (i = 0; i < panels.length; i += 1) removeClass(panels[i], "active");
    addClass($(tabName + "Panel"), "active");
  }

  function renderAll() {
    renderCategorySelect();
    renderItemTemplateSelect();
    renderOptionPickers();
    renderCategoryFilters();
    renderMenu();
    renderCategories();
    renderOptions();
    renderTemplates();
    setStatus("舊平板相容模式已連線。", false);
  }

  function renderCategorySelect() {
    var el = $("legacyItemCategory");
    var list = getCategories();
    var html = "";
    var i;
    if (!el) return;
    for (i = 0; i < list.length; i += 1) {
      html += '<option value="' + escapeHtml(list[i].name) + '">' + escapeHtml(list[i].name) + '</option>';
    }
    el.innerHTML = html || '<option value="未分類">未分類</option>';
  }

  function renderItemTemplateSelect() {
    var el = $("legacyItemTemplateSelect");
    var list = getTemplates();
    var html = '<option value="">選擇範本</option>';
    var i;
    if (!el) return;
    for (i = 0; i < list.length; i += 1) {
      html += '<option value="' + escapeHtml(list[i].id) + '">' + escapeHtml(list[i].name || "未命名範本") + '</option>';
    }
    el.innerHTML = html;
  }

  function renderCategoryFilters() {
    var el = $("legacyCategoryFilters");
    var list = getCategories();
    var html = '<button type="button" data-category="全部" class="' + (state.categoryFilter === "全部" ? "active" : "") + '">全部</button>';
    var i;
    if (!el) return;
    for (i = 0; i < list.length; i += 1) {
      html += '<button type="button" data-category="' + escapeHtml(list[i].name) + '" class="' + (state.categoryFilter === list[i].name ? "active" : "") + '">' + escapeHtml(list[i].name) + '</button>';
    }
    el.innerHTML = html;
    bindButtons(el, function(btn) {
      state.categoryFilter = btn.getAttribute("data-category") || "全部";
      renderCategoryFilters();
      renderMenu();
    });
  }

  function renderMenu() {
    var el = $("legacyMenuList");
    var search = $("legacyMenuSearch") ? ($("legacyMenuSearch").value || "").toLowerCase() : "";
    var items = getMenuItems();
    var html = "";
    var i;
    var item;
    if (!el) return;
    if (!items.length) {
      setBox("legacyMenuList", "尚未建立餐點。", false);
      return;
    }
    html = '<div class="legacy-grid">';
    for (i = 0; i < items.length; i += 1) {
      item = items[i];
      if (state.categoryFilter !== "全部" && (item.category || "未分類") !== state.categoryFilter) continue;
      if (search && ((item.name || "").toLowerCase().indexOf(search) < 0) && ((item.category || "").toLowerCase().indexOf(search) < 0)) continue;
      html += '<article class="legacy-row-card ' + (item.enabled === false ? "disabled" : "") + '">' +
        '<h3>' + escapeHtml(item.name || "未命名餐點") + '</h3>' +
        '<p>' + escapeHtml(item.category || "未分類") + '｜NT$' + Number(item.price || 0) + '</p>' +
        '<p>' + (item.enabled === false ? "下架" : "上架") + (item.soldOut === true || item.paused === true ? "｜今日售完" : "") + '</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editItem" data-id="' + escapeHtml(item.id) + '">編輯</button>' +
        '<button type="button" data-action="toggleItem" data-id="' + escapeHtml(item.id) + '">' + (item.enabled === false ? "上架" : "下架") + '</button>' +
        '<button type="button" data-action="soldOutItem" data-id="' + escapeHtml(item.id) + '">' + (item.soldOut === true || item.paused === true ? "恢復販售" : "今日售完") + '</button>' +
        '<button type="button" data-action="moveItemUp" data-id="' + escapeHtml(item.id) + '">上移</button>' +
        '<button type="button" data-action="moveItemDown" data-id="' + escapeHtml(item.id) + '">下移</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html === '<div class="legacy-grid"></div>' ? '<div class="legacy-empty">沒有符合條件的餐點。</div>' : html;
    bindButtons(el, handleMenuAction);
  }

  function renderOptionPickers() {
    var el = $("legacyItemOptionPicker");
    var groups = getGroups();
    var html = "";
    var i;
    if (!el) return;
    for (i = 0; i < groups.length; i += 1) {
      html += '<label><input type="checkbox" value="' + escapeHtml(groups[i].id) + '"' + (indexOf(state.selectedItemGroupIds, groups[i].id) >= 0 ? " checked" : "") + ' /> ' + escapeHtml(groups[i].name) + '</label>';
    }
    el.innerHTML = html || '<div class="legacy-empty">尚未建立餐點選項。</div>';
  }

  function renderOptions() {
    var el = $("legacyOptionList");
    var groups = getGroups();
    var html = "";
    var i;
    if (!el) return;
    if (!groups.length) {
      setBox("legacyOptionList", "尚未建立餐點選項。", false);
      return;
    }
    html = '<div class="legacy-grid">';
    for (i = 0; i < groups.length; i += 1) {
      html += '<article class="legacy-row-card ' + (groups[i].enabled === false ? "disabled" : "") + '">' +
        '<h3>' + escapeHtml(groups[i].name) + '</h3>' +
        '<p>' + selectionLabel(groups[i].selectionType) + '｜內容 ' + groups[i].options.length + ' 個</p>' +
        '<p>' + (groups[i].enabled === false ? "停用" : "啟用") + '</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editGroup" data-id="' + escapeHtml(groups[i].id) + '">編輯</button>' +
        '<button type="button" data-action="toggleGroup" data-id="' + escapeHtml(groups[i].id) + '">' + (groups[i].enabled === false ? "啟用" : "停用") + '</button>' +
        '<button type="button" data-action="moveGroupUp" data-id="' + escapeHtml(groups[i].id) + '">上移</button>' +
        '<button type="button" data-action="moveGroupDown" data-id="' + escapeHtml(groups[i].id) + '">下移</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
    bindButtons(el, handleOptionAction);
  }

  function renderTemplates() {
    var el = $("legacyTemplateList");
    var templates = getTemplates();
    var groups = getGroupMap();
    var html = "";
    var i;
    var ids;
    var names;
    if (!el) return;
    if (!templates.length) {
      setBox("legacyTemplateList", "尚未建立範本。", false);
      return;
    }
    html = '<div class="legacy-grid">';
    for (i = 0; i < templates.length; i += 1) {
      ids = groupIdsFromTemplate(templates[i]);
      names = groupNames(ids, groups);
      html += '<article class="legacy-row-card"><h3>' + escapeHtml(templates[i].name || "未命名範本") + '</h3>' +
        '<p>餐點選項：' + escapeHtml(names || "尚未加入") + '</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editTemplate" data-id="' + escapeHtml(templates[i].id) + '">編輯</button>' +
        '<button type="button" data-action="copyTemplate" data-id="' + escapeHtml(templates[i].id) + '">複製</button>' +
        '<button type="button" data-action="deleteTemplate" data-id="' + escapeHtml(templates[i].id) + '" class="danger">刪除</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
    bindButtons(el, handleTemplateAction);
  }

  function renderCategories() {
    var el = $("legacyCategoryList");
    var categories = getCategories();
    var html = "";
    var i;
    if (!el) return;
    if (!categories.length) {
      setBox("legacyCategoryList", "尚未建立分類。", false);
      return;
    }
    html = '<div class="legacy-grid">';
    for (i = 0; i < categories.length; i += 1) {
      html += '<article class="legacy-row-card ' + (categories[i].enabled === false ? "disabled" : "") + '">' +
        '<h3>' + escapeHtml(categories[i].name) + '</h3>' +
        '<p>' + (categories[i].enabled === false ? "停用" : "啟用") + '</p>' +
        '<label>預設範本' + categoryTemplateSelect(categories[i]) + '</label>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="renameCategory" data-id="' + escapeHtml(categories[i].id) + '" data-name="' + escapeHtml(categories[i].name) + '">改名</button>' +
        '<button type="button" data-action="toggleCategory" data-id="' + escapeHtml(categories[i].id) + '">' + (categories[i].enabled === false ? "啟用" : "停用") + '</button>' +
        '<button type="button" data-action="moveCategoryUp" data-id="' + escapeHtml(categories[i].id) + '">上移</button>' +
        '<button type="button" data-action="moveCategoryDown" data-id="' + escapeHtml(categories[i].id) + '">下移</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
    bindButtons(el, handleCategoryAction);
    bindCategoryTemplateSelects();
  }

  function categoryTemplateSelect(category) {
    var templates = getTemplates();
    var html = '<select data-action="defaultTemplate" data-id="' + escapeHtml(category.id) + '"><option value="">不套用</option>';
    var i;
    for (i = 0; i < templates.length; i += 1) {
      html += '<option value="' + escapeHtml(templates[i].id) + '"' + (category.defaultTemplateId === templates[i].id ? " selected" : "") + '>' + escapeHtml(templates[i].name || "未命名範本") + '</option>';
    }
    html += '</select>';
    return html;
  }

  function bindCategoryTemplateSelects() {
    var list = $("legacyCategoryList");
    var selects = list ? list.querySelectorAll('select[data-action="defaultTemplate"]') : [];
    var i;
    for (i = 0; i < selects.length; i += 1) {
      selects[i].onchange = function() {
        var id = this.getAttribute("data-id");
        if (String(id).indexOf("legacy-") === 0) {
          alert("請先建立正式分類後再設定預設範本。");
          this.value = "";
          return;
        }
        updatePath("categories/" + id, { defaultTemplateId: this.value || "", updatedAt: now() }, "預設範本更新失敗");
      };
    }
  }

  function groupNames(ids, groupMap) {
    var out = [];
    var i;
    var g;
    for (i = 0; i < ids.length; i += 1) {
      g = groupMap[ids[i]];
      if (g) out.push(g.name || g.title || "未命名餐點選項");
    }
    return out.join("、");
  }

  function bindButtons(root, handler) {
    var buttons = root ? root.querySelectorAll("button") : [];
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      bindTap(buttons[i], function(event) {
        handler(event.currentTarget || event.srcElement);
      });
    }
  }

  function indexOf(list, value) {
    var i;
    for (i = 0; i < (list || []).length; i += 1) if (String(list[i]) === String(value)) return i;
    return -1;
  }

  function readCheckedValues(rootId) {
    var root = $(rootId);
    var inputs = root ? root.querySelectorAll("input") : [];
    var out = [];
    var i;
    for (i = 0; i < inputs.length; i += 1) if (inputs[i].checked) out.push(inputs[i].value);
    return out;
  }

  function resetItemForm() {
    state.editingItemId = "";
    state.selectedItemGroupIds = [];
    $("legacyItemTitle").innerHTML = "新增餐點";
    $("legacyItemName").value = "";
    $("legacyItemPrice").value = "";
    $("legacyItemImage").value = "";
    $("legacyItemDescription").value = "";
    $("legacyItemEnabled").checked = true;
    $("legacyItemSoldOut").checked = false;
    $("legacyItemTemplateSelect").value = "";
    renderCategorySelect();
    renderItemTemplateSelect();
    renderOptionPickers();
  }

  function applyTemplateToItem(templateId) {
    var template = getTemplateMap()[templateId];
    if (!template) {
      if (templateId) alert("找不到這個範本");
      return;
    }
    state.selectedItemGroupIds = groupIdsFromTemplate(template);
    renderOptionPickers();
  }

  function applyDefaultTemplateForCategory(categoryName) {
    var categories = getCategories();
    var i;
    for (i = 0; i < categories.length; i += 1) {
      if (categories[i].name === categoryName && categories[i].defaultTemplateId) {
        applyTemplateToItem(categories[i].defaultTemplateId);
        $("legacyItemTemplateSelect").value = categories[i].defaultTemplateId;
        return;
      }
    }
  }

  function saveItem(event) {
    if (event && event.preventDefault) event.preventDefault();
    var id = state.editingItemId || firebasePushKey("menu");
    var oldItem = state.editingItemId ? (getMenuMap()[state.editingItemId] || {}) : {};
    var item = copyObject(oldItem);
    item.name = $("legacyItemName").value.replace(/^\s+|\s+$/g, "");
    item.category = $("legacyItemCategory").value || "未分類";
    item.price = Number($("legacyItemPrice").value || 0);
    item.image = $("legacyItemImage").value.replace(/^\s+|\s+$/g, "");
    item.description = $("legacyItemDescription").value;
    item.enabled = $("legacyItemEnabled").checked === true;
    item.soldOut = $("legacyItemSoldOut").checked === true;
    item.paused = item.soldOut;
    item.customGroupIds = readCheckedValues("legacyItemOptionPicker");
    item.customOptionGroupIds = item.customGroupIds.slice(0);
    item.updatedAt = now();
    if (!item.createdAt) item.createdAt = now();
    if (!item.sortOrder) item.sortOrder = now();
    if (!item.name) {
      alert("請輸入餐點名稱");
      return false;
    }
    db.ref("menu/" + id).update(item, function(error) {
      if (error) return showSaveError("餐點儲存失敗", error);
      resetItemForm();
      setActiveTab("menu");
    });
    return false;
  }

  function editItem(id) {
    var item = getMenuMap()[id];
    if (!item) return;
    state.editingItemId = id;
    state.selectedItemGroupIds = groupIdsFromItem(item);
    $("legacyItemTitle").innerHTML = "編輯餐點";
    $("legacyItemName").value = item.name || "";
    renderCategorySelect();
    $("legacyItemCategory").value = item.category || "未分類";
    $("legacyItemPrice").value = Number(item.price || 0);
    $("legacyItemImage").value = item.image || item.imageUrl || "";
    $("legacyItemDescription").value = item.description || "";
    $("legacyItemEnabled").checked = item.enabled !== false;
    $("legacyItemSoldOut").checked = item.soldOut === true || item.paused === true;
    $("legacyItemTemplateSelect").value = "";
    renderOptionPickers();
    setActiveTab("item");
  }

  function handleMenuAction(btn) {
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    var item = getMenuMap()[id] || {};
    if (action === "editItem") editItem(id);
    if (action === "toggleItem") updatePath("menu/" + id, { enabled: item.enabled === false, updatedAt: now() }, "上架狀態更新失敗");
    if (action === "soldOutItem") updatePath("menu/" + id, { soldOut: !(item.soldOut === true || item.paused === true), paused: !(item.soldOut === true || item.paused === true), updatedAt: now() }, "販售狀態更新失敗");
    if (action === "moveItemUp") moveMenuItem(id, -1);
    if (action === "moveItemDown") moveMenuItem(id, 1);
  }

  function moveMenuItem(id, direction) {
    var items = getMenuItems();
    var index = -1;
    var target;
    var updates = {};
    var i;
    for (i = 0; i < items.length; i += 1) if (items[i].id === id) index = i;
    target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    items.splice(target, 0, items.splice(index, 1)[0]);
    for (i = 0; i < items.length; i += 1) updates["menu/" + items[i].id + "/sortOrder"] = (i + 1) * 1000;
    db.ref().update(updates, function(error) { if (error) showSaveError("餐點排序失敗", error); });
  }

  function openGroupModal(id) {
    var group = id ? normalizeGroup(id, getGroupMap()[id]) : normalizeGroup("", {});
    var body = "";
    var i;
    state.editingGroupId = id || "";
    body += '<form id="legacyGroupForm" class="legacy-form">';
    body += '<label>餐點選項名稱<input id="legacyGroupName" type="text" value="' + escapeHtml(id ? group.name : "") + '" /></label>';
    body += '<label>選擇方式<select id="legacyGroupType"><option value="single">單選</option><option value="multiple">多選</option><option value="toggle">開關</option><option value="quantity">數量</option></select></label>';
    body += '<label class="legacy-check"><input id="legacyGroupRequired" type="checkbox"' + (group.required ? " checked" : "") + ' /> 必選</label>';
    body += '<label>最少選擇數<input id="legacyGroupMin" type="number" min="0" value="' + Number(group.minSelect || 0) + '" /></label>';
    body += '<label>最多選擇數<input id="legacyGroupMax" type="number" min="0" value="' + Number(group.maxSelect || 0) + '" /></label>';
    body += '<label class="legacy-check"><input id="legacyGroupEnabled" type="checkbox"' + (group.enabled !== false ? " checked" : "") + ' /> 啟用</label>';
    body += '<label>說明文字<textarea id="legacyGroupDescription">' + escapeHtml(group.description || "") + '</textarea></label>';
    body += '<div class="legacy-card"><strong>選項內容</strong><div id="legacyGroupOptions">';
    if (!group.options.length) group.options.push({ name: "", price: 0, enabled: true, defaultQuantity: 1, maxQty: 1 });
    for (i = 0; i < group.options.length; i += 1) body += groupOptionRow(group.options[i], i);
    body += '</div><button id="legacyAddGroupOptionBtn" type="button">＋ 新增內容</button></div></form>';
    openModal(id ? "編輯餐點選項" : "新增餐點選項", body, '<button id="legacyCancelModalBtn" type="button">取消</button><button id="legacySaveGroupBtn" type="button" class="primary">儲存餐點選項</button>');
    $("legacyGroupType").value = group.selectionType || "single";
    bindTap($("legacyAddGroupOptionBtn"), function() {
      var box = $("legacyGroupOptions");
      var div = document.createElement("div");
      div.innerHTML = groupOptionRow({ name: "", price: 0, enabled: true, defaultQuantity: 1, maxQty: 1 }, box.querySelectorAll(".legacy-option-row").length);
      box.appendChild(div.firstChild);
      bindGroupOptionButtons();
    });
    bindTap($("legacySaveGroupBtn"), saveGroupFromModal);
    bindTap($("legacyCancelModalBtn"), closeModal);
    bindGroupOptionButtons();
  }

  function groupOptionRow(option, index) {
    return '<div class="legacy-option-row" data-option-id="' + escapeHtml(option.id || option.itemId || "") + '">' +
      '<label>名稱<input data-field="name" type="text" value="' + escapeHtml(option.name || "") + '" /></label>' +
      '<label>加價<input data-field="price" type="number" value="' + Number(option.price || 0) + '" /></label>' +
      '<label class="legacy-check"><input data-field="qtyEnabled" type="checkbox"' + (option.qtyEnabled || option.allowQuantity ? " checked" : "") + ' /> 可調</label>' +
      '<label>預設<input data-field="defaultQuantity" type="number" min="1" value="' + Number(option.defaultQuantity || 1) + '" /></label>' +
      '<label>最大<input data-field="maxQty" type="number" min="1" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" /></label>' +
      '<button type="button" data-action="deleteOption">刪除</button></div>';
  }

  function bindGroupOptionButtons() {
    var box = $("legacyGroupOptions");
    bindButtons(box, function(btn) {
      var row = findParent(btn, "legacy-option-row");
      if (row && row.parentNode) row.parentNode.removeChild(row);
    });
  }

  function saveGroupFromModal() {
    var id = state.editingGroupId || firebasePushKey("customGroups");
    var rows = $("legacyGroupOptions").querySelectorAll(".legacy-option-row");
    var options = [];
    var i;
    var row;
    var nameInput;
    var priceInput;
    var qtyInput;
    var defaultInput;
    var maxInput;
    var maxQty;
    var group;
    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];
      nameInput = row.querySelector('[data-field="name"]');
      if (!nameInput || !nameInput.value.replace(/^\s+|\s+$/g, "")) continue;
      priceInput = row.querySelector('[data-field="price"]');
      qtyInput = row.querySelector('[data-field="qtyEnabled"]');
      defaultInput = row.querySelector('[data-field="defaultQuantity"]');
      maxInput = row.querySelector('[data-field="maxQty"]');
      maxQty = Math.max(1, Number(maxInput ? maxInput.value : 1));
      options.push({
        id: row.getAttribute("data-option-id") || id + "-item-" + now() + "-" + i,
        name: nameInput.value.replace(/^\s+|\s+$/g, ""),
        price: Number(priceInput ? priceInput.value : 0),
        allowQuantity: qtyInput && qtyInput.checked === true,
        qtyEnabled: qtyInput && qtyInput.checked === true,
        defaultQuantity: Math.max(1, Number(defaultInput ? defaultInput.value : 1)),
        maxQuantity: maxQty,
        maxQty: maxQty,
        enabled: true,
        sortOrder: (i + 1) * 1000
      });
    }
    group = {
      id: id,
      name: $("legacyGroupName").value.replace(/^\s+|\s+$/g, ""),
      area: "customer",
      type: "customer",
      selectionType: $("legacyGroupType").value,
      choiceType: $("legacyGroupType").value,
      required: $("legacyGroupRequired").checked === true,
      minSelect: Number($("legacyGroupMin").value || 0),
      maxSelect: Number($("legacyGroupMax").value || 0),
      description: $("legacyGroupDescription").value,
      enabled: $("legacyGroupEnabled").checked === true,
      modules: defaultModules("customer"),
      visibility: modulesToVisibility(defaultModules("customer")),
      options: options,
      items: options,
      sortOrder: (getGroupMap()[id] && getGroupMap()[id].sortOrder) || now(),
      updatedAt: now()
    };
    if (!group.name) return alert("請輸入餐點選項名稱");
    if (!group.createdAt) group.createdAt = now();
    var updates = {};
    updates["customGroups/" + id] = group;
    updates["customOptionGroups/" + id] = group;
    db.ref().update(updates, function(error) {
      if (error) return showSaveError("餐點選項儲存失敗", error);
      closeModal();
    });
  }

  function handleOptionAction(btn) {
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    var group = getGroupMap()[id] || {};
    if (action === "editGroup") openGroupModal(id);
    if (action === "toggleGroup") updatePath("customGroups/" + id, { enabled: group.enabled === false, updatedAt: now() }, "餐點選項狀態更新失敗");
    if (action === "moveGroupUp") moveGroups(id, -1);
    if (action === "moveGroupDown") moveGroups(id, 1);
  }

  function moveGroups(id, direction) {
    var groups = getGroups();
    var index = -1;
    var target;
    var updates = {};
    var i;
    for (i = 0; i < groups.length; i += 1) if (groups[i].id === id) index = i;
    target = index + direction;
    if (index < 0 || target < 0 || target >= groups.length) return;
    groups.splice(target, 0, groups.splice(index, 1)[0]);
    for (i = 0; i < groups.length; i += 1) {
      updates["customGroups/" + groups[i].id + "/sortOrder"] = (i + 1) * 1000;
      updates["customOptionGroups/" + groups[i].id + "/sortOrder"] = (i + 1) * 1000;
    }
    db.ref().update(updates, function(error) { if (error) showSaveError("餐點選項排序失敗", error); });
  }

  function openTemplateModal(id) {
    var template = id ? (getTemplateMap()[id] || {}) : {};
    var ids = groupIdsFromTemplate(template);
    var groups = getGroups();
    var body = '<form class="legacy-form"><label>範本名稱<input id="legacyTemplateName" type="text" value="' + escapeHtml(template.name || "") + '" /></label><div class="legacy-card"><strong>餐點選項</strong><div id="legacyTemplateGroups" class="legacy-checkbox-list">';
    var i;
    state.editingTemplateId = id || "";
    for (i = 0; i < groups.length; i += 1) {
      body += '<label><input type="checkbox" value="' + escapeHtml(groups[i].id) + '"' + (indexOf(ids, groups[i].id) >= 0 ? " checked" : "") + ' /> ' + escapeHtml(groups[i].name) + '</label>';
    }
    body += '</div></div></form>';
    openModal(id ? "編輯範本" : "新增範本", body, '<button id="legacyCancelModalBtn" type="button">取消</button><button id="legacySaveTemplateBtn" type="button" class="primary">儲存範本</button>');
    bindTap($("legacySaveTemplateBtn"), saveTemplateFromModal);
    bindTap($("legacyCancelModalBtn"), closeModal);
  }

  function saveTemplateFromModal() {
    var id = state.editingTemplateId || firebasePushKey("optionTemplates");
    var old = getTemplateMap()[id] || {};
    var ids = readCheckedValues("legacyTemplateGroups");
    var template = copyObject(old);
    template.id = id;
    template.name = $("legacyTemplateName").value.replace(/^\s+|\s+$/g, "");
    template.customGroupIds = ids;
    template.customOptionGroupIds = ids.slice(0);
    template.updatedAt = now();
    if (!template.createdAt) template.createdAt = now();
    if (!template.name) return alert("請輸入範本名稱");
    db.ref("optionTemplates/" + id).update(template, function(error) {
      if (error) return showSaveError("範本儲存失敗", error);
      closeModal();
    });
  }

  function handleTemplateAction(btn) {
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    if (action === "editTemplate") openTemplateModal(id);
    if (action === "copyTemplate") copyTemplate(id);
    if (action === "deleteTemplate") deleteTemplate(id);
  }

  function copyTemplate(id) {
    var source = getTemplateMap()[id];
    var newId = firebasePushKey("optionTemplates");
    var copy;
    if (!source) return;
    copy = copyObject(source);
    copy.id = newId;
    copy.name = (copy.name || "範本") + " 複製";
    copy.createdAt = now();
    copy.updatedAt = now();
    db.ref("optionTemplates/" + newId).update(copy, function(error) { if (error) showSaveError("範本複製失敗", error); });
  }

  function deleteTemplate(id) {
    if (!confirm("確定刪除這個範本？")) return;
    db.ref("optionTemplates/" + id).remove(function(error) { if (error) showSaveError("範本刪除失敗", error); });
  }

  function handleCategoryAction(btn) {
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    var name = btn.getAttribute("data-name") || "";
    if (action === "renameCategory") renameCategory(id, name);
    if (action === "toggleCategory") toggleCategory(id);
    if (action === "moveCategoryUp") moveCategories(id, -1);
    if (action === "moveCategoryDown") moveCategories(id, 1);
  }

  function addCategory() {
    var input = $("legacyNewCategoryName");
    var name = input.value.replace(/^\s+|\s+$/g, "");
    var id;
    if (!name) return;
    id = firebasePushKey("categories");
    db.ref("categories/" + id).update({ name: name, enabled: true, sortOrder: now(), createdAt: now(), updatedAt: now() }, function(error) {
      if (error) return showSaveError("分類新增失敗", error);
      input.value = "";
    });
  }

  function renameCategory(id, oldName) {
    var next = prompt("請輸入新的分類名稱", oldName);
    var updates = {};
    if (!next) return;
    if (String(id).indexOf("legacy-") === 0) id = firebasePushKey("categories");
    updates["categories/" + id + "/name"] = next;
    updates["categories/" + id + "/updatedAt"] = now();
    db.ref().update(updates, function(error) { if (error) showSaveError("分類改名失敗", error); });
  }

  function toggleCategory(id) {
    var cat = data.categories[id] || {};
    if (String(id).indexOf("legacy-") === 0) return alert("請先改名或新增正式分類後再停用。");
    updatePath("categories/" + id, { enabled: cat.enabled === false, updatedAt: now() }, "分類狀態更新失敗");
  }

  function moveCategories(id, direction) {
    var cats = getCategories();
    var index = -1;
    var target;
    var updates = {};
    var i;
    for (i = 0; i < cats.length; i += 1) if (cats[i].id === id) index = i;
    target = index + direction;
    if (index < 0 || target < 0 || target >= cats.length) return;
    cats.splice(target, 0, cats.splice(index, 1)[0]);
    for (i = 0; i < cats.length; i += 1) if (String(cats[i].id).indexOf("legacy-") !== 0) updates["categories/" + cats[i].id + "/sortOrder"] = (i + 1) * 1000;
    db.ref().update(updates, function(error) { if (error) showSaveError("分類排序失敗", error); });
  }

  function updatePath(path, patch, message) {
    db.ref(path).update(patch, function(error) {
      if (error) showSaveError(message, error);
    });
  }

  function showSaveError(message, error) {
    console.error(message, error);
    alert(message + "，請重新整理後再試。");
  }

  function findParent(node, className) {
    while (node && node !== document) {
      if (hasClass(node, className)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function openModal(title, bodyHtml, actionsHtml) {
    var modal = $("legacyModal");
    state.modalScrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    $("legacyModalTitle").innerHTML = escapeHtml(title);
    $("legacyModalBody").innerHTML = bodyHtml;
    $("legacyModalActions").innerHTML = actionsHtml || "";
    removeClass(modal, "hidden");
    document.body.style.top = "-" + state.modalScrollY + "px";
    addClass(document.body, "legacy-lock");
  }

  function closeModal() {
    var modal = $("legacyModal");
    addClass(modal, "hidden");
    removeClass(document.body, "legacy-lock");
    document.body.style.top = "";
    if (window.scrollTo) window.scrollTo(0, state.modalScrollY || 0);
  }

  function initFirebase() {
    if (!window.firebase || !window.firebase.initializeApp) {
      setStatus("JavaScript 不相容或 Firebase 載入失敗。", true);
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      bindNode("menu", "menu");
      bindNode("menuItems", "menuItems");
      bindNode("categories", "categories");
      bindNode("customGroups", "customGroups");
      bindNode("customOptionGroups", "customOptionGroups");
      bindNode("optionGroups", "optionGroups");
      bindNode("optionTemplates", "optionTemplates");
      bindNode("templates", "templates");
      bindNode("settings", "settings");
    } catch (error) {
      console.error("Legacy Firebase init failed", error);
      setStatus("菜單資料載入失敗，請重新整理。", true);
    }
  }

  function bindNode(path, key) {
    db.ref(path).on("value", function(snapshot) {
      data[key] = snapshot.val() || {};
      renderAll();
    }, function(error) {
      console.error("Legacy Firebase read failed: " + path, error);
      setStatus("菜單資料載入失敗，請重新整理。", true);
      if (path === "menu") setBox("legacyMenuList", "菜單資料載入失敗，請重新整理。", true);
    });
  }

  function initEvents() {
    var tabs = document.querySelectorAll("#legacyTabs button");
    var i;
    for (i = 0; i < tabs.length; i += 1) {
      bindTap(tabs[i], function(event) {
        setActiveTab((event.currentTarget || event.srcElement).getAttribute("data-tab"));
      });
    }
    bindTap($("legacyAddGroupBtn"), function() { openGroupModal(""); });
    bindTap($("legacyAddTemplateBtn"), function() { openTemplateModal(""); });
    bindTap($("legacyAddCategoryBtn"), addCategory);
    bindTap($("legacyResetItemBtn"), resetItemForm);
    bindTap($("legacyModalCloseBtn"), closeModal);
    bindTap($("legacyApplyTemplateBtn"), function() {
      applyTemplateToItem($("legacyItemTemplateSelect").value);
    });
    $("legacyItemForm").onsubmit = saveItem;
    $("legacyMenuSearch").oninput = renderMenu;
    $("legacyItemCategory").onchange = function() {
      if (!state.editingItemId) applyDefaultTemplateForCategory(this.value);
    };
  }

  function init() {
    setStatus("正在讀取 Firebase 資料……", false);
    initEvents();
    resetItemForm();
    initFirebase();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, false);
  } else {
    init();
  }
})();
