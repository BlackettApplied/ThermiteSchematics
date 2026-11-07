import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import { symbolFunctionMatchesShape } from "@thermite/compiler";
import { symbolProfile, SYMBOL_PROFILES } from "@thermite/schema";
import type { Conductor, SignalLoopViewRequest } from "../signal-loop.js";
import {
  terminalKey as key,
  readLoopPolarity,
  terminalRole,
  polarityTerminal,
  assertLoopPolarityEntry,
} from "./polarity.js";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const selector = (v: unknown) =>
  record(v) &&
  Object.keys(v).length === 2 &&
  ["device", "function"].every(
    (k) => typeof v[k] === "string" && (v[k] as string).trim(),
  );
const shortString = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const assembliesValid = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) &&
    v.length <= 7 &&
    v.every(
      (a) =>
        record(a) &&
        Object.keys(a).length === 3 &&
        shortString(a.cable, 100) &&
        shortString(a.connector, 8) &&
        shortString(a.description, 120),
    ));
const enclosuresValid = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) &&
    v.length <= 4 &&
    v.every(
      (e) =>
        record(e) &&
        Object.keys(e).every((k) =>
          ["label", "devices", "wallDevice"].includes(k),
        ) &&
        shortString(e.label, 80) &&
        Array.isArray(e.devices) &&
        e.devices.length > 0 &&
        e.devices.length <= 8 &&
        e.devices.every((d) => shortString(d, 100)) &&
        (e.wallDevice === undefined || shortString(e.wallDevice, 100)),
    ));

export function validateSignalLoopRequest(request: SignalLoopViewRequest) {
  if (
    record(request) &&
    Object.hasOwn(request, "loopPower") &&
    !selector(request.loopPower)
  )
    throw new Error(
      "Invalid signal loop loopPower selector; expected {device, function}.",
    );
  if (
    !record(request) ||
    request.format !== "signal-loop-view-request/0.1" ||
    Object.keys(request).some(
      (k) =>
        ![
          "format",
          "from",
          "to",
          "flow",
          "notes",
          "auxiliary",
          "cableAssemblies",
          "enclosures",
          "loopPower",
        ].includes(k),
    ) ||
    !selector(request.from) ||
    !selector(request.to) ||
    (request.auxiliary !== undefined &&
      (!Array.isArray(request.auxiliary) ||
        request.auxiliary.length > 2 ||
        request.auxiliary.some(
          (a) =>
            !record(a) ||
            Object.keys(a).length !== 2 ||
            !selector(a.from) ||
            !selector(a.to),
        ))) ||
    !assembliesValid(request.cableAssemblies) ||
    !enclosuresValid(request.enclosures) ||
    (request.flow !== undefined &&
      !["left-to-right", "top-to-bottom"].includes(request.flow)) ||
    (request.notes !== undefined &&
      (!Array.isArray(request.notes) ||
        request.notes.length > 6 ||
        request.notes.some(
          (s) => typeof s !== "string" || !s.trim() || s.length > 240,
        )))
  )
    throw new Error(
      "Invalid signal loop request; check selectors, flow, notes, cable assemblies and enclosures.",
    );
}

export interface LoopFunction {
  device: IrDevice;
  function: IrFunction;
  type: IrDeviceType;
}
export interface Leg {
  terminals: TerminalId[];
  edges: Conductor[];
}
const topology =
  "Series loop requires exactly one unbranched physical leg between each selected function pair on three distinct nets.";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error(topology);
  return value;
}

