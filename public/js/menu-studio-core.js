// Shared Menu Studio 1.0 helpers.
// Keep this file framework-free so Admin, POS, QR, KDS, and print code can use
// the same option-group data shape without importing Firebase.

export const MENU_STUDIO_MODULE_LABELS = {
  qr: "QR",
  pos: "POS",
  kds: "KDS",
  print: "出單",
  sticker: "貼紙",
  online: "線上訂餐",
  invoice: "電子發票",
  member: "會員"
};

export function defaultMenuOptionModules(area) {
  const modules = {
    qr: true,
    pos: true,
    kds: true,
    print: true,
    sticker: false,
    online: false,
    invoice: false,
    member: false
  };

  if (area === "posOnly") {
    modules.qr = false;
  }

  return modules;
}

export function normalizeMenuSelectionType(value) {
  if (value === "multi") return "multiple";
  if (value === "multiple" || value === "quantity") return value;
  return "single";
}

export function menuSelectionTypeLabel(value) {
  const type = normalizeMenuSelectionType(value);
  if (type === "multiple") return "多選";
  if (type === "quantity") return "可調數量";
  return "單選";
}

export function modulesToVisibility(modules) {
  const source = modules || defaultMenuOptionModules();
  return {
    qr: source.qr === true,
    pos: source.pos !== false,
    kds: source.kds !== false,
    print: source.print !== false,
    sticker: source.sticker === true,
    onlineOrder: source.online === true || source.onlineOrder === true,
    invoice: source.invoice === true,
    member: source.member === true
  };
}

export function visibilityToModules(visibility) {
  const source = visibility || {};
  return {
    qr: source.qr === true,
    pos: source.pos !== false,
    kds: source.kds !== false,
    print: source.print !== false,
    sticker: source.sticker === true,
    online: source.onlineOrder === true || source.online === true,
    invoice: source.invoice === true,
    member: source.member === true
  };
}

export function normalizeMenuOptionGroup(id, group) {
  const source = group || {};
  const inferredArea = source.area || source.type || (source.modules && source.modules.qr === false ? "posOnly" : "customer");
  const area = inferredArea === "posOnly" ? "posOnly" : "customer";
  let modules = source.modules || visibilityToModules(source.visibility);

  if (!source.modules && !source.visibility) {
    modules = defaultMenuOptionModules(area);
  }

  modules = Object.assign(defaultMenuOptionModules(area), modules || {});
  if (area === "posOnly") modules.qr = false;

  const rawOptions = Array.isArray(source.options)
    ? source.options
    : (Array.isArray(source.items) ? source.items : []);

  const options = rawOptions.map((option, index) => {
    const row = typeof option === "string" ? { name: option } : (option || {});
    const maxQuantity = Math.max(1, Number(row.maxQuantity || row.maxQty || 1));
    const defaultQuantity = Math.max(1, Math.min(maxQuantity, Number(row.defaultQuantity || 1)));
    const allowQuantity = row.allowQuantity === true || row.qtyEnabled === true || row.quantityEnabled === true;

    return {
      id: row.id || row.itemId || "",
      name: row.name || row.label || row.value || "",
      price: Number(row.price || 0),
      allowQuantity,
      qtyEnabled: allowQuantity,
      defaultQuantity,
      maxQuantity,
      maxQty: maxQuantity,
      enabled: row.enabled !== false,
      sortOrder: Number(row.sortOrder || ((index + 1) * 1000))
    };
  }).filter(option => option.name).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  return {
    id,
    name: source.name || source.title || "",
    area,
    type: area,
    selectionType: normalizeMenuSelectionType(source.selectionType || source.choiceType || source.typeMode || (source.allowQuantity ? "quantity" : "single")),
    choiceType: normalizeMenuSelectionType(source.selectionType || source.choiceType || source.typeMode || (source.allowQuantity ? "quantity" : "single")),
    modules,
    visibility: source.visibility || modulesToVisibility(modules),
    required: source.required === true,
    minSelect: Math.max(0, Number(source.minSelect || 0)),
    maxSelect: Math.max(0, Number(source.maxSelect || 0)),
    description: source.description || "",
    enabled: source.enabled !== false,
    allowQuantity: source.allowQuantity === true,
    defaultQuantity: Math.max(1, Number(source.defaultQuantity || 1)),
    maxQuantity: Math.max(1, Number(source.maxQuantity || 1)),
    sortOrder: Number(source.sortOrder || 0),
    options
  };
}

export function getMenuOptionGroupItems(customGroupsData, customOptionGroupsData) {
  const merged = {};

  Object.entries(customOptionGroupsData || {}).forEach(([id, group]) => {
    merged[id] = normalizeMenuOptionGroup(id, group);
  });

  Object.entries(customGroupsData || {}).forEach(([id, group]) => {
    merged[id] = normalizeMenuOptionGroup(id, group);
  });

  return Object.keys(merged)
    .map(id => merged[id])
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

export function getAppliedMenuOptionGroups(config) {
  const item = config && config.item;
  const moduleName = config && config.moduleName;
  const customGroupsData = config && config.customGroupsData;
  const customOptionGroupsData = config && config.customOptionGroupsData;
  const legacyBuilder = config && config.legacyBuilder;
  let ids = item && (item.customGroupIds || item.customOptionGroupIds || item.optionGroupIds);

  if (!ids || (Array.isArray(ids) && !ids.length)) {
    return typeof legacyBuilder === "function" ? legacyBuilder(item, moduleName) : [];
  }

  if (!Array.isArray(ids)) {
    ids = Object.keys(ids || {}).filter(id => ids[id] !== false);
  }

  if (!ids.length) {
    return typeof legacyBuilder === "function" ? legacyBuilder(item, moduleName) : [];
  }

  const groups = [];

  ids.forEach(id => {
    const raw = (customGroupsData && customGroupsData[id]) || (customOptionGroupsData && customOptionGroupsData[id]);
    if (!raw) return;

    const group = normalizeMenuOptionGroup(id, raw);
    if (group.enabled === false) return;
    if (moduleName === "qr" && group.area === "posOnly") return;
    if (moduleName && group.modules && group.modules[moduleName] === false) return;
    if (moduleName === "qr" && group.modules.qr !== true) return;
    groups.push(group);
  });

  return groups;
}

export function summarizeMenuOptionGroups(groups) {
  return (groups || []).map(group => {
    const count = (group.options || []).length;
    return `${group.name || "餐點選項"} ${count}項`;
  }).join("、");
}
