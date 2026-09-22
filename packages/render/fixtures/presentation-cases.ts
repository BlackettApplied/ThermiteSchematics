import type { ElectricalIr, TerminalId } from "@thermite/compiler";

import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  type DeviceTypeSymbolMapping,
} from "../src/symbols/mappings.js";
import type { SelectedConductorStep, SelectedSubgraph } from "../src/types.js";

function sameTerminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

/** Test-only fixture for semantic degree three/four at one function terminal. */
export function withParallelConductorsAt(
  sourceIr: ElectricalIr,
  sourceSelected: SelectedSubgraph,
  terminal: TerminalId,
  extraCount: number,
): Readonly<{ ir: ElectricalIr; selected: SelectedSubgraph }> {
  const ir = structuredClone(sourceIr);
  const selected = structuredClone(sourceSelected);
  const path = selected.paths.find((candidate) =>
    candidate.steps.some(
      (step) =>
        step.kind === "conductor" &&
        (sameTerminal(step.from, terminal) || sameTerminal(step.to, terminal)),
    ),
  );
  if (path === undefined)
    throw new Error("Parallel fixture terminal is absent.");
  const base = path.steps.find(
    (step): step is SelectedConductorStep =>
      step.kind === "conductor" &&
      (sameTerminal(step.from, terminal) || sameTerminal(step.to, terminal)),
  );
  if (base === undefined || base.elementId.kind !== "wire") {
    throw new Error("Parallel fixture requires a selected wire.");
  }
  const baseWire = ir.wires.find(({ uid }) => uid === base.elementId.uid);
  if (baseWire === undefined)
    throw new Error("Parallel fixture wire is absent.");
  const mutableSteps = path.steps as Array<
    SelectedSubgraph["paths"][number]["steps"][number]
  >;
  const mutableIds = selected.conductiveElementIds as Array<
    SelectedSubgraph["conductiveElementIds"][number]
  >;
  for (let index = 0; index < extraCount; index++) {
    const uid = `presentation-parallel-${index + 1}`;
    const elementId = { kind: "wire" as const, uid };
    ir.wires.push({
      ...structuredClone(baseWire),
      uid,
      designation: `PRESENTATION-PARALLEL-${index + 1}`,
    });
    ir.indexes.terminalIdsByConductiveElement.push({
      key: elementId,
      value: [structuredClone(base.from), structuredClone(base.to)],
    });
    for (const endpoint of [base.from, base.to]) {
      const entry = ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
        sameTerminal(key, endpoint),
      );
      if (entry === undefined)
        throw new Error("Parallel fixture terminal index is absent.");
      entry.value.push(elementId);
    }
    const net = ir.nets.find(({ id }) => id === base.netId);
    if (net === undefined) throw new Error("Parallel fixture net is absent.");
    net.conductiveElementIds.push(elementId);
    mutableSteps.push({
      kind: "conductor",
      elementId,
      from: structuredClone(base.from),
      to: structuredClone(base.to),
      netId: base.netId,
    });
    mutableIds.push(elementId);
  }
  return { ir, selected };
}

export function deepFreezeFixture<Value>(
  value: Value,
  seen = new Set<object>(),
): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreezeFixture(member, seen);
  return Object.freeze(value);
}

