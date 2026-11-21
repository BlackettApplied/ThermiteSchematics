import { identifierTable } from "./identifier-tables.mjs";
import { identifierFindings } from "./identifier-checks.mjs";
import { pdfIdentifierRuns } from "./identifier-pdf.mjs";
import { tableForSheet } from "./m3-documents.mjs";
import { documentGeometries, mediumDocuments } from "./document-geometries.mjs";
import {
  isIdentifierError,
  IdentifierMeasurementError,
} from "./identifier-errors.mjs";
export const identifierFailure = (error) => ({
  status: "infrastructure-error",
  instrumentation: "identifier",
  reason: `Identifier measurement failed: ${error.message}`,
});
function failure(error, geometry) {
  if (!isIdentifierError(error)) throw error;
  return {
    ...identifierFailure(error),
    documentId: geometry.texts.find((t) => t.documentId)?.documentId,
  };
}
export function svgIdentifiers(sheet, packet, g, ir, tables, policy) {
  const findings = [],
    failures = [],
    documents = [];
  for (const geometry of documentGeometries(g)) {
    let reportTable;
    try {
      reportTable = tableForSheet(sheet, geometry, tables);
      const table = identifierTable(sheet, packet, geometry, ir, tables);
      if (table)
        findings.push(
          ...identifierFindings(geometry, table, ir, "svg", undefined, policy),
        );
    } catch (error) {
      failures.push(failure(error, geometry));
    }
    documents.push({ geometry, table: reportTable });
  }
  return {
    table: documents.length === 1 ? documents[0].table : undefined,
    documents,
    findings,
    failures,
    extra: failures.length ? failures[0] : {},
  };
}
async function measureMedium(
  medium,
  sheet,
  packet,
  g,
  html,
  ir,
  tables,
  pdfPage,
  policy,
) {
  const findings = [],
    failures = [];
  let applicable = false,
    pdfRuns;
  for (const { geometry, source } of mediumDocuments(g, html, medium)) {
    try {
      if (!geometry)
        throw new IdentifierMeasurementError(
          "Identifier measurement: HTML document geometry missing",
        );
      const table = identifierTable(sheet, packet, geometry, ir, tables);
      if (!table) continue;
      applicable = true;
      if (medium === "pdf") pdfRuns ??= await pdfIdentifierRuns(pdfPage);
      findings.push(
        ...identifierFindings(geometry, table, ir, medium, pdfRuns, policy),
      );
    } catch (error) {
      failures.push(failure(error, source));
    }
  }
  return { findings, failures, applicable };
}
export async function mediaIdentifiers(
  c,
  sheet,
  packet,
  g,
  html,
  ir,
  tables,
  pdfPage,
  policy,
  observation,
) {
  const rows = [];
  for (const medium of ["html", "pdf"]) {
    const { findings, failures, applicable } = await measureMedium(
      medium,
      sheet,
      packet,
      g,
      html,
      ir,
      tables,
      pdfPage,
      policy,
    );
    if (!applicable && !failures.length) continue;
    const extra = failures.length && !findings.length ? failures[0] : {};
    rows.push(
      observation(c, sheet, "DQ-19", findings, {
        id: `${c.id}/DQ-19/${medium}-${sheet.number}`,
        medium,
        scope:
          "Complete source identifier units on one independently measured physical line.",
        ...extra,
      }),
    );
    if (failures.length && findings.length)
      rows.push(
        observation(c, sheet, "DQ-19", [], {
          id: `${c.id}/DQ-19/${medium}-identifier-infrastructure-${sheet.number}`,
          check: medium,
          medium,
          ...failures[0],
          evidence: {
            findingCount: 0,
            findings: [],
            documentFailures: failures,
          },
        }),
      );
  }
  return rows;
}
