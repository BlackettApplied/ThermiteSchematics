import type {
  ConductiveElementId,
  ElectricalIr,
  IrDevice,
  TerminalId,
} from "@thermite/compiler";
import type { RenderTextSource } from "../types.js";
import type { OffViewConnection } from "./model.js";
import { terminalIdKey, compareRenderTextSource } from "../ordering.js";
import {
  irSemanticOrder,
  compareSemanticElementIds,
} from "../semantic-order.js";
import { conductorKey, required, textSource } from "../presentation/util.js";

type Ends = readonly [TerminalId | null, TerminalId | null];

class IncidenceBuilder {
  readonly byTerminal = new Map<string, OffViewConnection[]>();
  readonly devices: ReadonlyMap<string, IrDevice>;
  constructor(ir: Readonly<ElectricalIr>) {
    this.devices = new Map(ir.devices.map((d) => [d.uid, d]));
  }
  designation(t: TerminalId) {
    return required(
      this.devices.get(t.deviceUid),
      "Authored endpoint device is missing",
    ).designation;
  }
  sources(t: TerminalId): RenderTextSource[] {
    return [
      textSource(
        "device",
        [t.deviceUid],
        "device.designation",
        this.designation(t),
      ),
      textSource(
        "terminal",
        [t.deviceUid, t.terminalKey],
        "terminal.key",
        t.terminalKey,
      ),
    ];
  }
  add(
    elementId: ConductiveElementId,
    designation: string,
    ends: Ends,
    sources: readonly RenderTextSource[],
  ) {
    const seen = new Set<string>();
    for (const [index, terminal] of ends.entries()) {
      if (!terminal || seen.has(terminalIdKey(terminal))) continue;
      seen.add(terminalIdKey(terminal));
      const other = ends[index === 0 ? 1 : 0];
      const value: OffViewConnection = {
        elementId: { ...elementId },
        designation,
        terminal: {
          deviceUid: terminal.deviceUid,
          terminalKey: terminal.terminalKey,
        },
        other: other
          ? { deviceUid: other.deviceUid, terminalKey: other.terminalKey }
          : null,
        destination: other
          ? `${this.designation(other)}.${other.terminalKey}`
          : "unterminated (spare)",
        textSources: [
          ...sources,
          ...this.sources(terminal),
          ...(other ? this.sources(other) : []),
        ].sort(compareRenderTextSource),
      };
      const key = terminalIdKey(terminal);
      this.byTerminal.set(key, [...(this.byTerminal.get(key) ?? []), value]);
    }
  }
}

function addCableIncidence(
  ir: Readonly<ElectricalIr>,
  builder: IncidenceBuilder,
) {
  for (const cable of ir.cables) {
    const records = new Map<string, Ends>(
      ir.cableConductors
        .filter((c) => c.cableUid === cable.uid)
        .map((c) => [
          c.id.conductorId,
          [c.endpoints[0].terminal, c.endpoints[1].terminal],
        ]),
    );
    // Assignments retain loose/spare ends; they never join compiler nets.
    for (const c of cable.assignments ?? [])
      records.set(c.id, [
        c.endpoints[0]?.terminal ?? null,
        c.endpoints[1]?.terminal ?? null,
      ]);
    for (const [id, ends] of records)
      builder.add(
        { kind: "cable_conductor", cableUid: cable.uid, conductorId: id },
        `${cable.designation}.${id}`,
        ends,
        [
          textSource(
            "cable",
            [cable.uid],
            "cable.designation",
            cable.designation,
          ),
          textSource(
            "cable-conductor",
            [cable.uid, id],
            "cable.conductor.id",
            id,
          ),
        ],
      );
  }
}

/** Direct source incidence only. Net membership and device functions add nothing. */
export function authoredTerminalIncidence(ir: Readonly<ElectricalIr>) {
  const builder = new IncidenceBuilder(ir);
  for (const w of ir.wires)
    builder.add(
      { kind: "wire", uid: w.uid },
      w.designation,
      [w.endpoints[0].terminal, w.endpoints[1].terminal],
      [textSource("wire", [w.uid], "wire.designation", w.designation)],
    );
  for (const j of ir.jumpers)
    builder.add(
      { kind: "jumper", uid: j.uid },
      j.designation ?? "Jumper",
      [j.endpoints[0].terminal, j.endpoints[1].terminal],
      j.designation
        ? [textSource("jumper", [j.uid], "jumper.designation", j.designation)]
        : [],
    );
  addCableIncidence(ir, builder);
  const order = irSemanticOrder(ir);
  for (const list of builder.byTerminal.values())
    list.sort((a, b) =>
      compareSemanticElementIds(order, a.elementId, b.elementId),
    );
  return builder.byTerminal;
}

export function omittedConnections(
  incidence: ReadonlyMap<string, readonly OffViewConnection[]>,
  terminal: TerminalId,
  drawn: ReadonlySet<string>,
): readonly OffViewConnection[] {
  return (incidence.get(terminalIdKey(terminal)) ?? []).filter(
    (c) => !drawn.has(conductorKey(c.elementId)),
  );
}
