import {
  compileProject,
  type ConductiveElementId,
  type ElectricalIr,
  type TerminalId,
} from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";

import { selectTraceSubgraph } from "../src/selection.js";
import type { SchematicFlow, SelectedSubgraph } from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { pnpTraceFixture, required } from "./fixtures.js";
import {
  materializeTier2Project,
  type Tier2FixtureName,
} from "./tier2-fixture.js";

export function sameB4Terminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

function sameElement(
  left: ConductiveElementId,
  right: ConductiveElementId,
): boolean {
  return (
    left.kind === right.kind &&
    left.uid === right.uid &&
    (left.kind !== "cable-conductor" ||
      (right.kind === "cable-conductor" &&
        left.conductorId === right.conductorId))
  );
}

export function b4Terminal(
  ir: ElectricalIr,
  designation: string,
  terminalKey: string,
): TerminalId {
  return {
    deviceUid: required(
      ir.devices.find((device) => device.designation === designation),
    ).uid,
    terminalKey,
  };
}

function moveTerminalToNet(
  ir: ElectricalIr,
  moved: TerminalId,
  netId: string,
): void {
  const entry = required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameB4Terminal(key, moved)),
  );
  const previous = required(ir.nets.find(({ id }) => id === entry.value));
  previous.terminalIds = previous.terminalIds.filter(
    (candidate) => !sameB4Terminal(candidate, moved),
  );
  if (
    previous.terminalIds.length === 0 &&
    previous.conductiveElementIds.length === 0 &&
    previous.potentialUids.length === 0
  ) {
    ir.nets = ir.nets.filter(({ id }) => id !== previous.id);
  }
  entry.value = netId;
  required(ir.nets.find(({ id }) => id === netId)).terminalIds.push(
    structuredClone(moved),
  );
}

function retargetWire(
  ir: ElectricalIr,
  designation: string,
  oldTerminal: TerminalId,
  newTerminal: TerminalId,
): void {
  const wire = required(
    ir.wires.find((candidate) => candidate.designation === designation),
  );
  const id = { kind: "wire" as const, uid: wire.uid };
  required(
    wire.endpoints.find(({ terminal }) =>
      sameB4Terminal(terminal, oldTerminal),
    ),
  ).terminal = structuredClone(newTerminal);
  const reverse = required(
    ir.indexes.terminalIdsByConductiveElement.find(({ key }) =>
      sameElement(key, id),
    ),
  );
  reverse.value = reverse.value.map((candidate) =>
    sameB4Terminal(candidate, oldTerminal)
      ? structuredClone(newTerminal)
      : candidate,
  );
  const oldEntry = required(
    ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameB4Terminal(key, oldTerminal),
    ),
  );
  oldEntry.value = oldEntry.value.filter(
    (candidate) => !sameElement(candidate, id),
  );
  required(
    ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameB4Terminal(key, newTerminal),
    ),
  ).value.push(id);
}

function addWire(
  ir: ElectricalIr,
  uid: string,
  designation: string,
  first: TerminalId,
  second: TerminalId,
): void {
  const template = required(ir.wires[0]);
  const id = { kind: "wire" as const, uid };
  const netId = required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameB4Terminal(key, first)),
  ).value;
  if (
    required(
      ir.indexes.netIdByTerminal.find(({ key }) => sameB4Terminal(key, second)),
    ).value !== netId
  ) {
    throw new Error("B4 fixture wire endpoints are not on one net.");
  }
  ir.wires.push({
    uid,
    designation,
    aliases: [],
    endpoints: [
      {
        terminal: structuredClone(first),
        source: structuredClone(template.endpoints[0].source),
      },
      {
        terminal: structuredClone(second),
        source: structuredClone(template.endpoints[1].source),
      },
    ],
    source: structuredClone(template.source),
  });
  required(ir.nets.find(({ id }) => id === netId)).conductiveElementIds.push(
    id,
  );
  ir.indexes.terminalIdsByConductiveElement.push({
    key: id,
    value: [structuredClone(first), structuredClone(second)],
  });
  for (const endpoint of [first, second]) {
    required(
      ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
        sameB4Terminal(key, endpoint),
      ),
    ).value.push(id);
  }
  ir.indexes.objectRefByUid.push({ key: uid, value: { kind: "wire", uid } });
  ir.indexes.objectRefByDesignation.push({
    key: designation,
    value: { kind: "wire", uid },
  });
}

