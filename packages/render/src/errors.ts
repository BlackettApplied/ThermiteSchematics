import type { SchematicViewFamily } from "./types.js";

export class InvalidSymbolCatalogError extends Error {
  readonly name = "InvalidSymbolCatalogError";
}

export class InvalidSymbolMappingError extends Error {
  readonly name = "InvalidSymbolMappingError";
}

export type RenderErrorCode =
  "R001" | "R002" | "R003" | "R004" | "R005" | "R006";

export type RuntimeInputType =
  | "null"
  | "boolean"
  | "number"
  | "bigint"
  | "symbol"
  | "array"
  | "object"
  | "function";

export type RequestedStringInput =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "string"; readonly value: string }
  | {
      readonly kind: "non-string";
      readonly inputType: RuntimeInputType;
    };

export type RequestedFormatInput = RequestedStringInput;
export type RequestedFamilyInput = RequestedStringInput;
export type RequestedFlowInput = RequestedStringInput;

export type RequestedIntentInput =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | {
      readonly kind: "intent";
      readonly value: "trace" | "conductors" | "loads";
    }
  | {
      readonly kind: "non-object";
      readonly inputType: RuntimeInputType | "string";
    }
  | {
      readonly kind: "malformed-intent";
      readonly intentKind: RequestedStringInput;
    };

export type RequestedBooleanInput =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | {
      readonly kind: "non-boolean";
      readonly inputType: RuntimeInputType | "string";
    };

export type RequestedRootInput =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | {
      readonly kind: "selector";
      readonly by: "uid" | "designation";
      readonly value: string;
    }
  | {
      readonly kind: "non-object";
      readonly inputType: RuntimeInputType | "string";
    }
  | {
      readonly kind: "malformed-selector";
      readonly by: RequestedStringInput;
      readonly value: RequestedStringInput;
    };

export type RenderTextOwnerKind =
  | "project"
  | "presentation"
  | "view"
  | "renderer"
  | "cable"
  | "device"
  | "function"
  | "aggregate"
  | "terminal"
  | "wire"
  | "jumper"
  | "cable-conductor"
  | "potential"
  | "boundary";

export type RenderTextField =
  | "project.name"
  | "title.project-line"
  | "title.revision-line"
  | "title.view-line"
  | "title.tool-line"
  | "title.authored-line"
  | "device.designation"
  | "device.type"
  | "device.location"
  | "function.key"
  | "aggregate.key"
  | "terminal.key"
  | "wire.properties.label"
  | "wire.designation"
  | "jumper.designation"
  | "cable.designation"
  | "cable.conductor.id"
  | "cable.conductor.color"
  | "cable.conductor.size"
  | "potential.name"
  | "boundary.label";

export type RenderTextReason =
  | "empty-string"
  | "over-160-code-points"
  | "forbidden-single-line-code-point"
  | "unpaired-surrogate"
  | "xml-illegal-code-point";

export interface RenderErrorBase {
  readonly message: string;
  readonly root: string;
}

export interface InvalidViewRequestError extends RenderErrorBase {
  readonly code: "R001";
  readonly requestedFormat: RequestedFormatInput;
  readonly requestedRoot: RequestedRootInput;
  readonly requestedFamily: RequestedFamilyInput;
  readonly requestedIntent?: RequestedIntentInput;
  readonly requestedTarget?: RequestedRootInput;
  readonly requestedIncludePower?: RequestedBooleanInput;
  readonly requestedFlow: RequestedFlowInput;
  readonly family?: SchematicViewFamily;
  readonly deviceUid?: string;
}

export type IncompletePathError =
  | (RenderErrorBase & {
      readonly code: "R002";
      readonly family: "control";
      readonly deviceUid: string;
      readonly pathSide: "input" | "return";
    })
  | (RenderErrorBase & {
      readonly code: "R002";
      readonly family: "power";
      readonly deviceUid: string;
      readonly lane: string;
    })
  | {
      readonly code: "R002";
      readonly family: "control";
      readonly intent: "trace";
      readonly deviceUid: string;
      readonly targetDeviceUid: string;
      readonly segment: "signal" | "positive-supply" | "return-supply";
      readonly message: string;
      readonly root: string;
    }
  | {
      readonly code: "R002";
      readonly family: "control";
      readonly intent: "conductors";
      readonly cableUid: string;
      readonly segment: "conductors";
      readonly message: string;
      readonly root: string;
    }
  | {
      readonly code: "R002";
      readonly family: "control";
      readonly intent: "loads";
      readonly deviceUid: string;
      readonly segment: "complete-load";
      readonly message: string;
      readonly root: string;
    };

export interface UnsupportedSymbolMappingError extends RenderErrorBase {
  readonly code: "R003";
  readonly family: SchematicViewFamily;
  readonly deviceUid: string;
  readonly typeId: string;
  readonly functionKey?: string;
}

export interface InvalidLayoutError extends RenderErrorBase {
  readonly code: "R004";
  readonly family: SchematicViewFamily;
  readonly netId?: string;
}