function resolvePower(
  ir: Readonly<ElectricalIr>,
  spec: NonNullable<SignalLoopViewRequest["loopPower"]>,
): LoopFunction {
  const matches = ir.devices.filter(
    (d) => d.uid === spec.device || d.designation === spec.device,
  );
  if (matches.length !== 1)
    throw new Error(
      `Loop power device ${JSON.stringify(spec.device)} does not resolve uniquely.`,
    );
  const device = required(matches[0]);
  const type = required(ir.deviceTypes.find((t) => t.id === device.typeId));
  const fn = ir.functions.find(
    (f) => f.id.deviceUid === device.uid && f.id.functionKey === spec.function,
  );
  const shapeError = `Loop power ${device.designation}.${spec.function} must identify a two-terminal source with the thermite:dc-supply profile or a registered alias.`;
  if (
    !fn ||
    fn.kind !== "source" ||
    fn.terminals.length !== 2 ||
    symbolProfile(type) !== "thermite:dc-supply"
  )
    throw new Error(shapeError);
  const [a, b] = fn.terminals.map((t) => terminalRole(ir, t));
  if (a !== "dc_positive_output" || b !== "dc_return_output")
    throw new Error(
      `Series loop power ${device.designation}.${spec.function}: expected dc_positive_output then dc_return_output in authored function order; found ${polarityTerminal(ir, required(fn.terminals[0]))} and ${polarityTerminal(ir, required(fn.terminals[1]))}.`,
    );
  const support = SYMBOL_PROFILES.find(
    (p) => p.id === symbolProfile(type),
  )?.support.find(
    (s) => s.family === "signal-loop" && s.role === "series-power",
  );
  const definition = type.functions.find((f) => f.key === fn.id.functionKey);
  if (
    !definition ||
    !support?.functions.some((s) =>
      symbolFunctionMatchesShape(type, definition, s),
    )
  )
    throw new Error(shapeError);
  return { device, function: fn, type };
}

function adjacency(conductors: readonly Conductor[]) {
  const adjacent = new Map<string, Conductor[]>();
  for (const c of conductors)
    for (const t of c.ends) {
      const list = adjacent.get(key(t)) ?? [];
      list.push(c);
      adjacent.set(key(t), list);
    }
  return adjacent;
}

/** Physical conductors only. Traversing a function is never a graph operation. */
function pathBetween(
  start: TerminalId,
  target: TerminalId,
  adjacent: ReturnType<typeof adjacency>,
  excluded?: string,
): Leg | undefined {
  const queue: Leg[] = [{ terminals: [start], edges: [] }];
  const visited = new Set([key(start)]);
  for (const path of queue) {
    const current = required(path.terminals.at(-1));
    if (key(current) === key(target)) return path;
    for (const c of adjacent.get(key(current)) ?? []) {
      if (c.id === excluded) continue;
      const next = required(c.ends.find((t) => key(t) !== key(current)));
      if (visited.has(key(next))) continue;
      visited.add(key(next));
      queue.push({
        terminals: [...path.terminals, next],
        edges: [...path.edges, c],
      });
    }
  }
  return undefined;
}

function selectLegs(
  ir: Readonly<ElectricalIr>,
  functions: readonly LoopFunction[],
  adjacent: ReturnType<typeof adjacency>,
) {
  if (
    new Set(functions.flatMap((f) => f.function.terminals.map(key))).size !== 6
  )
    throw new Error(topology);
  const nets = new Map(
    ir.nets.flatMap((n) => n.terminalIds.map((t) => [key(t), n.id] as const)),
  );
  const pairs = new Map<string, { terminal: TerminalId; owner: number }[]>();
  functions.forEach((f, owner) =>
    f.function.terminals.forEach((terminal) => {
      const net = nets.get(key(terminal));
      if (!net) throw new Error(topology);
      const group = pairs.get(net) ?? [];
      group.push({ terminal, owner });
      pairs.set(net, group);
    }),
  );
  if (pairs.size !== 3) throw new Error(topology);
  const functionPairs = new Set<string>();
  const legs = [...pairs.values()].map((pair) => {
    const a = required(pair[0]),
      b = required(pair[1]);
    if (pair.length !== 2 || a.owner === b.owner) throw new Error(topology);
    functionPairs.add(JSON.stringify([a.owner, b.owner].sort()));
    const path = pathBetween(a.terminal, b.terminal, adjacent);
    if (
      !path ||
      path.edges.some((c) =>
        pathBetween(a.terminal, b.terminal, adjacent, c.id),
      )
    )
      throw new Error(topology);
    if (path.edges.some((c) => c.spare))
      throw new Error(
        "An active signal path uses a core explicitly marked spare.",
      );
    return path;
  });
  if (functionPairs.size !== 3) throw new Error(topology);
  return legs;
}

function intermediateStages(leg: Leg) {
  const stages = leg.terminals.map((t) => t.deviceUid);
  return stages.slice(1, -1);
}

