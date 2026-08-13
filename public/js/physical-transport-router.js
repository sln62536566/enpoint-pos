function targetError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
export function createPhysicalTransportRouter(options = {}) {
  const source = options.transports instanceof Map ? options.transports : new Map(Object.entries(options.transports || {}));
  const transports = new Map();
  source.forEach((transport, printerId) => {
    if (transport && typeof transport.send === "function") transports.set(String(printerId), transport);
  });
  let closed = false, activeTransport = null;

  function resolve(context) {
    const printerId = context && context.metadata && context.metadata.printerId;
    if (!printerId) throw targetError("PHYSICAL_TARGET_NOT_FOUND", "Print context has no physical printer target");
    const transport = transports.get(String(printerId));
    if (!transport) throw targetError("PHYSICAL_TARGET_UNAVAILABLE", `Physical printer target unavailable: ${printerId}`);
    return transport;
  }

  return Object.freeze({
    async send(payload, context) {
      if (closed) throw targetError("TRANSPORT_CLOSED", "Physical transport router is closed");
      const transport = resolve(context);
      activeTransport = transport;
      try { return await transport.send(payload, context); }
      finally { if (activeTransport === transport) activeTransport = null; }
    },
    cancel(reason) { return activeTransport && typeof activeTransport.cancel === "function" ? activeTransport.cancel(reason) : false; },
    flush() {
      const unique = Array.from(new Set(transports.values()));
      return Promise.all(unique.map(transport => typeof transport.flush === "function" ? transport.flush() : Promise.resolve()));
    },
    isBusy() { return Boolean(activeTransport) || Array.from(new Set(transports.values())).some(transport => typeof transport.isBusy === "function" && transport.isBusy()); },
    destroy() {
      if (closed) return false;
      closed = true;
      Array.from(new Set(transports.values())).forEach(transport => { if (typeof transport.destroy === "function") transport.destroy(); });
      transports.clear(); activeTransport = null;
      return true;
    }
  });
}
