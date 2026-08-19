function clear(element) {
  while (element && element.firstChild) element.removeChild(element.firstChild);
}

function appendText(documentRef, parent, tag, text, className = "") {
  const element = documentRef.createElement(tag);
  element.textContent = String(text);
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function formatCurrency(value) {
  const amount = Number(value);
  return `NT$ ${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString("zh-TW")}`;
}

function formatPercentage(value) {
  const number = Number(value);
  return `${(Number.isFinite(number) ? number * 100 : 0).toFixed(1)}%`;
}

function createSection(documentRef, parent, title) {
  const section = documentRef.createElement("section");
  section.className = "stats-box statistics-analytics-section";
  appendText(documentRef, section, "h3", title);
  parent.appendChild(section);
  return section;
}

function renderProductList(documentRef, parent, rows, metric) {
  const list = documentRef.createElement("div");
  list.className = "top-items-list";
  if (!rows.length) appendText(documentRef, list, "div", "此期間沒有可分析的商品資料", "empty");
  rows.slice(0, 5).forEach((row, index) => {
    const item = documentRef.createElement("div"); item.className = "top-item-row";
    appendText(documentRef, item, "span", `${index + 1}. ${row.name}`);
    appendText(documentRef, item, "strong", metric === "quantity" ? `${row.quantity} 份` : formatCurrency(row.revenue));
    list.appendChild(item);
  });
  parent.appendChild(list);
}

function renderBreakdownCards(documentRef, parent, rows, labels, emptyText) {
  const grid = documentRef.createElement("div"); grid.className = "statistics-breakdown-grid";
  if (!rows.some(row => row.paidOrders > 0)) appendText(documentRef, grid, "div", emptyText, "empty");
  rows.forEach(row => {
    const card = documentRef.createElement("div"); card.className = "statistics-breakdown-card";
    appendText(documentRef, card, "strong", labels[row.key] || row.key);
    appendText(documentRef, card, "span", `${row.paidOrders} 筆`);
    appendText(documentRef, card, "span", formatCurrency(row.salesRevenue));
    appendText(documentRef, card, "span", `營收占比 ${formatPercentage(row.revenueShare)}`);
    grid.appendChild(card);
  });
  parent.appendChild(grid);
}

function renderStatisticsAnalytics(documentRef, container, analytics, options = {}) {
  if (!container || !analytics) return false;
  clear(container);
  container.classList.add("statistics-analytics-layout");
  if (options.includeQuantity !== false) {
    const quantity = createSection(documentRef, container, "熱銷商品 TOP 5（數量）");
    renderProductList(documentRef, quantity, analytics.productAnalytics.byQuantity, "quantity");
  }
  const revenue = createSection(documentRef, container, "商品營收 TOP 5");
  renderProductList(documentRef, revenue, analytics.productAnalytics.byRevenue, "revenue");
  const source = createSection(documentRef, container, "訂單來源");
  renderBreakdownCards(documentRef, source, analytics.sourceAnalytics, { POS: "POS", QR: "QR", Unknown: "未分類" }, "此期間沒有可分析的訂單來源資料");
  const type = createSection(documentRef, container, "用餐方式");
  renderBreakdownCards(documentRef, type, analytics.orderTypeAnalytics, { "內用": "內用", "外帶": "外帶", Unknown: "未分類" }, "此期間沒有可分析的用餐方式資料");
  return true;
}

export { formatPercentage, renderStatisticsAnalytics };