function checkLegSources(
  ir: Readonly<ElectricalIr>,
  legs: readonly Leg[],
  power: LoopFunction,
) {
  const terminals = new Set(legs.flatMap((p) => p.terminals.map(key)));
  for (const fn of ir.functions) {
    if (
      fn.kind !== "source" ||
      (fn.id.deviceUid === power.function.id.deviceUid &&
        fn.id.functionKey === power.function.id.functionKey)
    )
      continue;
    const terminal = fn.terminals.find((t) => terminals.has(key(t)));
    if (!terminal) continue;
    const device = required(ir.devices.find((d) => d.uid === fn.id.deviceUid));
    throw new Error(
      `Series loop terminal ${device.designation}.${terminal.terminalKey} belongs to source function ${device.designation}.${fn.id.functionKey}; selected loop power is ${power.device.designation}.${power.function.id.functionKey}.`,
    );
  }
}

function checkStages(
  ir: Readonly<ElectricalIr>,
  legs: readonly Leg[],
  from: LoopFunction,
) {
  const fields = legs.filter((p) =>
    p.terminals.some((t) => t.deviceUid === from.device.uid),
  );
  const chains = fields.map(intermediateStages);
  const [a, b] = chains;
  const supported = (uid: string) => {
    const device = ir.devices.find((d) => d.uid === uid);
    const type = ir.deviceTypes.find((t) => t.id === device?.typeId);
    return ["thermite:bulkhead-connector", "thermite:terminal-strip"].includes(
      symbolProfile(type ?? {}) ?? "",
    );
  };
  if (
    !a ||
    !b ||
    JSON.stringify(a) !== JSON.stringify(b) ||
    a.some((uid) => !supported(uid)) ||
    new Set(a).size !== a.length
  )
    throw new Error(
      "Series loop field legs must follow the same ordered feed-through stages.",
    );
  const third = required(legs.find((p) => !fields.includes(p)));
  const chain = intermediateStages(third);
  if (
    chain.some((uid) => !supported(uid)) ||
    new Set(chain).size !== chain.length
  )
    throw new Error(
      "Series loop third leg must be an unbranched supported feed-through chain.",
    );
  const stages = [
    ...new Set(legs.flatMap((p) => p.terminals.map((t) => t.deviceUid))),
  ];
  if (stages.length > 8)
    throw new Error("Series loop exceeds eight displayed devices.");
  return stages;
}

function branchError(ir: Readonly<ElectricalIr>, terminal: TerminalId): never {
  const device = required(ir.devices.find((d) => d.uid === terminal.deviceUid));
  throw new Error(
    `Series loop has an additional connection at ${device.designation}.${terminal.terminalKey}; use a circuit view that includes the branch.`,
  );
}

function supplyBranches(
  ir: Readonly<ElectricalIr>,
  power: LoopFunction,
  legs: readonly Leg[],
  adjacent: ReturnType<typeof adjacency>,
) {
  const selected = new Set(legs.flatMap((p) => p.edges.map((e) => e.id)));
  const supply = new Set(power.function.terminals.map(key));
  const branches: {
    terminal: TerminalId;
    conductor: Conductor;
    destination: TerminalId;
  }[] = [];
  for (const leg of legs)
    for (const terminal of leg.terminals) {
      for (const conductor of adjacent.get(key(terminal)) ?? []) {
        if (selected.has(conductor.id)) continue;
        if (!supply.has(key(terminal)) || conductor.cable)
          branchError(ir, terminal);
        const destination = required(
          conductor.ends.find((t) => key(t) !== key(terminal)),
        );
        // Net pairing and path uniqueness already rule out reconnecting to a leg.
        // Walk the remaining outside component to detect authored source functions.
        const queue = [destination],
          seen = new Set([key(terminal)]);
        for (const node of queue) {
          if (seen.has(key(node))) continue;
          seen.add(key(node));
          if (
            ir.functions.some(
              (f) =>
                f.kind === "source" &&
                f.terminals.some((t) => key(t) === key(node)),
            )
          )
            branchError(ir, terminal);
          for (const edge of adjacent.get(key(node)) ?? [])
            for (const end of edge.ends)
              if (!seen.has(key(end))) queue.push(end);
        }
        branches.push({ terminal, conductor, destination });
      }
    }
  return branches.sort((a, b) => compare(a.conductor.id, b.conductor.id));
}

