import {
  DIAGNOSTIC_CATALOG,
  appendJsonPointer,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Cable,
  type CableType,
  type Device,
  type Diagnostic,
  type LibraryType,
  type ProjectObject,
  type ValidatedDeviceType,
} from "@thermite/schema";

import type {
  LoadedDocument,
  LoadedLibrary,
  LoadedLibrarySourceFile,
  LoadedProject,
  LoadedProjectSourceFile,
} from "./loader.js";

export interface SourceRef {
  file: string;
  line: number;
  column: number;
  jsonPointer: string;
}

export interface TerminalId {
  deviceUid: string;
  terminalKey: string;
}

export interface ProjectObjectCatalogEntry {
  object: ProjectObject;
  document: LoadedDocument<LoadedProjectSourceFile>;
  objectIndex: number;
  source: SourceRef;
  uidSource: SourceRef;
  designationSource?: SourceRef;
}

export interface LibraryTypeCatalogEntry {
  type: LibraryType;
  library: LoadedLibrary;
  document: LoadedDocument<LoadedLibrarySourceFile>;
  typeIndex: number;
  source: SourceRef;
  idSource: SourceRef;
}

export interface ProjectCatalogs {
  projectObjectsByUid: ReadonlyMap<string, ProjectObjectCatalogEntry>;
  projectObjectsByDesignation: ReadonlyMap<
    string,
    readonly ProjectObjectCatalogEntry[]
  >;
  libraryTypesById: ReadonlyMap<string, LibraryTypeCatalogEntry>;
}

export interface CatalogBuildResult {
  catalogs: ProjectCatalogs;
  diagnostics: Diagnostic[];
  duplicateDesignations: ReadonlySet<string>;
}

export type InstanceTypeResolution =
  | {
      instance: Device;
      typeEntry: LibraryTypeCatalogEntry & { type: ValidatedDeviceType };
    }
  | {
      instance: Cable;
      typeEntry: LibraryTypeCatalogEntry & { type: CableType };
    };

export interface ResolvedDeviceReference {
  ownerUid: string;
  deviceUid: string;
  source: SourceRef;
}

export interface ResolvedTerminalReference {
  ownerUid: string;
  terminal: TerminalId;
  source: SourceRef;
  deviceSource: SourceRef;
  terminalSource: SourceRef;
}

export interface ResolveLoadedProjectResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  catalogs: ProjectCatalogs;
  instanceTypesByUid: ReadonlyMap<string, InstanceTypeResolution>;
  deviceReferences: readonly ResolvedDeviceReference[];
  terminalReferences: readonly ResolvedTerminalReference[];
}

interface AuthoredDeviceReference {
  owner: ProjectObjectCatalogEntry;
  device: string;
  pointer: string;
}

