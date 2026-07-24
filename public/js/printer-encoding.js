export function createEncoding(options = {}) {
  const encoder = options.encoder || (typeof TextEncoder !== "undefined" ? new TextEncoder() : null);
  const encode = options.encode || (encoder && (value => encoder.encode(String(value))));
  if (typeof encode !== "function") throw new Error("No text encoding implementation available");
  return Object.freeze({
    name: String(options.name || "utf-8"),
    codePage: options.codePage === undefined ? null : options.codePage,
    encode(value) {
      const result = encode(String(value));
      if (!(result instanceof Uint8Array)) throw new TypeError("Encoding result must be a Uint8Array");
      return result;
    }
  });
}

export const UTF8_ENCODING = createEncoding();