function parallelBase(source: ElectricalIr): ElectricalIr {
  const ir = pnpTraceFixture(source);
  const root = b4Terminal(ir, "LS1", "4");
  const lane0 = b4Terminal(ir, "JB1", "X1.5");
  const signalNetId = required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameB4Terminal(key, root)),
  ).value;
  moveTerminalToNet(ir, lane0, signalNetId);
  addWire(ir, "f0000000-0000-4000-8000-000000000200", "EQ-1", root, lane0);
  return ir;
}

export async function materializeAndCompileB4Tier2Fixture(
  root: string,
  fixtureName: Tier2FixtureName,
) {
  const projectRoot = await materializeTier2Project(root, fixtureName);
  const compiled = await compileProject(projectRoot);
  if (!compiled.ok || compiled.diagnostics.length !== 0) {
    throw new Error(
      "Tier 2 fixture failed full compilation: " +
        JSON.stringify(compiled.diagnostics),
    );
  }
  return {
    projectRoot,
    diagnostics: compiled.diagnostics,
    ir: compiled.ir,
  };
}

export function b4Round9Fixture(source: ElectricalIr): ElectricalIr {
  const ir = parallelBase(source);
  const root = b4Terminal(ir, "LS1", "4");
  const early = b4Terminal(ir, "TB1", "7");
  const via = b4Terminal(ir, "JB1", "X1.6");
  const final = b4Terminal(ir, "TB1", "3");
  const signalNetId = required(
    ir.indexes.netIdByTerminal.find(({ key }) => sameB4Terminal(key, root)),
  ).value;
  for (const moved of [early, via]) moveTerminalToNet(ir, moved, signalNetId);
  retargetWire(ir, "W-FLD-003", b4Terminal(ir, "JB1", "X1.2"), early);
  retargetWire(ir, "EQ-1", b4Terminal(ir, "JB1", "X1.5"), early);
  addWire(ir, "00000000-0000-4000-8000-000000000201", "EQ-4", root, via);
  addWire(ir, "00000000-0000-4000-8000-000000000202", "EQ-5", via, final);
  addWire(ir, "00000000-0000-4000-8000-000000000203", "EQ-6", early, final);
  return ir;
}

/** M6_PLAN v23 Amendment B4's full compiled-context plain-N=2 embedding. */
export function b4CompiledContextN2Fixture(source: ElectricalIr): ElectricalIr {
  const ir = parallelBase(source);
  const merge = b4Terminal(ir, "TB1", "3");
  retargetWire(ir, "W-FLD-003", b4Terminal(ir, "JB1", "X1.2"), merge);
  retargetWire(ir, "EQ-1", b4Terminal(ir, "JB1", "X1.5"), merge);
  return ir;
}

export function selectB4Trace(
  ir: ElectricalIr,
  flow: SchematicFlow,
  includePower = false,
): SelectedSubgraph {
  const normalized = normalizeSchematicView(ir, {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower,
    },
    flow,
  });
  if (
    !normalized.ok ||
    normalized.value.view.format !== "schematic-view/0.2" ||
    normalized.value.view.intent !== "trace"
  ) {
    throw new Error("B4 trace normalization failed.");
  }
  const selected = selectTraceSubgraph({
    ir,
    view: normalized.value.view,
    engine: createQueryEngine(ir),
    mappings: normalized.value.mappings,
    target: normalized.value.view.target,
    includePower,
  });
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  return selected.value;
}
