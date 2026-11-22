import { painted } from "./review-geometry.mjs";
import { referenceClauses } from "./navigation-reference-clauses.mjs";
export const escapeReference = (s) =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const hasReferenceName = (text, name) =>
  new RegExp(
    "(?<![\\p{L}\\p{N}_])" + escapeReference(name) + "(?![\\p{L}\\p{N}_])",
    "u",
  ).test(text);
export const referenceTokens = (text) =>
  [
    ...text.matchAll(
      /(?<![\p{L}\p{N}_.])(?:P(\d+)\s*\/\s*)?S?(\d+)[. :]([A-Z]+\d+)\b/gu,
    ),
  ].map((m) => ({
    part: m[1] && Number(m[1]),
    sheet: Number(m[2]),
    zone: m[3],
  }));
// Group only measured ink; IDs locate containers, never certify ownership.
export function referenceInk(g) {
  const groups = new Map();
  for (const t of g.texts.filter(
    (t) => painted(t) && !t.sheetText && !t.row && t.bbox,
  )) {
    const id = t.navigationAnnotation ?? t.navigationContainer ?? t.element;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(t);
  }
  return [...groups.values()].flatMap((rows) => {
    const bbox = {
      x: Math.min(...rows.map((t) => t.bbox.x)),
      y: Math.min(...rows.map((t) => t.bbox.y)),
    };
    bbox.w = Math.max(...rows.map((t) => t.bbox.x + t.bbox.w)) - bbox.x;
    bbox.h = Math.max(...rows.map((t) => t.bbox.y + t.bbox.h)) - bbox.y;
    // A printed tag header belongs to this measured annotation only. Row
    // boundaries separate element/pointer clauses; they never pool targets.
    return referenceClauses(rows, referenceTokens).map((clause) => ({
      ...clause,
      bbox,
      rows,
    }));
  });
}
