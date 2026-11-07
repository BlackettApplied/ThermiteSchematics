import {
  type TerminalId,
  type FunctionId,
  type ConductiveElementId,
  compareConductiveElementId,
} from "@thermite/compiler";
import {
  type UnsupportedSymbolMappingError,
  unsupportedSymbolMappingError,
} from "../errors.js";
import {
  sameTerminal,
  cloneFunction,
  conductorKey,
  cloneTerminal,
  addTerminal,
  cloneConductor,
} from "../internal.js";
import {
  functionIdKey,
  terminalIdKey,
  compareText,
  compareDeviceUid,
  compareFunctionId,
} from "../ordering.js";
import { validateMaterializedFunctionFacts } from "../symbols/validate.js";
import type { SelectedSubgraph } from "../types.js";
import {
  deviceTypeFor,
  compareCompleteTerminal,
  unsupportedRoot,
  designationFor,
  functionMappingOrder,
} from "./context.js";
import type {
  SelectedIdentities,
  SymbolMappingContext,
  SelectionContext,
  SearchSuccess,
} from "./contracts.js";

export function terminalDisplayFunctionId(
  context: SymbolMappingContext,
  terminal: TerminalId,
  invalidMapping: (detail: string) => never,
  family: "control" | "power" = "control",
): FunctionId | undefined {
  const device = context.deviceByUid.get(terminal.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (device === undefined || mapping === undefined) return undefined;
  const rules = mapping.functions.filter(
    (rule) =>
      rule.families.includes(family) &&
      rule.traversalRole === "terminal-display" &&
      rule.bindings.some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      ),
  );
  if (rules.length === 0) return undefined;
  if (rules.length !== 1) {
    invalidMapping(
      `${device.typeId}.${terminal.terminalKey} has ambiguous terminal-display mappings.`,
    );
  }
  const rule = rules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  if (
    materialized === undefined ||
    materialized.terminals.length !== 1 ||
    !sameTerminal(materialized.terminals[0]!, terminal)
  ) {
    invalidMapping(
      `${device.typeId}.${rule.functionKey} is not an exact one-terminal display function.`,
    );
  }
  validateMaterializedFunctionFacts(
    deviceTypeFor(context, device),
    materialized,
  );
  return cloneFunction(materialized.id);
}

