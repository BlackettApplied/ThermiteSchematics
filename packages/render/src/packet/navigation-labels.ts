import type { ElectricalIr } from "@thermite/compiler";
import type { PlacedOccurrence, NavigationShape } from "./navigation-types.js";
import { destinationToken } from "./navigation-location.js";
import { compareText } from "../ordering.js";
import { required } from "../presentation/util.js";
import { printableTextMetrics } from "../text-metrics.js";
export const NAVIGATION_FONT_MM = 3.502;
export const measureNavigationText = (s: string) => {
  const m = printableTextMetrics(s, NAVIGATION_FONT_MM);
  return Math.max(m.advance, m.right) - Math.min(m.left, 0);
};
let widestToken: string | undefined;
export const maximumToken = () =>
  (widestToken ??= Array.from({ length: 100 }, (_, i) =>
    "ABCD"
      .split("")
      .flatMap((r) =>
        Array.from({ length: 6 }, (_, c) =>
          destinationToken({ sheet: i + 1, zone: `${r}${c + 1}` }),
        ),
      ),
  )
    .flat()
    .reduce((a, b) =>
      measureNavigationText(a) >= measureNavigationText(b) ? a : b,
    ));

export function labelLines(
  prefix: string,
  heading: string,
  tokens: readonly string[],
  suffix = "",
) {
  return Array.from(
    { length: Math.ceil(tokens.length / 3) },
    (_, i) =>
      `${i === 0 ? `${prefix}${heading} ` : ""}${tokens.slice(i * 3, i * 3 + 3).join(", ")}${i * 3 + 3 < tokens.length ? "," : suffix}`,
  );
}
export function distinctDestinations(targets: readonly PlacedOccurrence[]) {
  const sorted = targets
    .slice()
    .sort(
      (a, b) =>
        a.destination.sheet - b.destination.sheet ||
        compareText(a.destination.zone, b.destination.zone),
    );
  return [...new Set(sorted.map((o) => destinationToken(o.destination)))];
}
export function repeatNoun(
  ir: Readonly<ElectricalIr>,
  members: readonly PlacedOccurrence[],
) {
  if (new Set(members.map((o) => JSON.stringify(o.source))).size > 1)
    return "functions";
  const owner = required(members[0], "Missing label owner");
  const fn = required(
    ir.functions.find(
      (f) =>
        f.id.deviceUid === owner.source.deviceUid &&
        f.id.functionKey === owner.source.functionKey,
    ),
    "Missing repeat source",
  );
  return fn.kind === "contact" ? "contact" : "function";
}
/** Greedy word wrapping; authored tokens are never split. Hard role breaks survive. */
export function wrapNavigationText(text: string, width: number): string {
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && measureNavigationText(next) > width) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      return [...lines, line];
    })
    .join("\n");
}
export function envelopeShapes(
  mode: NavigationShape["mode"],
  forms: string[],
  narrowWidths: readonly number[] = [],
): NavigationShape[] {
  const maximum =
    Math.ceil(
      Math.max(
        ...forms.flatMap((f) => f.split("\n").map(measureNavigationText)),
      ) * 1000,
    ) / 1000;
  const minimum = Math.max(
    ...forms.flatMap((f) => f.split(/\s+/).map(measureNavigationText)),
  );
  // Stable wide-to-narrow order, independent of current page/zone values.
  const widths = [maximum, 84, 70, 56, 42, 28, ...narrowWidths].filter(
    (w, i) => i === 0 || (w < maximum && w >= minimum),
  );
  return widths.map((width, i) => {
    const wrapped = forms.map((f) => wrapNavigationText(f, width));
    return {
      id: `${mode}/${i}`,
      mode,
      wrapWidthMm: width,
      inkMm: {
        x: 0,
        y: 0,
        w: width + 2,
        h: Math.max(...wrapped.map((f) => f.split("\n").length)) * 4.8 + 1,
      },
      maximumForms: wrapped,
    };
  });
}
export function maximumRepeatForms(
  tag: string,
  noun: string,
  counts: readonly number[],
  token: string,
) {
  const budgets = counts.map((n) => n - 1).sort((a, b) => b - a);
  const tokens = (n: number) =>
    Array.from({ length: n }, () => token).join(", ");
  const shapes = (["local", "self-located"] as const).flatMap((mode) => {
    const prefix = mode === "local" ? `${tag}: ` : `${tag} (${token}): `;
    const forms = [
      `${prefix}Also shown ${tokens(budgets.reduce((n, b) => n + b, 0))}`,
      `${prefix}Repeat of ${tokens(counts.length)} (same ${noun})`,
    ];
    // Cover each possible mixed canonical/secondary role partition too.
    for (let n = 1; n < counts.length; n++)
      forms.push(
        `${prefix}Also shown ${tokens(budgets.slice(0, n).reduce((a, b) => a + b, 0))}\nRepeat of ${tokens(counts.length - n)} (same ${counts.length - n === 1 ? "function" : noun})`,
      );
    return envelopeShapes(mode, forms);
  });
  const first = required(shapes[0], "Missing repeat envelope");
  return {
    shapes,
    forms: first.maximumForms,
    w: first.inkMm.w,
    h: first.inkMm.h,
  };
}
