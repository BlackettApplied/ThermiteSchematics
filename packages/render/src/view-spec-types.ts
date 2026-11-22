import type { ElectricalIr, IrDevice, IrDeviceType } from "@thermite/compiler";
import type { ObjectSelector, QueryEngine, QueryError } from "@thermite/query";
import type {
  InvalidViewRequestError,
  RequestedStringInput,
  RequestedRootInput,
  RequestedIntentInput,
  RequestedBooleanInput,
  RuntimeInputType,
} from "./errors.js";
import type {
  NormalizedIntentSchematicView,
  NormalizedSchematicView,
  SchematicFlow,
  SchematicViewFamily,
} from "./types.js";
import type { DeviceTypeSymbolMapping } from "./symbols/mappings.js";

export type RuntimeInputClassification =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "record"; readonly value: object }
  | { readonly kind: "other"; readonly inputType: RuntimeInputType };

export type OwnSnapshot =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "data"; readonly value: unknown };

export interface CapturedValue {
  readonly snapshot: OwnSnapshot;
  readonly classification?: RuntimeInputClassification;
}

export interface RequestDescriptorSnapshot {
  readonly requestedFormat: RequestedStringInput;
  readonly requestedRoot: RequestedRootInput;
  readonly requestedFamily: RequestedStringInput;
  readonly requestedIntent?: RequestedIntentInput;
  readonly requestedTarget?: RequestedRootInput;
  readonly requestedIncludePower?: RequestedBooleanInput;
  readonly requestedFlow: RequestedStringInput;
}

export interface LegacyValidatedRequest extends RequestDescriptorSnapshot {
  readonly version: "legacy";
  readonly root: ObjectSelector;
  readonly family: SchematicViewFamily;
  readonly flow: SchematicFlow;
}

export type IntentValidatedRequest =
  | (RequestDescriptorSnapshot & {
      readonly version: "intent";
      readonly root: ObjectSelector;
      readonly intent: "trace";
      readonly target: ObjectSelector;
      readonly includePower: boolean;
      readonly flow: SchematicFlow;
    })
  | (RequestDescriptorSnapshot & {
      readonly version: "intent";
      readonly root: ObjectSelector;
      readonly intent: "conductors" | "loads";
      readonly flow: SchematicFlow;
    });

export type ValidatedRequest = LegacyValidatedRequest | IntentValidatedRequest;

export interface PreparedDeviceSchematicView {
  readonly view: Exclude<
    NormalizedSchematicView,
    Extract<NormalizedIntentSchematicView, { readonly intent: "conductors" }>
  >;
  readonly engine: QueryEngine;
  readonly rootDevice: IrDevice;
  readonly rootDeviceType: IrDeviceType;
  readonly rootMapping: DeviceTypeSymbolMapping;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
}

export interface PreparedCableSchematicView {
  readonly view: Extract<
    NormalizedIntentSchematicView,
    { readonly intent: "conductors" }
  >;
  readonly engine: QueryEngine;
  readonly rootSelector: ObjectSelector;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
}

export type PreparedSchematicView =
  PreparedDeviceSchematicView | PreparedCableSchematicView;

export type NormalizeSchematicViewResult =
  | { readonly ok: true; readonly value: PreparedSchematicView }
  | {
      readonly ok: false;
      readonly error: InvalidViewRequestError | QueryError;
    };

export interface ViewNormalizationOptions {
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
  readonly queryEngineFactory?: (ir: Readonly<ElectricalIr>) => QueryEngine;
}
