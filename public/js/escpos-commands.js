const ESC = 27;
const GS = 29;
const LF = 10;

function bytes(...values) { return Uint8Array.from(values); }

export const ESCPOS_COMMANDS = Object.freeze({
  initialize: () => bytes(ESC, 64),
  alignLeft: () => bytes(ESC, 97, 0),
  alignCenter: () => bytes(ESC, 97, 1),
  alignRight: () => bytes(ESC, 97, 2),
  boldOn: () => bytes(ESC, 69, 1),
  boldOff: () => bytes(ESC, 69, 0),
  normalSize: () => bytes(GS, 33, 0),
  doubleWidth: () => bytes(GS, 33, 16),
  doubleHeight: () => bytes(GS, 33, 1),
  doubleSize: () => bytes(GS, 33, 17),
  lineFeed: () => bytes(LF),
  feed: lines => bytes(ESC, 100, Math.min(255, Math.max(0, Number(lines) || 0))),
  cut: () => bytes(GS, 86, 0)
});

export function concatBytes(chunks) {
  const safe = Array.from(chunks || []);
  const length = safe.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  safe.forEach(chunk => { result.set(chunk, offset); offset += chunk.byteLength; });
  return result;
}
