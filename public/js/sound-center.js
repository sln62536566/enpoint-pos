const SOUND_CENTER_STORAGE_KEY = "enpoint_sound_center_v1";

const SOUND_EVENTS = {
  newOrder: "new-order",
  "new-order": "new-order",
  qrOrder: "new-order",
  "qr-order": "new-order",
  posOrder: "new-order",
  "pos-order": "new-order",
  payment: "payment",
  cooking: "cooking",
  done: "done",
  kdsDone: "done",
  "kds-done": "done",
  cancel: "cancel",
  error: "error",
  printFail: "error",
  "print-fail": "error"
};

const DEFAULT_SOUND_CENTER_SETTINGS = {
  enabled: true,
  masterVolume: 100,
  theme: "classic",
  repeatMode: "15",
  repeatCustomSeconds: 15,
  repeatMaxCount: 5,
  silentHoursEnabled: false,
  silentStart: "22:00",
  silentEnd: "07:00",
  future: {
    uberEatsTheme: null,
    foodpandaTheme: null,
    customMp3: null,
    externalSpeaker: null,
    multiStoreProfiles: null,
    schedule: null,
    doNotDisturb: null
  }
};

const SOUND_PACKS = {
  classic: {
    label: "經典",
    events: {
      "new-order": [[880, 0, 0.18, 1], [1175, 0.24, 0.18, 0.9]],
      payment: [[659, 0, 0.12, 0.78], [880, 0.16, 0.18, 0.9]],
      cooking: [[740, 0, 0.14, 0.72], [932, 0.2, 0.16, 0.68]],
      done: [[523, 0, 0.16, 0.72], [784, 0.2, 0.22, 0.8]],
      cancel: [[392, 0, 0.18, 0.68], [330, 0.22, 0.22, 0.56]],
      error: [[988, 0, 0.12, 0.96], [622, 0.16, 0.18, 0.86], [988, 0.4, 0.12, 0.96]]
    }
  },
  restaurant: {
    label: "餐廳",
    events: {
      "new-order": [[784, 0, 0.22, 1], [988, 0.28, 0.22, 0.92]],
      payment: [[587, 0, 0.15, 0.76], [784, 0.19, 0.2, 0.84]],
      cooking: [[698, 0, 0.16, 0.78], [880, 0.21, 0.18, 0.74]],
      done: [[698, 0, 0.18, 0.78], [932, 0.24, 0.2, 0.74]],
      cancel: [[349, 0, 0.2, 0.66], [294, 0.26, 0.24, 0.56]],
      error: [[932, 0, 0.14, 0.9], [587, 0.18, 0.2, 0.82], [932, 0.44, 0.14, 0.9]]
    }
  },
  cafe: {
    label: "咖啡館",
    events: {
      "new-order": [[659, 0, 0.2, 0.88], [880, 0.28, 0.24, 0.82], [1047, 0.62, 0.18, 0.68]],
      payment: [[523, 0, 0.16, 0.66], [784, 0.22, 0.18, 0.74]],
      cooking: [[587, 0, 0.18, 0.7], [740, 0.24, 0.18, 0.64]],
      done: [[622, 0, 0.2, 0.68], [831, 0.28, 0.22, 0.64]],
      cancel: [[330, 0, 0.24, 0.56], [277, 0.32, 0.26, 0.5]],
      error: [[880, 0, 0.13, 0.84], [554, 0.18, 0.22, 0.76], [880, 0.48, 0.13, 0.84]]
    }
  },
  modern: {
    label: "現代",
    events: {
      "new-order": [[988, 0, 0.1, 1], [1319, 0.14, 0.13, 0.92], [1568, 0.31, 0.13, 0.86]],
      payment: [[740, 0, 0.1, 0.74], [1175, 0.16, 0.16, 0.78]],
      cooking: [[880, 0, 0.1, 0.76], [1175, 0.14, 0.12, 0.7]],
      done: [[1047, 0, 0.12, 0.76], [1568, 0.18, 0.16, 0.68]],
      cancel: [[494, 0, 0.12, 0.68], [370, 0.18, 0.2, 0.58]],
      error: [[1175, 0, 0.08, 0.96], [740, 0.13, 0.13, 0.82], [1175, 0.28, 0.08, 0.96]]
    }
  },
  "night-market": {
    label: "夜市",
    events: {
      "new-order": [[1047, 0, 0.1, 1], [1047, 0.16, 0.1, 1], [784, 0.36, 0.22, 0.9]],
      payment: [[784, 0, 0.12, 0.78], [1047, 0.17, 0.16, 0.82]],
      cooking: [[932, 0, 0.1, 0.82], [932, 0.15, 0.1, 0.82], [698, 0.34, 0.18, 0.72]],
      done: [[880, 0, 0.1, 0.8], [1175, 0.16, 0.18, 0.74]],
      cancel: [[466, 0, 0.14, 0.7], [349, 0.2, 0.22, 0.6]],
      error: [[1047, 0, 0.1, 0.96], [659, 0.16, 0.16, 0.84], [1047, 0.36, 0.1, 0.96]]
    }
  },
  "high-tone-double": {
    label: "高音雙響",
    events: {
      "new-order": [[1319, 0, 0.14, 1], [1760, 0.2, 0.18, 0.94]],
      payment: [[1175, 0, 0.12, 0.76], [1568, 0.18, 0.16, 0.82]],
      cooking: [[1047, 0, 0.14, 0.74], [1397, 0.2, 0.16, 0.7]],
      done: [[1397, 0, 0.14, 0.78], [1865, 0.2, 0.2, 0.76]],
      cancel: [[659, 0, 0.16, 0.68], [523, 0.22, 0.2, 0.6]],
      error: [[1568, 0, 0.12, 0.94], [988, 0.18, 0.18, 0.84], [1568, 0.42, 0.12, 0.94]]
    }
  },
  "fast-triple": {
    label: "急促三響",
    events: {
      "new-order": [[1175, 0, 0.09, 1], [1175, 0.13, 0.09, 1], [1568, 0.26, 0.13, 0.94]],
      payment: [[880, 0, 0.09, 0.78], [1047, 0.13, 0.09, 0.8], [1319, 0.26, 0.14, 0.84]],
      cooking: [[988, 0, 0.09, 0.82], [988, 0.13, 0.09, 0.82], [740, 0.26, 0.16, 0.72]],
      done: [[1047, 0, 0.09, 0.8], [1319, 0.13, 0.09, 0.78], [1760, 0.26, 0.16, 0.74]],
      cancel: [[587, 0, 0.1, 0.72], [466, 0.14, 0.1, 0.66], [349, 0.28, 0.18, 0.58]],
      error: [[1397, 0, 0.08, 0.96], [1397, 0.12, 0.08, 0.96], [880, 0.25, 0.16, 0.86]]
    }
  },
  "kitchen-alert": {
    label: "廚房警示音",
    events: {
      "new-order": [[932, 0, 0.12, 1], [698, 0.16, 0.16, 0.9], [932, 0.38, 0.12, 1]],
      payment: [[698, 0, 0.14, 0.78], [932, 0.2, 0.16, 0.82]],
      cooking: [[784, 0, 0.11, 0.9], [1047, 0.15, 0.11, 0.86], [784, 0.3, 0.18, 0.82]],
      done: [[698, 0, 0.14, 0.8], [1047, 0.2, 0.22, 0.78]],
      cancel: [[494, 0, 0.16, 0.74], [330, 0.22, 0.24, 0.64]],
      error: [[988, 0, 0.1, 1], [622, 0.14, 0.18, 0.9], [988, 0.38, 0.1, 1]]
    }
  },
  "long-bell": {
    label: "長鈴提醒",
    events: {
      "new-order": [[880, 0, 0.62, 0.92], [1175, 0.1, 0.68, 0.72]],
      payment: [[659, 0, 0.38, 0.7], [988, 0.08, 0.44, 0.66]],
      cooking: [[740, 0, 0.44, 0.76], [932, 0.08, 0.5, 0.68]],
      done: [[784, 0, 0.48, 0.72], [1175, 0.1, 0.54, 0.66]],
      cancel: [[466, 0, 0.42, 0.66], [330, 0.12, 0.48, 0.58]],
      error: [[988, 0, 0.36, 0.9], [622, 0.1, 0.46, 0.8], [988, 0.58, 0.24, 0.88]]
    }
  }
};