function completeCableInventory(
  ir: Readonly<ElectricalIr>,
  legs: readonly Leg[],
  all: readonly Conductor[],
  adjacent: ReturnType<typeof adjacency>,
) {
  const selected = new Map(
    legs.flatMap((p) => p.edges.map((e) => [e.id, e] as const)),
  );
  const cables = new Set(
    [...selected.values()].flatMap((c) => (c.cable ? [c.cable] : [])),
  );
  const adjacentDevices = new Set(
    legs.flatMap((p) =>
      p.edges.map((e) => JSON.stringify(e.ends.map((t) => t.deviceUid).sort())),
    ),
  );
  for (const uid of cables) {
    const cable = required(ir.cables.find((c) => c.uid === uid));
    const definition = required(
      ir.cableTypes.find((c) => c.id === cable.typeId),
    );
    if (
      definition.conductors.some(
        (core) =>
          !cable.assignments?.some(
            (a) => a.id === core.id && a.endpoints.every(Boolean),
          ),
      )
    )
      throw new Error(
        `Cable ${cable.designation} has unassigned or loose cores; use its conductor view to resolve them before generating this loop view.`,
      );
    for (const c of all.filter((c) => c.cable === uid)) {
      if (
        !adjacentDevices.has(
          JSON.stringify(c.ends.map((t) => t.deviceUid).sort()),
        )
      )
        throw new Error(
          "A cable leaves the selected device chain; select a view that includes its complete endpoints.",
        );
      if (!selected.has(c.id) && !c.spare)
        throw new Error(
          "A cable has an additional active core outside this two-wire loop; use a complete conductor view.",
        );
      selected.set(c.id, c);
    }
  }
  const pathTerminals = new Set(legs.flatMap((p) => p.terminals.map(key)));
  for (const c of selected.values())
    for (const terminal of c.ends)
      if (
        !pathTerminals.has(key(terminal)) &&
        (adjacent.get(key(terminal)) ?? []).some((e) => !selected.has(e.id))
      )
        branchError(ir, terminal);
  return [...selected.values()].sort((a, b) => compare(a.id, b.id));
}

function verifyPolarity(
  ir: Readonly<ElectricalIr>,
  from: LoopFunction,
  to: LoopFunction,
  power: LoopFunction,
  legs: readonly Leg[],
) {
  const unverifiedEndpoints = [from, to]
    .filter(
      (f, i) =>
        !readLoopPolarity(
          ir,
          f.function.terminals,
          i === 0 ? "transmitter" : "input",
        ),
    )
    .sort(
      (a, b) =>
        compare(a.device.designation, b.device.designation) ||
        compare(a.function.id.functionKey, b.function.id.functionKey),
    )
    .map((f) => `${f.device.designation}.${f.function.id.functionKey}`);
  let departure = required(power.function.terminals[0]);
  const visited = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const leg = required(
      legs.find((p) =>
        [p.terminals[0], p.terminals.at(-1)].some(
          (t) => t && key(t) === key(departure),
        ),
      ),
    );
    const arrival = required(
      key(required(leg.terminals[0])) === key(departure)
        ? leg.terminals.at(-1)
        : leg.terminals[0],
    );
    const target = required(
      [from, to, power].find((f) =>
        f.function.terminals.some((t) => key(t) === key(arrival)),
      ),
    );
    if (target === power) {
      if (
        i !== 2 ||
        key(arrival) !== key(required(power.function.terminals[1]))
      )
        throw new Error(topology);
      break;
    }
    if (visited.has(target.device.uid)) throw new Error(topology);
    visited.add(target.device.uid);
    assertLoopPolarityEntry(
      ir,
      departure,
      arrival,
      readLoopPolarity(
        ir,
        target.function.terminals,
        target === from ? "transmitter" : "input",
      ),
      "Series loop polarity",
    );
    // Orientation only: this relation never enters the conductive graph or IR.
    departure = required(
      target.function.terminals.find((t) => key(t) !== key(arrival)),
    );
  }
  return { unverifiedEndpoints };
}

export function selectSeriesLoop(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
  from: LoopFunction,
  to: LoopFunction,
  input: boolean,
  conductors: readonly Conductor[],
) {
  const power = resolvePower(ir, required(request.loopPower));
  if (!input || (request.auxiliary?.length ?? 0) > 0)
    throw new Error(
      "Series loop power is supported only for input views without auxiliary pairs.",
    );
  const adjacent = adjacency(conductors);
  const legs = selectLegs(ir, [from, to, power], adjacent);
  checkLegSources(ir, legs, power);
  const stages = checkStages(ir, legs, from);
  const branches = supplyBranches(ir, power, legs, adjacent);
  const shown = completeCableInventory(ir, legs, conductors, adjacent);
  const polarity = verifyPolarity(ir, from, to, power, legs);
  return {
    power,
    legs,
    stages,
    conductors: shown,
    supplyBranches: branches,
    polarity,
  };
}
