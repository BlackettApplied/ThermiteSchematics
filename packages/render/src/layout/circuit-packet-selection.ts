import type { SchematicPacketRequest } from "../packet/types.js";
import type { RenderedPacket } from "../packet/types.js";
import type { RenderOutcome } from "../types.js";
import {
  circuitInlineContext,
  circuitInlineTrace,
  circuitLayoutContext,
} from "./circuit-inline-context.js";
import { circuitHasJogs } from "./circuit-route-quality.js";
import { circuitPacketGuard } from "./circuit-packet-guard.js";
import { required } from "../presentation/util.js";
import { powerPlacementAvailable } from "./power-placement.js";

/** The saved printable reference predates all routing alternatives. Each logical
 * circuit or LTR power view must repair its own printed jogs; guards compare
 * against that original reference, never a newly generated easier baseline. */
export function selectCircuitPacket(
  request: SchematicPacketRequest,
  render: () => Promise<RenderOutcome<RenderedPacket>>,
) {
  if (
    !Array.isArray(request?.views) ||
    !request.views.some(
      (v) =>
        v?.format === "circuit-view-request/0.1" ||
        (v?.format === "schematic-view-request/0.1" &&
          v.family === "power" &&
          v.flow === "left-to-right"),
    )
  )
    return render();
  const context = circuitLayoutContext();
  return circuitInlineContext.run(context, async () => {
    circuitInlineTrace.getStore()?.push(context);
    const original = await render();
    context.baselineLayouts = context.layouts.size;
    if (!original.ok) return original;
    context.qualityPhase = true;
    let selected = original;
    for (const [index, run] of context.runs.entries()) {
      if (
        ![...run.printed].some((key) =>
          circuitHasJogs(
            required(run.baseline.get(key), "Missing printed circuit baseline"),
          ),
        )
      )
        continue;
      if (!powerPlacementAvailable(run)) {
        run.decisions.set(
          "printed-power",
          "placement/economy budget exhausted",
        );
        continue;
      }
      context.selected.add(index);
      context.cursor = 0;
      const candidate = await render();
      if (run.power && !run.power.selected) {
        context.selected.delete(index);
        context.viewDecisions.push({ view: index, reason: "no alternative" });
        continue;
      }
      if (!candidate.ok && candidate.error.code !== "R006")
        throw new Error(
          `Unexpected circuit candidate failure: ${candidate.error.message}`,
        );
      if (candidate.ok && circuitPacketGuard(candidate.value, original.value))
        selected = candidate;
      else context.selected.delete(index);
      context.viewDecisions.push({
        view: index,
        reason: candidate.ok
          ? context.selected.has(index)
            ? "accepted"
            : "packet/view growth or annotation/card conservation/locality"
          : "composition fit",
      });
    }
    return selected;
  });
}