let audioContext = null;
let soundSettings = loadSoundCenterSettings();
let unlocked = false;
let unlockPromise = null;
let safariAudioUnlocked = false;
let playQueue = [];
let queueBusy = false;
let masterOutputNode = null;
const QUEUE_GAP_MS = 120;
const STORE_LOUDNESS_CURVE = Object.freeze([0, 0.2, 0.38, 0.55, 0.7, 0.82, 0.91, 0.97, 1]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTheme(value) {
  return SOUND_PACKS[value] ? value : "classic";
}

function normalizeEventName(eventName) {
  return SOUND_EVENTS[String(eventName || "new-order")] || "new-order";
}

function normalizeTime(value, fallback) {
  const raw = String(value || "");
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeSettings(settings) {
  const next = Object.assign({}, clone(DEFAULT_SOUND_CENTER_SETTINGS), settings || {});
  if (settings && settings.repeatIntervalSeconds && !settings.repeatMode) {
    next.repeatMode = String(settings.repeatIntervalSeconds);
  }
  next.masterVolume = Math.min(200, Math.max(0, Math.round(Number(next.masterVolume) || 0)));
  next.masterVolume = Math.round(next.masterVolume / 25) * 25;
  next.theme = normalizeTheme(next.theme);
  next.repeatMode = next.repeatMode === "off" || next.repeatMode === "custom" ? next.repeatMode : String(Math.floor(Number(next.repeatMode) || 15));
  if (["10", "15", "20", "30", "45", "60", "90", "120"].indexOf(next.repeatMode) === -1 && next.repeatMode !== "off" && next.repeatMode !== "custom") {
    next.repeatMode = "15";
  }
  next.repeatCustomSeconds = Math.min(3600, Math.max(1, Math.floor(Number(next.repeatCustomSeconds) || 15)));
  next.repeatMaxCount = next.repeatMaxCount === "until-confirmed" || next.repeatMaxCount === "infinite" ? "until-confirmed" : Math.min(10, Math.max(1, Math.floor(Number(next.repeatMaxCount) || 5)));
  next.enabled = next.enabled !== false;
  next.silentHoursEnabled = next.silentHoursEnabled === true;
  next.silentStart = normalizeTime(next.silentStart, "22:00");
  next.silentEnd = normalizeTime(next.silentEnd, "07:00");
  next.future = Object.assign({}, DEFAULT_SOUND_CENTER_SETTINGS.future, next.future || {});
  return next;
}

function loadSoundCenterSettings() {
  try {
    const raw = window.localStorage ? localStorage.getItem(SOUND_CENTER_STORAGE_KEY) : "";
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch (error) {
    return normalizeSettings({});
  }
}

function saveSoundCenterSettings(settings) {
  soundSettings = normalizeSettings(settings);
  try {
    if (window.localStorage) localStorage.setItem(SOUND_CENTER_STORAGE_KEY, JSON.stringify(soundSettings));
  } catch (error) {}
  return getSoundCenterSettings();
}

function getOrCreateAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("此瀏覽器不支援 Web Audio API");
  audioContext = new AudioContextCtor();
  return audioContext;
}

function getStoreLoudness(masterVolume) {
  const bounded = Math.max(0, Math.min(200, Number(masterVolume) || 0));
  const position = bounded / 25;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(STORE_LOUDNESS_CURVE.length - 1, Math.ceil(position));
  const ratio = position - lowerIndex;
  return STORE_LOUDNESS_CURVE[lowerIndex] + (STORE_LOUDNESS_CURVE[upperIndex] - STORE_LOUDNESS_CURVE[lowerIndex]) * ratio;
}

function getStoreDynamicsProfile() {
  const thresholdDb = -2.5;
  const kneeDb = 1;
  return Object.freeze({
    thresholdDb: thresholdDb,
    kneeDb: kneeDb,
    ratio: 12,
    attack: 0.001,
    release: 0.12,
    normalStoreLevel: getStoreLoudness(100),
    compressionStartsAt: Math.pow(10, (thresholdDb - kneeDb / 2) / 20),
    maximumLevel: getStoreLoudness(200)
  });
}

function getMasterOutput(context) {
  if (masterOutputNode) return masterOutputNode;
  if (typeof context.createDynamicsCompressor !== "function") {
    masterOutputNode = context.destination;
    return masterOutputNode;
  }
  const profile = getStoreDynamicsProfile();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = profile.thresholdDb;
  compressor.knee.value = profile.kneeDb;
  compressor.ratio.value = profile.ratio;
  compressor.attack.value = profile.attack;
  compressor.release.value = profile.release;
  compressor.connect(context.destination);
  masterOutputNode = compressor;
  return masterOutputNode;
}

function unlockSafariAudio(context) {
  if (safariAudioUnlocked) return Promise.resolve(true);
  return new Promise(function(resolve) {
    var settled = false;
    var finish = function() {
      if (settled) return;
      settled = true;
      safariAudioUnlocked = true;
      resolve(true);
    };
    try {
      if (!context.createBuffer || !context.createBufferSource) {
        finish();
        return;
      }
      var buffer = context.createBuffer(1, 1, 22050);
      var source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = finish;
      source.start(0);
      window.setTimeout(finish, 100);
    } catch (error) {
      console.warn("Safari audio unlock skipped:", error);
      finish();
    }
  });
}

function unlockSoundCenter() {
  if (unlockPromise) return unlockPromise;
  var context;
  try {
    context = getOrCreateAudioContext();
  } catch (error) {
    unlocked = false;
    console.error("Sound Center unlock error:", error);
    return Promise.resolve(false);
  }
  unlockPromise = (async function() {
    try {
      if (context.state === "suspended" && context.resume) await context.resume();
      if (context.state !== "running") {
        unlocked = false;
        console.error("Sound Center unlock failed:", context.state);
        return false;
      }
      unlocked = true;
      await unlockSafariAudio(context);
      drainPlayQueue();
      return true;
    } catch (error) {
      unlocked = false;
      console.error("Sound Center unlock error:", error);
      return false;
    }
  })().then(function(result) {
    unlockPromise = null;
    return result;
  });
  return unlockPromise;
}

function minutesFromTime(value) {
  const parts = String(value || "00:00").split(":");
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

function isInSilentHours(date) {
  const settings = soundSettings || loadSoundCenterSettings();
  if (settings.silentHoursEnabled !== true) return false;
  const now = date || new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesFromTime(settings.silentStart);
  const end = minutesFromTime(settings.silentEnd);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function playTone(context, frequency, start, duration, volume) {
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(getMasterOutput(context));
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function getPatternDurationMs(pattern) {
  var seconds = 0;
  pattern.forEach(function(tone) {
    seconds = Math.max(seconds, Number(tone[1] || 0) + Number(tone[2] || 0));
  });
  return Math.max(80, Math.ceil(seconds * 1000));
}

function drainPlayQueue() {
  if (queueBusy || !playQueue.length) return;
  const context = audioContext;
  if (!unlocked || !context || context.state !== "running") return;

  const job = playQueue.shift();
  queueBusy = true;
  try {
    const now = context.currentTime || 0;
    job.pattern.forEach(function(tone) {
      playTone(context, tone[0], now + tone[1], tone[2], job.baseVolume * tone[3]);
    });
  } catch (error) {
    console.warn("恩點音效中心播放失敗", error);
  }

  window.setTimeout(function() {
    queueBusy = false;
    drainPlayQueue();
  }, getPatternDurationMs(job.pattern) + QUEUE_GAP_MS);
}

function play(eventName, options) {
  const opts = options || {};
  const settings = soundSettings || loadSoundCenterSettings();
  if (settings.enabled !== true && opts.force !== true) return false;
  if (isInSilentHours() && opts.ignoreSilentHours !== true) return false;

  const eventKey = normalizeEventName(eventName);
  const pack = SOUND_PACKS[settings.theme] || SOUND_PACKS.classic;
  const pattern = pack.events[eventKey] || pack.events["new-order"];
  const baseVolume = getStoreLoudness(settings.masterVolume);
  if (baseVolume <= 0) return false;

  playQueue.push({ pattern: pattern, baseVolume: baseVolume });
  if (unlocked && audioContext && audioContext.state === "running") drainPlayQueue();
  return true;
}

function configureSoundCenter(partialSettings) {
  const next = saveSoundCenterSettings(Object.assign({}, soundSettings || {}, partialSettings || {}));
  if (next.enabled !== true) playQueue = [];
  return next;
}

function getSoundCenterSettings() {
  return clone(soundSettings || loadSoundCenterSettings());
}

function getRepeatIntervalSeconds() {
  const settings = soundSettings || loadSoundCenterSettings();
  if (settings.repeatMode === "off") return 0;
  if (settings.repeatMode === "custom") return settings.repeatCustomSeconds;
  return Math.floor(Number(settings.repeatMode) || 15);
}

const SoundCenter = {
  play,
  playSound: play,
  configure: configureSoundCenter,
  getSettings: getSoundCenterSettings,
  getRepeatIntervalSeconds,
  isInSilentHours,
  unlock: unlockSoundCenter,
  packs: clone(SOUND_PACKS),
  themes: Object.keys(SOUND_PACKS),
  events: ["new-order", "payment", "cooking", "done", "cancel", "error"],
  future: clone(DEFAULT_SOUND_CENTER_SETTINGS.future)
};

window.SoundCenter = SoundCenter;
window.EnPointSoundCenter = SoundCenter;
window.playSound = play;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden && audioContext && audioContext.state !== "running") {
      unlocked = false;
      safariAudioUnlocked = false;
    }
  }, false);
}
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", function() {
    if (audioContext && audioContext.state !== "running") {
      unlocked = false;
      safariAudioUnlocked = false;
    }
  }, false);
  window.addEventListener("focus", function() {
    if (audioContext && audioContext.state !== "running") {
      unlocked = false;
      safariAudioUnlocked = false;
    }
  }, false);
}

export {
  SoundCenter,
  play,
  play as playSound,
  configureSoundCenter,
  getSoundCenterSettings,
  getRepeatIntervalSeconds,
  unlockSoundCenter,
  getStoreLoudness,
  getStoreDynamicsProfile
};
