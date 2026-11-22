import {
  compactPlanningReceipts,
  type FrameReceipt,
} from "../../packet/frame-budget.js";
import type { PaperPage } from "../../packet/types.js";
import { selectCircuitPacket } from "../../layout/circuit-packet-selection.js";
// Hidden, source-only entry for TB2a. Not exported by @thermite/render.
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import { renderPacketWithAdvice } from "../../sheets.js";
import { useCompactFrame } from "../../packet/frame-profile.js";
import type { SchematicPacketRequest } from "../../packet/types.js";
import { withFontMetricCache } from "../../symbols/font-metric-cache.js";

export function renderCompactBenchmark(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
  onPlanning?: (receipts: readonly FrameReceipt[]) => void,
) {
  return withFontMetricCache(async () => {
    let configured: PaperPage | undefined;
    const result = await selectCircuitPacket(request, () =>
      renderPacketWithAdvice(ir, request, presentation, true, (page) => {
        useCompactFrame(page);
        configured = page;
      }),
    );
    // Circuit selection can retain an earlier render rather than its last trial.
    if (configured)
      onPlanning?.(
        compactPlanningReceipts(result.ok ? result.value.page : configured),
      );
    return result;
  });
}
