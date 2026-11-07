// Conductors family selection: selectCableConductors and selectCableConductorSubgraph.
import type {
  IrDevice,
  TerminalId,
  FunctionId,
  ConductiveElementId,
} from "@thermite/compiler";
import {
  InvalidSymbolMappingError,
  incompleteConductorsPathError,
  type UnsupportedSymbolMappingError,
  unsupportedSymbolMappingError,
} from "../errors.js";
import {
  sameTerminal,
  withStoppedTerminals,
  sameEndpointPair,
  conductorKey,
  addTerminal,
  cloneConductor,
  cloneTerminal,
} from "../internal.js";
import { compareText, functionIdKey } from "../ordering.js";
import { projectDeviceTypeSymbolMappings } from "../symbols/mappings.js";
import type { SelectedPath } from "../types.js";
import {
  selectedIdentities,
  terminalDisplayFunctionId,
} from "./conservation.js";
import {
  createSymbolMappingContext,
  compareCompleteTerminal,
} from "./context.js";
import type {
  IncompleteCableConductorSelectionError,
  SymbolMappingContext,
  SelectCableConductorsRequest,
  SelectCableConductorsResult,
  SelectCableConductorSubgraphRequest,
  SelectCableConductorSubgraphResult,
} from "./contracts.js";

function invalidCableMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid cable mapping: ${detail}`);
}

function incompleteCableConductorSelectionError(
  cableUid: string,
  designation: string,
): IncompleteCableConductorSelectionError {
  return incompleteConductorsPathError(
    cableUid,
    designation,
  ) as IncompleteCableConductorSelectionError;
}

function unsupportedCableEndpoint(
  context: SymbolMappingContext,
  device: IrDevice,
  root: string,
  terminal: TerminalId,
): { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const functionKey = context.ir.functions.find(
    (f) =>
      f.id.deviceUid === device.uid &&
      f.terminals.some((t) => sameTerminal(t, terminal)),
  )?.id.functionKey;
  return Object.freeze({
    ok: false,
    error: withStoppedTerminals(
      unsupportedSymbolMappingError({
        family: "control",
        deviceUid: device.uid,
        typeId: device.typeId,
        ...(functionKey ? { functionKey } : {}),
        root,
      }),
      [terminal],
    ),
  });
}

export function selectCableConductors(
  request: SelectCableConductorsRequest,
): SelectCableConductorsResult {
  const queried = request.engine.cable(request.root);
  if (!queried.ok) return queried;
  const { cable, conductors } = queried.value;
  const authoredCable = request.ir.cables.find(({ uid }) => uid === cable.uid);
  if (
    authoredCable === undefined ||
    authoredCable.designation !== cable.designation ||
    authoredCable.typeId !== cable.typeId
  ) {
    throw new Error("Query cable identity disagrees with ElectricalIr.");
  }
  if (conductors.length === 0) {
    return Object.freeze({
      ok: false,
      error: incompleteCableConductorSelectionError(
        cable.uid,
        cable.designation,
      ),
    });
  }

  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const context = createSymbolMappingContext(request.ir, mappings);
  const orderedConductors = [...conductors].sort((left, right) =>
    compareText(left.id.conductorId, right.id.conductorId),
  );
  const paths: SelectedPath[] = [];
  const terminalIds = new Map<string, TerminalId>();
  const functionIds = new Map<string, FunctionId>();
  const conductiveElementIds = new Map<string, ConductiveElementId>();
  const netIds = new Set<string>();
  const seenConductorIds = new Set<string>();

  for (const conductor of orderedConductors) {
    if (
      conductor.id.cableUid !== cable.uid ||
      seenConductorIds.has(conductor.id.conductorId)
    ) {
      throw new Error("Query cable conductor identity is inconsistent.");
    }
    seenConductorIds.add(conductor.id.conductorId);
    const elementId: ConductiveElementId = {
      kind: "cable_conductor",
      cableUid: cable.uid,
      conductorId: conductor.id.conductorId,
    };
    const authoredConductor = request.ir.cableConductors.find(
      ({ id }) =>
        id.cableUid === cable.uid &&
        id.conductorId === conductor.id.conductorId,
    );
    const queryEndpoints = conductor.endpoints.map(({ id }) => id) as [
      TerminalId,
      TerminalId,
    ];
    if (
      authoredConductor === undefined ||
      !sameEndpointPair(
        [
          authoredConductor.endpoints[0].terminal,
          authoredConductor.endpoints[1].terminal,
        ],
        queryEndpoints,
      )
    ) {
      throw new Error(
        `Query cable endpoints disagree with ElectricalIr for ${conductorKey(elementId)}.`,
      );
    }
    const [start, end] = [...queryEndpoints].sort((left, right) =>
      compareCompleteTerminal(context, left, right),
    ) as [TerminalId, TerminalId];

    for (const terminal of [start, end]) {
      addTerminal(terminalIds, terminal);
      const device = context.deviceByUid.get(terminal.deviceUid);
      if (device === undefined) {
        throw new Error(
          "Cable endpoint terminal device is absent from ElectricalIr.",
        );
      }
      const functionId = terminalDisplayFunctionId(
        context,
        terminal,
        invalidCableMapping,
      );
      if (functionId === undefined) {
        return unsupportedCableEndpoint(
          context,
          device,
          cable.designation,
          terminal,
        );
      }
      functionIds.set(functionIdKey(functionId), functionId);
    }

    const clonedElementId = cloneConductor(elementId);
    conductiveElementIds.set(conductorKey(elementId), clonedElementId);
    netIds.add(conductor.net.id);
    paths.push(
      Object.freeze({
        id: `cable:${conductor.id.conductorId}`,
        lane: conductor.id.conductorId,
        start: Object.freeze({ terminal: cloneTerminal(start) }),
        steps: Object.freeze([
          Object.freeze({
            kind: "conductor",
            elementId: clonedElementId,
            from: cloneTerminal(start),
            to: cloneTerminal(end),
            netId: conductor.net.id,
          }),
        ]),
        end: Object.freeze({ terminal: cloneTerminal(end) }),
      }),
    );
  }

  const devices = new Set(
    [...terminalIds.values()].map(({ deviceUid }) => deviceUid),
  );

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cableUid: cable.uid,
      designation: cable.designation,
      paths: Object.freeze(paths),
      ...selectedIdentities(
        context,
        devices,
        terminalIds,
        functionIds,
        conductiveElementIds,
        netIds,
      ),
    }),
  });
}

export function selectCableConductorSubgraph(
  request: SelectCableConductorSubgraphRequest,
): SelectCableConductorSubgraphResult {
  const selected = selectCableConductors(request);
  if (!selected.ok) return selected;
  if (
    selected.value.cableUid !== request.view.root.cableUid ||
    selected.value.designation !== request.view.root.designation
  ) {
    throw new Error("Normalized cable root identity is inconsistent.");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      view: request.view,
      paths: selected.value.paths,
      deviceUids: selected.value.deviceUids,
      terminalIds: selected.value.terminalIds,
      functionIds: selected.value.functionIds,
      conductiveElementIds: selected.value.conductiveElementIds,
      netIds: selected.value.netIds,
    }),
  });
}
