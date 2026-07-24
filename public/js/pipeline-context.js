import { deepFreeze } from "./print-request.js";

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") { const result = {}; Object.keys(value).forEach(key => { result[key] = clone(value[key]); }); return result; }
  return value;
}

export function createPipelineContext(input = {}, clock = Date.now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Pipeline context must be an object");
  return deepFreeze({
    jobId: String(input.jobId || ""), requestId: String(input.requestId || ""),
    correlationId: String(input.correlationId || input.requestId || input.jobId || ""),
    startTime: Number.isFinite(Number(input.startTime)) ? Number(input.startTime) : Number(clock()),
    provider: String(input.provider || "unknown"), attempt: Math.max(1, Math.floor(Number(input.attempt) || 1)),
    metadata: clone(input.metadata || {}), trace: clone(Array.isArray(input.trace) ? input.trace : [])
  });
}
