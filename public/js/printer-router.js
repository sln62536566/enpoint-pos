import { capabilityMatches } from "./printer-capability.js";
import { createRoutingResult } from "./routing-result.js";

export function createPrinterRouter(options = {}) {
  if (!options.registry || typeof options.registry.list !== "function") throw new TypeError("Printer router requires a registry");
  const registry = options.registry;
  const scorePrinter = typeof options.score === "function" ? options.score : (printer, criteria) => {
    const required = criteria.requiredCapabilities || [];
    const groupMatch = !criteria.group || printer.group === criteria.group;
    return (groupMatch ? 10000 : 0) + (printer.priority * 100) + required.length;
  };

  return Object.freeze({
    route(criteria = {}) {
      const required = criteria.requiredCapabilities || [];
      const candidates = registry.list().filter(printer => printer.enabled && capabilityMatches(printer.capability, required))
        .map(printer => ({ printer, score: scorePrinter(printer, criteria) }))
        .filter(candidate => Number.isFinite(candidate.score)).sort((a, b) => b.score - a.score || a.printer.id.localeCompare(b.printer.id));
      if (!candidates.length) return createRoutingResult({ group: criteria.group, reason: "NO_MATCHING_PRINTER" });
      const selected = candidates[0];
      return createRoutingResult({ printer: selected.printer, score: selected.score, reason: "BEST_SCORE", group: criteria.group || selected.printer.group });
    }
  });
}
