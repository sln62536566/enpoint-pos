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
    label: "Classic",
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
    label: "Restaurant",
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
    label: "Cafe",
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
    label: "Modern",
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
    label: "Night Market",
    events: {
      "new-order": [[1047, 0, 0.1, 1], [1047, 0.16, 0.1, 1], [784, 0.36, 0.22, 0.9]],
      payment: [[784, 0, 0.12, 0.78], [1047, 0.17, 0.16, 0.82]],
      cooking: [[932, 0, 0.1, 0.82], [932, 0.15, 0.1, 0.82], [698, 0.34, 0.18, 0.72]],
      done: [[880, 0, 0.1, 0.8], [1175, 0.16, 0.18, 0.74]],
      cancel: [[466, 0, 0.14, 0.7], [349, 0.2, 0.22, 0.6]],
      error: [[1047, 0, 0.1, 0.96], [659, 0.16, 0.16, 0.84], [1047, 0.36, 0.1, 0.96]]
    }
  }
};

let audioContext = null;
let soundSettings = loadSoundCenterSettings();
let unlocked = false;

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

function play(eventName, options) {
  const opts = options || {};
  const settings = soundSettings || loadSoundCenterSettings();
  if (settings.enabled !== true && opts.force !== true) return false;
  if (isInSilentHours() && opts.ignoreSilentHours !== true) return false;

  const context = getContext();
  if (!context) return false;
  if (!unlocked) unlockSoundCenter();
  if (context.state === "suspended") {
    if (context.resume) context.resume().catch(function() {});
    if (opts.force !== true) return false;
  }
  if (context.state === "suspended") return false;

  const eventKey = normalizeEventName(eventName);
  const pack = SOUND_PACKS[settings.theme] || SOUND_PACKS.classic;
  const pattern = pack.events[eventKey] || pack.events["new-order"];
  const volumeMultiplier = Math.max(0, Math.min(2, Number(settings.masterVolume || 0) / 100));
  const baseVolume = 0.46 * volumeMultiplier;
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

export {
  SoundCenter,
  play,
  play as playSound,
  configureSoundCenter,
  getSoundCenterSettings,
  getRepeatIntervalSeconds,
  unlockSoundCenter
};
