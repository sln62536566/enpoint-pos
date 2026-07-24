export const PRINT_JOB_STATUS = Object.freeze({
  PENDING: "Pending", PREPARING: "Preparing", FORMATTING: "Formatting",
  SENDING: "Sending", COMPLETED: "Completed", FAILED: "Failed", CANCELLED: "Cancelled"
});

export const TERMINAL_JOB_STATUSES = Object.freeze([
  PRINT_JOB_STATUS.COMPLETED, PRINT_JOB_STATUS.FAILED, PRINT_JOB_STATUS.CANCELLED
]);

export function isPrintJobStatus(value) { return Object.values(PRINT_JOB_STATUS).includes(value); }
