var modalRegistry = [];
var activeModals = [];
var headerElements = [];
var bodyScrollLocked = false;
var previousBodyOverflow = "";
var previousHtmlOverflow = "";
var initialized = false;

function hasClass(element, className) {
  return !!element && (" " + (element.className || "") + " ").indexOf(" " + className + " ") !== -1;
}

function addClass(element, className) {
  if (!element || hasClass(element, className)) return;
  element.className = ((element.className || "") + " " + className).replace(/\s+/g, " ").trim();
}

function removeClass(element, className) {
  if (!element) return;
  element.className = (" " + (element.className || "") + " ").replace(" " + className + " ", " ").replace(/\s+/g, " ").trim();
}

function removeFromStack(modal) {
  var next = [];
  for (var i = 0; i < activeModals.length; i += 1) {
    if (activeModals[i] !== modal) next.push(activeModals[i]);
  }
  activeModals = next;
}

function getConfig(modal) {
  for (var i = 0; i < modalRegistry.length; i += 1) {
    if (modalRegistry[i].modal === modal) return modalRegistry[i];
  }
  return null;
}

function isElementMatch(element, selector) {
  if (!element || !selector) return false;
  if (element.matches) return element.matches(selector);
  var nodes = (element.document || element.ownerDocument).querySelectorAll(selector);
  for (var i = 0; i < nodes.length; i += 1) {
    if (nodes[i] === element) return true;
  }
  return false;
}

function closestMatch(element, selector, stopAt) {
  var node = element;
  while (node && node !== stopAt) {
    if (isElementMatch(node, selector)) return node;
    node = node.parentNode;
  }
  return null;
}

function refreshChromeState() {
  if (activeModals.length > 0) {
    setQrHeaderVisible(false);
    lockQrBodyScroll();
  } else {
    setQrHeaderVisible(true);
    unlockQrBodyScroll();
  }
}

export function setQrHeaderVisible(visible) {
  if (!headerElements.length && typeof document !== "undefined") {
    var header = document.querySelector(".qr-header");
    if (header) headerElements.push(header);
  }

  for (var i = 0; i < headerElements.length; i += 1) {
    var element = headerElements[i];
    if (!element) continue;
    if (visible) {
      removeClass(element, "qr-header-hidden");
      element.removeAttribute("aria-hidden");
    } else {
      addClass(element, "qr-header-hidden");
      element.setAttribute("aria-hidden", "true");
    }
  }
}

export function lockQrBodyScroll() {
  if (bodyScrollLocked || typeof document === "undefined") return;
  bodyScrollLocked = true;
  if (document.body) {
    previousBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
    addClass(document.body, "qr-modal-open");
  }
  if (document.documentElement) {
    previousHtmlOverflow = document.documentElement.style.overflow || "";
    document.documentElement.style.overflow = "hidden";
    addClass(document.documentElement, "qr-modal-open");
  }
}

export function unlockQrBodyScroll() {
  if (!bodyScrollLocked || typeof document === "undefined") return;
  bodyScrollLocked = false;
  if (document.body) {
    document.body.style.overflow = previousBodyOverflow;
    removeClass(document.body, "qr-modal-open");
    removeClass(document.body, "qr-cart-modal-open");
  }
  if (document.documentElement) {
    document.documentElement.style.overflow = previousHtmlOverflow;
    removeClass(document.documentElement, "qr-modal-open");
  }
}

export function registerQrModal(modal, options) {
  if (!modal) return null;
  var config = getConfig(modal);
  if (!config) {
    config = {
      modal: modal,
      openClass: "show-force",
      closeClass: "hidden",
      closeOnBackdrop: true,
      closeOnEsc: true,
      closeSelector: "[data-qr-modal-close]",
      backdropSelector: ""
    };
    modalRegistry.push(config);
  }

  options = options || {};
  for (var key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key)) config[key] = options[key];
  }

  if (modal.getAttribute("data-qr-modal-bound") !== "true") {
    modal.setAttribute("data-qr-modal-bound", "true");
    modal.addEventListener("click", function(event) {
      var target = event.target || event.srcElement;
      var currentConfig = getConfig(modal) || config;
      if (currentConfig.closeSelector && closestMatch(target, currentConfig.closeSelector, modal)) {
        closeQrModal(modal, event);
        return;
      }
      if (currentConfig.backdropSelector && closestMatch(target, currentConfig.backdropSelector, modal)) {
        closeQrModal(modal, event);
        return;
      }
      if (currentConfig.closeOnBackdrop !== false && target === modal) {
        closeQrModal(modal, event);
      }
    }, false);
  }

  return config;
}

export function openQrModal(modal, options) {
  if (!modal) return false;
  var config = registerQrModal(modal, options);
  var closeClass = config.closeClass === undefined ? "hidden" : config.closeClass;
  if (closeClass) removeClass(modal, closeClass);
  if (config.openClass) addClass(modal, config.openClass);
  modal.style.display = "";
  modal.setAttribute("aria-hidden", "false");
  removeFromStack(modal);
  activeModals.push(modal);
  refreshChromeState();
  return true;
}

export function closeQrModal(modal, event) {
  if (event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
  }
  if (!modal) return false;
  var config = getConfig(modal) || registerQrModal(modal, {});
  var closeClass = config.closeClass === undefined ? "hidden" : config.closeClass;
  if (config.openClass) removeClass(modal, config.openClass);
  if (closeClass) addClass(modal, closeClass);
  modal.style.display = "";
  modal.setAttribute("aria-hidden", "true");
  removeFromStack(modal);
  refreshChromeState();
  return false;
}

export function closeTopQrModal(event) {
  for (var i = activeModals.length - 1; i >= 0; i -= 1) {
    var modal = activeModals[i];
    var config = getConfig(modal);
    if (config && config.closeOnEsc === false) continue;
    return closeQrModal(modal, event);
  }
  return false;
}

export function initQrModalManager(options) {
  options = options || {};
  if (options.headerElements && options.headerElements.length) {
    headerElements = options.headerElements;
  }
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  document.addEventListener("keydown", function(event) {
    if (!event || event.key !== "Escape") return;
    closeTopQrModal(event);
  }, false);
}
