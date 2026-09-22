import { posix } from "node:path";

import {
  appendJsonPointer,
  normalizeDiagnosticFile,
  parseJson,
} from "@thermite/schema";

import type {
  ExpansionResult,
  FunctionId,
  IrCable,
  IrCableType,
  IrDevice,
  IrDeviceType,
  IrFunction,
  IrGangedGroup,
  IrInternalRelation,
  IrTerminal,
} from "./expansion.js";
import type {
  CableConductorId,
  ConductiveElementId,
  GraphNormalizationResult,
  InstanceRef,
  IrCableConductor,
  IrIndexes,
  IrJumper,
  IrPotential,
  IrProjectRelation,
  IrWire,
} from "./graph.js";
import { stringifyJson, type JsonKeyOrder } from "./canonical-json.js";
import type {
  LoadedDocument,
  LoadedLibrary,
  LoadedProject,
  NormalizedLibraryLock,
} from "./loader.js";
import type { IrNet, NetDerivationResult } from "./nets.js";
import type { SourceRef, TerminalId } from "./resolution.js";

export interface IrProject {
  name: string;
  description?: string;
  source: SourceRef;
}

export interface IrLibraryFile {
  path: string;
  integrity: string;
  source: SourceRef;
}

export interface IrLibrary {
  name: string;
  version: string;
  path: string;
  resolutionKind: "local" | "shipped";
  integrity: string;
  files: IrLibraryFile[];
  source: SourceRef;
  manifestSource: SourceRef;
}

export interface ElectricalIr {
  format: "electrical-ir/0.1";
  project: IrProject;
  libraries: IrLibrary[];
  deviceTypes: IrDeviceType[];
  cableTypes: IrCableType[];
  devices: IrDevice[];
  terminals: IrTerminal[];
  functions: IrFunction[];
  internalRelations: IrInternalRelation[];
  gangedGroups: IrGangedGroup[];
  wires: IrWire[];
  jumpers: IrJumper[];
  cables: IrCable[];
  cableConductors: IrCableConductor[];
  relations: IrProjectRelation[];
  potentials: IrPotential[];
  nets: IrNet[];
  indexes: IrIndexes;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTerminalId(left: TerminalId, right: TerminalId): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.terminalKey, right.terminalKey)
  );
}

function compareFunctionId(left: FunctionId, right: FunctionId): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.functionKey, right.functionKey)
  );
}

function compareCableConductorId(
  left: CableConductorId,
  right: CableConductorId,
): number {
  return (
    compareText(left.cableUid, right.cableUid) ||
    compareText(left.conductorId, right.conductorId)
  );
}

const CONDUCTIVE_KIND_ORDER: Record<ConductiveElementId["kind"], number> = {
  wire: 0,
  jumper: 1,
  cable_conductor: 2,
};

export function compareConductiveElementId(
  left: ConductiveElementId,
  right: ConductiveElementId,
): number {
  const kindOrder =
    CONDUCTIVE_KIND_ORDER[left.kind] - CONDUCTIVE_KIND_ORDER[right.kind];

  if (kindOrder !== 0) {
    return kindOrder;
  }

  if (left.kind === "cable_conductor") {
    const rightConductor = right as Extract<
      ConductiveElementId,
      { kind: "cable_conductor" }
    >;
    return (
      compareText(left.cableUid, rightConductor.cableUid) ||
      compareText(left.conductorId, rightConductor.conductorId)
    );
  }

  return compareText(
    left.uid,
    (right as Extract<ConductiveElementId, { kind: typeof left.kind }>).uid,
  );
}

export function compareSourceRef(left: SourceRef, right: SourceRef): number {
  return (
    compareText(left.file, right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.jsonPointer, right.jsonPointer)
  );
}

function compareInstanceRef(left: InstanceRef, right: InstanceRef): number {
  const kindOrder =
    (left.kind === "device" ? 0 : 1) - (right.kind === "device" ? 0 : 1);
  return kindOrder || compareText(left.uid, right.uid);
}

