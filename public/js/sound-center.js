const SOUND_CENTER_STORAGE_KEY = "enpoint_sound_center_v1";

const DEFAULT_SOUND_CENTER_SETTINGS = {
  enabled: true,
  masterVolume: 100,
  theme: "classic",
  repeatEnabled: true,
  repeatIntervalSeconds: 15,
  repeatMaxCount: 3,
  eventSounds: {
    "new-order": "new-order",
    "qr-order": "qr-order",
    "pos-order": "pos-order",
    payment: "payment",
    "kds-done": "kds-done",
    cancel: "cancel",
    "print-fail": "print-fail",
    "uber-eats": "delivery",
    foodpanda: "delivery"
  },
  customSounds: {},
  future: {
    deliveryPlatforms: ["uber-eats", "foodpanda"],
    multiStoreProfiles: false,
    bluetoothSpeaker: false,
    usbSpeaker: false,
    doNotDisturb: false,
    scheduledMute: false
  }
};

const THEME_PATTERNS = {
  classic: {
    "new-order": [[880, 0, 0.18, 1], [1175, 0.24, 0.18, 0.9]],
    "qr-order": [[880, 0, 0.18, 1], [1175, 0.24, 0.18, 0.9]],
    "pos-order": [[740, 0, 0.14, 0.8], [988, 0.18, 0.16, 0.75]],
    payment: [[659, 0, 0.12, 0.7], [880, 0.16, 0.18, 0.8]],
    "kds-done": [[523, 0, 0.16, 0.7], [784, 0.2, 0.22, 0.75]],
    cancel: [[392, 0, 0.18, 0.65], [330, 0.22, 0.22, 0.55]],
    "print-fail": [[988, 0, 0.12, 0.9], [622, 0.16, 0.18, 0.8], [988, 0.4, 0.12, 0.9]],
    delivery: [[1047, 0, 0.1, 0.85], [1319, 0.14, 0.12, 0.8], [1047, 0.32, 0.18, 0.7]]
  },
  restaurant: {
    "new-order": [[784, 0, 0.22, 1], [988, 0.28, 0.22, 0.9]],
    "qr-order": [[784, 0, 0.22, 1], [988, 0.28, 0.22, 0.9]],
    "pos-order": [[659, 0, 0.16, 0.8], [880, 0.22, 0.18, 0.75]],
    payment: [[587, 0, 0.15, 0.7], [784, 0.19, 0.2, 0.75]],
    "kds-done": [[698, 0, 0.18, 0.72], [932, 0.24, 0.2, 0.7]],
    cancel: [[349, 0, 0.2, 0.65], [294, 0.26, 0.24, 0.55]],
    "print-fail": [[932, 0, 0.14, 0.88], [587, 0.18, 0.2, 0.8], [932, 0.44, 0.14, 0.88]],
    delivery: [[988, 0, 0.12, 0.85], [1175, 0.16, 0.14, 0.8], [988, 0.36, 0.2, 0.7]]
  },
  cafe: {
    "new-order": [[659, 0, 0.2, 0.85], [880, 0.28, 0.24, 0.8], [1047, 0.62, 0.18, 0.65]],
    "qr-order": [[659, 0, 0.2, 0.85], [880, 0.28, 0.24, 0.8], [1047, 0.62, 0.18, 0.65]],
    "pos-order": [[587, 0, 0.18, 0.75], [784, 0.24, 0.2, 0.68]],
    payment: [[523, 0, 0.16, 0.65], [784, 0.22, 0.18, 0.7]],
    "kds-done": [[622, 0, 0.2, 0.66], [831, 0.28, 0.22, 0.62]],
    cancel: [[330, 0, 0.24, 0.55], [277, 0.32, 0.26, 0.48]],
    "print-fail": [[880, 0, 0.13, 0.82], [554, 0.18, 0.22, 0.74], [880, 0.48, 0.13, 0.82]],
    delivery: [[784, 0, 0.12, 0.78], [988, 0.16, 0.14, 0.74], [1175, 0.36, 0.18, 0.68]]
  },
  modern: {
    "new-order": [[988, 0, 0.1, 1], [1319, 0.14, 0.13, 0.9], [1568, 0.31, 0.13, 0.85]],
    "qr-order": [[988, 0, 0.1, 1], [1319, 0.14, 0.13, 0.9], [1568, 0.31, 0.13, 0.85]],
    "pos-order": [[880, 0, 0.1, 0.8], [1175, 0.14, 0.12, 0.75]],
    payment: [[740, 0, 0.1, 0.72], [1175, 0.16, 0.16, 0.76]],
    "kds-done": [[1047, 0, 0.12, 0.74], [1568, 0.18, 0.16, 0.66]],
    cancel: [[494, 0, 0.12, 0.68], [370, 0.18, 0.2, 0.58]],
    "print-fail": [[1175, 0, 0.08, 0.95], [740, 0.13, 0.13, 0.8], [1175, 0.28, 0.08, 0.95]],
    delivery: [[1319, 0, 0.09, 0.84], [1568, 0.13, 0.1, 0.8], [1319, 0.3, 0.12, 0.72]]
  },
  "night-market": {
    "new-order": [[1047, 0, 0.1, 1], [1047, 0.16, 0.1, 1], [784, 0.36, 0.22, 0.9]],
    "qr-order": [[1047, 0, 0.1, 1], [1047, 0.16, 0.1, 1], [784, 0.36, 0.22, 0.9]],
    "pos-order": [[932, 0, 0.1, 0.82], [932, 0.15, 0.1, 0.82], [698, 0.34, 0.18, 0.72]],
    payment: [[784, 0, 0.12, 0.75], [1047, 0.17, 0.16, 0.78]],
    "kds-done": [[880, 0, 0.1, 0.78], [1175, 0.16, 0.18, 0.72]],
    cancel: [[466, 0, 0.14, 0.68], [349, 0.2, 0.22, 0.58]],
    "print-fail": [[1047, 0, 0.1, 0.94], [659, 0.16, 0.16, 0.82], [1047, 0.36, 0.1, 0.94]],
    delivery: [[1175, 0, 0.08, 0.88], [1397, 0.12, 0.1, 0.82], [1175, 0.3, 0.14, 0.74]]
  }
};

