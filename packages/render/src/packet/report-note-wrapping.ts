import { describeCodePoint, textClusters } from "../text-metrics.js";
import { fieldTextMeasureWidth } from "./svg.js";

/** Keep original code points, whitespace and explicit paragraph separators. */
export function reportNoteLines(value: string, width: number) {
  const lines: string[] = [];
  const fits = (text: string) => fieldTextMeasureWidth(text, 2.5) <= width;
  let line = "";
  for (const token of value.match(
    /\r\n|[\n\r\u2028\u2029]|[^\S\n\r\u2028\u2029]+|\S+/gu,
  ) ?? []) {
    if (/^[\n\r\u2028\u2029]/u.test(token)) {
      lines.push(line + token);
      line = "";
    } else if (/^\s+$/u.test(token)) line += token;
    else {
      if (line && !fits(line + token)) {
        lines.push(line);
        line = "";
      }
      if (fits(token)) line += token;
      else {
        for (const cluster of textClusters(token)) {
          if (!fits(cluster))
            throw Error(
              `Report note grapheme ${[...cluster].map(describeCodePoint).join(", ")} cannot fit the available width.`,
            );
          if (line && !fits(line + cluster)) {
            lines.push(line);
            line = "";
          }
          line += cluster;
        }
      }
    }
  }
  return [...lines, line];
}
