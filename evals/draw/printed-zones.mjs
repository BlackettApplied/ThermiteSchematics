import { inside } from "./checks.mjs";

const letterNumber = (s) =>
  [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function sequences(texts, axis, value) {
  const groups = new Map();
  for (const t of texts) {
    const key = t.anchor[axis].toFixed(3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const other = axis === "x" ? "y" : "x";
  return [...groups.values()]
    .sort((a, b) => a[0].anchor[axis] - b[0].anchor[axis])
    .map((group) => group.sort((a, b) => a.anchor[other] - b.anchor[other]))
    .filter(
      (group) =>
        group.length >= 2 && group.every((t, i) => value(t.text) === i + 1),
    );
}

// Recognize measured complete strips, not arbitrary title/table strings that
// happen to look like a zone. Numeric columns and alphabetic rows have no fixed
// 6/4 limit; spreadsheet-style letters continue through Z, AA, AB, ... .
export function printedZones(g) {
  if (!g.frame || !g.headerRule) return { numbers: [], letters: [] };
  const candidates = [...g.texts, ...(g.hiddenTexts ?? [])].filter(
    (t) =>
      t.sheetText &&
      t.painted !== false &&
      !t.nested &&
      !t.deviceUid &&
      !t.wire &&
      !t.row &&
      !t.continuation &&
      t.tagField == null &&
      inside(t.bbox, g.frame),
  );
  const numbers =
    sequences(
      candidates.filter(
        (t) => /^[1-9]\d*$/.test(t.text) && t.bbox.y >= g.headerRule.y,
      ),
      "y",
      Number,
    )[0] ?? [];
  const left = Math.min(...numbers.map((t) => t.bbox.x));
  const letters = numbers.length
    ? (sequences(
        candidates.filter(
          (t) => /^[A-Z]+$/.test(t.text) && t.bbox.x + t.bbox.w < left,
        ),
        "x",
        letterNumber,
      )[0] ?? [])
    : [];
  return { numbers, letters };
}
