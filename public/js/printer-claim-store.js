const DEFAULT_LEASE_MS = 60000;

function text(value, fallback = "") { return value === undefined || value === null ? fallback : String(value); }
function errorCode(error, fallback) { return text(error && error.code, fallback); }
function controlled(input = {}) { return Object.freeze(Object.assign({ ok: false, acquired: false, code: "CLAIM_FAILED", claim: null }, input)); }

export function normalizePrinterClaimKey(parts = {}) {
  const logical = [parts.storeId || "defaultStore", parts.orderId, parts.businessEventVersion, parts.ticketType || "kitchen", parts.routeGroup || "Kitchen"].map(value => text(value));
  return logical.join(":").replace(/[.#$\[\]\/\u0000-\u001f\u007f]/g, "_");
}

export function createPrinterClaimStore(options = {}) {
  if (typeof options.ref !== "function" || typeof options.runTransaction !== "function") throw new TypeError("Printer claim store requires Firebase transaction dependencies");
  const database = options.db;
  const makeRef = options.ref;
  const transaction = options.runTransaction;
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const leaseMs = Math.max(1000, Number(options.leaseMs) || DEFAULT_LEASE_MS);
  const heartbeatMs = Math.max(250, Math.min(20000, Math.floor(leaseMs / 3)));
  const rootPath = text(options.rootPath, "printerClaims");

  function claimReference(claimKey) { return makeRef(database, `${rootPath}/${claimKey}`); }

  async function claim(candidate, owner) {
    const claimKey = text(candidate && candidate.claimKey) || normalizePrinterClaimKey(candidate);
    const ownerId = text(owner && owner.ownerId || owner);
    const now = Number(clock());
    try {
      const response = await transaction(claimReference(claimKey), current => {
        if (current && current.status === "completed") return;
        if (current && current.status === "failed") return;
        if (current && (current.status === "claimed" || current.status === "printing") && Number(current.leaseExpiresAt || 0) > now) return;
        const attempt = Math.max(0, Number(current && current.attempt) || 0) + 1;
        return {
          eventId: text(candidate.eventId || claimKey), orderId: text(candidate.orderId), orderNumber: text(candidate.orderNumber),
          ticketType: text(candidate.ticketType, "kitchen"), routeGroup: text(candidate.routeGroup, "Kitchen"),
          businessEventVersion: text(candidate.businessEventVersion), ownerId, deviceId: text(owner && owner.deviceId), sessionId: text(owner && owner.sessionId),
          claimedAt: now, leaseExpiresAt: now + leaseMs, status: "claimed", attempt,
          completedAt: null, failedAt: null, lastErrorCode: null
        };
      });
      const value = response && response.snapshot && typeof response.snapshot.val === "function" ? response.snapshot.val() : null;
      if (!response || response.committed !== true || !value || value.ownerId !== ownerId || Number(value.claimedAt) !== now) return controlled({ ok: true, code: "CLAIM_NOT_ACQUIRED", claimKey, claim: value });
      return controlled({ ok: true, acquired: true, code: "CLAIM_ACQUIRED", claimKey, claim: Object.freeze(Object.assign({}, value)) });
    } catch (error) {
      return controlled({ code: errorCode(error, "CLAIM_TRANSACTION_FAILED"), claimKey, error: Object.freeze({ code: errorCode(error, "CLAIM_TRANSACTION_FAILED"), message: text(error && error.message, "Claim transaction failed") }) });
    }
  }

  async function transition(claimKey, ownerId, status, fields, allowedStatuses) {
    try {
      const response = await transaction(claimReference(claimKey), current => {
        if (!current || current.ownerId !== ownerId || allowedStatuses.indexOf(current.status) < 0) return;
        return Object.assign({}, current, fields, { status });
      });
      const value = response && response.snapshot && typeof response.snapshot.val === "function" ? response.snapshot.val() : null;
      if (!response || response.committed !== true) {
        const lost = Boolean(value && value.ownerId && value.ownerId !== ownerId);
        return controlled({ code: lost ? "CLAIM_OWNERSHIP_LOST" : "CLAIM_STATE_NOT_UPDATED", claimKey, claim: value });
      }
      return controlled({ ok: true, acquired: false, code: `CLAIM_${status.toUpperCase()}`, claimKey, claim: value && Object.freeze(Object.assign({}, value)) });
    } catch (error) { return controlled({ code: errorCode(error, "CLAIM_STATE_WRITE_FAILED"), claimKey }); }
  }

  function renewLease(claimKey, ownerId) {
    const now = Number(clock());
    return transition(claimKey, ownerId, "printing", { leaseExpiresAt: now + leaseMs, lastHeartbeatAt: now }, ["claimed", "printing"]);
  }

  return Object.freeze({
    claim,
    leaseMs,
    heartbeatMs,
    renewLease,
    markPrinting(claimKey, ownerId) { const now = Number(clock()); return transition(claimKey, ownerId, "printing", { printingAt: now, leaseExpiresAt: now + leaseMs, lastHeartbeatAt: now }, ["claimed", "printing"]); },
    complete(claimKey, ownerId) { return transition(claimKey, ownerId, "completed", { completedAt: Number(clock()), leaseExpiresAt: 0, lastErrorCode: null }, ["claimed", "printing"]); },
    fail(claimKey, ownerId, error) { return transition(claimKey, ownerId, "failed", { failedAt: Number(clock()), leaseExpiresAt: 0, lastErrorCode: errorCode(error, "PRINT_FAILED") }, ["claimed", "printing"]); }
  });
}

export const PrinterClaimStore = Object.freeze({ create: createPrinterClaimStore, normalizeKey: normalizePrinterClaimKey });
