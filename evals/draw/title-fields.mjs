import { finding, painted } from "./review-geometry.mjs";
import { compactRevisionSource } from "./title-revision-source.mjs";
const contained = (t, b) =>
  b &&
  t.x >= b.x - 0.001 &&
  t.y >= b.y - 0.001 &&
  t.x + t.w <= b.x + b.w + 0.001 &&
  t.y + t.h <= b.y + b.h + 0.001;

function revisionMatches(texts, cell, { label, value }) {
  if (typeof value !== "string" || !value.trim() || value === "UNSPECIFIED")
    return false;
  const row = texts
    .filter((t) => t.sheetText && contained(t.bbox, cell))
    .sort((a, b) => a.bbox.x - b.bbox.x);
  if (row.length !== 2) return false;
  const [heading, ink] = row;
  return (
    heading.text === label &&
    ink.text === value &&
    heading.bbox.x + heading.bbox.w <= ink.bbox.x &&
    Math.abs(heading.anchor.y - ink.anchor.y) <= 0.001
  );
}

export function titleFields(g, revision) {
  const panel = g.titleBlock;
  const texts = g.texts.filter((t) => painted(t) && contained(t.bbox, panel));
  const title = texts.map((t) => t.text).join("\n");
  const fields = {
    drawingNumber: /\b(?:drawing\s*(?:no\.?|number)|dwg\s*no\.?)\s*:/i,
    drawn: /\bdrawn(?: by)?\s*:/i,
    checked: /\bchecked(?: by)?\s*:/i,
    approved: /\bapproved(?: by)?\s*:/i,
    customerOrSite: /\b(?:customer|site|company)\s*:/i,
    revision: /\bREV\s+(?!UNSPECIFIED\b)\S+/,
    revisionHistory: /\b(?:revision\s+(?:history|table)|rev\s+date)\b/i,
  };
  const missing = Object.keys(fields).filter((k) =>
    k === "revision" && revision
      ? !revisionMatches(texts, g.revisionCell, revision)
      : !fields[k].test(title),
  );
  const revisionOnly =
    revision && missing.length === 1 && missing[0] === "revision";
  const bbox = revisionOnly
    ? (g.revisionCell ?? panel)
    : revision
      ? panel
      : undefined;
  return missing.length
    ? [
        finding(
          "incomplete-title-block",
          { bbox },
          {
            missing,
            ...(revisionOnly
              ? {
                  revision: {
                    expected: revision.value ?? null,
                    ...(revision.unavailable
                      ? { source: "unresolved authored view" }
                      : {}),
                  },
                }
              : {}),
          },
        ),
      ]
    : [];
}

export function titleBlockObservation(g, tables, packet, sheet, request, obs) {
  const revision = compactRevisionSource(
    tables.presentation,
    packet,
    sheet,
    request ?? tables.request,
  );
  return obs("DQ-18", titleFields(g, revision));
}