function sourceRef(
  document: LoadedDocument<unknown>,
  jsonPointer: string,
): SourceRef {
  const location = document.nodes.get(jsonPointer)?.value;
  return {
    file: normalizeDiagnosticFile(document.file),
    line: location?.line ?? 1,
    column: location?.column ?? 1,
    jsonPointer,
  };
}

function libraryFilePath(
  library: LoadedLibrary,
  document: LoadedDocument<unknown>,
): string {
  return posix.relative(
    posix.dirname(normalizeDiagnosticFile(library.manifest.file)),
    normalizeDiagnosticFile(document.file),
  );
}

function presentationNeutralManifest(
  project: LoadedProject,
): LoadedDocument<unknown> {
  const presentationNode = project.manifest.nodes.get("/presentation");
  const presentationKey = presentationNode?.key;
  if (presentationNode === undefined || presentationKey === undefined) {
    return project.manifest;
  }

  const text = Buffer.from(project.manifest.rawBytes).toString("utf8");
  const nextRootKey = [...project.manifest.nodes.entries()]
    .filter(
      ([pointer, node]) =>
        pointer !== "/presentation" &&
        pointer.startsWith("/") &&
        !pointer.slice(1).includes("/") &&
        node.key !== undefined &&
        node.key.offset > presentationKey.offset,
    )
    .map(([, node]) => node.key!)
    .sort((left, right) => left.offset - right.offset)[0];

  let projected: string;
  if (nextRootKey !== undefined) {
    projected =
      text.slice(0, presentationKey.offset) + text.slice(nextRootKey.offset);
  } else {
    let commaOffset = presentationKey.offset - 1;
    while (commaOffset >= 0 && /\s/u.test(text[commaOffset]!)) {
      commaOffset -= 1;
    }
    if (text[commaOffset] !== ",") {
      throw new TypeError(
        "The project presentation member cannot be projected out of the semantic manifest.",
      );
    }
    projected =
      text.slice(0, commaOffset) +
      text.slice(presentationNode.value.offset + presentationNode.value.length);
  }

  const parsed = parseJson(projected, project.manifest.file);
  if (parsed.value === undefined || parsed.diagnostics.length > 0) {
    throw new TypeError(
      "The presentation-neutral semantic manifest is not valid JSON.",
    );
  }
  return { ...project.manifest, nodes: parsed.nodes };
}

function assembleLibrary(
  projectManifest: LoadedDocument<unknown>,
  lock: NormalizedLibraryLock,
  library: LoadedLibrary,
): IrLibrary {
  const name = library.dependency.name;
  const locked = lock.libraries[name];

  if (locked === undefined) {
    throw new Error(
      `Verified lock is missing library ${JSON.stringify(name)}.`,
    );
  }

  const documents = new Map<string, LoadedDocument<unknown>>([
    ["library.json", library.manifest],
    ...library.sources.map(
      (document) => [libraryFilePath(library, document), document] as const,
    ),
  ]);
  const files = Object.keys(locked.files)
    .sort(compareText)
    .map((path) => {
      const document = documents.get(path);

      if (document === undefined) {
        throw new Error(
          `Verified library ${JSON.stringify(name)} is missing file ${JSON.stringify(path)}.`,
        );
      }

      return {
        path,
        integrity: locked.files[path]!,
        source: sourceRef(document, ""),
      };
    });
  const dependencyPointer = appendJsonPointer(
    "/libraries",
    library.dependencyIndex,
  );

  return {
    name,
    version: locked.version,
    path: locked.path,
    resolutionKind: library.resolutionKind,
    integrity: locked.integrity,
    files,
    source: sourceRef(projectManifest, dependencyPointer),
    manifestSource: sourceRef(library.manifest, ""),
  };
}

