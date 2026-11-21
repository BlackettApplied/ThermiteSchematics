import { measuredRows } from "./tranche4-data.mjs";
import { issuedRows } from "./m3-documents.mjs";
import { compact } from "./tranche4-source.mjs";
import { finding } from "./review-geometry.mjs";
function validIssuedNumbers(numbers) {
  return (
    numbers.length <= 100 &&
    new Set(numbers).size === numbers.length &&
    numbers.every((n, i) => n === i + 1)
  );
}
// Caption equality is packet/print consistency, not an independent native-IR oracle.
function finalCaption(view) {
  if (!view.root) return view.title;
  const subject = view.root.designation;
  const detail =
    view.format === "schematic-view/0.1"
      ? view.family
      : view.intent === "trace"
        ? `trace to ${view.target?.designation}`
        : view.intent;
  return subject && detail ? `${subject} / ${detail}` : undefined;
}
function qualifiedCaption(sheet, captions) {
  const title = finalCaption(sheet.view);
  return title && captions.filter((c) => c === title).length > 1
    ? `${title} (sheet ${String(sheet.number).padStart(2, "0")})`
    : title;
}
export function finalIndexAudit(packet, geometries, request) {
  const indexes = packet.sheets.filter((s) => s.view?.kind === "index"),
    findings = [];
  const anchor = indexes[0] ?? packet.sheets[0];
  const fail = (kind, extra = {}) =>
    findings.push({ ...finding(kind, {}, extra), sheet: anchor?.number });
  if (!indexes.length && request?.index !== true)
    return { findings, eligible: 0, sheet: anchor?.number };
  if (
    !request ||
    !Array.isArray(packet.sheets) ||
    !indexes.length ||
    !measuredRows(geometries)
  ) {
    fail("final-index-geometry-unavailable");
    return { findings, eligible: 1, sheet: anchor?.number };
  }
  const numbers = packet.sheets.map((s) => s.number);
  if (!validIssuedNumbers(numbers))
    fail("final-index-issued-sheet-list-invalid", { numbers });
  if (
    request.references === false &&
    packet.sheets.some((s) => s.view.kind === "references")
  )
    fail("final-index-references-disabled-but-issued");
  const rows = issuedRows(packet, geometries).filter((r) => r.kind === "index");
  const captions = packet.sheets.map((s) => finalCaption(s.view));
  for (const s of packet.sheets) {
    const own = rows.filter((r) => r.key === String(s.number));
    if (
      own.length !== 1 ||
      !own[0].visible ||
      compact(own[0].cells[0]) !== String(s.number)
    ) {
      fail("final-index-sheet-not-listed-once", {
        missingSheet: s.number,
        matches: own.length,
      });
      continue;
    }
    const caption = qualifiedCaption(s, captions);
    if (!caption || compact(own[0].cells[1]) !== compact(caption))
      findings.push({
        ...finding("final-index-view-caption-disagrees", own[0].texts[0], {
          targetSheet: s.number,
          expected: caption ?? null,
          actual: own[0].cells[1],
        }),
        sheet: own[0].sheet,
      });
  }
  for (const r of rows)
    if (!numbers.includes(Number(r.key)))
      findings.push({
        ...finding("final-index-foreign-sheet", r.texts[0], { row: r.key }),
        sheet: r.sheet,
      });
  return {
    findings,
    eligible: 1,
    sheet: anchor?.number,
    measurement: {
      issuedSheets: numbers.length,
      indexPages: indexes.length,
      printedRows: rows.length,
      referencesEnabled: request.references !== false,
    },
  };
}
