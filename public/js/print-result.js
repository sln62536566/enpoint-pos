import { deepFreeze } from "./print-request.js";

function safeError(error) {
  return {
    code: String(error && error.code || "PIPELINE_FAILED"),
    message: String(error && error.message || "Print pipeline failed")
  };
}

export function createPrintResult(input = {}) {
  const errors = Array.isArray(input.errors) ? input.errors.map(safeError) : [];
  return deepFreeze({
    success: input.success === true, cancelled: input.cancelled === true, failed: input.failed === true,
    duration: Math.max(0, Number(input.duration) || 0), bytes: Math.max(0, Number(input.bytes) || 0),
    copies: Math.max(0, Number(input.copies) || 0), provider: String(input.provider || "none"),
    errors
  });
}

export function resultError(error) { return safeError(error); }
