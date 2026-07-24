import { deepFreeze } from "./print-request.js";
import { PRINT_JOB_STATUS, isPrintJobStatus } from "./print-job-status.js";

export function createPrintJob(input = {}) {
  if (!input.request || !input.context) throw new TypeError("Print job requires request and context");
  const status = input.status || PRINT_JOB_STATUS.PENDING;
  if (!isPrintJobStatus(status)) throw new RangeError(`Invalid print job status: ${status}`);
  return deepFreeze({
    id: String(input.id || input.context.jobId), request: input.request, context: input.context, status,
    createdAt: Number(input.createdAt) || 0, startedAt: input.startedAt === null || input.startedAt === undefined ? null : Number(input.startedAt),
    finishedAt: input.finishedAt === null || input.finishedAt === undefined ? null : Number(input.finishedAt),
    result: input.result || null
  });
}

export function transitionPrintJob(job, status, changes = {}) {
  return createPrintJob(Object.assign({}, job, changes, { status }));
}
