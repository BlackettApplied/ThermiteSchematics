import {
  contactCaptionAudit,
  isContactCaptionField,
} from "./contact-role-oracle.mjs";
import { pdfOracleTexts } from "./tranche3-media.mjs";
import { finding } from "./review-geometry.mjs";
const key = (t) =>
  JSON.stringify([
    t.documentId,
    t.row,
    t.columnIndex,
    t.functionKey,
    t.deviceUid,
    t.labelOwnerKey,
  ]);
export function contactCaptionMediaAudit(g, ir) {
  const svg = contactCaptionAudit(g, ir),
    findings = svg.findings.map((f) => ({ ...f, medium: "svg" }));
  const field = (t) => isContactCaptionField(t, ir),
    expected = g.texts.filter(field);
  if (!expected.length) return svg;
  const htmlTexts = g.htmlTexts ?? [],
    actual = new Set(htmlTexts.filter(field).map(key));
  findings.push(
    ...contactCaptionAudit({ ...g, texts: htmlTexts }, ir).findings.map(
      (f) => ({ ...f, medium: "html" }),
    ),
  );
  for (const t of expected)
    if (!actual.has(key(t)))
      findings.push(
        finding("contact-caption-medium-unavailable", t, { medium: "html" }),
      );
  const pdf = pdfOracleTexts(
    { ...g, pdfTexts: g.tranche3?.pdfTexts ?? [] },
    field,
  );
  findings.push(
    ...pdf.missing,
    ...contactCaptionAudit({ ...g, texts: pdf.texts }, ir).findings.map(
      (f) => ({ ...f, medium: "pdf" }),
    ),
  );
  return { ...svg, findings };
}
