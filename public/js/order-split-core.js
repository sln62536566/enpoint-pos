import { applyOrderItemPrice } from "./order-price-core.js";

function toNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : (fallback || 0);
}

function positiveQuantity(value) {
  var quantity = Math.floor(toNumber(value, 1));
  return quantity > 0 ? quantity : 1;
}

function optionQuantity(option) {
  if (!option) return 0;
  if (Object.prototype.hasOwnProperty.call(option, "allocationQuantity")) {
    return Math.max(0, Math.floor(toNumber(option.allocationQuantity, 0)));
  }
  if (Object.prototype.hasOwnProperty.call(option, "qty")) {
    return Math.max(0, Math.floor(toNumber(option.qty, 0)));
  }
  if (Object.prototype.hasOwnProperty.call(option, "quantity")) {
    return Math.max(0, Math.floor(toNumber(option.quantity, 0)));
  }
  return 0;
}

function cloneList(list) {
  return (Array.isArray(list) ? list : []).map(function(item) {
    return Object.assign({}, item || {});
  });
}

function isQuantityAllocationOption(option) {
  var type = String(option && (option.selectionType || option.choiceType || option.mode || "") || "");
  return type === "quantityAllocation" || option && option.quantityAllocation === true;
}

function makeCartId(seed, index) {
  return String(seed || "split") + "-split-" + index;
}

function applyDisplayName(item, option) {
  var optionName = option && option.name ? String(option.name) : "";
  if (!optionName) return item.name || item.itemName || "";
  return (item.name || item.itemName || "") + "（" + optionName + "）";
}

export function splitOrderItemByQuantityAllocation(item) {
  var source = item || {};
  var quantity = positiveQuantity(source.quantity || source.qty || 1);
  var customOptions = cloneList(source.customOptions);
  var allocationOptions = [];
  var commonOptions = [];

  for (var i = 0; i < customOptions.length; i += 1) {
    if (isQuantityAllocationOption(customOptions[i])) {
      if (optionQuantity(customOptions[i]) > 0) allocationOptions.push(customOptions[i]);
    } else {
      commonOptions.push(customOptions[i]);
    }
  }

  if (!allocationOptions.length) {
    return [applyOrderItemPrice(Object.assign({}, source, { customOptions: commonOptions }))];
  }

  var parentItemId = source.parentItemId || source.itemId || source.id || "";
  var splitGroupId = source.splitGroupId || source.cartId || ("split-" + (Date.now ? Date.now() : new Date().getTime()));
  var baseQuantity = quantity;
  var result = [];
  var baseFields = Object.assign({}, source, {
    parentItemId: parentItemId,
    splitGroupId: splitGroupId
  });

  delete baseFields.variants;

  for (var a = 0; a < allocationOptions.length; a += 1) {
    var allocation = Object.assign({}, allocationOptions[a]);
    var allocatedQty = Math.min(baseQuantity, optionQuantity(allocation));
    if (allocatedQty <= 0) continue;
    baseQuantity -= allocatedQty;
    allocation.qty = 1;
    allocation.quantity = 1;
    allocation.allocationQuantity = allocatedQty;

    result.push(applyOrderItemPrice(Object.assign({}, baseFields, {
      cartId: makeCartId(splitGroupId, result.length + 1),
      displayName: applyDisplayName(source, allocation),
      size: allocation.name || source.size || "",
      splitOptionId: allocation.optionId || allocation.id || allocation.name || "",
      customOptions: commonOptions.concat([allocation]),
      quantity: allocatedQty,
      qty: allocatedQty
    })));
  }

  if (baseQuantity > 0) {
    result.unshift(applyOrderItemPrice(Object.assign({}, baseFields, {
      cartId: makeCartId(splitGroupId, 0),
      displayName: source.displayName || source.name || source.itemName || "",
      splitOptionId: "",
      customOptions: commonOptions,
      quantity: baseQuantity,
      qty: baseQuantity
    })));
  }

  return result;
}
