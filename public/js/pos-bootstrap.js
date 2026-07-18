console.log("[BOOT 01] Bootstrap Module Started");

function getBootErrorDetails(error) {
  var bootError = error instanceof Error ? error : new Error(String(error || "Unknown bootstrap error"));
  return {
    message: bootError.message,
    name: bootError.name,
    stack: bootError.stack || null,
    cause: bootError.cause || null,
    error: error,
    url: window.location.href,
    userAgent: navigator.userAgent,
    time: new Date().toISOString(),
    online: navigator.onLine
  };
}

function reportBootStop(reason) {
  console.error("[BOOT STOP]", {
    stoppedAt: "[BOOT 03] Importing POS Module",
    reason: reason
  });
}

function showBootImportFailure(message) {
  var loadingScreen = document.getElementById("appLoadingScreen");
  if (!loadingScreen) return;
  loadingScreen.classList.remove("hidden");

  var title = loadingScreen.querySelector("strong");
  var detail = loadingScreen.querySelector("span");
  if (title) title.textContent = "恩點系統載入失敗";
  if (detail) detail.textContent = "模組載入失敗：" + message;

  var loadingBox = loadingScreen.querySelector(".app-loading-box");
  if (!loadingBox) return;
  var instruction = document.getElementById("bootFailureInstruction");
  if (!instruction) instruction = document.createElement("div");
  instruction.id = "bootFailureInstruction";
  instruction.textContent = "請截圖此畫面提供除錯";
  loadingBox.appendChild(instruction);
}

window.addEventListener("error", function(event) {
  var target = event && event.target;
  var resourceUrl = target && (target.src || target.href);
  if (resourceUrl) {
    console.error("[BOOT RESOURCE ERROR]", {
      message: "Resource failed to load",
      resource: resourceUrl,
      tagName: target.tagName || null,
      url: window.location.href,
      userAgent: navigator.userAgent,
      time: new Date().toISOString(),
      online: navigator.onLine,
      event: event
    });
    return;
  }

  console.error("[BOOT ERROR]", getBootErrorDetails(event && (event.error || event.message)));
}, true);

window.addEventListener("unhandledrejection", function(event) {
  console.error("[BOOT UNHANDLED REJECTION]", getBootErrorDetails(event && event.reason));
});

console.log("[BOOT 02] Global Error Handlers Installed");
console.log("[BOOT 03] Importing POS Module");

try {
  await import("./pos.js?v=664");
  console.log("[BOOT 04] POS Module Imported");
} catch (error) {
  console.error("[BOOT IMPORT ERROR]", getBootErrorDetails(error));
  reportBootStop(error && error.message ? error.message : String(error));
  showBootImportFailure(error && error.message ? error.message : String(error));
  window.addEventListener("load", function() {
    showBootImportFailure(error && error.message ? error.message : String(error));
  }, { once: true });
}