export function pathTerminalDisplayFunctionIds(
  context: SelectionContext,
  selections: readonly SearchSuccess[],
  invalidMapping: (detail: string) => never,
  rootFunctionIds: readonly FunctionId[] = [],
):
  | { readonly ok: true; readonly value: readonly FunctionId[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const endpoints = new Set<string>();
  const touched = new Map<string, TerminalId>();
  const selectedFunctions = new Map(
    rootFunctionIds.map((id) => [functionIdKey(id), id]),
  );
  for (const { path } of selections) {
    endpoints.add(terminalIdKey(path.start.terminal));
    endpoints.add(terminalIdKey(path.end.terminal));
    for (const step of path.steps) {
      if (step.kind === "function")
        selectedFunctions.set(functionIdKey(step.functionId), step.functionId);
      touched.set(terminalIdKey(step.from), step.from);
      touched.set(terminalIdKey(step.to), step.to);
    }
  }
  for (const selection of selections)
    for (const id of selection.candidate.functionIds)
      selectedFunctions.set(functionIdKey(id), id);
  // Function steps already own their terminals. Only physical pass-throughs
  // without a selected owner need an implicit terminal-display mapping.
  for (const id of selectedFunctions.values())
    for (const terminal of context.functionByKey.get(functionIdKey(id))!
      .terminals)
      endpoints.add(terminalIdKey(terminal));
  const ids: FunctionId[] = [];
  for (const terminal of [...touched.values()].sort((left, right) =>
    compareCompleteTerminal(context, left, right),
  )) {
    if (endpoints.has(terminalIdKey(terminal))) continue;
    const functionId = terminalDisplayFunctionId(
      context,
      terminal,
      invalidMapping,
      context.view.family,
    );
    if (functionId === undefined) {
      const device = context.deviceByUid.get(terminal.deviceUid);
      if (device === undefined) {
        throw new Error(
          "Selected path terminal device is absent from ElectricalIr.",
        );
      }
      // Keep the existing profile/binding diagnostic for a type with no rooted
      // representation of this terminal in any family. The new refusal is for
      // a supported function that is unselected in this particular view.
      const mapping = context.mappingByTypeId.get(device.typeId);
      if (
        ![...(mapping?.functions ?? []), ...(mapping?.aggregates ?? [])].some(
          (rule) =>
            rule.bindings.some(
              (binding) => binding.terminalKey === terminal.terminalKey,
            ),
        )
      )
        return unsupportedRoot(context, device);
      return {
        ok: false,
        error: unrepresentedTerminalError(
          context,
          terminal,
          selections,
          rootFunctionIds,
        ),
      };
    }
    ids.push(functionId);
  }
  return { ok: true, value: Object.freeze(ids) };
}

function unrepresentedTerminalError(
  context: SelectionContext,
  terminal: TerminalId,
  selections: readonly SearchSuccess[],
  rootFunctionIds: readonly FunctionId[],
): UnsupportedSymbolMappingError {
  const device = context.deviceByUid.get(terminal.deviceUid)!;
  const steps = new Map(
    selections.flatMap(({ path }) =>
      path.steps.flatMap((step) =>
        step.kind === "conductor"
          ? [[conductorKey(step.elementId), step] as const]
          : [],
      ),
    ),
  );
  const metadata = (id: ConductiveElementId) => {
    if (id.kind === "cable_conductor")
      return {
        kind: "cable-conductor" as const,
        cableUid: id.cableUid,
        cableDesignation: context.ir.cables.find((c) => c.uid === id.cableUid)!
          .designation,
        conductorId: id.conductorId,
      };
    const object = (
      id.kind === "wire" ? context.ir.wires : context.ir.jumpers
    ).find((c) => c.uid === id.uid)!;
    return {
      kind: id.kind,
      uid: id.uid,
      designation: object.designation ?? object.uid,
    };
  };
  const name = (id: ConductiveElementId) => {
    const c = metadata(id);
    return c.kind === "cable-conductor"
      ? `${c.cableDesignation}/${c.conductorId}`
      : c.designation;
  };
  const incident = [...steps.values()].filter(
    (step) =>
      sameTerminal(step.from, terminal) || sameTerminal(step.to, terminal),
  );
  const conductors = incident
    .sort((a, b) => compareConductiveElementId(a.elementId, b.elementId))
    .map((step) => metadata(step.elementId));
  const names = incident.map((step) => name(step.elementId)).sort(compareText);
  const functions = rootFunctionIds
    .filter((id) => id.deviceUid === context.view.root.deviceUid)
    .map((id) => ({
      device: { by: "designation", value: context.view.root.designation },
      key: id.functionKey,
    }));
  return {
    ...unsupportedSymbolMappingError({
      family: context.view.family,
      root: context.view.root.designation,
      deviceUid: device.uid,
      typeId: device.typeId,
    }),
    message: `Unsupported terminal representation: ${device.designation}.${terminal.terminalKey} on ${JSON.stringify(device.typeId)} is incident to selected conductors ${names.join(", ")} but has no selected function, mapped terminal-display symbol, or boundary representation in this rooted view. Use a circuit view to draw these conductors with their real endpoint terminals. Put details.alternative in the views array of a schematic-packet-request/0.1 file and run thermite packet --input <file>. The alternative selects ${functions.map((f) => `${f.device.value}.${f.key}`).join(", ")}.`,
    details: {
      reason: "unrepresented-terminal",
      designation: device.designation,
      terminalIds: [cloneTerminal(terminal)],
      conductors,
      alternative: {
        format: "circuit-view-request/0.1",
        title: `${context.view.root.designation} selected conductors`,
        flow: context.view.flow,
        groups: [
          {
            id: "selected-path",
            functions,
            conductors: [...steps.values()]
              .map((step) => name(step.elementId))
              .sort(compareText),
          },
        ],
      },
    },
  };
}

export function buildSelectedSubgraph(
  context: SelectionContext,
  selections: readonly SearchSuccess[],
  rootFunctionIds: readonly FunctionId[],
  provenanceNetIds: readonly string[] = [],
): SelectedSubgraph {
  const terminalIds = new Map<string, TerminalId>();
  const functionIds = new Map<string, FunctionId>();
  const conductiveIds = new Map<string, ConductiveElementId>();
  const netIds = new Set<string>(provenanceNetIds);

  for (const id of rootFunctionIds) {
    functionIds.set(functionIdKey(id), cloneFunction(id));
  }
  for (const selection of selections) {
    addTerminal(terminalIds, selection.path.start.terminal);
    addTerminal(terminalIds, selection.path.end.terminal);
    if (selection.path.start.boundary !== undefined) {
      netIds.add(selection.path.start.boundary.netId);
    }
    if (selection.path.end.boundary !== undefined) {
      netIds.add(selection.path.end.boundary.netId);
    }
    for (const id of selection.candidate.functionIds) {
      functionIds.set(functionIdKey(id), cloneFunction(id));
    }
    for (const step of selection.path.steps) {
      addTerminal(terminalIds, step.from);
      addTerminal(terminalIds, step.to);
      if (step.kind === "conductor") {
        conductiveIds.set(
          conductorKey(step.elementId),
          cloneConductor(step.elementId),
        );
        netIds.add(step.netId);
      } else {
        functionIds.set(
          functionIdKey(step.functionId),
          cloneFunction(step.functionId),
        );
      }
    }
  }
  for (const id of functionIds.values()) {
    const materialized = context.functionByKey.get(functionIdKey(id));
    if (materialized === undefined) {
      throw new Error(
        `Selected function ${functionIdKey(id)} is absent from ElectricalIr.`,
      );
    }
    for (const terminal of materialized.terminals) {
      addTerminal(terminalIds, terminal);
    }
  }

  const deviceUids = new Set<string>([context.view.root.deviceUid]);
  for (const terminal of terminalIds.values()) {
    deviceUids.add(terminal.deviceUid);
  }
  for (const id of functionIds.values()) deviceUids.add(id.deviceUid);

  return Object.freeze({
    view: context.view,
    paths: Object.freeze(selections.map(({ path }) => path)),
    ...selectedIdentities(
      context,
      deviceUids,
      terminalIds,
      functionIds,
      conductiveIds,
      netIds,
    ),
  });
}

/** Exact selected identities, detached and frozen in the established order.
 * Does not traverse: callers supply the conductor set and provenance nets. */
export function selectedIdentities(
  context: SymbolMappingContext,
  deviceUids: ReadonlySet<string>,
  terminalIds: ReadonlyMap<string, TerminalId>,
  functionIds: ReadonlyMap<string, FunctionId>,
  conductiveIds: ReadonlyMap<string, ConductiveElementId>,
  netIds: ReadonlySet<string>,
): SelectedIdentities {
  const sortedDevices = [...deviceUids].sort((left, right) =>
    compareDeviceUid(left, right, (uid) => designationFor(context, uid)),
  );
  const sortedTerminals = [...terminalIds.values()].sort((left, right) =>
    compareCompleteTerminal(context, left, right),
  );
  const sortedFunctions = [...functionIds.values()].sort((left, right) =>
    compareFunctionId(
      left,
      right,
      (uid) => designationFor(context, uid),
      (id) => functionMappingOrder(context, id),
    ),
  );
  const sortedConductors = [...conductiveIds.values()].sort(
    compareConductiveElementId,
  );
  const sortedNets = [...netIds].sort(compareText);

  return {
    deviceUids: Object.freeze(sortedDevices),
    terminalIds: Object.freeze(sortedTerminals.map(cloneTerminal)),
    functionIds: Object.freeze(sortedFunctions.map(cloneFunction)),
    conductiveElementIds: Object.freeze(sortedConductors.map(cloneConductor)),
    netIds: Object.freeze(sortedNets),
  };
}
