import type { CompletenessReport } from "@thermite/compiler";
import { documentationCsv } from "@thermite/query";

export function completenessText(report: CompletenessReport): string {
  const c = report.counts;
  return [
    `${report.project} — connection completeness`,
    `Scope: ${[report.scope.device, report.scope.location].filter(Boolean).join(" / ") || "whole project"}`,
    `${c.devices} devices; ${c.terminals} terminals; ${c.ports} ports`,
    `${c.requiredMissing} required connections missing; ${c.warnings} warnings; ${c.information} information items`,
    `${c.partialModels} partial models; ${c.unreviewedModels} models with undeclared coverage`,
    "",
    ...["warning", "info"].flatMap((severity) =>
      report.findings
        .filter((f) => f.severity === severity)
        .map(
          (f) =>
            `${f.severity.toUpperCase()} ${f.code} ${f.designation}${f.location ? ` [${f.location}]` : ""}: ${f.message}\n  Project: ${f.source.file}:${f.source.line} ${f.source.jsonPointer}\n  Definition: ${f.definitionSource.file}:${f.definitionSource.line} ${f.definitionSource.jsonPointer}`,
        ),
    ),
    "",
    ...report.limitations,
    "",
  ].join("\n");
}

/** CSV is a complete connection inventory, including connected points and model coverage rows. */
export function completenessCsv(report: CompletenessReport): string {
  return documentationCsv({
    kind: "terminals",
    title: "Connection completeness",
    widths: [],
    notes: report.limitations,
    columns: [
      "Device",
      "Location",
      "Kind",
      "Connection",
      "Required",
      "State",
      "Attached",
      "Review",
      "Reason",
      "Findings",
      "Project source",
      "Definition source",
    ],
    rows: report.devices.flatMap((d) => {
      const rows = [
        {
          kind: "model",
          key: "",
          required: false,
          connection: d.coverage.status,
          connections: [] as string[],
          review: undefined as (typeof d.connections)[number]["review"],
          source: d.definitionSource,
        },
        ...d.connections,
      ];
      return rows.map((e) => ({
        key: JSON.stringify([d.uid, e.kind, e.key]),
        deviceUids: [d.uid],
        cells: [
          d.designation,
          d.location ?? "",
          e.kind,
          e.key,
          e.kind === "model" ? "" : String(e.required),
          e.connection,
          e.connections.join("; "),
          e.review?.status ?? "",
          e.kind === "model" ? d.coverage.notes : (e.review?.reason ?? ""),
          report.findings
            .filter(
              (f) =>
                f.deviceUid === d.uid &&
                f.kind === e.kind &&
                (f.key ?? "") === e.key,
            )
            .map((f) => `${f.code}: ${f.message}`)
            .join("; "),
          `${d.source.file}:${d.source.line} ${d.source.jsonPointer}`,
          `${e.source.file}:${e.source.line} ${e.source.jsonPointer}`,
        ],
      }));
    }),
  });
}
