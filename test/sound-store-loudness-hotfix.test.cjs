const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataUrl = value => "data:text/javascript;base64," + Buffer.from(value).toString("base64");
let api, source, context, oscillators, gains, compressors;

test.before(async () => {
  source = await fs.readFile(path.join(__dirname, "..", "public", "js", "sound-center.js"), "utf8");
  oscillators = [];
  gains = [];
  compressors = [];
  class AudioContextMock {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = { kind: "destination" }; context = this; }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() { if (this.onended) this.onended(); } }; }
    createOscillator() { const node = { type: "sine", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; oscillators.push(node); return node; }
    createGain() {
      const ramps = [];
      const node = { ramps, gain: { setValueAtTime(value, time) { ramps.push({ type: "set", value, time }); }, exponentialRampToValueAtTime(value, time) { ramps.push({ type: "ramp", value, time }); } }, connect(target) { this.target = target; } };
      gains.push(node);
      return node;
    }
    createDynamicsCompressor() {
      const node = { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect(target) { this.target = target; } };
      compressors.push(node);
      return node;
    }
    async resume() { this.state = "running"; }
  }
  global.window = { AudioContext: AudioContextMock, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() { return 1; }, addEventListener() {} };
  api = await import(dataUrl(source));
});

test.after(() => { delete global.window; });

test("597 zero master volume is silent", () => assert.equal(api.getStoreLoudness(0), 0));

test("598 store loudness rises monotonically from 50 through 200", () => {
  const values = [50, 100, 150, 200].map(api.getStoreLoudness);
  assert.ok(values[0] < values[1] && values[1] < values[2] && values[2] < values[3]);
});

test("599 maximum store loudness is bounded at one", () => {
  assert.equal(api.getStoreLoudness(200), 1);
  assert.equal(api.getStoreLoudness(999), 1);
});

test("600 normal store volume uses the calibrated commercial baseline", () => assert.equal(api.getStoreLoudness(100), 0.7));

test("601 new-order and error retain highest classic event priority", () => {
  const classic = api.SoundCenter.packs.classic.events;
  const peak = pattern => Math.max(...pattern.map(tone => tone[3]));
  assert.equal(peak(classic["new-order"]), 1);
  assert.ok(peak(classic.error) >= peak(classic.payment));
  assert.ok(peak(classic.error) >= peak(classic.done));
});

test("602 all formal events remain playable through the same queue", async () => {
  api.configureSoundCenter({ masterVolume: 100, enabled: true, silentHoursEnabled: false });
  assert.equal(await api.unlockSoundCenter(), true);
  for (const event of api.SoundCenter.events) assert.equal(api.playSound(event, { force: true, ignoreSilentHours: true }), true);
});

test("603 audio graph uses a clear waveform and one protected master output", () => {
  assert.ok(oscillators.length > 0);
  assert.equal(oscillators[0].type, "triangle");
  assert.equal(compressors.length, 1);
  assert.equal(compressors[0].target, context.destination);
  assert.equal(gains[0].target, compressors[0]);
});

test("604 preview unlock queue silent-hours repeat and themes remain wired", () => {
  assert.match(source, /unlockSafariAudio/);
  assert.match(source, /playQueue\.push/);
  assert.match(source, /ignoreSilentHours/);
  assert.match(source, /getRepeatIntervalSeconds/);
  assert.equal(api.SoundCenter.themes.length, 9);
  assert.deepEqual(api.SoundCenter.events, ["new-order", "payment", "cooking", "done", "cancel", "error"]);
});

test("605 normal-store new-order peak enters the graph at 0.70 times its tone multiplier", () => {
  const firstAudibleRamp = gains[0].ramps.find(item => item.type === "ramp" && item.value > 0.0001);
  assert.equal(firstAudibleRamp.value, 0.7 * api.SoundCenter.packs.classic.events["new-order"][0][3]);
});

test("606 dynamics contract is a near-peak protection profile", () => {
  const profile = api.getStoreDynamicsProfile();
  assert.deepEqual({ thresholdDb: profile.thresholdDb, kneeDb: profile.kneeDb, ratio: profile.ratio }, { thresholdDb: -2.5, kneeDb: 1, ratio: 12 });
  assert.notDeepEqual({ thresholdDb: profile.thresholdDb, kneeDb: profile.kneeDb, ratio: profile.ratio }, { thresholdDb: -18, kneeDb: 12, ratio: 4 });
});

test("607 normal-store level stays below the compression region", () => {
  const profile = api.getStoreDynamicsProfile();
  assert.equal(profile.normalStoreLevel, 0.7);
  assert.ok(profile.normalStoreLevel < profile.compressionStartsAt);
});

test("608 150 and 200 percent retain peak protection", () => {
  const profile = api.getStoreDynamicsProfile();
  assert.ok(api.getStoreLoudness(150) > profile.compressionStartsAt);
  assert.ok(api.getStoreLoudness(200) > profile.compressionStartsAt);
  assert.equal(profile.maximumLevel, 1);
});

test("609 missing compressor falls back to destination and still plays", async () => {
  const previousWindow = global.window;
  const fallbackGains = [];
  class FallbackAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = { kind: "fallback-destination" }; }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() { if (this.onended) this.onended(); } }; }
    createOscillator() { return { type: "sine", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { const node = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(target) { this.target = target; } }; fallbackGains.push(node); return node; }
  }
  global.window = { AudioContext: FallbackAudioContext, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() { return 1; }, addEventListener() {} };
  try {
    const fallbackApi = await import(dataUrl(source + "\n// compressor-fallback-test"));
    assert.equal(await fallbackApi.unlockSoundCenter(), true);
    assert.equal(fallbackApi.playSound("new-order", { force: true, ignoreSilentHours: true }), true);
    assert.equal(fallbackGains[0].target.kind, "fallback-destination");
  } finally {
    global.window = previousWindow;
  }
});

test("610 triangle queue preview and Safari unlock contracts remain intact", () => {
  assert.equal(oscillators[0].type, "triangle");
  assert.match(source, /playQueue\.push/);
  assert.match(source, /unlockSafariAudio/);
  assert.match(source, /ignoreSilentHours/);
});