export function assembleElectricalIr(
  project: LoadedProject,
  lock: NormalizedLibraryLock | undefined,
  expansion: ExpansionResult,
  graph: GraphNormalizationResult,
  derived: NetDerivationResult,
): ElectricalIr {
  if (project.libraries.length > 0 && lock === undefined) {
    throw new Error("A verified lock is required to assemble library IR.");
  }

  const metadata = project.manifest.value.project;
  const projectManifest = presentationNeutralManifest(project);
  return canonicalizeIr({
    format: "electrical-ir/0.1",
    project: {
      name: metadata.name,
      ...(metadata.description === undefined
        ? {}
        : { description: metadata.description }),
      source: sourceRef(project.manifest, "/project"),
    },
    libraries: project.libraries.map((library) =>
      assembleLibrary(projectManifest, lock!, library),
    ),
    deviceTypes: expansion.deviceTypes,
    cableTypes: expansion.cableTypes,
    devices: expansion.devices,
    terminals: expansion.terminals,
    functions: expansion.functions,
    internalRelations: expansion.internalRelations,
    gangedGroups: expansion.gangedGroups,
    wires: graph.wires,
    jumpers: graph.jumpers,
    cables: expansion.cables,
    cableConductors: graph.cableConductors,
    relations: graph.relations,
    potentials: derived.potentials,
    nets: derived.nets,
    indexes: derived.indexes,
  });
}

function canonicalizeIr(input: ElectricalIr): ElectricalIr {
  const ir = structuredClone(input);

  ir.libraries.sort((left, right) => compareText(left.name, right.name));
  for (const library of ir.libraries) {
    library.files.sort((left, right) => compareText(left.path, right.path));
  }

  ir.deviceTypes.sort((left, right) => compareText(left.id, right.id));
  for (const type of ir.deviceTypes) {
    type.terminals.sort((left, right) => compareText(left.key, right.key));
    type.functions.sort((left, right) => compareText(left.key, right.key));
    type.internalRelations.sort(
      (left, right) =>
        compareText(left.verb, right.verb) ||
        compareText(left.fromFunctionKey, right.fromFunctionKey) ||
        compareText(left.toFunctionKey, right.toFunctionKey),
    );
    for (const relation of type.internalRelations) {
      relation.sourceOrigins.sort(compareSourceRef);
    }
  }

  ir.cableTypes.sort((left, right) => compareText(left.id, right.id));
  for (const type of ir.cableTypes) {
    type.conductors.sort((left, right) => compareText(left.id, right.id));
  }

  ir.devices.sort((left, right) => compareText(left.uid, right.uid));
  ir.terminals.sort((left, right) => compareTerminalId(left.id, right.id));
  ir.functions.sort((left, right) => compareFunctionId(left.id, right.id));
  ir.internalRelations.sort(
    (left, right) =>
      compareText(left.deviceUid, right.deviceUid) ||
      compareText(left.verb, right.verb) ||
      compareFunctionId(left.from, right.from) ||
      compareFunctionId(left.to, right.to),
  );
  for (const relation of ir.internalRelations) {
    relation.sourceOrigins.sort(compareSourceRef);
  }

  ir.gangedGroups.sort((left, right) => compareText(left.id, right.id));
  for (const group of ir.gangedGroups) {
    group.functionIds.sort(compareFunctionId);
  }

  ir.wires.sort((left, right) => compareText(left.uid, right.uid));
  ir.jumpers.sort((left, right) => compareText(left.uid, right.uid));
  for (const element of [...ir.wires, ...ir.jumpers]) {
    element.endpoints.sort((left, right) =>
      compareTerminalId(left.terminal, right.terminal),
    );
  }

  ir.cables.sort((left, right) => compareText(left.uid, right.uid));
  for (const cable of ir.cables)
    cable.assignments?.sort((left, right) => compareText(left.id, right.id));
  ir.cableConductors.sort((left, right) =>
    compareCableConductorId(left.id, right.id),
  );
  for (const conductor of ir.cableConductors) {
    conductor.endpoints.sort((left, right) =>
      compareTerminalId(left.terminal, right.terminal),
    );
  }

  ir.relations.sort((left, right) => compareText(left.uid, right.uid));
  ir.potentials.sort((left, right) => compareText(left.uid, right.uid));
  ir.nets.sort((left, right) => compareText(left.id, right.id));
  for (const net of ir.nets) {
    net.terminalIds.sort(compareTerminalId);
    net.conductiveElementIds.sort(compareConductiveElementId);
    net.potentialUids.sort(compareText);
  }

  const indexes = ir.indexes;
  indexes.terminalIdsByDeviceUid.sort((left, right) =>
    compareText(left.key, right.key),
  );
  for (const entry of indexes.terminalIdsByDeviceUid) {
    entry.value.sort(compareTerminalId);
  }
  indexes.conductiveElementIdsByTerminal.sort((left, right) =>
    compareTerminalId(left.key, right.key),
  );
  for (const entry of indexes.conductiveElementIdsByTerminal) {
    entry.value.sort(compareConductiveElementId);
  }
  indexes.terminalIdsByConductiveElement.sort((left, right) =>
    compareConductiveElementId(left.key, right.key),
  );
  for (const entry of indexes.terminalIdsByConductiveElement) {
    entry.value.sort(compareTerminalId);
  }
  indexes.conductorIdsByCableUid.sort((left, right) =>
    compareText(left.key, right.key),
  );
  for (const entry of indexes.conductorIdsByCableUid) {
    entry.value.sort(compareCableConductorId);
  }
  indexes.objectRefByUid.sort((left, right) =>
    compareText(left.key, right.key),
  );
  indexes.objectRefByDesignation.sort((left, right) =>
    compareText(left.key, right.key),
  );
  indexes.relationEndpointsByUid.sort((left, right) =>
    compareText(left.key, right.key),
  );
  indexes.instanceRefsByTypeId.sort((left, right) =>
    compareText(left.key, right.key),
  );
  for (const entry of indexes.instanceRefsByTypeId) {
    entry.value.sort(compareInstanceRef);
  }
  indexes.netIdByTerminal.sort((left, right) =>
    compareTerminalId(left.key, right.key),
  );

  return ir;
}

