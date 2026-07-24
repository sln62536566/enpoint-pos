export const TRANSPORT_ERRORS = Object.freeze({
  TRANSFER_TIMEOUT: "TRANSFER_TIMEOUT",
  TRANSFER_CANCELLED: "TRANSFER_CANCELLED",
  TRANSPORT_BUSY: "TRANSPORT_BUSY",
  TRANSPORT_CLOSED: "TRANSPORT_CLOSED"
});

function transportError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function chunkBytes(bytes, chunkSize) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Transport data must be a Uint8Array");
  const size = positiveInteger(chunkSize, 64);
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    chunks.push(bytes.slice(offset, Math.min(offset + size, bytes.byteLength)));
  }
  return chunks;
}

export function createPrintTransport(driver, options = {}) {
  const timeoutMs = positiveInteger(options.timeoutMs, 5000);
  const suppliedPolicy = options.retryPolicy && typeof options.retryPolicy === "object" ? options.retryPolicy : {};
  const maxRetries = Math.max(0, Number.isInteger(Number(suppliedPolicy.maxRetries))
    ? Number(suppliedPolicy.maxRetries)
    : (Number.isInteger(Number(options.maxRetries)) ? Number(options.maxRetries) : 0));
  const retryPolicy = Object.freeze({
    maxRetries,
    shouldRetry: typeof suppliedPolicy.shouldRetry === "function" ? suppliedPolicy.shouldRetry : () => true,
    retryDelay: typeof suppliedPolicy.retryDelay === "function" ? suppliedPolicy.retryDelay : () => 0
  });
  const configuredChunkSize = options.chunkSize ? positiveInteger(options.chunkSize, 64) : null;
  let closed = false;
  let activeJob = null;
  let unsubscribe = function() {};
  let jobSequence = 0;

  function resolveChunkSize() {
    const status = driver && typeof driver.getStatus === "function" ? driver.getStatus() : null;
    return configuredChunkSize || positiveInteger(status && status.capability && status.capability.packetSize, 64);
  }

  function ensureOpen() {
    if (closed) throw transportError(TRANSPORT_ERRORS.TRANSPORT_CLOSED, "Print transport is closed");
    if (!driver || typeof driver.transferChunk !== "function") {
      throw transportError(TRANSPORT_ERRORS.TRANSPORT_CLOSED, "USB transport driver is unavailable");
    }
  }

  function cancellationRace(job) {
    return new Promise((resolve, reject) => { job.cancelReject = reject; });
  }

  async function transferWithPolicy(chunk, job) {
    let attempt = 0;
    while (true) {
      if (job.cancelled) throw transportError(TRANSPORT_ERRORS.TRANSFER_CANCELLED, "USB transfer was cancelled");
      let timer;
      const rawTransfer = Promise.resolve().then(() => driver.transferChunk(chunk));
      job.inFlight = rawTransfer.catch(() => undefined);
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(transportError(TRANSPORT_ERRORS.TRANSFER_TIMEOUT, "USB transfer timed out")), timeoutMs);
      });
      try {
        const result = await Promise.race([rawTransfer, timeout, cancellationRace(job)]);
        if (!result || result.ok !== true || !Number.isFinite(Number(result.bytesTransferred))) {
          throw new TypeError("Invalid printer driver transfer result");
        }
        return { ok: true, bytesTransferred: Number(result.bytesTransferred) };
      } catch (error) {
        if (error && (error.code === TRANSPORT_ERRORS.TRANSFER_TIMEOUT || error.code === TRANSPORT_ERRORS.TRANSFER_CANCELLED)) throw error;
        if (attempt >= retryPolicy.maxRetries || !retryPolicy.shouldRetry(error, attempt + 1)) throw error;
        attempt += 1;
        const delay = Math.max(0, Number(retryPolicy.retryDelay(attempt, error)) || 0);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      } finally {
        clearTimeout(timer);
        job.cancelReject = null;
      }
    }
  }

  async function run(bytes, job) {
    const chunks = chunkBytes(bytes, resolveChunkSize());
    let transferred = 0;
    for (const chunk of chunks) {
      if (job.cancelled) throw transportError(TRANSPORT_ERRORS.TRANSFER_CANCELLED, "USB transfer was cancelled");
      const result = await transferWithPolicy(chunk, job);
      if (result.bytesTransferred !== chunk.byteLength) throw new TypeError("Printer driver reported an incomplete chunk");
      transferred += result.bytesTransferred;
    }
    return { bytesTransferred: transferred, chunksTransferred: chunks.length };
  }

  function cancel(reason = "USB transfer was cancelled") {
    if (!activeJob || activeJob.finished) return false;
    activeJob.cancelled = true;
    if (activeJob.cancelReject) activeJob.cancelReject(transportError(TRANSPORT_ERRORS.TRANSFER_CANCELLED, reason));
    return true;
  }

  if (driver && typeof driver.onStatusChanged === "function") {
    unsubscribe = driver.onStatusChanged(status => {
      if (status && ["disconnecting", "disconnected", "device_disconnected"].includes(status.status)) {
        cancel("USB device disconnected during transfer");
      }
    });
  }

  return {
    send(bytes) {
      try { ensureOpen(); }
      catch (error) { return Promise.reject(error); }
      if (activeJob && !activeJob.finished) {
        return Promise.reject(transportError(TRANSPORT_ERRORS.TRANSPORT_BUSY, "Print transport is busy"));
      }
      const job = { id: ++jobSequence, cancelled: false, finished: false, cancelReject: null, inFlight: null };
      activeJob = job;
      job.promise = run(bytes, job);
      job.completion = job.promise.then(
        () => { job.finished = true; },
        async () => {
          if (job.inFlight) await job.inFlight;
          job.finished = true;
        }
      );
      return job.promise;
    },
    cancel,
    flush() {
      return activeJob && activeJob.completion ? activeJob.completion : Promise.resolve();
    },
    isBusy() { return Boolean(activeJob && !activeJob.finished); },
    destroy() {
      if (closed) return false;
      closed = true;
      cancel("Print transport was destroyed");
      try { unsubscribe(); } catch (error) { /* failure isolation */ }
      unsubscribe = function() {};
      return true;
    }
  };
}
