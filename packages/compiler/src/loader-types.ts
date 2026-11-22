import type {
  Diagnostic,
  JsonPointerNodeMap,
  SourceFile,
  ProjectObject,
  LibraryFile,
  LibraryType,
  LibraryManifest,
  ProjectManifest,
  ProjectPresentationFile,
  LibraryLock,
} from "@thermite/schema";
import type { ShippedCoreLibraryResolution } from "@thermite/core-library";

export type LoadedProjectSourceFile = Omit<SourceFile, "objects"> & {
  objects: ProjectObject[];
};

export type LoadedLibrarySourceFile = Omit<LibraryFile, "types"> & {
  types: LibraryType[];
};

export type LoadedDocumentOwner =
  | { kind: "project" }
  | { kind: "library"; name: string; dependencyIndex: number };

export type LoadedDocumentKind =
  | "project_manifest"
  | "project_presentation"
  | "project_source"
  | "library_manifest"
  | "library_source";

export interface LoadedDocument<T> {
  file: string;
  logicalPath: string;
  canonicalPath: string;
  rawBytes: Uint8Array;
  value: T;
  nodes: JsonPointerNodeMap;
  owner: LoadedDocumentOwner;
  kind: LoadedDocumentKind;
}

export type ProjectLibraryDependency = NonNullable<
  ProjectManifest["libraries"]
>[number];

export type LibraryResolutionKind = "local" | "shipped";

export interface LoadedLibrary {
  dependencyIndex: number;
  dependency: ProjectLibraryDependency;
  resolutionKind: LibraryResolutionKind;
  logicalRootPath: string;
  canonicalRootPath: string;
  manifest: LoadedDocument<LibraryManifest>;
  sources: LoadedDocument<LoadedLibrarySourceFile>[];
}

export type NormalizedLibraryLockEntry = Omit<
  LibraryLock["libraries"][string],
  "resolutionKind"
> & {
  resolutionKind: LibraryResolutionKind;
};

export type NormalizedLibraryLock = Omit<LibraryLock, "libraries"> & {
  libraries: Record<string, NormalizedLibraryLockEntry>;
};

export type LoadedLibraryLock =
  | { state: "missing" }
  | { state: "error"; detail: string }
  | { state: "invalid"; diagnostics: Diagnostic[] }
  | {
      state: "valid";
      rawBytes: Uint8Array;
      value: NormalizedLibraryLock;
      parsedValue: LibraryLock;
      nodes: JsonPointerNodeMap;
    };

export interface LoadProjectOptions {
  /** Override exact supported-version resolution; never called for local/unknown dependencies. */
  readonly resolveShippedCoreLibrary?: (
    version: string,
  ) => ShippedCoreLibraryResolution<string>;
}

export interface LoadedProject {
  logicalRootPath: string;
  canonicalRootPath: string;
  manifest: LoadedDocument<ProjectManifest>;
  presentation?: LoadedDocument<ProjectPresentationFile>;
  sources: LoadedDocument<LoadedProjectSourceFile>[];
  libraries: LoadedLibrary[];
  /** Frozen during structural loading, but trusted only by the lock stage. */
  libraryLock: LoadedLibraryLock;
  structuralDiagnostics: Diagnostic[];
}

export type LoadResult =
  | {
      ok: true;
      diagnostics: Diagnostic[];
      project: LoadedProject;
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
      toolFailure: boolean;
    };

/** A filesystem snapshot whose project source/presentation values are not schema-trusted. */
export type SourcePatchProject = Omit<
  LoadedProject,
  "sources" | "presentation"
> & {
  sources: LoadedDocument<unknown>[];
  presentation?: LoadedDocument<unknown>;
};

/** A patch-only load failure can retain untrusted parsed documents, never an IR. */
export type SourcePatchLoadResult =
  | Extract<LoadResult, { ok: true }>
  | (Extract<LoadResult, { ok: false }> & {
      /** The dedicated loader evaluated admission, even if no snapshot was safe. */
      sourcePatchCapable?: true;
      sourcePatchProject?: SourcePatchProject;
    });
