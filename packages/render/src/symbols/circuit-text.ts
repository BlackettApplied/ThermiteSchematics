import { printableTextWidth, textClusters } from "../text-metrics.js";

export const TERMINAL_TEXT_SIZE = 2.5;

export const measure = (value: string, size = TERMINAL_TEXT_SIZE) =>
  printableTextWidth(value, size);

export function circuitTextLines(
  value: string,
  width: number,
  size = TERMINAL_TEXT_SIZE,
  lineWidth = measure,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line && lineWidth(`${line} ${word}`, size) > width) {
      lines.push(line);
      line = "";
    }
    if (lineWidth(word, size) > width) {
      for (const c of textClusters(word)) {
        if (line && lineWidth(line + c, size) > width) {
          lines.push(line);
          line = "";
        }
        line += c;
      }
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Preserve the measured channel-row reservation in either reading direction. */
export function channelRowSlots(
  lines: readonly string[] | undefined,
  vertical: boolean,
  mark: string,
  pitch: number,
): number {
  if (!lines) return 1;
  return Math.ceil(
    (vertical
      ? Math.max(...lines.map((line) => measure(line, TERMINAL_TEXT_SIZE))) +
        (mark === "sensor-3wire" ? 16 : 4)
      : lines.length * 3.1 +
        0.8 +
        (["level-sensor", "sensor-3wire"].includes(mark) ? 9 : 0)) / pitch,
  );
}
