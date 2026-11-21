import { isContactCaptionField } from "./contact-role-oracle.mjs";
import { pdfIdentifierRuns } from "./identifier-pdf.mjs";
export function prepareOracleHtml(g, html) {
  g.htmlTexts = html.texts;
  if (!g.tranche3) throw Error("CHECK3 native geometry bundle missing");
  g.tranche3.htmlGeometry = html;
}
export async function prepareOraclePdf(g, ir, sheet, page, legacyTexts) {
  g.pdfTexts = legacyTexts;
  if (
    sheet.view.kind !== "wires" &&
    !g.texts.some((t) => isContactCaptionField(t, ir))
  )
    return;
  if (!g.tranche3) throw Error("CHECK3 native geometry bundle missing");
  g.tranche3.pdfTexts = await pdfIdentifierRuns(page);
}
