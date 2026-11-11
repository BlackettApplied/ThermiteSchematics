export const TERMINAL_TEXT_SIZE = 2.5;

export const measure = (s: string, size = TERMINAL_TEXT_SIZE) =>
  [...s].reduce(
    (sum, c) =>
      sum +
      (/[ilI1 .,:;'|!]/u.test(c)
        ? 0.35
        : /[MW@%]/u.test(c)
          ? 1
          : (c.codePointAt(0) ?? 0) > 127
            ? 1.2
            : 0.64) *
        size,
    0,
  );
export function circuitTextLines(
  value: string,
  width: number,
  size = TERMINAL_TEXT_SIZE,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line && measure(`${line} ${word}`, size) > width) {
      lines.push(line);
      line = "";
    }
    if (measure(word, size) > width) {
      for (const c of word) {
        if (measure(line + c, size) > width) {
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
