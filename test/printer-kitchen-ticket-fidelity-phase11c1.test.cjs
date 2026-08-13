const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let adaptPrinterEvent, createReceiptModel, buildKitchenReceiptLayout, buildCustomerReceiptLayout;

test.before(async () => {
  const root = path.join(__dirname, "..", "public", "js");
  const read = name => fs.readFile(path.join(root, name), "utf8");
  const [triggerSource, adapterRaw, modelSource, layoutRaw] = await Promise.all([read("print-trigger.js"), read("printer-event-adapter.js"), read("receipt-model.js"), read("receipt-layout.js")]);
  const adapterSource = adapterRaw.replace("./print-trigger.js", dataUrl(triggerSource));
  const layoutSource = layoutRaw.replace("./receipt-model.js", dataUrl(modelSource));
  adaptPrinterEvent = (await import(dataUrl(adapterSource))).adaptPrinterEvent;
  const model = await import(dataUrl(modelSource));
  createReceiptModel = model.createReceiptModel;
  const layout = await import(dataUrl(layoutSource));
  buildKitchenReceiptLayout = layout.buildKitchenReceiptLayout;
  buildCustomerReceiptLayout = layout.buildCustomerReceiptLayout;
});

function order(overrides = {}) {
  return Object.assign({
    id: "order-1", orderNumber: "P-001", storeName: "恩點", table: "3桌", paymentStatus: "unpaid", isTestOrder: true,
    note: "先做", total: 250,
    items: [{
      itemName: "鍋燒意麵", qty: 1, price: 250, size: "大份", spicy: "大辣", satay: "要沙茶",
      requiredOption: { title: "必選", value: "牛肉" }, addons: [{ name: "加蛋", qty: 2 }], removes: ["魚板"], note: "麵軟",
      customOptions: [
        { groupId: "size", groupName: "份量", name: "大份", modules: { print: true } },
        { groupId: "spicy", groupName: "辣度", name: "大辣", modules: { print: true } },
        { groupId: "satay", groupName: "沙茶", name: "要沙茶", modules: { print: true } },
        { groupId: "__legacy_required_meat", groupName: "必選", name: "牛肉", modules: { print: true } },
        { groupId: "__legacy_addons", groupName: "加料", name: "加蛋", qty: 2, modules: { print: true } },
        { groupId: "__legacy_removes", groupName: "不要項目", name: "魚板", modules: { print: true } },
        { groupId: "secret", groupName: "隱藏", name: "不可列印", modules: { print: false } }
      ]
    }]
  }, overrides);
}

function chain(input) {
  const trigger = adaptPrinterEvent({ eventType: "OrderCreated", source: "POS", storeId: "store", order: input, ticketType: "auto", routeGroup: "Kitchen", policy: "pos-order-created" });
  return { trigger, model: createReceiptModel(trigger.payload.order), layout: buildKitchenReceiptLayout(trigger.payload.order) };
}

function output(layout) { return layout.nodes.filter(node => node.type === "line").map(node => node.value).join("\n"); }

test("324 full POS order survives adapter model and kitchen layout", () => {
  const text = output(chain(order()).layout);
  for (const value of ["鍋燒意麵", "大份", "大辣", "沙茶", "加蛋 x2", "魚板", "牛肉", "麵軟", "先做", "P-001", "3桌"]) assert.match(text, new RegExp(value));
});
test("325 custom options are authoritative over legacy fallbacks", () => { const text = output(chain(order()).layout); for (const value of ["大份", "大辣", "要沙茶", "加蛋 x2", "魚板", "牛肉"]) assert.equal(text.split(value).length - 1, 1, value); });
test("326 modules print false options are excluded", () => assert.doesNotMatch(output(chain(order()).layout), /不可列印/));
test("327 arbitrary custom option groups print with group label", () => { const value = order(); value.items[0].customOptions.push({ groupId: "soup", groupName: "湯底", name: "麻辣", modules: { print: true } }); assert.match(output(chain(value).layout), /湯底：麻辣/); });
test("328 legacy-only details remain supported", () => { const value = order(); value.items[0].customOptions = []; const text = output(chain(value).layout); for (const detail of ["份量：大份", "辣度：大辣", "沙茶：要沙茶", "加料：加蛋 x2", "不要：魚板", "必選：牛肉"]) assert.match(text, new RegExp(detail)); });
test("329 item and order notes reach kitchen nodes", () => { const text = output(chain(order()).layout); assert.match(text, /備註：麵軟/); assert.match(text, /整單備註：\n先做/); });
test("330 test and unpaid flags are explicit", () => { const text = output(chain(order()).layout); assert.match(text, /測試單/); assert.match(text, /未付款/); });
test("331 normal paid order has no false warning flags", () => { const text = output(chain(order({ isTestOrder: false, paymentStatus: "paid" })).layout); assert.doesNotMatch(text, /測試單|未付款/); });
test("332 receipt fidelity extension is deeply immutable", () => { const model = chain(order()).model; assert.equal(Object.isFrozen(model), true); assert.equal(Object.isFrozen(model.items), true); assert.equal(Object.isFrozen(model.items[0]), true); assert.equal(Object.isFrozen(model.items[0].details), true); assert.throws(() => model.items[0].details.push("change")); });
test("333 legacy receipt input remains backward compatible", () => { const model = createReceiptModel({ items: [{ name: "Tea", quantity: 1, unitPrice: 10, note: "hot" }] }); assert.deepEqual(Array.from(model.items[0].details), []); assert.equal(model.orderNote, ""); assert.equal(model.isTestOrder, false); });
test("334 customer layout remains compatible", () => { const layout = buildCustomerReceiptLayout({ store: "Store", orderNumber: "1", items: [{ name: "Tea", quantity: 1, unitPrice: 10 }], total: 10 }); assert.match(output(layout), /Tea x1 10/); });