let audioContext = null;
let soundSettings = loadSoundCenterSettings();
let unlocked = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSettings(settings) {
  const next = Object.assign({}, clone(DEFAULT_SOUND_CENTER_SETTINGS), settings || {});
  next.eventSounds = Object.assign({}, DEFAULT_SOUND_CENTER_SETTINGS.eventSounds, next.eventSounds || {});
  next.customSounds = Object.assign({}, next.customSounds || {});
  next.masterVolume = Math.min(200, Math.max(0, Math.floor(Number(next.masterVolume) || 0)));
  next.theme = THEME_PATTERNS[next.theme] ? next.theme : "classic";
  next.repeatIntervalSeconds = Math.min(3600, Math.max(1, Math.floor(Number(next.repeatIntervalSeconds) || 15)));
  next.repeatMaxCount = next.repeatMaxCount === "infinite" ? "infinite" : Math.min(99, Math.max(1, Math.floor(Number(next.repeatMaxCount) || 3)));
  next.enabled = next.enabled !== false;
  next.repeatEnabled = next.repeatEnabled !== false;
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

function getContext() {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    audioContext = new AudioContextCtor();
  } catch (error) {
    audioContext = null;
  }
  return audioContext;
}

function unlockSoundCenter() {
  const context = getContext();
  if (context && context.state === "suspended" && context.resume) {
    context.resume().catch(function() {});
  }
  unlocked = true;
}

function playTone(context, frequency, start, duration, volume) {
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playSound(eventName, options) {
  const opts = options || {};
  const settings = soundSettings || loadSoundCenterSettings();
  if (settings.enabled !== true && opts.force !== true) return false;

  const context = getContext();
  if (!context) return false;
  if (!unlocked) unlockSoundCenter();
  if (context.state === "suspended") {
    if (context.resume) context.resume().catch(function() {});
    if (opts.force !== true) return false;
  }
  if (context.state === "suspended") return false;

  const eventKey = String(eventName || "new-order");
  const mappedKey = settings.eventSounds[eventKey] || eventKey;
  const theme = THEME_PATTERNS[settings.theme] || THEME_PATTERNS.classic;
  const pattern = theme[mappedKey] || theme[eventKey] || theme["new-order"];
  const baseVolume = Math.min(1.15, Math.max(0, Number(settings.masterVolume || 0) / 100) * 0.56);
  if (baseVolume <= 0) return false;

  try {
    const now = context.currentTime || 0;
    pattern.forEach(function(tone) {
      playTone(context, tone[0], now + tone[1], tone[2], baseVolume * tone[3]);
    });
    return true;
  } catch (error) {
    console.warn("EnPoint Sound Center playback failed", error);
    return false;
  }
}

function configureSoundCenter(partialSettings) {
  return saveSoundCenterSettings(Object.assign({}, soundSettings || {}, partialSettings || {}));
}

function getSoundCenterSettings() {
  return clone(soundSettings || loadSoundCenterSettings());
}

window.EnPointSoundCenter = {
  playSound,
  configure: configureSoundCenter,
  getSettings: getSoundCenterSettings,
  unlock: unlockSoundCenter,
  themes: Object.keys(THEME_PATTERNS),
  events: Object.keys(DEFAULT_SOUND_CENTER_SETTINGS.eventSounds)
};

window.playSound = playSound;

export {
  playSound,
  configureSoundCenter,
  getSoundCenterSettings,
  unlockSoundCenter
};