/** Two conductors use the distinct in/out ports of one ais:terminal symbol. */
export function terminalPassThroughFixture(
  sourceIr: ElectricalIr,
): Readonly<{ ir: ElectricalIr; selected: SelectedSubgraph }> {
  const ir = structuredClone(sourceIr);
  const terminalBlock = ir.devices.find(
    ({ designation }) => designation === "TB1",
  );
  const psu = ir.devices.find(({ designation }) => designation === "PS1");
  if (terminalBlock === undefined || psu === undefined) {
    throw new Error("Terminal fixture devices are absent.");
  }
  const first = { deviceUid: terminalBlock.uid, terminalKey: "1" };
  const second = { deviceUid: terminalBlock.uid, terminalKey: "2" };
  const source = { deviceUid: psu.uid, terminalKey: "+" };
  const firstWire = ir.wires.find(
    ({ designation }) => designation === "W-CTL-003",
  );
  if (firstWire === undefined)
    throw new Error("Terminal fixture wire is absent.");
  const netEntry = ir.indexes.netIdByTerminal.find(({ key }) =>
    sameTerminal(key, first),
  );
  const secondNetEntry = ir.indexes.netIdByTerminal.find(({ key }) =>
    sameTerminal(key, second),
  );
  if (netEntry === undefined || secondNetEntry === undefined) {
    throw new Error("Terminal fixture net index is absent.");
  }
  const netId = netEntry.value;
  const oldNetId = secondNetEntry.value;
  secondNetEntry.value = netId;
  const oldNet = ir.nets.find(({ id }) => id === oldNetId);
  if (oldNet !== undefined) {
    oldNet.terminalIds = oldNet.terminalIds.filter(
      (terminal) => !sameTerminal(terminal, second),
    );
  }
  const net = ir.nets.find(({ id }) => id === netId);
  if (net === undefined) throw new Error("Terminal fixture net is absent.");
  net.terminalIds.push(structuredClone(second));
  const secondWireId = { kind: "wire" as const, uid: "terminal-pass-through" };
  ir.wires.push({
    ...structuredClone(firstWire),
    uid: secondWireId.uid,
    designation: "TERMINAL-PASS-THROUGH",
    endpoints: [
      {
        terminal: structuredClone(first),
        source: structuredClone(firstWire.source),
      },
      {
        terminal: structuredClone(second),
        source: structuredClone(firstWire.source),
      },
    ],
  });
  ir.indexes.terminalIdsByConductiveElement.push({
    key: secondWireId,
    value: [structuredClone(first), structuredClone(second)],
  });
  for (const terminal of [first, second]) {
    const entry = ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameTerminal(key, terminal),
    );
    if (entry === undefined)
      throw new Error("Terminal fixture conductor index is absent.");
    entry.value.push(secondWireId);
  }
  net.conductiveElementIds.push(secondWireId);
  const firstWireId = { kind: "wire" as const, uid: firstWire.uid };
  const potential = ir.potentials.find(({ terminal }) =>
    sameTerminal(terminal, source),
  );
  return {
    ir,
    selected: {
      view: {
        format: "schematic-view/0.1",
        family: "control",
        root: { deviceUid: terminalBlock.uid, designation: "TB1" },
        flow: "left-to-right",
      },
      paths: [
        {
          id: "terminal-pass-through",
          lane: "input",
          start: {
            terminal: source,
            boundary: {
              kind: "potential",
              terminal: source,
              netId,
              ...(potential === undefined
                ? {}
                : { potentialUid: potential.uid }),
              label: potential?.name ?? "PS1.+",
            },
            constraint: "FIRST",
          },
          steps: [
            {
              kind: "conductor",
              elementId: firstWireId,
              from: source,
              to: first,
              netId,
            },
            {
              kind: "conductor",
              elementId: secondWireId,
              from: first,
              to: second,
              netId,
            },
          ],
          end: { terminal: second },
        },
      ],
      deviceUids: [psu.uid, terminalBlock.uid],
      terminalIds: [source, first, second],
      functionIds: [
        { deviceUid: terminalBlock.uid, functionKey: "terminal1" },
        { deviceUid: terminalBlock.uid, functionKey: "terminal2" },
      ],
      conductiveElementIds: [firstWireId, secondWireId],
      netIds: [netId],
    },
  };
}

/**
 * Legal IR fixture where two or three distinct contact functions attach to
 * one shared terminal without any conductor endpoint at that terminal.
 */
