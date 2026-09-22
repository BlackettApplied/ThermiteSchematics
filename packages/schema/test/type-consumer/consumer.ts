import type {
  BusFunction,
  Cable,
  CableType,
  ChannelFunction,
  CoilFunction,
  ContactFunction,
  Device,
  DeviceFunction,
  DeviceType,
  Jumper,
  LibraryFile,
  LibraryLock,
  LibraryManifest,
  LibraryType,
  LoadFunction,
  MechanismFunction,
  OtherFunction,
  Potential,
  ProjectManifest,
  ProjectPresentationFile,
  ProjectObject,
  Relation,
  SourceFile,
  SourceFunction,
  ValidatedDeviceType,
  Wire,
} from "@thermite/schema";

type EveryRoot = [
  Cable,
  CableType,
  Device,
  DeviceType,
  Jumper,
  LibraryManifest,
  LibraryFile,
  LibraryLock,
  Potential,
  ProjectManifest,
  ProjectPresentationFile,
  Relation,
  SourceFile,
  Wire,
];

type EveryDeviceFunctionBranch = [
  CoilFunction,
  ContactFunction,
  ChannelFunction,
  SourceFunction,
  LoadFunction,
  BusFunction,
  MechanismFunction,
  OtherFunction,
];

type HandwrittenUnions = [ProjectObject, LibraryType];

const shippedDependency: NonNullable<ProjectManifest["libraries"]>[number] = {
  name: "core",
  version: "0.1.0",
};
const legacyLockEntry: LibraryLock["libraries"][string] = {
  version: "0.1.0",
  path: "../library/core",
  integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  files: {
    "library.json": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  },
};
void shippedDependency;
void legacyLockEntry.resolutionKind;

export function discriminateDeviceFunction(value: DeviceFunction): string {
  switch (value.kind) {
    case "coil":
    case "contact":
    case "channel":
    case "source":
    case "load":
    case "bus":
    case "mechanism":
    case "other":
      return value.kind;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function consumeValidatedDeviceType(
  value: ValidatedDeviceType,
): [EveryRoot, EveryDeviceFunctionBranch, HandwrittenUnions] | undefined {
  for (const terminal of Object.values(value.terminals)) {
    switch (terminal.connection_policy) {
      case undefined:
      case "exclusive":
      case "shared":
        break;
      default: {
        const exhaustive: never = terminal.connection_policy;
        return exhaustive;
      }
    }
  }

  for (const deviceFunction of Object.values(value.functions)) {
    discriminateDeviceFunction(deviceFunction);
  }

  return undefined;
}