const FIELD_ORDERS: Readonly<Record<string, readonly string[]>> = {
  "": [
    "format",
    "project",
    "libraries",
    "deviceTypes",
    "cableTypes",
    "devices",
    "terminals",
    "functions",
    "internalRelations",
    "gangedGroups",
    "wires",
    "jumpers",
    "cables",
    "cableConductors",
    "relations",
    "potentials",
    "nets",
    "indexes",
  ],
  "/project": ["name", "description", "source"],
  "/libraries/*": [
    "name",
    "version",
    "path",
    "resolutionKind",
    "integrity",
    "files",
    "source",
    "manifestSource",
  ],
  "/libraries/*/files/*": ["path", "integrity", "source"],
  "/deviceTypes/*": [
    "kind",
    "id",
    "libraryName",
    "libraryVersion",
    "description",
    "aliases",
    "terminals",
    "functions",
    "internalRelations",
    "symbol",
    "circuitSymbols",
    "circuitSymbolSources",
    "source",
  ],
  "/deviceTypes/*/terminals/*": [
    "key",
    "role",
    "rating",
    "connectionPolicy",
    "description",
    "source",
  ],
  "/deviceTypes/*/functions/*": [
    "key",
    "kind",
    "normal_state",
    "direction",
    "terminalKeys",
    "source",
  ],
  "/deviceTypes/*/internalRelations/*": [
    "verb",
    "fromFunctionKey",
    "toFunctionKey",
    "sourceOrigins",
  ],
  "/cableTypes/*": [
    "kind",
    "id",
    "libraryName",
    "libraryVersion",
    "description",
    "aliases",
    "conductors",
    "shield",
    "construction",
    "source",
  ],
  "/cableTypes/*/conductors/*": ["id", "color", "size", "source"],
  "/devices/*": [
    "uid",
    "designation",
    "typeId",
    "description",
    "aliases",
    "location",
    "source",
  ],
  "/terminals/*": [
    "id",
    "role",
    "rating",
    "connectionPolicy",
    "description",
    "source",
  ],
  "/functions/*": [
    "id",
    "kind",
    "normal_state",
    "direction",
    "terminals",
    "source",
  ],
  "/internalRelations/*": ["deviceUid", "verb", "from", "to", "sourceOrigins"],
  "/gangedGroups/*": ["id", "functionIds"],
  "/wires/*": [
    "uid",
    "designation",
    "description",
    "aliases",
    "endpoints",
    "properties",
    "source",
  ],
  "/jumpers/*": [
    "uid",
    "designation",
    "description",
    "aliases",
    "endpoints",
    "source",
  ],
  "/cables/*": [
    "uid",
    "designation",
    "typeId",
    "description",
    "aliases",
    "source",
  ],
  "/cableConductors/*": [
    "id",
    "cableUid",
    "typeId",
    "endpoints",
    "typeConductor",
    "source",
  ],
  "/relations/*": [
    "uid",
    "verb",
    "fromDeviceUid",
    "toDeviceUid",
    "designation",
    "description",
    "aliases",
    "fromSource",
    "toSource",
    "source",
  ],
  "/potentials/*": [
    "uid",
    "name",
    "designation",
    "description",
    "aliases",
    "electrical",
    "terminal",
    "netId",
    "terminalSource",
    "source",
  ],
  "/nets/*": ["id", "terminalIds", "conductiveElementIds", "potentialUids"],
  "/indexes": [
    "terminalIdsByDeviceUid",
    "conductiveElementIdsByTerminal",
    "terminalIdsByConductiveElement",
    "conductorIdsByCableUid",
    "objectRefByUid",
    "objectRefByDesignation",
    "relationEndpointsByUid",
    "instanceRefsByTypeId",
    "netIdByTerminal",
  ],
};