export function sharedFunctionTerminalFixture(
  sourceIr: ElectricalIr,
  functionCount: 2 | 3,
): Readonly<{
  ir: ElectricalIr;
  selected: SelectedSubgraph;
  mappings: readonly DeviceTypeSymbolMapping[];
  sharedTerminal: TerminalId;
  sharedNetId: string;
}> {
  const ir = structuredClone(sourceIr);
  const templateType = ir.deviceTypes.find(
    ({ id }) => id === "core:limit-switch-2wire",
  );
  const templateDevice = ir.devices.find(
    ({ designation }) => designation === "LS1",
  );
  if (templateType === undefined || templateDevice === undefined) {
    throw new Error("Shared-terminal fixture templates are absent.");
  }
  const deviceUid = `00000000-0000-4000-8000-00000000000${functionCount}`;
  const typeId = `test:shared-terminal-${functionCount}`;
  const designation = `SHARED${functionCount}`;
  const terminalKeys = ["A", "S", "B", ...(functionCount === 3 ? ["C"] : [])];
  const functionKeys = Array.from(
    { length: functionCount },
    (_, index) => `contact${index + 1}`,
  );
  const terminalPairs = [
    ["A", "S"],
    ["S", "B"],
    ["S", "C"],
  ] as const;
  const terminalTemplate = templateType.terminals[0]!;
  const functionTemplate = templateType.functions[0]!;
  ir.deviceTypes.push({
    ...structuredClone(templateType),
    id: typeId,
    aliases: [],
    terminals: terminalKeys.map((key) => ({
      key,
      ...(key === "S" ? { connectionPolicy: "shared" as const } : {}),
      source: structuredClone(terminalTemplate.source),
    })),
    functions: functionKeys.map((key, index) => ({
      key,
      kind: "contact" as const,
      normal_state: "open" as const,
      terminalKeys: [...terminalPairs[index]!],
      source: structuredClone(functionTemplate.source),
    })),
    internalRelations: [],
  });
  ir.devices.push({
    ...structuredClone(templateDevice),
    uid: deviceUid,
    designation,
    typeId,
    aliases: [],
    location: "TEST",
  });
  const terminals = terminalKeys.map((terminalKey) => ({
    id: { deviceUid, terminalKey },
    ...(terminalKey === "S" ? { connectionPolicy: "shared" as const } : {}),
    source: structuredClone(terminalTemplate.source),
  }));
  ir.terminals.push(...terminals);
  ir.functions.push(
    ...functionKeys.map((functionKey, index) => ({
      id: { deviceUid, functionKey },
      kind: "contact" as const,
      normal_state: "open" as const,
      terminals: terminalPairs[index]!.map((terminalKey) => ({
        deviceUid,
        terminalKey,
      })),
      source: structuredClone(functionTemplate.source),
    })),
  );
  const netIdByTerminal = new Map(
    terminalKeys.map((terminalKey) => [
      terminalKey,
      `test:shared-terminal-${functionCount}:${terminalKey}`,
    ]),
  );
  for (const terminal of terminals) {
    const netId = netIdByTerminal.get(terminal.id.terminalKey)!;
    ir.nets.push({
      id: netId,
      terminalIds: [structuredClone(terminal.id)],
      conductiveElementIds: [],
      potentialUids: [],
    });
    ir.indexes.netIdByTerminal.push({
      key: structuredClone(terminal.id),
      value: netId,
    });
    ir.indexes.conductiveElementIdsByTerminal.push({
      key: structuredClone(terminal.id),
      value: [],
    });
  }
  ir.indexes.terminalIdsByDeviceUid.push({
    key: deviceUid,
    value: terminals.map(({ id }) => structuredClone(id)),
  });
  ir.indexes.objectRefByUid.push({
    key: deviceUid,
    value: { kind: "device", uid: deviceUid },
  });
  ir.indexes.objectRefByDesignation.push({
    key: designation,
    value: { kind: "device", uid: deviceUid },
  });
  ir.indexes.instanceRefsByTypeId.push({
    key: typeId,
    value: [{ kind: "device", uid: deviceUid }],
  });
  const mapping: DeviceTypeSymbolMapping = {
    typeId,
    functions: functionKeys.map((functionKey, index) => ({
      functionKey,
      families: ["control"],
      symbolId: "ais:switch-no",
      bindings: [
        { portId: "in", terminalKey: terminalPairs[index]![0] },
        { portId: "out", terminalKey: terminalPairs[index]![1] },
      ],
      classification: "permissive",
      traversalRole: "permissive-contact",
    })),
    aggregates: [],
    omissions: functionKeys.map((functionKey) => ({
      functionKey,
      families: ["power"],
      reason: "outside-family",
    })),
    boundaryTerminals: [],
  };
  const terminal = (terminalKey: string): TerminalId => ({
    deviceUid,
    terminalKey,
  });
  const functionStep = (index: number, reverse = false) => ({
    kind: "function" as const,
    functionId: { deviceUid, functionKey: functionKeys[index]! },
    from: terminal(terminalPairs[index]![reverse ? 1 : 0]),
    to: terminal(terminalPairs[index]![reverse ? 0 : 1]),
    normalState: "open" as const,
  });
  const path = (
    id: string,
    from: string,
    steps: readonly ReturnType<typeof functionStep>[],
    target: string,
  ) => ({
    id,
    lane: "input",
    start: {
      terminal: terminal(from),
      boundary: {
        kind: "potential" as const,
        terminal: terminal(from),
        netId: netIdByTerminal.get(from)!,
        label: from,
      },
      constraint: "FIRST" as const,
    },
    steps,
    end: { terminal: terminal(target) },
  });
  const paths = [
    path("shared-primary", "A", [functionStep(0), functionStep(1)], "B"),
    ...(functionCount === 3
      ? [path("shared-third", "C", [functionStep(2, true)], "S")]
      : []),
  ];
  const sharedTerminal = terminal("S");
  return {
    ir,
    mappings: [...CORE_DEVICE_TYPE_SYMBOL_MAPPINGS, mapping],
    sharedTerminal,
    sharedNetId: netIdByTerminal.get("S")!,
    selected: {
      view: {
        format: "schematic-view/0.1",
        family: "control",
        root: { deviceUid, designation },
        flow: "left-to-right",
      },
      paths,
      deviceUids: [deviceUid],
      terminalIds: terminalKeys.map(terminal),
      functionIds: functionKeys.map((functionKey) => ({
        deviceUid,
        functionKey,
      })),
      conductiveElementIds: [],
      netIds: terminalKeys.map((key) => netIdByTerminal.get(key)!),
    },
  };
}

