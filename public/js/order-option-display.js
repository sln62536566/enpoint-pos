function asText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function isSizeCustomOption(option) {
  var groupId = asText(option && option.groupId);
  var groupName = asText(option && option.groupName).toLowerCase();
  return groupId === "__legacy_sizes" ||
    groupName.indexOf("份量") !== -1 ||
    groupName.indexOf("size") !== -1 ||
    groupName.indexOf("大小") !== -1;
}

function normalizeGroupLabel(label) {
  var text = asText(label) || "選項";
  if (text.indexOf("不要") !== -1) return "不要";
  if (text.indexOf("加料") !== -1 || text.indexOf("加點") !== -1) return "加料";
  return text;
}

function optionName(option) {
  if (typeof option === "string") return asText(option);
  return asText(option && (option.name || option.label || option.value || option.title));
}

function optionLabel(option) {
  var name = optionName(option);
  if (!name) return "";
  var qty = Number(option && option.qty || 1);
  return name + (qty > 1 ? " x" + qty : "");
}

function normalizeRemoveName(value) {
  var text = optionName(value);
  return text.replace(/^不要/, "").trim() || text;
}

function getSizeLabel(item) {
  var list = item && item.customOptions;
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i += 1) {
      var option = list[i] || {};
      if (isSizeCustomOption(option) && optionName(option)) return optionName(option);
    }
  }
  return asText(item && (item.size || item.sizeName || item.portion || item.selectedSize)) || "一般";
}

function addLine(lines, seen, label, value) {
  var cleanLabel = asText(label);
  var cleanValue = asText(value);
  if (!cleanLabel || !cleanValue) return;
  var key = cleanLabel + "\n" + cleanValue;
  if (seen[key]) return;
  seen[key] = true;
  lines.push({
    label: cleanLabel,
    value: cleanValue,
    text: cleanLabel + "：" + cleanValue
  });
}

function collectCustomGroups(item, moduleName) {
  var list = item && item.customOptions;
  var groups = [];
  var byGroup = {};
  var flags = {
    addons: false,
    removes: false,
    spicy: false,
    satay: false
  };

  if (!Array.isArray(list)) return { groups: groups, flags: flags };

  for (var i = 0; i < list.length; i += 1) {
    var option = list[i] || {};
    if (moduleName && option.modules && option.modules[moduleName] === false) continue;
    if (isSizeCustomOption(option)) continue;

    var label = normalizeGroupLabel(option.groupName);
    var name = optionLabel(option);
    if (!name) continue;

    if (label === "加料") flags.addons = true;
    if (label === "不要") flags.removes = true;
    if (label.indexOf("辣") !== -1) flags.spicy = true;
    if (label.indexOf("沙茶") !== -1) flags.satay = true;

    if (!byGroup[label]) {
      byGroup[label] = [];
      groups.push({ label: label, values: byGroup[label] });
    }
    byGroup[label].push(label === "不要" ? normalizeRemoveName(option) : name);
  }

  return { groups: groups, flags: flags };
}

function namesFromList(list, normalizeRemoves) {
  var result = [];
  if (!Array.isArray(list)) return result;
  for (var i = 0; i < list.length; i += 1) {
    var text = normalizeRemoves ? normalizeRemoveName(list[i]) : optionLabel(list[i]);
    if (text) result.push(text);
  }
  return result;
}

export function formatOrderOptionDisplay(item, options) {
  var config = options || {};
  var moduleName = config.moduleName || "";
  var lines = [];
  var seen = {};
  if (!item) return lines;

  addLine(lines, seen, "份量", getSizeLabel(item));

  if (item.requiredOption && (item.requiredOption.value || item.requiredOption.name)) {
    addLine(lines, seen, item.requiredOption.title || "必選", item.requiredOption.value || item.requiredOption.name);
  }

  var custom = collectCustomGroups(item, moduleName);

  if (item.spicy && !custom.flags.spicy) addLine(lines, seen, "辣度", item.spicy);
  if (item.satay && !custom.flags.satay) addLine(lines, seen, "沙茶", item.satay);

  for (var c = 0; c < custom.groups.length; c += 1) {
    addLine(lines, seen, custom.groups[c].label, custom.groups[c].values.join("、"));
  }

  var addons = namesFromList(item.addons || item.extras || [], false);
  if (addons.length && !custom.flags.addons) addLine(lines, seen, "加料", addons.join("、"));

  var removes = namesFromList(item.removes || item.removeOptionsSelected || item.noOptionsSelected || [], true);
  if (removes.length && !custom.flags.removes) addLine(lines, seen, "不要", removes.join("、"));

  var combo = asText(item.comboName || item.combo || item.mealName || item.meal || item.setName);
  if (combo) addLine(lines, seen, "套餐", combo);

  if (item.note) addLine(lines, seen, "備註", item.note);

  return lines;
}

export function formatOrderOptionLines(item, options) {
  return formatOrderOptionDisplay(item, options).map(function(line) {
    return line.text;
  });
}

export function formatOrderOptionHtml(item, escapeFn, options) {
  var escapeText = typeof escapeFn === "function" ? escapeFn : function(value) { return asText(value); };
  return formatOrderOptionLines(item, options).map(function(line) {
    return "<p>" + escapeText(line) + "</p>";
  }).join("");
}
