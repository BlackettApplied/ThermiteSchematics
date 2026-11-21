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

export interface ShippedCoreLibraryResolution<
  Version extends string = typeof SHIPPED_CORE_LIBRARY_VERSION,
> {
  readonly packageRootPath: string;
  readonly libraryRootPath: string;
  readonly displayRoot: Version extends "0.1.0"
    ? typeof SHIPPED_CORE_DISPLAY_ROOT
    : string;
  readonly locator: `ais-shipped:core@${Version}`;
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

export interface ShippedCoreVersion {
  readonly directory: string;
  readonly displayRoot: string;
  readonly locator: `ais-shipped:core@${string}`;
  readonly fileInventory: readonly string[];
}

/** Exact shipped versions. The original constants/default resolver stay 0.1.0. */
export const SHIPPED_CORE_VERSIONS: Readonly<
  Record<string, ShippedCoreVersion>
> = Object.freeze({
  "0.1.0": Object.freeze({
    directory: "library",
    displayRoot: SHIPPED_CORE_DISPLAY_ROOT,
    locator: SHIPPED_CORE_LIBRARY_LOCATOR,
    fileInventory: SHIPPED_CORE_FILE_INVENTORY,
  }),
  "0.2.0": Object.freeze({
    directory: "versions/0.2.0",
    displayRoot: `${SHIPPED_CORE_DISPLAY_ROOT}/versions/0.2.0`,
    locator: "ais-shipped:core@0.2.0",
    fileInventory: Object.freeze(
      [
        ...SHIPPED_CORE_FILE_INVENTORY.map((path) =>
          path.replace(/^library\//u, "versions/0.2.0/"),
        ),
        "versions/0.2.0/types/pushbutton-no.json",
        "versions/0.2.0/types/estop-nc.json",
        "versions/0.2.0/types/selector-2pos.json",
        "versions/0.2.0/types/pilot-light.json",
        "versions/0.2.0/types/relay-1co.json",
        "versions/0.2.0/types/fuse-1p.json",
        "versions/0.2.0/types/fuse-2p.json",
        "versions/0.2.0/types/fuse-3p.json",
        "versions/0.2.0/types/breaker-1p.json",
        "versions/0.2.0/types/breaker-2p.json",
        "versions/0.2.0/types/control-transformer.json",
        "versions/0.2.0/types/terminal-pe.json",
        "versions/0.2.0/types/cable-power-4core.json",
        "versions/0.2.0/types/plc-8di-8do-2ai.json",
        "versions/0.2.0/types/hmi.json",
        "versions/0.2.0/types/transmitter-2wire-4-20ma.json",
        "versions/0.2.0/types/level-switch-no.json",
        "versions/0.2.0/types/disconnect-3p.json",
        "versions/0.2.0/types/cordset-sensor-4core.json",
        "versions/0.2.0/types/cable-instrumentation-1pair.json",
      ].sort(),
    ),
  }),
});

export function resolveShippedCoreLibraryVersion(
  version: string,
  moduleUrl: string = import.meta.url,
): ShippedCoreLibraryResolution<string> | undefined {
  if (!Object.hasOwn(SHIPPED_CORE_VERSIONS, version)) return undefined;
  const entry = SHIPPED_CORE_VERSIONS[version]!;
  const { packageRootPath } = resolveShippedCoreLibrary(moduleUrl);
  return Object.freeze({
    packageRootPath,
    libraryRootPath: join(packageRootPath, entry.directory),
    displayRoot: entry.displayRoot,
    locator: entry.locator,
  });
}
