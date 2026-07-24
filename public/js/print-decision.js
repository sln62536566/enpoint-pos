function freezeTicket(input = {}) {
  return Object.freeze({
    type: String(input.type || "generic"), layoutVariant: String(input.layoutVariant || "customer"),
    paper: String(input.paper || "58"), copies: Math.max(1, Math.floor(Number(input.copies) || 1))
  });
}

export function createPrintDecision(input = {}) {
  const action = input.action === "print" ? "print" : "skip";
  const tickets = action === "print" && Array.isArray(input.tickets) ? input.tickets.map(freezeTicket) : [];
  return Object.freeze({ action, tickets: Object.freeze(tickets), reason: String(input.reason || "") });
}

export function createDecisionLayer(resolver = () => ({ action: "skip", reason: "No print policy configured" })) {
  if (typeof resolver !== "function") throw new TypeError("Print decision resolver must be a function");
  return Object.freeze({
    decide(request) { return Promise.resolve(resolver(request)).then(createPrintDecision); }
  });
}