interface AuthoredTerminalReference extends AuthoredDeviceReference {
  terminal: string;
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

function projectObjectPointer(index: number): string {
  return appendJsonPointer("/objects", index);
}

function libraryTypePointer(index: number): string {
  return appendJsonPointer("/types", index);
}

function projectObjectEntries(
  project: LoadedProject,
): ProjectObjectCatalogEntry[] {
  return project.sources.flatMap((document) =>
    document.value.objects.map((object, objectIndex) => {
      const pointer = projectObjectPointer(objectIndex);
      const designation = object.designation;
      return {
        object,
        document,
        objectIndex,
        source: sourceRef(document, pointer),
        uidSource: sourceRef(document, appendJsonPointer(pointer, "uid")),
        ...(typeof designation === "string" && designation.length > 0
          ? {
              designationSource: sourceRef(
                document,
                appendJsonPointer(pointer, "designation"),
              ),
            }
          : {}),
      };
    }),
  );
}

function libraryTypeEntries(project: LoadedProject): LibraryTypeCatalogEntry[] {
  return project.libraries.flatMap((library) =>
    library.sources.flatMap((document) =>
      document.value.types.map((type, typeIndex) => {
        const pointer = libraryTypePointer(typeIndex);
        return {
          type,
          library,
          document,
          typeIndex,
          source: sourceRef(document, pointer),
          idSource: sourceRef(document, appendJsonPointer(pointer, "id")),
        };
      }),
    ),
  );
}

function duplicateDesignationDiagnostic(
  entry: ProjectObjectCatalogEntry,
  first: ProjectObjectCatalogEntry,
  designation: string,
): Diagnostic {
  const source = entry.designationSource!;
  const firstSource = first.designationSource!;
  return {
    code: "E100",
    severity: DIAGNOSTIC_CATALOG.E100.severity,
    message: `Duplicate project designation ${JSON.stringify(designation)}.`,
    file: source.file,
    line: source.line,
    column: source.column,
    jsonPointer: source.jsonPointer,
    uid: entry.object.uid,
    related: [
      {
        file: firstSource.file,
        line: firstSource.line,
        column: firstSource.column,
        note: "First declaration of this designation.",
      },
    ],
  };
}

export function buildProjectCatalogs(
  project: LoadedProject,
): CatalogBuildResult {
  const objectEntries = projectObjectEntries(project);
  const projectObjectsByUid = new Map<string, ProjectObjectCatalogEntry>();
  const projectObjectsByDesignation = new Map<
    string,
    ProjectObjectCatalogEntry[]
  >();
  const diagnostics: Diagnostic[] = [];
  const duplicateDesignations = new Set<string>();

  for (const entry of objectEntries) {
    projectObjectsByUid.set(entry.object.uid, entry);
    const designation = entry.object.designation;

    if (typeof designation !== "string" || designation.length === 0) {
      continue;
    }

    const declarations = projectObjectsByDesignation.get(designation);

    if (declarations === undefined) {
      projectObjectsByDesignation.set(designation, [entry]);
      continue;
    }

    duplicateDesignations.add(designation);
    diagnostics.push(
      duplicateDesignationDiagnostic(entry, declarations[0]!, designation),
    );
    declarations.push(entry);
  }

  const libraryTypesById = new Map<string, LibraryTypeCatalogEntry>();

  for (const entry of libraryTypeEntries(project)) {
    libraryTypesById.set(entry.type.id, entry);
  }

  return {
    catalogs: {
      projectObjectsByUid,
      projectObjectsByDesignation,
      libraryTypesById,
    },
    diagnostics: normalizeDiagnostics(diagnostics),
    duplicateDesignations,
  };
}

function incompatibleTypeDiagnostic(
  instanceEntry: ProjectObjectCatalogEntry,
  typeEntry: LibraryTypeCatalogEntry,
): Diagnostic {
  const instance = instanceEntry.object as Device | Cable;
  const pointer = appendJsonPointer(
    projectObjectPointer(instanceEntry.objectIndex),
    "type",
  );
  const source = sourceRef(instanceEntry.document, pointer);
  return {
    code: "E104",
    severity: DIAGNOSTIC_CATALOG.E104.severity,
    message: `${instance.kind === "device" ? "Device" : "Cable"} ${JSON.stringify(instance.designation)} references type ${JSON.stringify(instance.type)}, but it is a ${typeEntry.type.kind}.`,
    file: source.file,
    line: source.line,
    column: source.column,
    jsonPointer: pointer,
    uid: instance.uid,
    related: [
      {
        file: typeEntry.idSource.file,
        line: typeEntry.idSource.line,
        column: typeEntry.idSource.column,
        note: `Incompatible ${typeEntry.type.kind} ${JSON.stringify(typeEntry.type.id)} is declared here.`,
      },
    ],
  };
}

function unknownTypeDiagnostic(
  instanceEntry: ProjectObjectCatalogEntry,
): Diagnostic {
  const instance = instanceEntry.object as Device | Cable;
  const pointer = appendJsonPointer(
    projectObjectPointer(instanceEntry.objectIndex),
    "type",
  );
  const source = sourceRef(instanceEntry.document, pointer);
  return {
    code: "E103",
    severity: DIAGNOSTIC_CATALOG.E103.severity,
    message: `${instance.kind === "device" ? "Device" : "Cable"} ${JSON.stringify(instance.designation)} references unknown type ${JSON.stringify(instance.type)}.`,
    file: source.file,
    line: source.line,
    column: source.column,
    jsonPointer: pointer,
    uid: instance.uid,
  };
}

function resolveInstanceTypes(catalogs: ProjectCatalogs): {
  diagnostics: Diagnostic[];
  instanceTypesByUid: Map<string, InstanceTypeResolution>;
} {
  const diagnostics: Diagnostic[] = [];
  const instanceTypesByUid = new Map<string, InstanceTypeResolution>();

  for (const entry of catalogs.projectObjectsByUid.values()) {
    if (entry.object.kind !== "device" && entry.object.kind !== "cable") {
      continue;
    }

    const typeEntry = catalogs.libraryTypesById.get(entry.object.type);

    if (typeEntry === undefined) {
      diagnostics.push(unknownTypeDiagnostic(entry));
      continue;
    }

    const expectedKind =
      entry.object.kind === "device" ? "device_type" : "cable_type";

    if (typeEntry.type.kind !== expectedKind) {
      diagnostics.push(incompatibleTypeDiagnostic(entry, typeEntry));
      continue;
    }

    if (entry.object.kind === "device") {
      instanceTypesByUid.set(entry.object.uid, {
        instance: entry.object,
        typeEntry: typeEntry as LibraryTypeCatalogEntry & {
          type: ValidatedDeviceType;
        },
      });
    } else {
      instanceTypesByUid.set(entry.object.uid, {
        instance: entry.object,
        typeEntry: typeEntry as LibraryTypeCatalogEntry & { type: CableType },
      });
    }
  }

  return { diagnostics, instanceTypesByUid };
}

function terminalReferenceSites(
  entry: ProjectObjectCatalogEntry,
): AuthoredTerminalReference[] {
  const objectPointer = projectObjectPointer(entry.objectIndex);
  const object = entry.object;

  if (object.kind === "wire" || object.kind === "jumper") {
    return object.endpoints.map((reference, endpointIndex) => ({
      owner: entry,
      device: reference.device,
      terminal: reference.terminal,
      pointer: appendJsonPointer(
        appendJsonPointer(objectPointer, "endpoints"),
        endpointIndex,
      ),
    }));
  }

  if (object.kind === "cable") {
    return object.conductors.flatMap((conductor, conductorIndex) =>
      conductor.endpoints.flatMap((reference, endpointIndex) =>
        reference === null
          ? []
          : [
              {
                owner: entry,
                device: reference.device,
                terminal: reference.terminal,
                pointer: appendJsonPointer(
                  appendJsonPointer(
                    appendJsonPointer(
                      appendJsonPointer(objectPointer, "conductors"),
                      conductorIndex,
                    ),
                    "endpoints",
                  ),
                  endpointIndex,
                ),
              },
            ],
      ),
    );
  }

  if (object.kind === "potential") {
    return [
      {
        owner: entry,
        device: object.at.device,
        terminal: object.at.terminal,
        pointer: appendJsonPointer(objectPointer, "at"),
      },
    ];
  }

  return [];
}

function deviceReferenceSites(
  entry: ProjectObjectCatalogEntry,
): AuthoredDeviceReference[] {
  if (entry.object.kind !== "relation") {
    return [];
  }

  const objectPointer = projectObjectPointer(entry.objectIndex);
  const relation = entry.object;
  return (["from", "to"] as const).map((side) => ({
    owner: entry,
    device: relation[side].device,
    pointer: appendJsonPointer(objectPointer, side),
  }));
}

function noUniqueDeviceDiagnostic(
  reference: AuthoredDeviceReference,
): Diagnostic {
  const pointer = appendJsonPointer(reference.pointer, "device");
  const source = sourceRef(reference.owner.document, pointer);
  return {
    code: "E101",
    severity: DIAGNOSTIC_CATALOG.E101.severity,
    message: `No unique device has designation ${JSON.stringify(reference.device)}.`,
    file: source.file,
    line: source.line,
    column: source.column,
    jsonPointer: pointer,
    uid: reference.owner.object.uid,
  };
}

function unknownTerminalDiagnostic(
  reference: AuthoredTerminalReference,
  typeEntry: LibraryTypeCatalogEntry & { type: ValidatedDeviceType },
): Diagnostic {
  const pointer = appendJsonPointer(reference.pointer, "terminal");
  const source = sourceRef(reference.owner.document, pointer);
  return {
    code: "E102",
    severity: DIAGNOSTIC_CATALOG.E102.severity,
    message: `Device ${JSON.stringify(reference.device)} of type ${JSON.stringify(typeEntry.type.id)} has no terminal ${JSON.stringify(reference.terminal)}.`,
    file: source.file,
    line: source.line,
    column: source.column,
    jsonPointer: pointer,
    uid: reference.owner.object.uid,
    related: [
      {
        file: typeEntry.idSource.file,
        line: typeEntry.idSource.line,
        column: typeEntry.idSource.column,
        note: `Resolved device type ${JSON.stringify(typeEntry.type.id)} is declared here.`,
      },
    ],
  };
}

function uniqueDeviceEntry(
  reference: AuthoredDeviceReference,
  catalogs: ProjectCatalogs,
  duplicateDesignations: ReadonlySet<string>,
): ProjectObjectCatalogEntry | undefined {
  if (duplicateDesignations.has(reference.device)) {
    return undefined;
  }

  const declarations = catalogs.projectObjectsByDesignation.get(
    reference.device,
  );
  return declarations?.length === 1 && declarations[0]!.object.kind === "device"
    ? declarations[0]
    : undefined;
}

function resolveAuthoredReferences(
  catalogs: ProjectCatalogs,
  duplicateDesignations: ReadonlySet<string>,
  instanceTypesByUid: ReadonlyMap<string, InstanceTypeResolution>,
): {
  diagnostics: Diagnostic[];
  deviceReferences: ResolvedDeviceReference[];
  terminalReferences: ResolvedTerminalReference[];
} {
  const diagnostics: Diagnostic[] = [];
  const deviceReferences: ResolvedDeviceReference[] = [];
  const terminalReferences: ResolvedTerminalReference[] = [];

  for (const owner of catalogs.projectObjectsByUid.values()) {
    for (const reference of deviceReferenceSites(owner)) {
      if (duplicateDesignations.has(reference.device)) {
        continue;
      }

      const deviceEntry = uniqueDeviceEntry(
        reference,
        catalogs,
        duplicateDesignations,
      );

      if (deviceEntry === undefined) {
        diagnostics.push(noUniqueDeviceDiagnostic(reference));
        continue;
      }

      deviceReferences.push({
        ownerUid: owner.object.uid,
        deviceUid: deviceEntry.object.uid,
        source: sourceRef(owner.document, reference.pointer),
      });
    }

    for (const reference of terminalReferenceSites(owner)) {
      if (duplicateDesignations.has(reference.device)) {
        continue;
      }

      const deviceEntry = uniqueDeviceEntry(
        reference,
        catalogs,
        duplicateDesignations,
      );

      if (deviceEntry === undefined) {
        diagnostics.push(noUniqueDeviceDiagnostic(reference));
        continue;
      }

      const typeResolution = instanceTypesByUid.get(deviceEntry.object.uid);

      if (
        typeResolution === undefined ||
        typeResolution.instance.kind !== "device" ||
        typeResolution.typeEntry.type.kind !== "device_type"
      ) {
        continue;
      }

      const typeEntry = typeResolution.typeEntry as LibraryTypeCatalogEntry & {
        type: ValidatedDeviceType;
      };

      if (!Object.hasOwn(typeEntry.type.terminals, reference.terminal)) {
        diagnostics.push(unknownTerminalDiagnostic(reference, typeEntry));
        continue;
      }

      terminalReferences.push({
        ownerUid: owner.object.uid,
        terminal: {
          deviceUid: deviceEntry.object.uid,
          terminalKey: reference.terminal,
        },
        source: sourceRef(owner.document, reference.pointer),
        deviceSource: sourceRef(
          owner.document,
          appendJsonPointer(reference.pointer, "device"),
        ),
        terminalSource: sourceRef(
          owner.document,
          appendJsonPointer(reference.pointer, "terminal"),
        ),
      });
    }
  }

  return { diagnostics, deviceReferences, terminalReferences };
}

export function resolveLoadedProject(
  project: LoadedProject,
): ResolveLoadedProjectResult {
  const catalogResult = buildProjectCatalogs(project);
  const typeResult = resolveInstanceTypes(catalogResult.catalogs);
  const referenceResult = resolveAuthoredReferences(
    catalogResult.catalogs,
    catalogResult.duplicateDesignations,
    typeResult.instanceTypesByUid,
  );
  const diagnostics = normalizeDiagnostics([
    ...catalogResult.diagnostics,
    ...typeResult.diagnostics,
    ...referenceResult.diagnostics,
  ]);

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
    catalogs: catalogResult.catalogs,
    instanceTypesByUid: typeResult.instanceTypesByUid,
    deviceReferences: referenceResult.deviceReferences,
    terminalReferences: referenceResult.terminalReferences,
  };
}
