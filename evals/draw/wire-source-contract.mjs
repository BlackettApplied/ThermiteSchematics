import { nativeRows } from "./m3-native.mjs";
import { finding } from "./review-geometry.mjs";
const terminal = (t) =>
  typeof t?.deviceUid === "string" &&
  t.deviceUid.length > 0 &&
  typeof t?.terminalKey === "string" &&
  t.terminalKey.length > 0;
export function validateNativeEnds(ir) {
  for (const w of [...(ir.wires ?? []), ...(ir.jumpers ?? [])])
    if (
      !Array.isArray(w.endpoints) ||
      w.endpoints.length !== 2 ||
      ![0, 1].every((i) => terminal(w.endpoints[i]?.terminal))
    )
      throw Error(`Native conductor ${w.uid} has incomplete endpoints`);
  for (const cable of ir.cables ?? []) {
    for (const assignment of cable.assignments ?? [])
      validateCableEnds(assignment.endpoints, `${cable.uid}/${assignment.id}`);
  }
  for (const core of ir.cableConductors ?? [])
    validateCableEnds(core.endpoints, JSON.stringify(core.id));
}
function validateCableEnds(ends, identity) {
  if (
    !Array.isArray(ends) ||
    ends.length !== 2 ||
    ![0, 1].every(
      (i) =>
        Object.hasOwn(ends, i) &&
        (ends[i] === null || terminal(ends[i]?.terminal)),
    )
  )
    throw Error(`Native cable core ${identity} has incomplete endpoints`);
}
export function wireInventory(rows) {
  const inventory = rows.filter((r) => r.kind === "wires");
  const findings = rows
    .filter(
      (r) =>
        r.kind !== "wires" &&
        ["fromsheet.zone", "tosheet.zone"].every((header) =>
          r.columnNames.some(
            (s) => String(s).replace(/\s/gu, "").toLowerCase() === header,
          ),
        ),
    )
    .map((r) =>
      finding("wire-locator-report-kind-mismatch", r.texts[0], {
        sheet: r.sheet,
        row: r.key,
        declaredKind: r.kind,
        reason: "Painted wire locator columns disagree with documentation kind",
      }),
    );
  return { inventory, findings };
}
// An authored absence is a source fact, not an unknown terminal identity.
// Keep that applicability decision visible in each end's measurement receipt.
export function nativeEndAbsences(ir, rows) {
  const result = new Map();
  for (const row of rows) {
    for (const end of [0, 1]) {
      if (row.ends[end]) continue;
      if (row.element.kind !== "cable_conductor")
        throw Error("Native conductor has an unknown end");
      const cable = ir.cables.find((c) => c.uid === row.element.cableUid);
      const assignment = cable?.assignments?.find(
        (a) => a.id === row.element.conductorId,
      );
      const physical = ir.cableConductors?.find(
        (c) =>
          c.id.cableUid === row.element.cableUid &&
          c.id.conductorId === row.element.conductorId,
      );
      const source = assignment ?? physical;
      const state = !source
        ? "unassigned-core"
        : source.endpoints[end] === null && !physical?.endpoints[end]?.terminal
          ? "explicit-unterminated"
          : undefined;
      if (!state)
        throw Error(
          "Native cable end has missing or contradictory source identity",
        );
      result.set(JSON.stringify([row.key, end]), state);
    }
  }
  return result;
}

export function nativeWireSources(ir) {
  validateNativeEnds(ir);
  const rows = nativeRows(ir).filter((r) => r.kind === "wires");
  if (rows.some((r) => r.ends.some((t) => t != null && !terminal(t))))
    throw Error("Native conductor has incomplete terminal identity");
  return { rows, absence: nativeEndAbsences(ir, rows) };
}
export function wireCoverageGaps(gaps, inventory) {
  return gaps.flatMap((gap) => [
    gap,
    ...inventory
      .filter((row) => row.key === gap.row && row.sheet !== gap.sheet)
      .map((row) => ({
        ...gap,
        sheet: row.sheet,
        appearanceSheet: gap.sheet,
        documentId: row.documentId,
      })),
  ]);
}
export function endApplicability(source, end, absence) {
  return source.ends[end]
    ? {}
    : {
        status: "not-applicable",
        nativeAbsence: absence.get(JSON.stringify([source.key, end])),
      };
}
