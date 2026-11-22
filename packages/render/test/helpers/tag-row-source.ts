import { expect } from "vitest";
/** Compare every printed character and the complete source interval against IR.
 * A wrap may consume trailing whitespace, but cannot skip any authored glyph. */
export function assertTagRows(
  rows: readonly {
    textContent: string | null;
    getAttribute(name: string): string | null;
  }[],
  expected: string,
) {
  let position = 0;
  for (const row of rows) {
    expect(row.getAttribute("data-tag-row-start")).not.toBeNull();
    const start = Number(row.getAttribute("data-tag-row-start")),
      end = Number(row.getAttribute("data-tag-row-end"));
    expect(start).toBe(position);
    expect(end).toBeGreaterThanOrEqual(start);
    expect(end).toBeLessThanOrEqual(expected.length);
    expect(row.textContent).toBe(expected.slice(start, end).trimEnd());
    position = end;
  }
  expect(position).toBe(expected.length);
}
