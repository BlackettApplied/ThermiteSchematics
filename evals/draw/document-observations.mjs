import * as checks from "./checks.mjs";
import { requestedTerminalPlan } from "./m3-documents.mjs";
import { documentGeometries } from "./document-geometries.mjs";
import {
  identifierFailure,
  svgIdentifiers,
} from "./identifier-observations.mjs";
import { isIdentifierError } from "./identifier-errors.mjs";
import { terminalPlanSheet } from "./terminal-plan-strict.mjs";
export function terminalPlanObservation(s, g, tables, obs, context) {
  const scope =
    "Requested terminal plan must contain graphical strip geometry; report-row cells identify current table-only output.";
  try {
    const requested = documentGeometries(g).map((part) =>
      requestedTerminalPlan(s, part, tables),
    );
    if (context?.request) {
      const { findings, approachCounts } = terminalPlanSheet(s, context);
      return obs("DQ-23", findings, {
        scope,
        ...(approachCounts.length
          ? {
              evidence: {
                findingCount: findings.length,
                findings,
                approachCounts,
              },
            }
          : {}),
      });
    }
    return obs(
      "DQ-23",
      requested.some(Boolean) && g.reportRows.length
        ? [
            {
              kind: "terminal-plan-is-table",
              element: "terminal-plan",
              designation: s.view.title ?? "terminals",
              sheetLevel: true,
              rows: g.reportRows.length,
            },
          ]
        : [],
      { scope },
    );
  } catch (error) {
    if (!isIdentifierError(error)) throw error;
    return obs("DQ-23", [], { scope, ...identifierFailure(error) });
  }
}
export function documentObservations({
  s,
  g,
  packet,
  ir,
  tables,
  policy,
  wireFindings,
  obs,
  cohort,
}) {
  const identifiers = svgIdentifiers(s, packet, g, ir, tables, policy);
  const reportFindings = [
    ...identifiers.documents.flatMap(({ geometry, table }) =>
      checks.reports(geometry, s, packet, table, false),
    ),
    ...checks.reportFurniture(g, s),
  ];
  const rows = [
    obs("DQ-19", [
      ...wireFindings,
      ...identifiers.findings,
      ...checks
        .textBounds({ ...g, texts: g.texts.filter((t) => t.row) })
        .filter((f) => f.kind === "text-outside-cell"),
      ...cohort(reportFindings, (f) =>
        f.kind === "report-null-placeholder"
          ? [f.kind, f.columnIndex]
          : [f.kind, f.element],
      ),
    ]),
  ];
  if (identifiers.failures.length)
    rows.push(
      obs("DQ-19", [], {
        id: `${rows[0].case}/DQ-19/svg-identifier-infrastructure-${s.number}`,
        check: "sheet",
        ...identifiers.failures[0],
        evidence: {
          findingCount: 0,
          findings: [],
          documentFailures: identifiers.failures,
        },
      }),
    );
  return rows;
}
