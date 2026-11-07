import {
  SHIPPED_CORE_DISPLAY_ROOT,
  SHIPPED_CORE_VERSIONS,
  SHIPPED_CORE_PACKAGE_NAME,
} from "@thermite/core-library";
import { normalizeDiagnosticFile } from "@thermite/schema";

import type { LibraryResolutionKind } from "./loader.js";

/** Directory of the shipped library inside its package (see the resolver). */
const SHIPPED_PACKAGE_LIBRARY_DIRECTORY = "library";

/** The shipped package as materialized below the runtime package root. */
export const SHIPPED_CORE_RUNTIME_PACKAGE_ROOT = `node_modules/${SHIPPED_CORE_PACKAGE_NAME}`;

/** The shipped package below the root of a source checkout. */
export const SHIPPED_CORE_SOURCE_PACKAGE_ROOT = "packages/core-library";

export interface OpenableLibraryFile {
  /** Path relative to the project manifest directory, for local libraries. */
  readonly project?: string;
  /** Path relative to the runtime package root, for the shipped library. */
  readonly runtime?: string;
  /** Path relative to the source checkout root, for the shipped library. */
  readonly source?: string;
}

/**
 * Locate a library file named by its diagnostic display path so a reader can
 * open it. Local display paths are already relative to the project manifest
 * directory. Shipped display paths are logical (`@thermite/core-library/...`)
 * and name no real file, so they map into the shipped package instead.
 */
export function openableLibraryFile(
  resolutionKind: LibraryResolutionKind,
  displayFile: string,
): OpenableLibraryFile {
  const file = normalizeDiagnosticFile(displayFile);
  const prefix = `${SHIPPED_CORE_DISPLAY_ROOT}/`;
  if (resolutionKind !== "shipped" || !file.startsWith(prefix)) {
    return { project: file };
  }
  const version = Object.values(SHIPPED_CORE_VERSIONS).find(
    (entry) =>
      entry.directory !== SHIPPED_PACKAGE_LIBRARY_DIRECTORY &&
      file.startsWith(`${entry.displayRoot}/`),
  );
  const packageFile = version
    ? `${version.directory}/${file.slice(version.displayRoot.length + 1)}`
    : `${SHIPPED_PACKAGE_LIBRARY_DIRECTORY}/${file.slice(prefix.length)}`;
  return {
    runtime: `${SHIPPED_CORE_RUNTIME_PACKAGE_ROOT}/${packageFile}`,
    source: `${SHIPPED_CORE_SOURCE_PACKAGE_ROOT}/${packageFile}`,
  };
}

/** Quote an openable library file for a diagnostic lookup. */
export function describeLibraryFile(location: OpenableLibraryFile): string {
  if (location.project !== undefined) return JSON.stringify(location.project);
  return `${JSON.stringify(location.runtime)} below the runtime package root (${JSON.stringify(location.source)} in a source checkout)`;
}