function normalizedPath(path: readonly (string | number)[]): string {
  return path
    .map((member) => `/${typeof member === "number" ? "*" : member}`)
    .join("");
}

function structuralFieldOrder(value: Record<string, unknown>): string[] {
  if (
    Object.hasOwn(value, "file") &&
    Object.hasOwn(value, "line") &&
    Object.hasOwn(value, "column") &&
    Object.hasOwn(value, "jsonPointer")
  ) {
    return ["file", "line", "column", "jsonPointer"];
  }
  if (
    Object.hasOwn(value, "deviceUid") &&
    Object.hasOwn(value, "terminalKey")
  ) {
    return ["deviceUid", "terminalKey"];
  }
  if (
    Object.hasOwn(value, "deviceUid") &&
    Object.hasOwn(value, "functionKey")
  ) {
    return ["deviceUid", "functionKey"];
  }
  if (Object.hasOwn(value, "cableUid") && Object.hasOwn(value, "conductorId")) {
    return ["kind", "cableUid", "conductorId"];
  }
  if (Object.hasOwn(value, "kind") && Object.hasOwn(value, "uid")) {
    return ["kind", "uid"];
  }
  if (Object.hasOwn(value, "terminal") && Object.hasOwn(value, "source")) {
    return ["terminal", "source"];
  }
  if (Object.hasOwn(value, "key") && Object.hasOwn(value, "value")) {
    return ["key", "value"];
  }
  return [];
}

const irKeyOrder: JsonKeyOrder = (object, path) => {
  const preferred = [
    ...(FIELD_ORDERS[normalizedPath(path)] ?? []),
    ...structuralFieldOrder(object),
  ];
  const rank = new Map(preferred.map((key, index) => [key, index]));
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort((left, right) => {
      const leftRank = rank.get(left);
      const rightRank = rank.get(right);

      if (leftRank !== undefined || rightRank !== undefined) {
        return (
          (leftRank ?? Number.MAX_SAFE_INTEGER) -
            (rightRank ?? Number.MAX_SAFE_INTEGER) || compareText(left, right)
        );
      }

      return compareText(left, right);
    });

  return keys;
};

export function serializeIr(ir: ElectricalIr): string {
  const canonical = canonicalizeIr(ir);
  return `${stringifyJson(canonical, irKeyOrder)}\n`;
}
