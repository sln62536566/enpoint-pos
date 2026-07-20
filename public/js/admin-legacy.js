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
    editingCategoryId: "",
    selectedItemGroupIds: [],
    templateGroupIds: [],
    modalScrollY: 0,
    lastTouchAt: 0
  };
  var CATEGORY_SORT_ORDER = {
    "鍋燒類": 1000,
    "炒麵類": 2000,
    "炒飯類": 3000,
    "咖哩類": 4000,
    "湯類": 5000,
    "飲料": 6000,
    "其他類": 7000
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

  function modulesLabel(modules) {
    var out = [];
    modules = modules || defaultModules("customer");
    if (modules.qr !== false) out.push("QR");
    if (modules.pos !== false) out.push("POS");
    if (modules.kds !== false) out.push("KDS");
    if (modules.print !== false) out.push("印單");
    return out.join("、") || "未設定";
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
      cat.sortOrder = Number(cat.sortOrder || CATEGORY_SORT_ORDER[cat.name] || 999999999);
      cat.sourceIndex = i;
      names[cat.name] = true;
      list.push(cat);
    }
    for (i = 0; i < items.length; i += 1) {
      if (!names[items[i].category || "未分類"]) {
        names[items[i].category || "未分類"] = true;
        list.push({ id: "legacy-" + (items[i].category || "未分類"), name: items[i].category || "未分類", enabled: true, sortOrder: Number(items[i].categoryOrder || CATEGORY_SORT_ORDER[items[i].category || "未分類"] || 999999999), sourceIndex: list.length });
      }
    }
    list.sort(function(a, b) {
      var orderA = Number(a.sortOrder || 999999999);
      var orderB = Number(b.sortOrder || 999999999);
      var priorityA;
      var priorityB;
      if (orderA !== orderB) return orderA - orderB;
      priorityA = CATEGORY_SORT_ORDER[a.name] || 999999999;
      priorityB = CATEGORY_SORT_ORDER[b.name] || 999999999;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return Number(a.sourceIndex || 0) - Number(b.sourceIndex || 0);
    });
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
    setStatus("資料已連線。", false);
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
  }

  function renderMenu() {
    var el = $("legacyMenuList");
    var search = $("legacyMenuSearch") ? ($("legacyMenuSearch").value || "").toLowerCase() : "";
    var items = getMenuItems();
    var categories = getCategories();
    var html = "";
    var i;
    var j;
    var item;
    var matched;
    if (!el) return;
    if (!items.length) {
      setBox("legacyMenuList", "尚未建立餐點。", false);
      return;
    }
    if (state.categoryFilter === "全部") {
      for (i = 0; i < categories.length; i += 1) {
        matched = "";
        for (j = 0; j < items.length; j += 1) {
          item = items[j];
          if ((item.category || "未分類") !== categories[i].name) continue;
          if (search && ((item.name || "").toLowerCase().indexOf(search) < 0) && ((item.category || "").toLowerCase().indexOf(search) < 0)) continue;
          matched += renderMenuItemCard(item);
        }
        if (matched) {
          html += '<section class="legacy-category-section"><h3>' + escapeHtml(categories[i].name) + '</h3><div class="legacy-grid">' + matched + '</div></section>';
        }
      }
    } else {
      html = '<div class="legacy-grid">';
      for (i = 0; i < items.length; i += 1) {
        item = items[i];
        if ((item.category || "未分類") !== state.categoryFilter) continue;
        if (search && ((item.name || "").toLowerCase().indexOf(search) < 0) && ((item.category || "").toLowerCase().indexOf(search) < 0)) continue;
        html += renderMenuItemCard(item);
      }
      html += '</div>';
    }
    el.className = "legacy-list-state";
    el.innerHTML = html === '<div class="legacy-grid"></div>' || html === "" ? '<div class="legacy-empty">沒有符合條件的餐點。</div>' : html;
  }

  function renderMenuItemCard(item) {
    var image = item.image || item.imageUrl || "";
    var isSoldOut = item.soldOut === true || item.paused === true;
    var statusClass = item.enabled === false ? "off" : (isSoldOut ? "sold-out" : "on");
    var statusText = item.enabled === false ? "已下架" : (isSoldOut ? "本日售完" : "販售中");
    var defaultIcon = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 29h38c0 13-8 22-19 22S13 42 13 29Z"/><path d="M10 27h44M20 54h24M25 23c-5-6 4-8 0-14M35 23c-5-6 4-8 0-14M45 23c-5-6 4-8 0-14"/></svg>';
    return '<article class="legacy-row-card ' + (item.enabled === false ? "disabled" : "") + '">' +
      '<div class="legacy-sort-zone"><span>☰</span><button type="button" data-action="moveItemUp" data-id="' + escapeHtml(item.id) + '" aria-label="上移">↑</button><button type="button" data-action="moveItemDown" data-id="' + escapeHtml(item.id) + '" aria-label="下移">↓</button></div>' +
      '<div class="legacy-item-media"><div class="legacy-item-thumb">' + (image ? '<img src="' + escapeHtml(image) + '" alt="">' : '<span class="legacy-default-meal-icon">' + defaultIcon + '</span>') + '</div><span class="legacy-category-tag">' + escapeHtml(item.category || "未分類") + '</span></div>' +
      '<div class="legacy-item-summary"><h3>' + escapeHtml(item.name || "未命名餐點") + ' <span class="legacy-item-badge ' + statusClass + '">' + statusText + '</span></h3>' +
      '<p>NT$' + Number(item.price || 0) + '</p></div>' +
      '<div class="legacy-card-actions">' +
      '<button type="button" data-action="toggleItem" data-id="' + escapeHtml(item.id) + '">' + (item.enabled === false ? "上架" : "下架") + '</button>' +
      '<button type="button" class="legacy-sold-out-btn' + (isSoldOut ? ' active' : '') + '" data-action="soldOutItem" data-id="' + escapeHtml(item.id) + '">' + (isSoldOut ? "恢復販售" : "本日售完") + '</button>' +
      '<button type="button" data-action="editItem" data-id="' + escapeHtml(item.id) + '">修改</button>' +
      '<button type="button" class="danger" data-action="deleteItem" data-id="' + escapeHtml(item.id) + '">刪除</button>' +
      '</div></article>';
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
        '<p>使用中餐點 ' + countItemsUsingGroup(groups[i].id) + ' 個｜範本 ' + countTemplatesUsingGroup(groups[i].id) + ' 個</p>' +
        '<p>' + modulesLabel(groups[i].modules) + '｜' + (groups[i].enabled === false ? "停用" : "啟用") + '</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editGroup" data-id="' + escapeHtml(groups[i].id) + '">編輯</button>' +
        '<button type="button" data-action="copyGroup" data-id="' + escapeHtml(groups[i].id) + '">複製</button>' +
        '<button type="button" data-action="toggleGroup" data-id="' + escapeHtml(groups[i].id) + '">' + (groups[i].enabled === false ? "啟用" : "停用") + '</button>' +
        '</div><div class="legacy-card-actions secondary">' +
        '<button type="button" data-action="moveGroupUp" data-id="' + escapeHtml(groups[i].id) + '">上移</button>' +
        '<button type="button" data-action="moveGroupDown" data-id="' + escapeHtml(groups[i].id) + '">下移</button>' +
        '<button type="button" data-action="deleteGroup" data-id="' + escapeHtml(groups[i].id) + '" class="danger">刪除</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
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
        '<p>使用中分類 ' + countCategoriesUsingTemplate(templates[i].id) + ' 個｜餐點 ' + countItemsUsingTemplate(templates[i].id) + ' 個</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editTemplate" data-id="' + escapeHtml(templates[i].id) + '">編輯</button>' +
        '<button type="button" data-action="copyTemplate" data-id="' + escapeHtml(templates[i].id) + '">複製</button>' +
        '<button type="button" data-action="deleteTemplate" data-id="' + escapeHtml(templates[i].id) + '" class="danger">刪除</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
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
        '<p>' + (categories[i].enabled === false ? "停用" : "啟用") + '｜餐點 ' + countItemsInCategory(categories[i].name) + ' 個</p>' +
        '<p>預設範本：' + escapeHtml(templateName(categories[i].defaultTemplateId || "")) + '</p>' +
        '<div class="legacy-card-actions">' +
        '<button type="button" data-action="editCategory" data-id="' + escapeHtml(categories[i].id) + '">編輯</button>' +
        '<button type="button" data-action="toggleCategory" data-id="' + escapeHtml(categories[i].id) + '">' + (categories[i].enabled === false ? "啟用" : "停用") + '</button>' +
        '</div><div class="legacy-card-actions secondary">' +
        '<button type="button" data-action="moveCategoryUp" data-id="' + escapeHtml(categories[i].id) + '">上移</button>' +
        '<button type="button" data-action="moveCategoryDown" data-id="' + escapeHtml(categories[i].id) + '">下移</button>' +
        '</div></article>';
    }
    html += '</div>';
    el.className = "legacy-list-state";
    el.innerHTML = html;
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

  function templateName(templateId) {
    var template = getTemplateMap()[templateId];
    return template ? (template.name || "未命名範本") : "不套用";
  }

  function countItemsUsingGroup(groupId) {
    var items = getMenuItems();
    var count = 0;
    var i;
    for (i = 0; i < items.length; i += 1) {
      if (indexOf(groupIdsFromItem(items[i]), groupId) >= 0) count += 1;
    }
    return count;
  }

  function countTemplatesUsingGroup(groupId) {
    var templates = getTemplates();
    var count = 0;
    var i;
    for (i = 0; i < templates.length; i += 1) {
      if (indexOf(groupIdsFromTemplate(templates[i]), groupId) >= 0) count += 1;
    }
    return count;
  }

  function countItemsUsingTemplate(templateId) {
    var items = getMenuItems();
    var template = getTemplateMap()[templateId] || {};
    var ids = groupIdsFromTemplate(template);
    var count = 0;
    var itemIds;
    var i;
    var j;
    for (i = 0; i < items.length; i += 1) {
      itemIds = groupIdsFromItem(items[i]);
      for (j = 0; j < ids.length; j += 1) {
        if (indexOf(itemIds, ids[j]) >= 0) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  function countCategoriesUsingTemplate(templateId) {
    var categories = getCategories();
    var count = 0;
    var i;
    for (i = 0; i < categories.length; i += 1) {
      if (categories[i].defaultTemplateId === templateId) count += 1;
    }
    return count;
  }

  function countItemsInCategory(categoryName) {
    var items = getMenuItems();
    var count = 0;
    var i;
    for (i = 0; i < items.length; i += 1) {
      if ((items[i].category || "未分類") === categoryName) count += 1;
    }
    return count;
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

  function moduleChecks(modules) {
    modules = modules || defaultModules("customer");
    return '<div class="legacy-module-row">' +
      '<label class="legacy-check"><input id="legacyModuleQr" type="checkbox"' + (modules.qr !== false ? " checked" : "") + ' /> QR</label>' +
      '<label class="legacy-check"><input id="legacyModulePos" type="checkbox"' + (modules.pos !== false ? " checked" : "") + ' /> POS</label>' +
      '<label class="legacy-check"><input id="legacyModuleKds" type="checkbox"' + (modules.kds !== false ? " checked" : "") + ' /> KDS</label>' +
      '<label class="legacy-check"><input id="legacyModulePrint" type="checkbox"' + (modules.print !== false ? " checked" : "") + ' /> 印單</label>' +
      '</div>';
  }

  function readGroupModules() {
    return {
      qr: $("legacyModuleQr") ? $("legacyModuleQr").checked === true : true,
      pos: $("legacyModulePos") ? $("legacyModulePos").checked === true : true,
      kds: $("legacyModuleKds") ? $("legacyModuleKds").checked === true : true,
      print: $("legacyModulePrint") ? $("legacyModulePrint").checked === true : true,
      sticker: false,
      online: false
    };
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
    if (state.itemSaving) return false;
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
    state.itemSaving = true;
    $("legacySaveItemBtn").disabled = true;
    db.ref("menu/" + id).update(item, function(error) {
      state.itemSaving = false;
      $("legacySaveItemBtn").disabled = false;
      if (error) return showSaveError("餐點儲存失敗", error);
      resetItemForm();
      setActiveTab("menu");
      removeClass(document.body, "legacy-lock");
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
    addClass(document.body, "legacy-lock");
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
    if (action === "deleteItem") deleteMenuItem(id);
  }

  function deleteMenuItem(id) {
    var item = getMenuMap()[id];
    var ok;
    if (!item) return;
    ok = confirm("是否確定刪除此餐點？\n\n餐點：" + (item.name || "未命名餐點") + "\n\n刪除後將同步從：\n✓ POS\n✓ QR\n✓ KDS\n✓ Menu\n\n移除。");
    if (!ok) return;
    db.ref("menu/" + id).remove(function(error) {
      if (error) return showSaveError("餐點刪除失敗", error);
      if (state.editingItemId === id) resetItemForm();
    });
  }

  function moveMenuItem(id, direction) {
    var source = getMenuMap()[id] || {};
    var category = source.category || "未分類";
    var allItems = getMenuItems();
    var items = [];
    var index = -1;
    var target;
    var updates = {};
    var previousOrders = {};
    var i;
    for (i = 0; i < allItems.length; i += 1) {
      if ((allItems[i].category || "未分類") === category) items.push(allItems[i]);
    }
    for (i = 0; i < items.length; i += 1) if (items[i].id === id) index = i;
    target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    items.splice(target, 0, items.splice(index, 1)[0]);
    for (i = 0; i < items.length; i += 1) {
      previousOrders[items[i].id] = data.menu[items[i].id] ? data.menu[items[i].id].sortOrder : null;
      updates["menu/" + items[i].id + "/sortOrder"] = (i + 1) * 1000;
      if (data.menu[items[i].id]) data.menu[items[i].id].sortOrder = (i + 1) * 1000;
    }
    renderMenu();
    db.ref().update(updates, function(error) {
      var key;
      if (!error) return;
      for (key in previousOrders) if (Object.prototype.hasOwnProperty.call(previousOrders, key) && data.menu[key]) data.menu[key].sortOrder = previousOrders[key];
      renderMenu();
      showSaveError("餐點排序失敗", error);
    });
  }

  function openGroupModal(id) {
    var group = id ? normalizeGroup(id, getGroupMap()[id]) : normalizeGroup("", {});
    var body = "";
    var i;
    state.editingGroupId = id || "";
    body += '<form id="legacyGroupForm" class="legacy-form">';
    body += '<section class="legacy-form-section"><h3>基本設定</h3><div class="legacy-form-grid">';
    body += '<label>餐點選項名稱<input id="legacyGroupName" type="text" value="' + escapeHtml(id ? group.name : "") + '" /></label>';
    body += '<label>選擇方式<select id="legacyGroupType"><option value="single">一次只能選一個</option><option value="multiple">可以選很多個</option><option value="toggle">開關</option><option value="quantity">數量</option></select></label>';
    body += '<label class="legacy-check"><input id="legacyGroupRequired" type="checkbox"' + (group.required ? " checked" : "") + ' /> 必選</label>';
    body += '<label>最少選擇數<input id="legacyGroupMin" type="number" min="0" value="' + Number(group.minSelect || 0) + '" /></label>';
    body += '<label>最多選擇數<input id="legacyGroupMax" type="number" min="0" value="' + Number(group.maxSelect || 0) + '" /></label>';
    body += '<label class="legacy-check"><input id="legacyGroupEnabled" type="checkbox"' + (group.enabled !== false ? " checked" : "") + ' /> 啟用狀態</label>';
    body += '</div><p><strong>顯示位置</strong></p>' + moduleChecks(group.modules);
    body += '<label>說明文字<textarea id="legacyGroupDescription">' + escapeHtml(group.description || "") + '</textarea></label></section>';
    body += '<section class="legacy-form-section"><h3>選項內容</h3><div id="legacyGroupOptions">';
    if (!group.options.length) group.options.push({ name: "", price: 0, enabled: true, defaultQuantity: 1, maxQty: 1 });
    for (i = 0; i < group.options.length; i += 1) body += groupOptionRow(group.options[i], i);
    body += '</div><button id="legacyAddGroupOptionBtn" type="button">＋ 新增內容</button></section>';
    body += '<section class="legacy-form-section"><h3>使用狀況</h3><p>使用中的餐點數：' + countItemsUsingGroup(id) + '</p><p>使用中的範本數：' + countTemplatesUsingGroup(id) + '</p></section></form>';
    openModal(id ? "編輯餐點選項" : "新增餐點選項", body, '<button id="legacyCancelModalBtn" type="button">取消</button><button id="legacySaveGroupBtn" type="button" class="primary">儲存餐點選項</button>');
    $("legacyGroupType").value = group.selectionType || "single";
  }

  function groupOptionRow(option, index) {
    return '<div class="legacy-option-row" data-option-id="' + escapeHtml(option.id || option.itemId || "") + '">' +
      '<label>名稱<input data-field="name" type="text" value="' + escapeHtml(option.name || "") + '" /></label>' +
      '<label>加價<input data-field="price" type="number" value="' + Number(option.price || 0) + '" /></label>' +
      '<label class="legacy-check"><input data-field="qtyEnabled" type="checkbox"' + (option.qtyEnabled || option.allowQuantity ? " checked" : "") + ' /> 可調</label>' +
      '<label>預設<input data-field="defaultQuantity" type="number" min="1" value="' + Number(option.defaultQuantity || 1) + '" /></label>' +
      '<label>最大<input data-field="maxQty" type="number" min="1" value="' + Number(option.maxQty || option.maxQuantity || 1) + '" /></label>' +
      '<label class="legacy-check"><input data-field="enabled" type="checkbox"' + (option.enabled !== false ? " checked" : "") + ' /> 啟用</label>' +
      '<div><button type="button" data-action="moveOptionUp">上移</button><button type="button" data-action="moveOptionDown">下移</button><button type="button" data-action="deleteOption" class="danger">刪除</button></div></div>';
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
    var enabledInput;
    var defaultInput;
    var maxInput;
    var maxQty;
    var group;
    var modules;
    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];
      nameInput = row.querySelector('[data-field="name"]');
      if (!nameInput || !nameInput.value.replace(/^\s+|\s+$/g, "")) continue;
      priceInput = row.querySelector('[data-field="price"]');
      qtyInput = row.querySelector('[data-field="qtyEnabled"]');
      enabledInput = row.querySelector('[data-field="enabled"]');
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
        enabled: !enabledInput || enabledInput.checked === true,
        sortOrder: (i + 1) * 1000
      });
    }
    modules = readGroupModules();
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
      modules: modules,
      visibility: modulesToVisibility(modules),
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

  function addGroupOptionRow() {
    var box = $("legacyGroupOptions");
    var div;
    if (!box) return;
    div = document.createElement("div");
    div.innerHTML = groupOptionRow({ name: "", price: 0, enabled: true, defaultQuantity: 1, maxQty: 1 }, box.querySelectorAll(".legacy-option-row").length);
    box.appendChild(div.firstChild);
  }

  function handleGroupOptionAction(btn) {
    var action = btn.getAttribute("data-action");
    var row = findParent(btn, "legacy-option-row");
    var target;
    if (!row || !row.parentNode) return;
    if (action === "deleteOption") {
      row.parentNode.removeChild(row);
      return;
    }
    if (action === "moveOptionUp") {
      target = row.previousSibling;
      while (target && (!target.className || String(target.className).indexOf("legacy-option-row") < 0)) target = target.previousSibling;
      if (target) row.parentNode.insertBefore(row, target);
      return;
    }
    if (action === "moveOptionDown") {
      target = row.nextSibling;
      while (target && (!target.className || String(target.className).indexOf("legacy-option-row") < 0)) target = target.nextSibling;
      if (target) row.parentNode.insertBefore(target, row);
    }
  }

  function handleOptionAction(btn) {
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    var group = getGroupMap()[id] || {};
    if (action === "editGroup") openGroupModal(id);
    if (action === "copyGroup") copyGroup(id);
    if (action === "toggleGroup") updatePath("customGroups/" + id, { enabled: group.enabled === false, updatedAt: now() }, "餐點選項狀態更新失敗");
    if (action === "moveGroupUp") moveGroups(id, -1);
    if (action === "moveGroupDown") moveGroups(id, 1);
    if (action === "deleteGroup") deleteGroup(id);
  }

  function copyGroup(id) {
    var source = getGroupMap()[id];
    var newId = firebasePushKey("customGroups");
    var copy;
    var updates = {};
    if (!source) return;
    copy = normalizeGroup(newId, source);
    copy.id = newId;
    copy.name = (copy.name || "餐點選項") + " 複製";
    copy.createdAt = now();
    copy.updatedAt = now();
    copy.sortOrder = now();
    updates["customGroups/" + newId] = copy;
    updates["customOptionGroups/" + newId] = copy;
    db.ref().update(updates, function(error) { if (error) showSaveError("餐點選項複製失敗", error); });
  }

  function deleteGroup(id) {
    var updates = {};
    if (!confirm("確定刪除這個餐點選項？")) return;
    updates["customGroups/" + id] = null;
    updates["customOptionGroups/" + id] = null;
    db.ref().update(updates, function(error) { if (error) showSaveError("餐點選項刪除失敗", error); });
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
    var body = "";
    var i;
    state.editingTemplateId = id || "";
    state.templateGroupIds = ids.slice(0);
    body += '<form class="legacy-form">';
    body += '<section class="legacy-form-section"><h3>範本設定</h3><label>範本名稱<input id="legacyTemplateName" type="text" value="' + escapeHtml(template.name || "") + '" /></label></section>';
    body += '<section class="legacy-form-section"><h3>可用餐點選項</h3><div class="legacy-inline-form"><select id="legacyTemplateAvailable">';
    for (i = 0; i < groups.length; i += 1) {
      body += '<option value="' + escapeHtml(groups[i].id) + '">' + escapeHtml(groups[i].name) + '</option>';
    }
    body += '</select><button id="legacyAddTemplateGroupBtn" type="button">加入</button></div></section>';
    body += '<section class="legacy-form-section"><h3>已加入餐點選項</h3><div id="legacyTemplateGroups" class="legacy-template-picked"></div></section>';
    body += '<section class="legacy-form-section"><h3>使用狀況</h3><p>使用中的分類：' + countCategoriesUsingTemplate(id) + '</p><p>使用中的餐點：' + countItemsUsingTemplate(id) + '</p></section>';
    body += '</form>';
    openModal(id ? "編輯範本" : "新增範本", body, '<button id="legacyCancelModalBtn" type="button">取消</button><button id="legacySaveTemplateBtn" type="button" class="primary">儲存範本</button>');
    renderTemplatePickedGroups();
  }

  function saveTemplateFromModal() {
    var id = state.editingTemplateId || firebasePushKey("optionTemplates");
    var old = getTemplateMap()[id] || {};
    var ids = state.templateGroupIds.slice(0);
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

  function renderTemplatePickedGroups() {
    var el = $("legacyTemplateGroups");
    var groups = getGroupMap();
    var html = "";
    var i;
    var id;
    if (!el) return;
    for (i = 0; i < state.templateGroupIds.length; i += 1) {
      id = state.templateGroupIds[i];
      html += '<div class="legacy-picked-row" data-id="' + escapeHtml(id) + '"><strong>' + escapeHtml((groups[id] && (groups[id].name || groups[id].title)) || "未命名餐點選項") + '</strong>' +
        '<button type="button" data-action="moveTemplateGroupUp">上移</button>' +
        '<button type="button" data-action="moveTemplateGroupDown">下移</button>' +
        '<button type="button" data-action="removeTemplateGroup" class="danger">移除</button></div>';
    }
    el.innerHTML = html || '<div class="legacy-empty">尚未加入餐點選項。</div>';
  }

  function addTemplateGroupFromSelect() {
    var select = $("legacyTemplateAvailable");
    var id = select ? select.value : "";
    if (!id || indexOf(state.templateGroupIds, id) >= 0) return;
    state.templateGroupIds.push(id);
    renderTemplatePickedGroups();
  }

  function handleTemplateGroupAction(btn) {
    var row = findParent(btn, "legacy-picked-row");
    var action = btn.getAttribute("data-action");
    var id = row ? row.getAttribute("data-id") : "";
    var index = indexOf(state.templateGroupIds, id);
    var next;
    if (index < 0) return;
    if (action === "removeTemplateGroup") {
      state.templateGroupIds.splice(index, 1);
    } else if (action === "moveTemplateGroupUp" && index > 0) {
      next = state.templateGroupIds[index - 1];
      state.templateGroupIds[index - 1] = state.templateGroupIds[index];
      state.templateGroupIds[index] = next;
    } else if (action === "moveTemplateGroupDown" && index < state.templateGroupIds.length - 1) {
      next = state.templateGroupIds[index + 1];
      state.templateGroupIds[index + 1] = state.templateGroupIds[index];
      state.templateGroupIds[index] = next;
    }
    renderTemplatePickedGroups();
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
    if (action === "editCategory") openCategoryModal(id);
    if (action === "toggleCategory") toggleCategory(id);
    if (action === "moveCategoryUp") moveCategories(id, -1);
    if (action === "moveCategoryDown") moveCategories(id, 1);
  }

  function openCategoryModal(id) {
    var category = id ? (data.categories[id] || {}) : {};
    var body = "";
    var templates = getTemplates();
    var i;
    if (String(id).indexOf("legacy-") === 0) {
      category = { name: String(id).replace(/^legacy-/, ""), enabled: true, defaultTemplateId: "" };
    }
    state.editingCategoryId = id || "";
    body += '<form class="legacy-form">';
    body += '<section class="legacy-form-section"><h3>分類設定</h3><div class="legacy-form-grid">';
    body += '<label>分類名稱<input id="legacyCategoryName" type="text" value="' + escapeHtml(category.name || "") + '" /></label>';
    body += '<label>預設範本<select id="legacyCategoryTemplate"><option value="">不套用</option>';
    for (i = 0; i < templates.length; i += 1) {
      body += '<option value="' + escapeHtml(templates[i].id) + '"' + (category.defaultTemplateId === templates[i].id ? " selected" : "") + '>' + escapeHtml(templates[i].name || "未命名範本") + '</option>';
    }
    body += '</select></label>';
    body += '<label class="legacy-check"><input id="legacyCategoryEnabled" type="checkbox"' + (category.enabled !== false ? " checked" : "") + ' /> 啟用狀態</label>';
    body += '<label class="legacy-check"><input id="legacyCategoryApplyExisting" type="checkbox" /> 套用至既有餐點</label>';
    body += '</div><p>餐點數量：' + countItemsInCategory(category.name || "") + '</p></section>';
    body += '</form>';
    openModal(id ? "編輯分類" : "新增分類", body, '<button id="legacyCancelModalBtn" type="button">取消</button><button id="legacySaveCategoryBtn" type="button" class="primary">儲存分類</button>');
  }

  function saveCategoryFromModal() {
    var id = state.editingCategoryId || firebasePushKey("categories");
    var oldCategory = data.categories[id] || {};
    var oldName = oldCategory.name || "";
    var next = $("legacyCategoryName").value.replace(/^\s+|\s+$/g, "");
    var templateId = $("legacyCategoryTemplate").value || "";
    var updates = {};
    var items;
    var i;
    if (!next) return alert("請輸入分類名稱");
    if (String(id).indexOf("legacy-") === 0) id = firebasePushKey("categories");
    updates["categories/" + id + "/enabled"] = $("legacyCategoryEnabled").checked === true;
    updates["categories/" + id + "/name"] = next;
    updates["categories/" + id + "/defaultTemplateId"] = templateId;
    if (!oldCategory.createdAt) updates["categories/" + id + "/createdAt"] = now();
    if (!oldCategory.sortOrder) updates["categories/" + id + "/sortOrder"] = now();
    updates["categories/" + id + "/updatedAt"] = now();
    if ($("legacyCategoryApplyExisting").checked === true) {
      if (!confirm("確定套用至既有餐點？這會更新同分類餐點的範本餐點選項。")) return;
      items = getMenuItems();
      for (i = 0; i < items.length; i += 1) {
        if ((items[i].category || "未分類") === (oldName || next)) {
          updates["menu/" + items[i].id + "/category"] = next;
          if (templateId) {
            updates["menu/" + items[i].id + "/customGroupIds"] = groupIdsFromTemplate(getTemplateMap()[templateId] || {});
            updates["menu/" + items[i].id + "/customOptionGroupIds"] = groupIdsFromTemplate(getTemplateMap()[templateId] || {});
          }
          updates["menu/" + items[i].id + "/updatedAt"] = now();
        }
      }
    } else if (oldName && oldName !== next) {
      items = getMenuItems();
      for (i = 0; i < items.length; i += 1) {
        if ((items[i].category || "未分類") === oldName) updates["menu/" + items[i].id + "/category"] = next;
      }
    }
    db.ref().update(updates, function(error) {
      if (error) return showSaveError("分類儲存失敗", error);
      closeModal();
    });
  }

  function toggleCategory(id) {
    var cat = data.categories[id] || {};
    if (String(id).indexOf("legacy-") === 0) return alert("請先改名或新增正式分類後再停用。");
    updatePath("categories/" + id, { enabled: cat.enabled === false, updatedAt: now() }, "分類狀態更新失敗");
  }

  function moveCategories(id, direction) {
    var cats = getCategories();
    var items = getMenuItems();
    var index = -1;
    var target;
    var updates = {};
    var i;
    var j;
    var order;
    for (i = 0; i < cats.length; i += 1) if (cats[i].id === id) index = i;
    target = index + direction;
    if (index < 0 || target < 0 || target >= cats.length) return;
    cats.splice(target, 0, cats.splice(index, 1)[0]);
    for (i = 0; i < cats.length; i += 1) {
      order = (i + 1) * 1000;
      if (String(cats[i].id).indexOf("legacy-") !== 0) {
        updates["categories/" + cats[i].id + "/sortOrder"] = order;
        updates["categories/" + cats[i].id + "/updatedAt"] = now();
      }
      for (j = 0; j < items.length; j += 1) {
        if ((items[j].category || "未分類") === cats[i].name) {
          updates["menu/" + items[j].id + "/categoryOrder"] = order;
          updates["menu/" + items[j].id + "/updatedAt"] = now();
        }
      }
    }
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

  function findButton(node) {
    while (node && node !== document) {
      if (node.tagName && String(node.tagName).toLowerCase() === "button") return node;
      node = node.parentNode;
    }
    return null;
  }

  function handleDelegatedTap(event) {
    var btn;
    var action;
    event = event || window.event;
    btn = findButton(event.target || event.srcElement);
    if (!btn || btn.disabled) return;
    action = btn.getAttribute("data-action") || "";
    if (btn.getAttribute("data-tab")) return setActiveTab(btn.getAttribute("data-tab"));
    if (btn.getAttribute("data-category")) {
      state.categoryFilter = btn.getAttribute("data-category") || "全部";
      renderCategoryFilters();
      renderMenu();
      return;
    }
    if (btn.id === "legacyAddGroupBtn") return openGroupModal("");
    if (btn.id === "legacyAddTemplateBtn") return openTemplateModal("");
    if (btn.id === "legacyAddCategoryBtn") return openCategoryModal("");
    if (btn.id === "legacyOpenNewItemBtn") {
      resetItemForm();
      setActiveTab("item");
      addClass(document.body, "legacy-lock");
      return;
    }
    if (btn.id === "legacyResetItemBtn" || btn.id === "legacyCloseItemBtn") {
      resetItemForm();
      setActiveTab("menu");
      removeClass(document.body, "legacy-lock");
      return;
    }
    if (btn.id === "legacySaveItemBtn") return saveItem(event);
    if (btn.id === "legacyModalCloseBtn" || btn.id === "legacyCancelModalBtn") return closeModal();
    if (btn.id === "legacyApplyTemplateBtn") return applyTemplateToItem($("legacyItemTemplateSelect").value);
    if (btn.id === "legacyAddGroupOptionBtn") return addGroupOptionRow();
    if (btn.id === "legacySaveGroupBtn") return saveGroupFromModal();
    if (btn.id === "legacyAddTemplateGroupBtn") return addTemplateGroupFromSelect();
    if (btn.id === "legacySaveTemplateBtn") return saveTemplateFromModal();
    if (btn.id === "legacySaveCategoryBtn") return saveCategoryFromModal();
    if (action === "editItem" || action === "toggleItem" || action === "soldOutItem" || action === "moveItemUp" || action === "moveItemDown" || action === "deleteItem") return handleMenuAction(btn);
    if (action === "editGroup" || action === "toggleGroup" || action === "moveGroupUp" || action === "moveGroupDown" || action === "copyGroup" || action === "deleteGroup") return handleOptionAction(btn);
    if (action === "deleteOption" || action === "moveOptionUp" || action === "moveOptionDown") return handleGroupOptionAction(btn);
    if (action === "editTemplate" || action === "copyTemplate" || action === "deleteTemplate") return handleTemplateAction(btn);
    if (action === "removeTemplateGroup" || action === "moveTemplateGroupUp" || action === "moveTemplateGroupDown") return handleTemplateGroupAction(btn);
    if (action === "editCategory" || action === "toggleCategory" || action === "moveCategoryUp" || action === "moveCategoryDown") return handleCategoryAction(btn);
  }

  function initEvents() {
    document.addEventListener("click", handleDelegatedTap, false);
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
    document.body.appendChild($("itemPanel"));
    initFirebase();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, false);
  } else {
    init();
  }
})();
