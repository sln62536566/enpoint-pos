import { createPipelineContext } from "./pipeline-context.js";
import { createPrintJob, transitionPrintJob } from "./print-job.js";
import { PRINT_JOB_STATUS, TERMINAL_JOB_STATUSES } from "./print-job-status.js";
import { createQueueEvents, QUEUE_EVENTS } from "./queue-events.js";

function isolatedFailure(error, provider) {
  return Object.freeze({ success: false, cancelled: false, failed: true, duration: 0, bytes: 0, copies: 0, provider,
    errors: Object.freeze([Object.freeze({ code: String(error && error.code || "QUEUE_FAILED"), message: String(error && error.message || "Print queue failed") })]) });
}

export function createCommercialPrintQueue(options = {}) {
  if (!options.pipeline || typeof options.pipeline.execute !== "function") throw new TypeError("Print queue requires a pipeline");
  const pipeline = options.pipeline;
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : (() => `print-job-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const provider = String(options.provider || "unknown");
  const events = createQueueEvents();
  const pending = [];
  const jobs = new Map();
  const completions = new Map();
  const cancellation = new Set();
  let currentId = null;
  let workerActive = false;
  let closed = false;
  let destroyed = false;

  function setJob(job) { jobs.set(job.id, job); return job; }
  function emit(name, job) { events.emit(name, job); }
  function finish(job, result) {
    const now = Number(clock());
    const status = cancellation.has(job.id) || result.cancelled ? PRINT_JOB_STATUS.CANCELLED : (result.failed ? PRINT_JOB_STATUS.FAILED : PRINT_JOB_STATUS.COMPLETED);
    const completed = setJob(transitionPrintJob(job, status, { finishedAt: now, result }));
    emit(status === PRINT_JOB_STATUS.COMPLETED ? QUEUE_EVENTS.JOB_COMPLETED : status === PRINT_JOB_STATUS.CANCELLED ? QUEUE_EVENTS.JOB_CANCELLED : QUEUE_EVENTS.JOB_FAILED, completed);
    const completion = completions.get(job.id); if (completion) completion.resolve(completed);
    completions.delete(job.id); cancellation.delete(job.id); return completed;
  }

  async function work() {
    if (workerActive || destroyed) return;
    workerActive = true;
    try {
      while (pending.length && !destroyed) {
        const id = pending.shift();
        let job = jobs.get(id);
        if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) continue;
        currentId = id;
        job = setJob(transitionPrintJob(job, PRINT_JOB_STATUS.PREPARING, { startedAt: Number(clock()) }));
        emit(QUEUE_EVENTS.JOB_STARTED, job);
        try {
          const transition = status => { if (jobs.has(id)) job = setJob(transitionPrintJob(job, status)); };
          const result = await pipeline.execute(job.request, job.context, {
            onPreparing() {},
            onFormatting() { transition(PRINT_JOB_STATUS.FORMATTING); },
            onSending() { transition(PRINT_JOB_STATUS.SENDING); }
          });
          finish(job, result);
        } catch (error) { finish(job, isolatedFailure(error, provider)); }
        currentId = null;
      }
    } finally { workerActive = false; currentId = null; }
  }

  function enqueue(request, contextInput = {}) {
    if (closed || destroyed) return Promise.reject(Object.assign(new Error("Print queue is closed"), { code: "QUEUE_CLOSED" }));
    const id = String(idFactory());
    const now = Number(clock());
    const context = createPipelineContext(Object.assign({}, contextInput, { jobId: id, requestId: contextInput.requestId || id, startTime: contextInput.startTime === undefined ? now : contextInput.startTime, provider: contextInput.provider || provider }), clock);
    const job = setJob(createPrintJob({ id, request, context, status: PRINT_JOB_STATUS.PENDING, createdAt: now }));
    pending.push(id); emit(QUEUE_EVENTS.JOB_QUEUED, job);
    const completion = new Promise((resolve, reject) => completions.set(id, { resolve, reject }));
    Promise.resolve().then(work);
    return Object.freeze({ id, completion });
  }

  function cancel(id) {
    const key = String(id); const job = jobs.get(key);
    if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) return false;
    cancellation.add(key);
    if (key === currentId && typeof pipeline.cancel === "function") pipeline.cancel();
    if (job.status === PRINT_JOB_STATUS.PENDING) {
      const index = pending.indexOf(key); if (index >= 0) pending.splice(index, 1);
      finish(job, Object.freeze({ success: false, cancelled: true, failed: false, duration: 0, bytes: 0, copies: 0, provider, errors: Object.freeze([]) }));
    }
    return true;
  }

  return Object.freeze({
    enqueue, cancel, on: events.on,
    getJob(id) { return jobs.get(String(id)) || null; },
    getJobs() { return Array.from(jobs.values()); },
    isBusy() { return workerActive; },
    close() { if (closed) return false; closed = true; return true; },
    destroy() {
      if (destroyed) return false; destroyed = true; closed = true;
      pending.slice().forEach(cancel); if (currentId) cancel(currentId);
      if (typeof pipeline.destroy === "function") pipeline.destroy(); events.clear(); return true;
    }
  });
}
