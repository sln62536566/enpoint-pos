const ERROR_MESSAGES = Object.freeze({
  NO_PRINTER_CONFIGURED: "尚未選擇印表機。",
  PHYSICAL_TARGET_NOT_FOUND: "印表機未綁定，請先選擇印表機。",
  BINDING_MISSING: "印表機未綁定，請先選擇印表機。",
  NOT_SUPPORTED: "此瀏覽器不支援 USB 印表機。",
  WEBUSB_UNSUPPORTED: "此瀏覽器不支援 USB 印表機。",
  PERMISSION_DENIED: "需要允許 USB 裝置權限。",
  DEVICE_SELECTION_FAILED: "無法選擇 USB 印表機，請確認裝置權限。",
  DEVICE_NOT_FOUND: "找不到原本綁定的印表機。",
  PHYSICAL_TARGET_UNAVAILABLE: "找不到原本綁定的印表機。",
  DEVICE_DISCONNECTED: "印表機已中斷連線。",
  DEVICE_BUSY: "印表機目前忙碌，請稍後再試。",
  TRANSPORT_BUSY: "印表機目前忙碌，請稍後再試。",
  TRANSFER_TIMEOUT: "列印傳送逾時，請檢查印表機後再試。",
  CLAIM_FAILED: "無法連接印表機。",
  CONNECTION_FAILED: "無法連接印表機。",
  CONFIGURATION_RELOAD_FAILED: "設定已儲存，但印表機重新載入失敗。",
  TEST_PRINT_FAILED: "測試列印失敗，請檢查印表機。"
});

function text(value, fallback = "—") {
  const result = String(value === undefined || value === null ? "" : value).trim();
  return result || fallback;
}

function hex(value) {
  return (Number(value) || 0).toString(16).toUpperCase().padStart(4, "0");
}

export function operatorPrinterError(error, fallbackCode = "TEST_PRINT_FAILED") {
  const code = String(error && (error.code || error.lastErrorCode) || fallbackCode);
  return Object.freeze({ ok: false, code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES[fallbackCode] });
}

export function bindingStatus(profile) {
  const binding = profile && profile.deviceBinding;
  if (!binding) return Object.freeze({ state: "unbound", label: "未綁定", warning: "請選擇這個用途要使用的 USB 印表機。" });
  if (binding.durable === false) return Object.freeze({ state: "session", label: "僅限本次工作階段", warning: "此印表機沒有可永久識別的序號，重新開啟瀏覽器或裝置後可能需要重新選擇。" });
  return Object.freeze({ state: "bound", label: "已綁定", warning: "綁定資料已儲存；這不代表印表機目前已連線。" });
}

export function printerBindingSummary(profile, purpose) {
  const binding = profile && profile.deviceBinding;
  const status = bindingStatus(profile);
  return Object.freeze({
    purpose: text(purpose), status,
    deviceName: binding ? text(binding.productName, "USB 印表機") : "—",
    vendorId: binding ? hex(binding.vendorId) : "—",
    productId: binding ? hex(binding.productId) : "—",
    serialNumber: binding ? text(binding.serialNumber) : "—",
    paperSize: profile ? `${text(profile.paperSize)}mm` : "—",
    copies: profile ? String(profile.copies || 1) : "—",
    autoPrint: profile && profile.autoPrint === true ? "開啟" : "關閉"
  });
}

export function renderBindingSummary(container, profile, purpose) {
  if (!container) return null;
  const value = printerBindingSummary(profile, purpose);
  container.setAttribute("data-binding-state", value.status.state);
  const fields = {
    status: value.status.label, device: value.deviceName, vid: value.vendorId, pid: value.productId,
    serial: value.serialNumber, paper: value.paperSize, copies: value.copies, auto: value.autoPrint, warning: value.status.warning
  };
  Object.keys(fields).forEach(key => {
    const target = container.querySelector(`[data-binding-${key}]`);
    if (target) target.textContent = fields[key];
  });
  return value;
}

export async function applyPrinterConfiguration(bridge, onState) {
  const emit = typeof onState === "function" ? onState : function() {};
  emit(Object.freeze({ state: "loading", message: "正在套用設定…" }));
  try {
    if (!bridge || typeof bridge.invalidateConfiguration !== "function" || typeof bridge.reloadConfiguration !== "function") {
      throw Object.assign(new Error("Printer configuration bridge unavailable"), { code: "CONFIGURATION_RELOAD_FAILED" });
    }
    const invalidated = await bridge.invalidateConfiguration();
    if (invalidated && invalidated.ok === false) throw Object.assign(new Error("Configuration invalidation failed"), { code: invalidated.code });
    const reloaded = await bridge.reloadConfiguration();
    if (!reloaded || reloaded.ok === false) throw Object.assign(new Error("Configuration reload failed"), { code: reloaded && reloaded.code || "CONFIGURATION_RELOAD_FAILED" });
    const result = Object.freeze({ ok: true, state: "success", code: "CONFIGURATION_APPLIED", message: "設定已套用。" });
    emit(result);
    return result;
  } catch (error) {
    console.warn("Printer settings reload isolated", { code: error && error.code || "CONFIGURATION_RELOAD_FAILED", error });
    const mapped = operatorPrinterError(error, "CONFIGURATION_RELOAD_FAILED");
    const result = Object.freeze({ ok: false, state: "error", code: mapped.code, message: mapped.message });
    emit(result);
    return result;
  }
}

export function savePrinterProfileAndApply(profileApi, profileName, changes, bridge, onState) {
  if (!profileApi || typeof profileApi.update !== "function") throw new TypeError("Printer Profile API unavailable");
  const profile = profileApi.update(profileName, changes || {});
  return Object.freeze({ profile, completion: applyPrinterConfiguration(bridge, onState) });
}

export const PrinterSettingsOperator = Object.freeze({
  bindingStatus, printerBindingSummary, renderBindingSummary, operatorPrinterError, applyPrinterConfiguration, savePrinterProfileAndApply
});
