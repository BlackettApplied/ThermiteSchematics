import type { RenderOutcome } from "../types.js";
import type { PaperPage } from "../packet/types.js";
import { hasCompactFrame } from "../packet/frame-profile.js";
import {
  titleFrameContext,
  titlePresentationContext,
} from "../internal/title-data/frame-context.js";
import {
  compactPlanningReceipts,
  replayCompactPlanningReceipts,
  type FrameReceipt,
} from "../packet/frame-budget.js";
import { nextCircuitLayoutRun } from "./circuit-inline.js";
import {
  circuitInlineContext,
  type CircuitInlineContext,
} from "./circuit-inline-context.js";

interface SavedView {
  ir: object;
  presentation: object | undefined;
  input: string;
  start: number;
  selected: boolean[];
  result: unknown;
  receipts: readonly FrameReceipt[];
}
const views = new WeakMap<CircuitInlineContext, SavedView[]>();

/** Reuse only identical pre-assembly inputs and the same run selection. Each
 * caller gets its own drafts: assembly mutates links, namespaces and headings.
 * Replaying nextCircuitLayoutRun preserves RT2a's cursor/current-run contract.
 * Final sheet assembly, NAV measurements and the packet guard still run. */
export async function cachedCircuitView<T>(
  ir: object,
  presentation: object | undefined,
  input: readonly unknown[],
  render: () => Promise<RenderOutcome<T>>,
  page?: PaperPage,
): Promise<RenderOutcome<T>> {
  const context = circuitInlineContext.getStore();
  if (!context) return render();
  const entries = views.get(context) ?? [];
  views.set(context, entries);
  const key = JSON.stringify([
      input,
      page ? hasCompactFrame(page) : false,
      page ? titleFrameContext(page) : undefined,
      titlePresentationContext(presentation),
    ]),
    start = context.cursor;
  const saved =
    context.qualityPhase &&
    entries.find(
      (entry) =>
        entry.ir === ir &&
        entry.presentation === presentation &&
        entry.input === key &&
        entry.start === start &&
        start + entry.selected.length <= context.runs.length &&
        entry.selected.every(
          (selected, i) => selected === context.selected.has(start + i),
        ),
    );
  if (saved) {
    for (const _ of saved.selected) nextCircuitLayoutRun();
    if (page) replayCompactPlanningReceipts(page, saved.receipts);
    return structuredClone(saved.result) as RenderOutcome<T>;
  }
  const receiptStart = page ? compactPlanningReceipts(page).length : 0;
  const result = await render();
  if (result.ok)
    entries.push({
      ir,
      presentation,
      input: key,
      start,
      selected: Array.from({ length: context.cursor - start }, (_, i) =>
        context.selected.has(start + i),
      ),
      result: structuredClone(result),
      receipts: page ? compactPlanningReceipts(page).slice(receiptStart) : [],
    });
  return result;
}
