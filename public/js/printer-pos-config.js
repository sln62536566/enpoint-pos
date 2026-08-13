function skipped(code, profile = null) {
  return Object.freeze({ enabled: false, code, profile, driver: null, printer: null });
}

export async function inspectPosPrinterEligibility(importer = specifier => import(specifier), environment = globalThis) {
  const profileModule = await importer("./printer-profile.js");
  const profile = profileModule.PrinterProfile.getKitchen();
  if (!profile || profile.enabled !== true || profile.autoPrint !== true) return Object.freeze({ eligible: false, code: "AUTO_PRINT_DISABLED", profile });
  if (profile.provider === "browser") return Object.freeze({ eligible: false, code: "BROWSER_REQUIRES_USER_ACTION", profile });
  if (profile.provider !== "usb") return Object.freeze({ eligible: false, code: "PROVIDER_UNSUPPORTED", profile });
  if (!environment || !environment.navigator || !environment.navigator.usb) return Object.freeze({ eligible: false, code: "WEBUSB_UNSUPPORTED", profile });
  const providerModule = await importer("./printer-center.js");
  const driver = await providerModule.initializeUsbProvider();
  const status = driver && typeof driver.getStatus === "function" ? driver.getStatus() : null;
  if (!status || !status.selectedDevice) return Object.freeze({ eligible: false, code: "NO_PRINTER_CONFIGURED", profile });
  if (!status.connected || !status.capability) return Object.freeze({ eligible: false, code: status.lastErrorCode || "PRINTER_NOT_READY", profile });
  return Object.freeze({ eligible: true, code: "READY", profile });
}

export async function loadPosPrinterConfiguration(importer = specifier => import(specifier)) {
  const profileModule = await importer("./printer-profile.js");
  const profile = profileModule.PrinterProfile.getKitchen();
  if (!profile || profile.enabled !== true || profile.autoPrint !== true) return skipped("AUTO_PRINT_DISABLED", profile);
  if (profile.provider === "browser") return skipped("BROWSER_REQUIRES_USER_ACTION", profile);
  if (profile.provider !== "usb") return skipped("PROVIDER_UNSUPPORTED", profile);

  const providerModule = await importer("./printer-center.js");
  const driver = await providerModule.initializeUsbProvider();
  await driver.detect();
  const statusBefore = driver.getStatus();
  if (!statusBefore.selectedDevice) return skipped(statusBefore.status === "unsupported" ? "WEBUSB_UNSUPPORTED" : "NO_PRINTER_CONFIGURED", profile);
  if (!statusBefore.connected) await driver.connect();
  const status = driver.getStatus();
  if (!status.connected || !status.capability) return skipped(status.lastErrorCode || "PRINTER_NOT_READY", profile);

  const paperCapability = profile.paperSize === "80" ? "supportsPaper80" : "supportsPaper58";
  return Object.freeze({
    enabled: true, code: "READY", profile, driver,
    printer: Object.freeze({
      id: "pos-kitchen-usb", name: profile.name, group: "Kitchen", provider: "usb", priority: 100, enabled: true,
      capability: Object.freeze({ id: "pos-kitchen-usb", supportsEscPos: true, supportsReceipt: true, [paperCapability]: true })
    })
  });
}

export async function loadPrinterRuntimeConfiguration(importer = specifier => import(specifier), environment = globalThis) {
  const profileModule = await importer("./printer-profile.js");
  const profiles = { Kitchen: profileModule.PrinterProfile.getKitchen(), Customer: profileModule.PrinterProfile.getCustomer() };
  const enabledUsb = Object.keys(profiles).filter(key => profiles[key] && profiles[key].enabled === true && profiles[key].provider === "usb");
  if (enabledUsb.length) {
    const legacyProviderModule = await importer("./printer-center.js");
    const legacyDriver = await legacyProviderModule.initializeUsbProvider();
    const legacyStatus = legacyDriver && typeof legacyDriver.getStatus === "function" ? legacyDriver.getStatus() : null;
    if (legacyStatus && legacyStatus.connected && typeof legacyDriver.disconnect === "function") await legacyDriver.disconnect();
  }
  const candidates = enabledUsb.map(key => {
    const profile = profiles[key];
    const paperCapability = profile.paperSize === "80" ? "supportsPaper80" : "supportsPaper58";
    return Object.freeze({
      id: `pos-${key.toLowerCase()}-usb`, name: profile.name, group: key, provider: "usb", priority: 100, enabled: true,
      deviceBinding: profile.deviceBinding,
      capability: Object.freeze({ id: `pos-${key.toLowerCase()}-usb`, supportsEscPos: true, supportsReceipt: true, [paperCapability]: true })
    });
  });
  const factoryModule = await importer("./printer-runtime-factory.js");
  const runtimeFactory = factoryModule.createPrinterRuntimeFactory({ importer, environment });
  const mappings = await runtimeFactory.createMappings(candidates);
  const printers = mappings.printers.map(printer => Object.freeze({
    id: printer.id, name: printer.name, group: printer.group, provider: printer.provider, priority: printer.priority, enabled: printer.enabled,
    capability: printer.capability, metadata: Object.freeze({ physicalBindingId: printer.physicalBindingId })
  }));
  const kitchen = profiles.Kitchen;
  const autoPrinter = printers.find(item => item.group === "Kitchen") || null;
  const autoEnabled = Boolean(kitchen && kitchen.enabled === true && kitchen.autoPrint === true && kitchen.provider === "usb" && autoPrinter);
  return Object.freeze({
    enabled: autoEnabled,
    code: autoEnabled ? "READY" : (!kitchen || kitchen.enabled !== true || kitchen.autoPrint !== true ? "AUTO_PRINT_DISABLED" : (kitchen.provider === "browser" ? "BROWSER_REQUIRES_USER_ACTION" : (autoPrinter ? "READY" : "PRINTER_NOT_READY"))),
    profile: kitchen,
    profiles: Object.freeze(profiles),
    driver: null,
    printer: autoPrinter,
    printers: Object.freeze(printers),
    transports: mappings.transports,
    runtimeErrors: mappings.errors,
    runtimeFactory
  });
}
