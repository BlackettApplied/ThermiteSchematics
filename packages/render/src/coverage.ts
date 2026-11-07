import type { Diagnostic } from "@thermite/schema";
import {
  buildTopologyCoverage,
  type TopologyCoverage,
  type TopologyDrawingCoverage,
} from "./topology-coverage.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";

export interface DrawingCoverage {
  kind: "circuit" | "wiring";
  group?: string;
  conductorIds: readonly string[];
  functionIds: readonly string[];
}
export interface CoverageEntry {
  readonly id: string;
  readonly designation: string;
  readonly terminals: readonly TerminalId[];
  readonly appearances: readonly {
    readonly sheet: number;
    readonly view: string;
    readonly kind: DrawingCoverage["kind"];
    readonly group?: string;
  }[];
}
export interface PacketCoverage {
  /** Absent when every placed device has a schematic appearance. */
  readonly diagnostics?: readonly Diagnostic[];
  readonly format: "schematic-coverage/0.1";
  readonly scope: "circuit-and-wiring";
  readonly counts: {
    readonly conductors: {
      readonly total: number;
      readonly represented: number;
      readonly outsideAuditedViews: number;
    };
    readonly functions: {
      readonly total: number;
      readonly represented: number;
      readonly outsideAuditedViews: number;
    };
  };
  readonly conductors: readonly CoverageEntry[];
  readonly functions: readonly CoverageEntry[];
  readonly unauditedSheets: readonly number[];
  readonly limitations: readonly string[];
  readonly topology: TopologyCoverage;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Coverage of successful source-selected drawing projections, not electrical validity. */
export function buildPacketCoverage(
  ir: Readonly<ElectricalIr>,
  sheets: readonly {
    sheet: number;
    view: string;
    drawings: readonly DrawingCoverage[];
    topologyDrawings?: readonly TopologyDrawingCoverage[];
  }[],
): PacketCoverage {
  const names = new Map(ir.devices.map((d) => [d.uid, d.designation]));
  const conductors: CoverageEntry[] = [
    ...ir.wires.map((w) => ({
      id: w.uid,
      designation: w.designation,
      terminals: w.endpoints.map((e) => e.terminal),
      appearances: [],
    })),
    ...ir.jumpers.map((w) => ({
      id: w.uid,
      designation: w.designation ?? w.uid,
      terminals: w.endpoints.map((e) => e.terminal),
      appearances: [],
    })),
    ...ir.cableConductors.map((c) => ({
      id: JSON.stringify(c.id),
      designation: `${ir.cables.find((w) => w.uid === c.cableUid)!.designation}/${c.id.conductorId}`,
      terminals: c.endpoints.map((e) => e.terminal),
      appearances: [],
    })),
  ];
  const functions: CoverageEntry[] = ir.functions.map((f) => ({
    id: JSON.stringify([f.id.deviceUid, f.id.functionKey]),
    designation: `${names.get(f.id.deviceUid)}/${f.id.functionKey}`,
    terminals: f.terminals,
    appearances: [],
  }));
  const inventory = (
    entries: CoverageEntry[],
    field: "conductorIds" | "functionIds",
  ) => {
    const appearances = new Map(
      entries.map((entry) => [
        entry.id,
        [] as CoverageEntry["appearances"][number][],
      ]),
    );
    for (const sheet of sheets)
      for (const drawing of sheet.drawings) {
        for (const id of new Set(drawing[field])) {
          const list = appearances.get(id);
          if (!list)
            throw new Error(
              `Drawing coverage references an unknown source identity: ${id}.`,
            );
          list.push({
            sheet: sheet.sheet,
            view: sheet.view,
            kind: drawing.kind,
            ...(drawing.group === undefined ? {} : { group: drawing.group }),
          });
        }
      }
    return entries
      .sort((a, b) => compare(a.id, b.id))
      .map((entry) => ({
        ...entry,
        terminals: entry.terminals.map((t) => ({ ...t })),
        appearances: appearances.get(entry.id)!,
      }));
  };
  const representedConductors = inventory(conductors, "conductorIds");
  const representedFunctions = inventory(functions, "functionIds");
  const counts = (entries: CoverageEntry[]) => {
    const represented = entries.filter((e) => e.appearances.length > 0).length;
    return {
      total: entries.length,
      represented,
      outsideAuditedViews: entries.length - represented,
    };
  };
  return {
    format: "schematic-coverage/0.1",
    scope: "circuit-and-wiring",
    topology: buildTopologyCoverage(ir, sheets),
    counts: {
      conductors: counts(representedConductors),
      functions: counts(representedFunctions),
    },
    conductors: representedConductors,
    functions: representedFunctions,
    unauditedSheets: sheets
      .filter((s) => !s.drawings.length)
      .map((s) => s.sheet),
    limitations: [
      "Only circuit and wiring drawing projections are audited. Other drawing families, schedules, indexes and communication links are not counted.",
      "Outside-audited-view entries may appear in other views; this is not proof of omission from the entire packet.",
      "Conductor inventory includes wires, jumpers and fully terminated cable cores. Unterminated and unassigned cores are excluded.",
      "Function inventory includes all declared functions, including mechanisms with no terminals. Wiring views do not depict device functions.",
      "Coverage preserves source identity and endpoints; it does not certify printed readability, upstream supply, energized state or electrical design.",
    ],
  };
}

/** Every drawing family uses sheet references; report/index references are kept
 * separate. This audits device presence, independently of the narrower conductor
 * and function coverage above. */
export function packetDeviceCoverageDiagnostics(
  ir: Readonly<ElectricalIr>,
  sheets: readonly {
    number: number;
    schematic: boolean;
    references: readonly { deviceUid: string }[];
  }[],
): Diagnostic[] {
  // Reports make no schematic coverage claim. Every actual drawing family counts.
  if (!sheets.some((s) => s.schematic)) return [];
  const drawn = new Set(
    sheets
      .filter((s) => s.schematic)
      .flatMap((s) => s.references.map((r) => r.deviceUid)),
  );
  const missing = ir.devices
    .filter((d) => !drawn.has(d.uid))
    .sort(
      (a, b) => compare(a.designation, b.designation) || compare(a.uid, b.uid),
    );
  if (!missing.length) return [];
  const devices = missing.map((d) => {
    const reportSheets = sheets
      .filter(
        (s) => !s.schematic && s.references.some((r) => r.deviceUid === d.uid),
      )
      .map((s) => s.number);
    return {
      uid: d.uid,
      designation: d.designation,
      appearance: reportSheets.length
        ? ("reports-only" as const)
        : ("absent" as const),
      reportSheets,
    };
  });
  const first = missing[0]!;
  return [
    {
      code: "W906",
      severity: "warning",
      message: `Packet coverage: ${devices.map((d) => `${d.designation} (${d.appearance === "reports-only" ? "reports/indexes only" : "nowhere in packet"})`).join(", ")} appear on no schematic sheet. Add source-selected schematic views for these devices; schedules and indexes do not depict their wiring.`,
      ...first.source,
      devices,
      related: missing.map((d) => ({
        file: d.source.file,
        line: d.source.line,
        column: d.source.column,
        note: `${d.designation} has no schematic appearance.`,
      })),
    },
  ];
}
