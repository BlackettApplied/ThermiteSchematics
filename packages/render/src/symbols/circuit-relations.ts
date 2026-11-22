import type { IrFunction } from "@thermite/compiler";
import { printableCaption } from "./printable-policy.js";
import { printableTextMetrics } from "../text-metrics.js";
import { circuitTextLines, measure } from "./circuit-text.js";
import { relationCaptionForms } from "./circuit-relation-form.js";

export const CIRCUIT_TAG_COLUMN_WIDTH = 34;
export const LONG_CIRCUIT_DESTINATION_WIDTH = 40;

export function relatedCaptionWidth(text: string) {
  return Math.max(measure(text), printableTextMetrics(text, 2.5).advance);
}

/** Choose the printed form before reserving its width. A summary never retains
 * the full mirror's discarded width; the body and pin minimum still applies. */
export function relationCaptionPlan(
  captions: readonly {
    kind: "relation";
    destination: string;
    functions: IrFunction[];
  }[],
  bodyWidth: number,
  wrapWidth?: number,
) {
  const full = captions.map((c) => printableCaption(c));
  const available =
    (wrapWidth ??
      Math.max(
        bodyWidth,
        Math.min(100, Math.max(0, ...full.map((s) => measure(s, 2.5) + 4))),
      )) - 4;
  const lines = relationCaptionForms(captions, bodyWidth).flatMap((value) =>
    circuitTextLines(
      value,
      available,
      2.5,
      wrapWidth ? relatedCaptionWidth : measure,
    ),
  );
  return {
    lines,
    width: Math.max(bodyWidth, ...lines.map((s) => relatedCaptionWidth(s) + 4)),
  };
}