export interface InvalidRenderTextError extends RenderErrorBase {
  readonly code: "R005";
  readonly family: SchematicViewFamily;
  readonly ownerKind: RenderTextOwnerKind;
  readonly ownerId: string;
  readonly field: RenderTextField;
  readonly reason: RenderTextReason;
}

export type RenderError =
  | InvalidViewRequestError
  | IncompletePathError
  | UnsupportedSymbolMappingError
  | InvalidLayoutError
  | InvalidRenderTextError
  | InvalidSheetError;

export interface InvalidSheetError extends RenderErrorBase {
  readonly code: "R006";
  readonly reason: "invalid-page" | "invalid-packet" | "unprintable-layout";
}

export interface InvalidViewRequestContext {
  readonly message: string;
  readonly requestedFormat: RequestedFormatInput;
  readonly requestedRoot: RequestedRootInput;
  readonly requestedFamily: RequestedFamilyInput;
  readonly requestedIntent?: RequestedIntentInput;
  readonly requestedTarget?: RequestedRootInput;
  readonly requestedIncludePower?: RequestedBooleanInput;
  readonly requestedFlow: RequestedFlowInput;
  readonly root: string;
  readonly family?: SchematicViewFamily;
  readonly deviceUid?: string;
}

export function invalidViewRequestError(
  context: InvalidViewRequestContext,
): InvalidViewRequestError {
  return Object.freeze({
    code: "R001",
    message: context.message,
    requestedFormat: context.requestedFormat,
    requestedRoot: context.requestedRoot,
    requestedFamily: context.requestedFamily,
    ...(context.requestedIntent === undefined
      ? {}
      : { requestedIntent: context.requestedIntent }),
    ...(context.requestedTarget === undefined
      ? {}
      : { requestedTarget: context.requestedTarget }),
    ...(context.requestedIncludePower === undefined
      ? {}
      : { requestedIncludePower: context.requestedIncludePower }),
    requestedFlow: context.requestedFlow,
    ...(context.family === undefined ? {} : { family: context.family }),
    ...(context.deviceUid === undefined
      ? {}
      : { deviceUid: context.deviceUid }),
    root: context.root,
  });
}

export function incompleteControlPathError(
  deviceUid: string,
  pathSide: "input" | "return",
  root: string,
): IncompletePathError {
  return Object.freeze({
    code: "R002",
    message: `Incomplete control view: no ${pathSide} path reaches a required boundary.`,
    family: "control",
    deviceUid,
    pathSide,
    root,
  });
}

export function incompletePowerPathError(
  deviceUid: string,
  lane: string,
  root: string,
): IncompletePathError {
  return Object.freeze({
    code: "R002",
    message: `Incomplete power view: lane ${JSON.stringify(lane)} does not reach a required boundary.`,
    family: "power",
    deviceUid,
    lane,
    root,
  });
}

export function incompleteTracePathError(
  deviceUid: string,
  targetDeviceUid: string,
  segment: "signal" | "positive-supply" | "return-supply",
  root: string,
): IncompletePathError {
  const messages = {
    signal:
      "Incomplete trace view: no signal path connects the requested devices.",
    "positive-supply":
      "Incomplete trace view: the requested root cannot reach a required positive-supply boundary.",
    "return-supply":
      "Incomplete trace view: the requested root cannot reach a required return-supply boundary.",
  } as const;
  return Object.freeze({
    code: "R002",
    family: "control",
    intent: "trace",
    deviceUid,
    targetDeviceUid,
    segment,
    message: messages[segment],
    root,
  });
}

export function incompleteConductorsPathError(
  cableUid: string,
  root: string,
): IncompletePathError {
  return Object.freeze({
    code: "R002",
    family: "control",
    intent: "conductors",
    cableUid,
    segment: "conductors",
    message:
      "Incomplete conductor view: the requested cable has no authored conductors.",
    root,
  });
}

export function incompleteLoadsPathError(
  deviceUid: string,
  root: string,
): IncompletePathError {
  return Object.freeze({
    code: "R002",
    family: "control",
    intent: "loads",
    deviceUid,
    segment: "complete-load",
    message:
      "Incomplete loads view: the requested source has no complete renderable load.",
    root,
  });
}

export interface UnsupportedSymbolMappingContext {
  readonly family: SchematicViewFamily;
  readonly deviceUid: string;
  readonly typeId: string;
  readonly functionKey?: string;
  readonly root: string;
}

export function unsupportedSymbolMappingError(
  context: UnsupportedSymbolMappingContext,
): UnsupportedSymbolMappingError {
  const scope =
    context.functionKey === undefined
      ? `type ${JSON.stringify(context.typeId)}`
      : `function ${JSON.stringify(context.functionKey)} on type ${JSON.stringify(context.typeId)}`;

  return Object.freeze({
    code: "R003",
    message: `Unsupported symbol mapping: ${scope} has no valid ${context.family} binding.`,
    family: context.family,
    deviceUid: context.deviceUid,
    typeId: context.typeId,
    ...(context.functionKey === undefined
      ? {}
      : { functionKey: context.functionKey }),
    root: context.root,
  });
}
