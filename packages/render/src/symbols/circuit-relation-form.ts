import type { IrFunction } from "@thermite/compiler";
import { printableCaption } from "./printable-policy.js";
import { circuitTextLines, measure } from "./circuit-text.js";

/** Freeze the pre-floor content choice, so enlarging type cannot discard
 * previously printed terminal references. This legacy em is ONLY a semantic
 * compatibility probe; the caller wraps, reserves and emits at 2.5 mm. */
export function relationCaptionForms(
  captions: readonly {
    kind: "relation";
    destination: string;
    functions: IrFunction[];
  }[],
  bodyWidth: number,
): string[] {
  const legacyEm = 2.3;
  const full = captions.map((c) => printableCaption(c));
  const available =
    Math.max(
      bodyWidth,
      Math.min(100, Math.max(0, ...full.map((s) => measure(s, legacyEm) + 4))),
    ) - 4;
  return captions.map((caption, i) => {
    const value = full[i];
    if (value === undefined) throw Error("Missing relation caption");
    const fullWasPrinted =
      circuitTextLines(value, available, legacyEm).length <= 4 &&
      value.split(/\s+/u).every((word) => measure(word, legacyEm) <= available);
    return fullWasPrinted
      ? value
      : printableCaption({ ...caption, kind: "relation-summary" });
  });
}