/** Complete disjoint-function PNP aggregate with one selected signal conductor. */
export function pnpAggregateFixture(
  sourceIr: ElectricalIr,
): Readonly<{ ir: ElectricalIr; selected: SelectedSubgraph }> {
  const ir = structuredClone(sourceIr);
  const deviceType = ir.deviceTypes.find(
    ({ id }) => id === "core:prox-pnp-3wire",
  );
  const psu = ir.devices.find(({ designation }) => designation === "PS1");
  if (deviceType === undefined || psu === undefined) {
    throw new Error("PNP fixture prerequisites are absent.");
  }
  const deviceUid = "presentation-pnp";
  ir.devices.push({
    uid: deviceUid,
    designation: "PNP1",
    typeId: deviceType.id,
    aliases: [],
    location: "FIELD",
    source: structuredClone(psu.source),
  });
  const pnpTerminals = deviceType.terminals.map((definition) => ({
    id: { deviceUid, terminalKey: definition.key },
    ...(definition.role === undefined ? {} : { role: definition.role }),
    ...(definition.rating === undefined
      ? {}
      : { rating: structuredClone(definition.rating) }),
    ...(definition.connectionPolicy === undefined
      ? {}
      : { connectionPolicy: definition.connectionPolicy }),
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    source: structuredClone(definition.source),
  }));
  ir.terminals.push(...pnpTerminals);
  ir.functions.push(
    ...deviceType.functions.map((definition) => {
      const base = {
        id: { deviceUid, functionKey: definition.key },
        terminals: definition.terminalKeys.map((terminalKey) => ({
          deviceUid,
          terminalKey,
        })),
        source: structuredClone(definition.source),
      };
      if (definition.kind === "contact") {
        return {
          ...base,
          kind: definition.kind,
          normal_state: definition.normal_state,
        };
      }
      if (definition.kind === "channel") {
        return {
          ...base,
          kind: definition.kind,
          direction: definition.direction,
        };
      }
      return { ...base, kind: definition.kind };
    }),
  );
  const source = { deviceUid: psu.uid, terminalKey: "+" };
  const signal = { deviceUid, terminalKey: "4" };
  const sourceNetEntry = ir.indexes.netIdByTerminal.find(({ key }) =>
    sameTerminal(key, source),
  );
  if (sourceNetEntry === undefined)
    throw new Error("PNP source net is absent.");
  const sourceNet = ir.nets.find(({ id }) => id === sourceNetEntry.value);
  if (sourceNet === undefined)
    throw new Error("PNP source net record is absent.");
  const netIds = ["presentation-net-pnp-1", "presentation-net-pnp-3"];
  ir.nets.push(
    {
      id: netIds[0]!,
      terminalIds: [{ deviceUid, terminalKey: "1" }],
      conductiveElementIds: [],
      potentialUids: [],
    },
    {
      id: netIds[1]!,
      terminalIds: [{ deviceUid, terminalKey: "3" }],
      conductiveElementIds: [],
      potentialUids: [],
    },
  );
  sourceNet.terminalIds.push(signal);
  ir.indexes.terminalIdsByDeviceUid.push({
    key: deviceUid,
    value: pnpTerminals.map(({ id }) => structuredClone(id)),
  });
  for (const [terminalKey, netId] of [
    ["1", netIds[0]!],
    ["3", netIds[1]!],
    ["4", sourceNet.id],
  ] as const) {
    const terminal = { deviceUid, terminalKey };
    ir.indexes.netIdByTerminal.push({ key: terminal, value: netId });
    ir.indexes.conductiveElementIdsByTerminal.push({
      key: terminal,
      value: [],
    });
  }
  const templateWire = ir.wires[0];
  if (templateWire === undefined)
    throw new Error("PNP wire template is absent.");
  const wireId = { kind: "wire" as const, uid: "presentation-pnp-signal" };
  ir.wires.push({
    ...structuredClone(templateWire),
    uid: wireId.uid,
    designation: "PNP-SIGNAL",
    endpoints: [
      {
        terminal: structuredClone(source),
        source: structuredClone(templateWire.source),
      },
      {
        terminal: structuredClone(signal),
        source: structuredClone(templateWire.source),
      },
    ],
  });
  ir.indexes.terminalIdsByConductiveElement.push({
    key: wireId,
    value: [source, signal],
  });
  for (const terminal of [source, signal]) {
    const entry = ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
      sameTerminal(key, terminal),
    );
    if (entry === undefined) throw new Error("PNP conductor index is absent.");
    entry.value.push(wireId);
  }
  sourceNet.conductiveElementIds.push(wireId);
  const potential = ir.potentials.find(({ terminal }) =>
    sameTerminal(terminal, source),
  );
  return {
    ir,
    selected: {
      view: {
        format: "schematic-view/0.1",
        family: "control",
        root: { deviceUid, designation: "PNP1" },
        flow: "left-to-right",
      },
      paths: [
        {
          id: "pnp-signal",
          lane: "input",
          start: {
            terminal: source,
            boundary: {
              kind: "potential",
              terminal: source,
              netId: sourceNet.id,
              ...(potential === undefined
                ? {}
                : { potentialUid: potential.uid }),
              label: potential?.name ?? "PS1.+",
            },
            constraint: "FIRST",
          },
          steps: [
            {
              kind: "conductor",
              elementId: wireId,
              from: source,
              to: signal,
              netId: sourceNet.id,
            },
          ],
          end: { terminal: signal },
        },
      ],
      deviceUids: [deviceUid, psu.uid],
      terminalIds: [
        { deviceUid, terminalKey: "1" },
        { deviceUid, terminalKey: "3" },
        signal,
        source,
      ],
      functionIds: [
        { deviceUid, functionKey: "supply" },
        { deviceUid, functionKey: "output" },
      ],
      conductiveElementIds: [wireId],
      netIds: [...netIds, sourceNet.id],
    },
  };
}
