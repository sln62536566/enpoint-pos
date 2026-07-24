export const QUEUE_EVENTS = Object.freeze({
  JOB_QUEUED: "JobQueued", JOB_STARTED: "JobStarted", JOB_COMPLETED: "JobCompleted",
  JOB_FAILED: "JobFailed", JOB_CANCELLED: "JobCancelled"
});

export function createQueueEvents() {
  const listeners = new Map();
  return Object.freeze({
    on(name, callback) {
      if (!Object.values(QUEUE_EVENTS).includes(name) || typeof callback !== "function") return function() {};
      const callbacks = listeners.get(name) || []; callbacks.push(callback); listeners.set(name, callbacks);
      return () => { const current = listeners.get(name) || []; const index = current.indexOf(callback); if (index >= 0) current.splice(index, 1); };
    },
    emit(name, job) {
      (listeners.get(name) || []).slice().forEach(callback => { try { callback(job); } catch (error) { /* event isolation */ } });
    },
    clear() { listeners.clear(); }
  });
}
