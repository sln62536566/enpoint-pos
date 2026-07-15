export function createQrSessionController(options) {
  var db = options.db;
  var ref = options.ref;
  var set = options.set;
  var update = options.update;
  var onValue = options.onValue;
  var storage = options.storage || {};
  var sessionStorageRef = storage.sessionStorage;
  var localStorageRef = storage.localStorage;
  var sessionKey = options.sessionKey || "enpoint_qr_session_id";
  var startedAtKey = options.startedAtKey || "enpoint_qr_session_started_at";
  var activityAtKey = options.activityAtKey || "enpoint_qr_session_last_activity_at";
  var closeDayRefPath = options.closeDayRefPath || "qrSessionControl/closeDayVersion";
  var sessionRoot = options.sessionRoot || "qrSessions";
  var timeoutTickMs = options.timeoutTickMs || 15000;
  var activitySyncMs = options.activitySyncMs || 30000;
  var state = {
    id: "",
    startedAt: 0,
    lastActivityAt: 0,
    lastSyncedActivityAt: 0,
    orderId: "",
    invalid: false,
    invalidReason: "",
    closeDayReady: false,
    closeDayVersion: 0,
    timer: null,
    activityBound: false
  };

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function makeId() {
    return "qr_" + now() + "_" + Math.floor(Math.random() * 1000000000);
  }

  function readSessionStorage(key) {
    try {
      return sessionStorageRef ? sessionStorageRef.getItem(key) : "";
    } catch (e) {
      return "";
    }
  }

  function writeSessionStorage(key, value) {
    try {
      if (sessionStorageRef) sessionStorageRef.setItem(key, String(value));
    } catch (e) {}
  }

  function sessionRef(path) {
    return ref(db, sessionRoot + "/" + state.id + (path ? "/" + path : ""));
  }

  function saveStorage() {
    writeSessionStorage(sessionKey, state.id);
    writeSessionStorage(startedAtKey, state.startedAt);
    writeSessionStorage(activityAtKey, state.lastActivityAt);
  }

  function timeoutMinutes() {
    return options.getTimeoutMinutes ? options.getTimeoutMinutes() : 30;
  }

  function writePatch(patch) {
    if (!state.id || !patch) return;
    try {
      update(sessionRef(""), patch).catch(function(error) {
        if (options.onError) options.onError("QR session update failed", error);
      });
    } catch (e) {}
  }

  function ensure() {
    if (state.id) return state.id;
    var currentTime = now();
    var hadStoredSession = false;
    state.id = readSessionStorage(sessionKey) || "";
    state.startedAt = Number(readSessionStorage(startedAtKey) || 0);
    state.lastActivityAt = Number(readSessionStorage(activityAtKey) || 0);
    hadStoredSession = !!state.id;

    if (!state.id || !state.startedAt) {
      state.id = makeId();
      state.startedAt = currentTime;
      state.lastActivityAt = currentTime;
      hadStoredSession = false;
    }
    if (!state.lastActivityAt) state.lastActivityAt = currentTime;
    saveStorage();

    var basePatch = {
      timeoutMinutes: timeoutMinutes(),
      lastSeenAt: currentTime
    };
    if (hadStoredSession) {
      try {
        update(sessionRef(""), basePatch).catch(function(error) {
          if (options.onError) options.onError("QR session resume failed", error);
        });
      } catch (e) {}
    } else {
      try {
        set(sessionRef(""), {
          id: state.id,
          storeId: options.storeId || "defaultStore",
          table: options.table || "",
          status: "active",
          startedAt: state.startedAt,
          lastActivityAt: state.lastActivityAt,
          timeoutMinutes: timeoutMinutes(),
          orderId: state.orderId || "",
          createdFrom: "qr",
          userAgent: typeof navigator !== "undefined" && navigator.userAgent ? String(navigator.userAgent).slice(0, 240) : ""
        }).catch(function(error) {
          if (options.onError) options.onError("QR session create failed", error);
        });
      } catch (e2) {}
    }
    return state.id;
  }

  function isExpired() {
    var minutes = timeoutMinutes();
    var lastActivityAt = Number(state.lastActivityAt || 0);
    if (!lastActivityAt) lastActivityAt = Number(readSessionStorage(activityAtKey) || readSessionStorage(startedAtKey) || 0);
    if (!lastActivityAt) return false;
    return now() - lastActivityAt > minutes * 60 * 1000;
  }

  function invalidate(reason, skipRemoteWrite) {
    if (state.invalid) return false;
    ensure();
    state.invalid = true;
    state.invalidReason = reason || (options.invalidMessage || "本次點餐已失效。請重新掃描桌面 QR Code。");
    if (!skipRemoteWrite) {
      writePatch({
        status: "expired",
        invalidReason: state.invalidReason,
        invalidatedAt: now(),
        updatedAt: now()
      });
    }
    if (options.onExpired) options.onExpired(state.invalidReason);
    return false;
  }

  function markActivity(forceSync) {
    if (state.invalid) return;
    ensure();
    var currentTime = now();
    state.lastActivityAt = currentTime;
    saveStorage();
    if (forceSync || currentTime - state.lastSyncedActivityAt > activitySyncMs) {
      state.lastSyncedActivityAt = currentTime;
      writePatch({
        lastActivityAt: currentTime,
        timeoutMinutes: timeoutMinutes()
      });
    }
  }

  function active() {
    if (state.invalid) {
      if (options.onExpired) options.onExpired(state.invalidReason);
      return false;
    }
    if (isExpired()) return invalidate(options.invalidMessage, false);
    markActivity(false);
    return true;
  }

  function bindActivityListeners() {
    if (state.activityBound || typeof document === "undefined") return;
    state.activityBound = true;
    ["click", "touchend", "keydown", "input", "change"].forEach(function(eventName) {
      document.addEventListener(eventName, function() {
        markActivity(false);
      }, true);
    });
  }

  function start() {
    ensure();
    markActivity(true);
    bindActivityListeners();
    try {
      onValue(sessionRef(""), function(snapshot) {
        var session = snapshot && snapshot.val ? snapshot.val() : null;
        if (!session) return;
        state.orderId = session.orderId || state.orderId || "";
        if (session.status === "completed" || session.status === "closedDay" || session.status === "expired" || session.status === "invalid") {
          invalidate(options.invalidMessage, true);
        }
      });
    } catch (e) {}
    try {
      onValue(ref(db, closeDayRefPath), function(snapshot) {
        var version = Number(snapshot && snapshot.val ? snapshot.val() : 0);
        if (!version) return;
        if (!state.closeDayReady) {
          state.closeDayReady = true;
          state.closeDayVersion = version;
          return;
        }
        if (version !== state.closeDayVersion) {
          state.closeDayVersion = version;
          invalidate(options.invalidMessage, false);
        }
      });
    } catch (e2) {}
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function() {
      if (!state.invalid && isExpired()) invalidate(options.invalidMessage, false);
    }, timeoutTickMs);
  }

  function setSubmittedOrder(orderId) {
    state.orderId = orderId || "";
    writePatch({
      status: "submitted",
      orderId: state.orderId,
      submittedAt: now(),
      updatedAt: now()
    });
  }

  function canViewOrder(orderId) {
    return !!orderId && !!state.orderId && String(orderId) === String(state.orderId);
  }

  function expireForCompletedOrder(orderId) {
    if (!orderId || !state.orderId || String(orderId) !== String(state.orderId)) return;
    invalidate(options.invalidMessage, false);
  }

  return {
    ensure: ensure,
    active: active,
    start: start,
    invalidate: invalidate,
    isExpired: isExpired,
    markActivity: markActivity,
    writePatch: writePatch,
    setSubmittedOrder: setSubmittedOrder,
    canViewOrder: canViewOrder,
    expireForCompletedOrder: expireForCompletedOrder,
    getState: function() { return state; },
    getOrderId: function() { return state.orderId || ""; },
    setOrderId: function(orderId) { state.orderId = orderId || ""; }
  };
}

export function createQrTabController(options) {
  var orderTabId = options.orderTabId || "qrOrderTabLink";
  var viewTabId = options.viewTabId || "qrViewOrderPlainLink";
  var openDefaultTab = options.openDefaultTab !== false;

  function stopEvent(event) {
    if (!event) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  function openMenu(event) {
    stopEvent(event);
    if (options.onMenu) options.onMenu();
    return false;
  }

  function openOrder(event) {
    stopEvent(event);
    if (options.onOrder) options.onOrder();
    return false;
  }

  function bind() {
    if (typeof document === "undefined") return;
    var orderTab = document.getElementById(orderTabId);
    var viewTab = document.getElementById(viewTabId);
    if (orderTab) {
      orderTab.href = "javascript:void(0)";
      orderTab.addEventListener("click", openMenu);
    }
    if (viewTab) {
      viewTab.href = "javascript:void(0)";
      viewTab.addEventListener("click", openOrder);
    }
  }

  function start() {
    bind();
    if (openDefaultTab) openMenu(null);
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", function(event) {
        if (event && event.persisted) openMenu(null);
      }, false);
    }
  }

  return {
    bind: bind,
    start: start,
    openMenu: openMenu,
    openOrder: openOrder
  };
}
