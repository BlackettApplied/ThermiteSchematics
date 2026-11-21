import { type EndpointSheetZones } from "../cable-schedule.js";
import type { DocumentationContext } from "./context.js";
import { appendWireRow, appendCoreRow } from "./wire-rows.js";
export function documentationWires<T>(context: DocumentationContext<T>) {
  const { ir, compare, incident, cables, references, options, rows, table } =
    context;
  const zones: EndpointSheetZones[] = [];
  for (const w of [...ir.wires, ...ir.jumpers].sort((a, b) =>
    compare(a.designation ?? a.uid, b.designation ?? b.uid),
  )) {
    if (!incident(w.endpoints.map((e) => e.terminal.deviceUid))) continue;
    appendWireRow(w, zones, context);
  }
  for (const c of cables)
    for (const core of c.cores) {
      appendCoreRow(c, core, zones, context);
    }
  const hasZones = references !== undefined || options?.output === "csv";
  if (hasZones)
    rows.forEach((row, i) =>
      row.cells.push(...zones[i]!.map((z) => z || "not drawn")),
    );
  return table(
    "Wire and core schedule",
    [
      "Conductor / label",
      "End A / first endpoint",
      "End B / second endpoint",
      "Color / size",
      "Assignment",
      ...(hasZones ? ["From sheet.zone", "To sheet.zone"] : []),
    ],
    hasZones
      ? [0.12, 0.18, 0.18, 0.14, 0.16, 0.11, 0.11]
      : [0.15, 0.24, 0.24, 0.18, 0.19],
    [
      "Wire endpoints are canonical, not a routing or installation order. Cable end order follows the source where annotated.",
      "Unterminated and unassigned cores do not imply a de-energized circuit.",
      "Sheet.zone locates the native endpoint in this packet; not drawn means it has no drawn landing on any issued sheet.",
    ],
  );
}
