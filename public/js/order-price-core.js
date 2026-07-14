// Shared item pricing core for POS, QR, order editing, and print totals.
// One item may contain multiple option variants; each variant is priced by
// (basePrice + optionPrice) * quantity, then item-level adjustments are applied.

function toNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : (fallback || 0);
}

function positiveQuantity(value) {
  var quantity = Math.floor(toNumber(value, 1));
  return quantity > 0 ? quantity : 1;
}

function sumOptionPrice(options) {
  var total = 0;
  var list = Array.isArray(options) ? options : [];

  for (var i = 0; i < list.length; i += 1) {
    var option = list[i] || {};
    var quantity = positiveQuantity(option.optionQuantity || option.qty || option.quantity || 1);
    total += toNumber(option.price || option.optionPrice || 0) * quantity;
  }

  return total;
}

function inferBasePrice(item) {
  return toNumber(
    item && (
      item.basePrice !== undefined ? item.basePrice :
      item.selectedBasePrice !== undefined ? item.selectedBasePrice :
      item.sizePrice !== undefined ? item.sizePrice :
      item.price !== undefined ? item.price :
      item.unitPrice !== undefined ? item.unitPrice :
      0
    ),
    0
  );
}

function inferOptionPrice(item) {
  if (!item) return 0;

  if (item.optionPrice !== undefined) return toNumber(item.optionPrice, 0);

  var addonSource = Array.isArray(item.addons) && item.addons.length ? item.addons : item.extras;

  return sumOptionPrice(item.selectedOptions)
    + sumOptionPrice(item.customOptions)
    + sumOptionPrice(addonSource);
}

function normalizeVariant(rawVariant, parentItem) {
  var variant = rawVariant || {};
  var basePrice = toNumber(
    variant.basePrice !== undefined ? variant.basePrice : inferBasePrice(parentItem),
    0
  );
  var optionPrice = variant.optionPrice !== undefined
    ? toNumber(variant.optionPrice, 0)
    : inferOptionPrice(variant);
  var quantity = positiveQuantity(variant.quantity || variant.qty || 1);
  var unitPrice = basePrice + optionPrice;
  var subtotal = unitPrice * quantity;

  return Object.assign({}, variant, {
    basePrice: basePrice,
    optionPrice: optionPrice,
    unitPrice: unitPrice,
    price: unitPrice,
    quantity: quantity,
    qty: quantity,
    subtotal: subtotal
  });
}

export function calculateOrderItemPrice(item) {
  var source = item || {};
  var variants = Array.isArray(source.variants) && source.variants.length
    ? source.variants.map(function(variant) { return normalizeVariant(variant, source); })
    : [normalizeVariant(source, source)];

  var subtotal = variants.reduce(function(sum, variant) {
    return sum + toNumber(variant.subtotal, 0);
  }, 0);
  var discount = toNumber(source.discount, 0);
  var serviceCharge = toNumber(source.serviceCharge, 0);
  var finalPrice = subtotal - discount + serviceCharge;
  var firstVariant = variants[0] || normalizeVariant({}, source);

  return {
    basePrice: firstVariant.basePrice,
    optionPrice: firstVariant.optionPrice,
    unitPrice: firstVariant.unitPrice,
    quantity: variants.length === 1
      ? firstVariant.quantity
      : variants.reduce(function(sum, variant) { return sum + positiveQuantity(variant.quantity); }, 0),
    subtotal: subtotal,
    discount: discount,
    serviceCharge: serviceCharge,
    finalPrice: finalPrice,
    variants: variants
  };
}

export function applyOrderItemPrice(item) {
  var priced = calculateOrderItemPrice(item);
  var nextItem = Object.assign({}, item || {}, {
    basePrice: priced.basePrice,
    optionPrice: priced.optionPrice,
    unitPrice: priced.unitPrice,
    price: priced.unitPrice,
    quantity: priced.quantity,
    qty: priced.quantity,
    subtotal: priced.subtotal,
    discount: priced.discount,
    serviceCharge: priced.serviceCharge,
    finalPrice: priced.finalPrice
  });

  if (Array.isArray(item && item.variants) && item.variants.length) {
    nextItem.variants = priced.variants;
  }

  return nextItem;
}

export function calculateOrderTotal(items) {
  return (Array.isArray(items) ? items : []).reduce(function(sum, item) {
    return sum + calculateOrderItemPrice(item).finalPrice;
  }, 0);
}
