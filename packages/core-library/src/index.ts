import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SHIPPED_CORE_PACKAGE_NAME = "@thermite/core-library";
export const SHIPPED_CORE_LIBRARY_NAME = "core";
export const SHIPPED_CORE_LIBRARY_VERSION = "0.1.0";
export const SHIPPED_CORE_LIBRARY_LOCATOR = "ais-shipped:core@0.1.0";
export const SHIPPED_CORE_DISPLAY_ROOT = "@thermite/core-library";

export const SHIPPED_CORE_FILE_INVENTORY = Object.freeze([
  "library/library.json",
  "library/types/breaker-3p.json",
  "library/types/cable-2pair-shielded.json",
  "library/types/contactor-3p-1no.json",
  "library/types/junction-box-8.json",
  "library/types/limit-switch-2wire.json",
  "library/types/motor-3ph.json",
  "library/types/overload-3p-1nc.json",
  "library/types/plc-compact.json",
  "library/types/prox-pnp-3wire.json",
  "library/types/psu-24vdc.json",
  "library/types/pushbutton-nc.json",
  "library/types/supply-480v-3ph.json",
  "library/types/terminal-block-8.json",
] as const);

export interface ShippedCoreLibraryResolution {
  readonly packageRootPath: string;
  readonly libraryRootPath: string;
  readonly displayRoot: typeof SHIPPED_CORE_DISPLAY_ROOT;
  readonly locator: typeof SHIPPED_CORE_LIBRARY_LOCATOR;
}

export function resolveShippedCoreLibrary(
  moduleUrl: string = import.meta.url,
): ShippedCoreLibraryResolution {
  const packageRootPath = resolve(dirname(fileURLToPath(moduleUrl)), "..");
  return Object.freeze({
    packageRootPath,
    libraryRootPath: join(packageRootPath, "library"),
    displayRoot: SHIPPED_CORE_DISPLAY_ROOT,
    locator: SHIPPED_CORE_LIBRARY_LOCATOR,
  });
}
