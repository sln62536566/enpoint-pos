const VALID_STATUSES = Object.freeze(["waiting", "printing", "completed", "failed", "cancelled"]);
const listeners = {
  complete: [],
  failed: [],
  status: []
};

let jobs = [];
let current = null;
let providers = {};
let paused = false;
let processing = false;
let sequence = 0;

function cloneJob(job) {
  if (!job) return null;
  return Object.assign({}, job, { profile: Object.assign({}, job.profile) });
}

function emit(name, payload) {
  const callbacks = listeners[name] || [];
  callbacks.slice().forEach(callback => {
    try { callback(payload); } catch (error) { console.error("PrintQueue listener error", error); }
  });
}

function emitStatus() {
  emit("status", {
    paused,
    busy: processing,
    current: cloneJob(current),
    pending: PrintQueue.getPending().length,
    jobs: PrintQueue.getJobs()
  });
}

function createId() {
  sequence += 1;
  return `print-${Date.now()}-${sequence}`;
}

function normalizeJob(input) {
  const job = input && typeof input === "object" ? input : {};
  const profile = Object.assign({}, job.profile || {});
  return {
    id: job.id || createId(),
    type: job.type || "customer",
    provider: profile.provider || "browser",
    profile,
    createdAt: Number(job.createdAt) || Date.now(),
    status: VALID_STATUSES.indexOf(job.status) >= 0 ? job.status : "waiting",
    retry: Math.max(0, Number(job.retry) || 0),
    copies: Math.min(3, Math.max(1, Number(job.copies) || 1)),
    documentHtml: String(job.documentHtml || ""),
    order: job.order || null
  };
}

function subscribe(name, callback) {
  if (typeof callback !== "function") return function() {};
  listeners[name].push(callback);
  return function unsubscribe() {
    const index = listeners[name].indexOf(callback);
    if (index >= 0) listeners[name].splice(index, 1);
  };
}

export const PrintQueue = {
  init(options = {}) {
    providers = options.providers || providers;
    paused = false;
    emitStatus();
    return this;
  },
  enqueue(input) {
    const job = normalizeJob(input);
    job.status = "waiting";
    jobs.push(job);
    emitStatus();
    const completion = new Promise((resolve, reject) => {
      Object.defineProperty(job, "_resolve", { value: resolve, configurable: true });
      Object.defineProperty(job, "_reject", { value: reject, configurable: true });
    });
    this.process();
    return completion;
  },
  async process() {
    if (processing || paused) return current;
    const next = jobs.find(job => job.status === "waiting");
    if (!next) {
      emitStatus();
      return null;
    }

    processing = true;
    current = next;
    next.status = "printing";
    emitStatus();
    try {
      const providerName = next.profile.provider || "browser";
      const provider = providers[providerName];
      if (!provider || typeof provider.print !== "function") throw new Error(`找不到 Provider：${providerName}`);
      await provider.print(next);
      next.status = "completed";
      if (next._resolve) next._resolve(cloneJob(next));
      emit("complete", cloneJob(next));
    } catch (error) {
      next.retry += 1;
      next.error = error && error.message ? error.message : String(error);
      if (next.retry <= 3) {
        next.status = "waiting";
      } else {
        next.status = "failed";
        if (next._reject) next._reject(error);
        emit("failed", cloneJob(next));
      }
    } finally {
      current = null;
      processing = false;
      emitStatus();
    }

    if (!paused) return this.process();
    return null;
  },
  pause() {
    paused = true;
    emitStatus();
    return this;
  },
  resume() {
    paused = false;
    emitStatus();
    this.process();
    return this;
  },
  clear() {
    jobs.forEach(job => {
      if (job.status === "waiting") {
        job.status = "cancelled";
        if (job._reject) job._reject(new Error("列印工作已取消"));
      }
    });
    jobs = current ? jobs.filter(job => job === current) : [];
    emitStatus();
    return this;
  },
  getJobs() {
    return jobs.map(cloneJob);
  },
  getPending() {
    return jobs.filter(job => job.status === "waiting").map(cloneJob);
  },
  getCurrent() {
    return cloneJob(current);
  },
  isBusy() {
    return processing;
  },
  isPaused() {
    return paused;
  },
  onComplete(callback) {
    return subscribe("complete", callback);
  },
  onFailed(callback) {
    return subscribe("failed", callback);
  },
  onStatusChanged(callback) {
    return subscribe("status", callback);
  }
};

window.PrintQueue = PrintQueue;
