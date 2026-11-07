import { escapeXmlText as xml } from "../svg/escape.js";

export const n = (value: number): string => String(Number(value.toFixed(3)));

export function text(
  x: number,
  y: number,
  value: string,
  size = 2.8,
  anchor = "start",
  weight = 400,
): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${n(size)}" text-anchor="${anchor}" font-weight="${weight}" fill="#18212b">${xml(value)}</text>`;
}
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra = "",
): string {
  return `<path d="M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)}" fill="none" stroke="#344054" stroke-width="0.3" ${extra}/>`;
}
export function wrap(value: string, max: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const char of value) {
    if ([...current].length >= max) {
      result.push(current);
      current = "";
    }
    current += char;
  }
  result.push(current);
  return result;
}
/** Prefer whitespace breaks in reports; split only a token wider than its column. */
export function wrapReport(value: string, max: number): string[] {
  const remaining = [...value],
    rows: string[] = [];
  while (remaining.length > max) {
    let cut = max;
    while (cut > 0 && !/\s/u.test(remaining[cut]!)) cut--;
    if (cut === 0) cut = max;
    rows.push(remaining.splice(0, cut).join(""));
    if (remaining[0] === " ") remaining.shift();
  }
  rows.push(remaining.join(""));
  return rows;
}
/** Conservative sans-serif advances at the assembly note's printed 2.5 mm size. */
export function assemblyNoteLines(value: string, maxWidth: number): string[] {
  const advance = (c: string) =>
    2.5 *
    (c.codePointAt(0)! > 127
      ? 1.2
      : /[MWmw@%]/u.test(c)
        ? 1
        : /[ilI]/u.test(c)
          ? 0.4
          : /[ .,:;'|!]/u.test(c)
            ? 0.5
            : /[0-9]/u.test(c)
              ? 0.65
              : /[a-z]/u.test(c)
                ? 0.7
                : 0.8);
  const remaining = [...value],
    rows: string[] = [];
  while (remaining.length) {
    let count = 0,
      width = 0;
    while (
      count < remaining.length &&
      width + advance(remaining[count]!) <= maxWidth
    )
      width += advance(remaining[count++]!);
    if (!count)
      throw new Error("Assembly note character cannot fit the sheet width.");
    if (count < remaining.length) {
      let cut = count;
      while (cut > 0 && !/\s/u.test(remaining[cut]!)) cut--;
      if (cut) count = cut;
    }
    rows.push(remaining.splice(0, count).join(""));
    if (remaining[0] === " ") remaining.shift();
  }
  return rows.length ? rows : [value];
}
