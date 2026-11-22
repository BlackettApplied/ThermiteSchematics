import { AsyncLocalStorage } from "node:async_hooks";
import { InlineLabelFitError } from "./inline-label-error.js";

export interface ElkWorkLedger {
  label: string;
  limit: number;
  /** Charged logical requests, including exact-input hits. */
  calls: number;
  cacheHits: number;
  baselineCalls: number;
  /** Exhaustion admits only the original legacy result. */
  exhausted?: boolean;
  dispatches: number;
}
export class ElkWorkBudgetError extends InlineLabelFitError {}
export const elkWorkScope = new AsyncLocalStorage<ElkWorkLedger>();
export const elkWorkTrace = new AsyncLocalStorage<ElkWorkLedger[]>();
export const elkPacketWorkTrace = new AsyncLocalStorage<{
  calls: number;
  cacheHits: number;
  outsideSearchCalls: number;
}>();

export function elkWorkLedger(label: string, limit: number): ElkWorkLedger {
  const ledger = {
    label,
    limit,
    calls: 0,
    cacheHits: 0,
    baselineCalls: 0,
    dispatches: 0,
  };
  elkWorkTrace.getStore()?.push(ledger);
  return ledger;
}

/** Charge every logical request before either a hit or dispatch. Cache warmth
 * only saves execution time; it cannot move a search's stop point. */
export function chargeElkWork(hit = false) {
  const work = elkWorkScope.getStore();
  const packet = elkPacketWorkTrace.getStore();
  if (work && work.calls >= work.limit)
    throw new ElkWorkBudgetError("Shared logical ELK layout budget exhausted.");
  if (work) work.calls++;
  if (hit) {
    if (work) work.cacheHits++;
    if (packet) packet.cacheHits++;
    return;
  }
}

/** Record only execution, after input admission; failed layouts still execute. */
export function recordElkDispatch() {
  const work = elkWorkScope.getStore(),
    packet = elkPacketWorkTrace.getStore();
  if (work) work.dispatches++;
  if (packet) {
    packet.calls++;
    if (!work) packet.outsideSearchCalls++;
  }
}
