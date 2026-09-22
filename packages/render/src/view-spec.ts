import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
} from "@thermite/compiler";
import {
  createQueryEngine,
  type ObjectSelector,
  type QueryEngine,
  type QueryError,
} from "@thermite/query";

import {
  invalidViewRequestError,
  type InvalidViewRequestError,
  type RequestedBooleanInput,
  type RequestedIntentInput,
  type RequestedRootInput,
  type RequestedStringInput,
  type RuntimeInputType,
} from "./errors.js";
import {
  materializedTraceRootFunctions,
  traceRootRuleForType,
  validateTraceRootRules,
} from "./intent-rules.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  projectDeviceTypeSymbolMappings,
  type DeviceTypeSymbolMapping,
} from "./symbols/mappings.js";
import type {
  NormalizedIntentSchematicView,
  NormalizedLegacySchematicView,
  NormalizedSchematicView,
  SchematicFlow,
  SchematicViewFamily,
} from "./types.js";

type RuntimeInputClassification =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "record"; readonly value: object }
  | { readonly kind: "other"; readonly inputType: RuntimeInputType };

type OwnSnapshot =
  | { readonly kind: "missing" }
  | { readonly kind: "uninspectable" }
  | { readonly kind: "data"; readonly value: unknown };

interface CapturedValue {
  readonly snapshot: OwnSnapshot;
  readonly classification?: RuntimeInputClassification;
}

interface RequestDescriptorSnapshot {
  readonly requestedFormat: RequestedStringInput;
  readonly requestedRoot: RequestedRootInput;
  readonly requestedFamily: RequestedStringInput;
  readonly requestedIntent?: RequestedIntentInput;
  readonly requestedTarget?: RequestedRootInput;
  readonly requestedIncludePower?: RequestedBooleanInput;
  readonly requestedFlow: RequestedStringInput;
}

interface LegacyValidatedRequest extends RequestDescriptorSnapshot {
  readonly version: "legacy";
  readonly root: ObjectSelector;
  readonly family: SchematicViewFamily;
  readonly flow: SchematicFlow;
}

type IntentValidatedRequest =
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

type ValidatedRequest = LegacyValidatedRequest | IntentValidatedRequest;

interface PreparedDeviceSchematicView {
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

interface PreparedCableSchematicView {
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

export function classifyRuntimeInput(
  value: unknown,
): RuntimeInputClassification {
  try {
    const primitiveType = typeof value;
    if (value === undefined) return Object.freeze({ kind: "missing" });
    if (value === null) {
      return Object.freeze({ kind: "other", inputType: "null" });
    }
    if (Array.isArray(value)) {
      return Object.freeze({ kind: "other", inputType: "array" });
    }
    if (primitiveType === "string") {
      return Object.freeze({ kind: "string", value: value as string });
    }
    if (primitiveType === "object") {
      return Object.freeze({ kind: "record", value });
    }
    return Object.freeze({
      kind: "other",
      inputType: primitiveType as Exclude<
        RuntimeInputType,
        "null" | "array" | "object"
      >,
    });
  } catch {
    return Object.freeze({ kind: "uninspectable" });
  }
}

export function snapshotOwn(record: object, key: PropertyKey): OwnSnapshot {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) return Object.freeze({ kind: "missing" });
    if (!("value" in descriptor)) {
      return Object.freeze({ kind: "uninspectable" });
    }
    return Object.freeze({ kind: "data", value: descriptor.value });
  } catch {
    return Object.freeze({ kind: "uninspectable" });
  }
}

function capture(snapshot: OwnSnapshot): CapturedValue {
  return Object.freeze({
    snapshot,
    ...(snapshot.kind === "data"
      ? { classification: classifyRuntimeInput(snapshot.value) }
      : {}),
  });
}

function requestedString(captured: CapturedValue): RequestedStringInput {
  if (captured.snapshot.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (captured.snapshot.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  const classification = captured.classification!;
  switch (classification.kind) {
    case "missing":
      return Object.freeze({ kind: "missing" });
    case "uninspectable":
      return Object.freeze({ kind: "uninspectable" });
    case "string":
      return Object.freeze({ kind: "string", value: classification.value });
    case "record":
      return Object.freeze({ kind: "non-string", inputType: "object" });
    case "other":
      return Object.freeze({
        kind: "non-string",
        inputType: classification.inputType,
      });
  }
}

function requestedRoot(captured: CapturedValue): RequestedRootInput {
  if (captured.snapshot.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (captured.snapshot.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  const classification = captured.classification!;
  if (classification.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (classification.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  if (classification.kind === "string") {
    return Object.freeze({ kind: "non-object", inputType: "string" });
  }
  if (classification.kind === "other") {
    return Object.freeze({
      kind: "non-object",
      inputType: classification.inputType,
    });
  }

  const bySnapshot = snapshotOwn(classification.value, "by");
  const valueSnapshot = snapshotOwn(classification.value, "value");
  const by = requestedString(capture(bySnapshot));
  const value = requestedString(capture(valueSnapshot));
  if (
    by.kind === "string" &&
    (by.value === "uid" || by.value === "designation") &&
    value.kind === "string"
  ) {
    return Object.freeze({
      kind: "selector",
      by: by.value,
      value: value.value,
    });
  }
  return Object.freeze({
    kind: "malformed-selector",
    by,
    value,
  });
}

function requestedBoolean(captured: CapturedValue): RequestedBooleanInput {
  if (captured.snapshot.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (captured.snapshot.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  const classification = captured.classification!;
  if (classification.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (classification.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  if (
    classification.kind === "other" &&
    classification.inputType === "boolean"
  ) {
    return Object.freeze({
      kind: "boolean",
      value: captured.snapshot.value as boolean,
    });
  }
  return Object.freeze({
    kind: "non-boolean",
    inputType:
      classification.kind === "string"
        ? "string"
        : classification.kind === "record"
          ? "object"
          : classification.inputType,
  });
}

function requestedIntent(
  captured: CapturedValue,
  kindSnapshot?: OwnSnapshot,
): RequestedIntentInput {
  if (captured.snapshot.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (captured.snapshot.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  const classification = captured.classification!;
  if (classification.kind === "missing") {
    return Object.freeze({ kind: "missing" });
  }
  if (classification.kind === "uninspectable") {
    return Object.freeze({ kind: "uninspectable" });
  }
  if (classification.kind === "string") {
    return Object.freeze({ kind: "non-object", inputType: "string" });
  }
  if (classification.kind === "other") {
    return Object.freeze({
      kind: "non-object",
      inputType: classification.inputType,
    });
  }
  const intentKind = requestedString(capture(kindSnapshot!));
  if (
    intentKind.kind === "string" &&
    (intentKind.value === "trace" ||
      intentKind.value === "conductors" ||
      intentKind.value === "loads")
  ) {
    return Object.freeze({ kind: "intent", value: intentKind.value });
  }
  return Object.freeze({ kind: "malformed-intent", intentKind });
}

function uninspectableDescriptors(): RequestDescriptorSnapshot {
  return Object.freeze({
    requestedFormat: Object.freeze({ kind: "uninspectable" }),
    requestedRoot: Object.freeze({ kind: "uninspectable" }),
    requestedFamily: Object.freeze({ kind: "uninspectable" }),
    requestedFlow: Object.freeze({ kind: "uninspectable" }),
  });
}

function missingDescriptors(): RequestDescriptorSnapshot {
  return Object.freeze({
    requestedFormat: Object.freeze({ kind: "missing" }),
    requestedRoot: Object.freeze({ kind: "missing" }),
    requestedFamily: Object.freeze({ kind: "missing" }),
    requestedFlow: Object.freeze({ kind: "missing" }),
  });
}

function captureLegacyRequest(
  record: object,
  formatSnapshot: OwnSnapshot,
): RequestDescriptorSnapshot {
  const rootSnapshot = snapshotOwn(record, "root");
  const familySnapshot = snapshotOwn(record, "family");
  const flowSnapshot = snapshotOwn(record, "flow");

  const format = capture(formatSnapshot);
  const root = capture(rootSnapshot);
  const family = capture(familySnapshot);
  const flow = capture(flowSnapshot);

  return Object.freeze({
    requestedFormat: requestedString(format),
    requestedRoot: requestedRoot(root),
    requestedFamily: requestedString(family),
    requestedFlow: requestedString(flow),
  });
}

interface CapturedIntentRequest {
  readonly descriptors: RequestDescriptorSnapshot;
  readonly targetPresent: boolean;
  readonly includePowerPresent: boolean;
}

function captureIntentRequest(
  record: object,
  formatSnapshot: OwnSnapshot,
): CapturedIntentRequest {
  const rootSnapshot = snapshotOwn(record, "root");
  const intentSnapshot = snapshotOwn(record, "intent");
  const flowSnapshot = snapshotOwn(record, "flow");

  const format = capture(formatSnapshot);
  const root = capture(rootSnapshot);
  const intent = capture(intentSnapshot);
  const flow = capture(flowSnapshot);
  const intentRecord =
    intent.classification?.kind === "record"
      ? intent.classification.value
      : undefined;
  const kindSnapshot =
    intentRecord === undefined ? undefined : snapshotOwn(intentRecord, "kind");
  const targetSnapshot =
    intentRecord === undefined ? undefined : snapshotOwn(intentRecord, "to");
  const includePowerSnapshot =
    intentRecord === undefined
      ? undefined
      : snapshotOwn(intentRecord, "includePower");
  const intentDescriptor = requestedIntent(intent, kindSnapshot);
  const targetPresent =
    targetSnapshot !== undefined && targetSnapshot.kind !== "missing";
  const includePowerPresent =
    includePowerSnapshot !== undefined &&
    includePowerSnapshot.kind !== "missing";
  const recognizedTrace =
    intentDescriptor.kind === "intent" && intentDescriptor.value === "trace";

  return Object.freeze({
    descriptors: Object.freeze({
      requestedFormat: requestedString(format),
      requestedRoot: requestedRoot(root),
      requestedFamily: Object.freeze({ kind: "missing" }),
      requestedIntent: intentDescriptor,
      ...(!recognizedTrace && !targetPresent
        ? {}
        : { requestedTarget: requestedRoot(capture(targetSnapshot!)) }),
      ...(!recognizedTrace && !includePowerPresent
        ? {}
        : {
            requestedIncludePower: requestedBoolean(
              capture(includePowerSnapshot!),
            ),
          }),
      requestedFlow: requestedString(flow),
    }),
    targetPresent,
    includePowerPresent,
  });
}

function canonicalRoot(requested: RequestedRootInput): string {
  switch (requested.kind) {
    case "missing":
      return "<missing>";
    case "uninspectable":
      return "<uninspectable-root>";
    case "selector":
      return requested.value;
    case "non-object":
      return `<invalid-root:${requested.inputType}>`;
    case "malformed-selector":
      return "<invalid-root-selector>";
  }
}

function received(input: RequestedStringInput): string {
  switch (input.kind) {
    case "missing":
      return "missing";
    case "uninspectable":
      return "uninspectable";
    case "string":
      return `'${input.value}'`;
    case "non-string":
      return input.inputType;
  }
}

function receivedIntent(input: RequestedIntentInput): string {
  return input.kind === "malformed-intent"
    ? received(input.intentKind)
    : input.kind;
}

function receivedBoolean(input: RequestedBooleanInput): string {
  return input.kind === "non-boolean" ? input.inputType : input.kind;
}

function invalid(
  message: string,
  descriptors: RequestDescriptorSnapshot,
  root: string,
  family?: SchematicViewFamily,
  deviceUid?: string,
): NormalizeSchematicViewResult {
  return Object.freeze({
    ok: false,
    error: invalidViewRequestError({
      message,
      ...descriptors,
      root,
      ...(family === undefined ? {} : { family }),
      ...(deviceUid === undefined ? {} : { deviceUid }),
    }),
  });
}

function validatedFlow(
  descriptors: RequestDescriptorSnapshot,
  root: string,
  family?: SchematicViewFamily,
): SchematicFlow | NormalizeSchematicViewResult {
  if (descriptors.requestedFlow.kind === "uninspectable") {
    return invalid(
      "Invalid flow: property is uninspectable.",
      descriptors,
      root,
      family,
    );
  }
  if (
    descriptors.requestedFlow.kind !== "missing" &&
    (descriptors.requestedFlow.kind !== "string" ||
      (descriptors.requestedFlow.value !== "left-to-right" &&
        descriptors.requestedFlow.value !== "top-to-bottom"))
  ) {
    return invalid(
      `Invalid flow: expected left-to-right or top-to-bottom; received ${received(descriptors.requestedFlow)}.`,
      descriptors,
      root,
      family,
    );
  }
  return descriptors.requestedFlow.kind === "missing"
    ? "left-to-right"
    : (descriptors.requestedFlow.value as SchematicFlow);
}

function validateLegacyRequest(
  descriptors: RequestDescriptorSnapshot,
): LegacyValidatedRequest | NormalizeSchematicViewResult {
  const root = canonicalRoot(descriptors.requestedRoot);
  if (descriptors.requestedFormat.kind === "uninspectable") {
    return invalid(
      "Invalid format: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (
    descriptors.requestedFormat.kind !== "string" ||
    descriptors.requestedFormat.value !== "schematic-view-request/0.1"
  ) {
    return invalid(
      `Invalid format: expected schematic-view-request/0.1; received ${received(descriptors.requestedFormat)}.`,
      descriptors,
      root,
    );
  }
  if (descriptors.requestedRoot.kind === "uninspectable") {
    return invalid(
      "Invalid root: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (descriptors.requestedRoot.kind !== "selector") {
    return invalid(
      "Invalid root: expected { by: 'uid' | 'designation', value: string }.",
      descriptors,
      root,
    );
  }
  if (descriptors.requestedFamily.kind === "uninspectable") {
    return invalid(
      "Invalid family: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (
    descriptors.requestedFamily.kind !== "string" ||
    (descriptors.requestedFamily.value !== "control" &&
      descriptors.requestedFamily.value !== "power")
  ) {
    return invalid(
      `Invalid family: expected control or power; received ${received(descriptors.requestedFamily)}.`,
      descriptors,
      root,
    );
  }
  const normalizedFlow = validatedFlow(
    descriptors,
    root,
    descriptors.requestedFamily.value,
  );
  if (typeof normalizedFlow !== "string") return normalizedFlow;
  return Object.freeze({
    ...descriptors,
    version: "legacy",
    root: Object.freeze({
      by: descriptors.requestedRoot.by,
      value: descriptors.requestedRoot.value,
    }),
    family: descriptors.requestedFamily.value,
    flow: normalizedFlow,
  });
}

function validateIntentRequest(
  captured: CapturedIntentRequest,
): IntentValidatedRequest | NormalizeSchematicViewResult {
  const { descriptors } = captured;
  const root = canonicalRoot(descriptors.requestedRoot);
  if (descriptors.requestedRoot.kind === "uninspectable") {
    return invalid(
      "Invalid root: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (descriptors.requestedRoot.kind !== "selector") {
    return invalid(
      "Invalid root: expected { by: 'uid' | 'designation', value: string }.",
      descriptors,
      root,
    );
  }
  const intentDescriptor = descriptors.requestedIntent!;
  if (intentDescriptor.kind === "uninspectable") {
    return invalid(
      "Invalid intent: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (
    intentDescriptor.kind === "missing" ||
    intentDescriptor.kind === "non-object"
  ) {
    return invalid("Invalid intent: expected an object.", descriptors, root);
  }
  if (
    intentDescriptor.kind === "malformed-intent" &&
    intentDescriptor.intentKind.kind === "uninspectable"
  ) {
    return invalid(
      "Invalid intent kind: property is uninspectable.",
      descriptors,
      root,
    );
  }
  if (intentDescriptor.kind === "malformed-intent") {
    return invalid(
      `Invalid intent kind: expected trace, conductors, or loads; received ${receivedIntent(intentDescriptor)}.`,
      descriptors,
      root,
    );
  }
  const intent = intentDescriptor.value;
  if (intent !== "trace" && captured.targetPresent) {
    return invalid(
      `Invalid ${intent} intent: property 'to' is not allowed.`,
      descriptors,
      root,
      "control",
    );
  }
  if (intent !== "trace" && captured.includePowerPresent) {
    return invalid(
      `Invalid ${intent} intent: property 'includePower' is not allowed.`,
      descriptors,
      root,
      "control",
    );
  }
  if (intent === "trace") {
    const target = descriptors.requestedTarget!;
    if (target.kind === "uninspectable") {
      return invalid(
        "Invalid trace target: property is uninspectable.",
        descriptors,
        root,
        "control",
      );
    }
    if (target.kind !== "selector") {
      return invalid(
        "Invalid trace target: expected { by: 'uid' | 'designation', value: string }.",
        descriptors,
        root,
        "control",
      );
    }
    const includePower = descriptors.requestedIncludePower!;
    if (includePower.kind === "uninspectable") {
      return invalid(
        "Invalid trace includePower: property is uninspectable.",
        descriptors,
        root,
        "control",
      );
    }
    if (includePower.kind !== "boolean") {
      return invalid(
        `Invalid trace includePower: expected boolean; received ${receivedBoolean(includePower)}.`,
        descriptors,
        root,
        "control",
      );
    }
    const flow = validatedFlow(descriptors, root, "control");
    if (typeof flow !== "string") return flow;
    return Object.freeze({
      ...descriptors,
      version: "intent",
      root: Object.freeze({
        by: descriptors.requestedRoot.by,
        value: descriptors.requestedRoot.value,
      }),
      intent,
      target: Object.freeze({ by: target.by, value: target.value }),
      includePower: includePower.value,
      flow,
    });
  }
  const flow = validatedFlow(descriptors, root, "control");
  if (typeof flow !== "string") return flow;
  return Object.freeze({
    ...descriptors,
    version: "intent",
    root: Object.freeze({
      by: descriptors.requestedRoot.by,
      value: descriptors.requestedRoot.value,
    }),
    intent,
    flow,
  });
}

function validateCapturedRequest(
  request: unknown,
): ValidatedRequest | NormalizeSchematicViewResult {
  const requestClassification = classifyRuntimeInput(request);
  if (requestClassification.kind === "uninspectable") {
    return invalid(
      "Invalid request: unable to inspect object.",
      uninspectableDescriptors(),
      "<uninspectable-request>",
    );
  }
  if (requestClassification.kind !== "record") {
    return invalid(
      "Invalid request: expected an object.",
      missingDescriptors(),
      "<missing>",
    );
  }
  const formatSnapshot = snapshotOwn(requestClassification.value, "format");
  if (
    formatSnapshot.kind === "data" &&
    formatSnapshot.value === "schematic-view-request/0.2"
  ) {
    return validateIntentRequest(
      captureIntentRequest(requestClassification.value, formatSnapshot),
    );
  }
  return validateLegacyRequest(
    captureLegacyRequest(requestClassification.value, formatSnapshot),
  );
}

function matchingFunction(
  functions: readonly IrFunction[],
  deviceUid: string,
  functionKey: string,
): IrFunction | undefined {
  const matches = functions.filter(
    ({ id }) => id.deviceUid === deviceUid && id.functionKey === functionKey,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function rootSupportsFamily(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
  family: SchematicViewFamily,
): boolean {
  if (family === "control") {
    const roots = mapping.functions.filter(
      (rule) =>
        rule.families.includes("control") && rule.traversalRole === "coil-root",
    );
    if (roots.length !== 1) return false;
    const root = roots[0]!;
    const materialized = matchingFunction(
      ir.functions,
      device.uid,
      root.functionKey,
    );
    return (
      materialized !== undefined &&
      materialized.terminals.length === 2 &&
      root.bindings.some(({ portId }) => portId === "A1") &&
      root.bindings.some(({ portId }) => portId === "A2")
    );
  }

  const aggregateBindings = mapping.aggregates
    .filter(
      (rule) =>
        rule.families.includes("power") &&
        rule.traversalRole === "load-boundary",
    )
    .flatMap((rule) => rule.bindings);
  const functionBindings = mapping.functions
    .filter(
      (rule) =>
        rule.families.includes("power") &&
        rule.traversalRole === "load-boundary",
    )
    .flatMap((rule) => rule.bindings);
  return [...aggregateBindings, ...functionBindings].some(({ terminalKey }) =>
    ir.terminals.some(
      ({ id }) => id.deviceUid === device.uid && id.terminalKey === terminalKey,
    ),
  );
}

function rootSupportsTrace(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  deviceType: IrDeviceType,
  mappings: readonly DeviceTypeSymbolMapping[],
): boolean {
  validateTraceRootRules(ir.deviceTypes, mappings);
  const rule = traceRootRuleForType(device.typeId);
  if (rule === undefined) return false;
  materializedTraceRootFunctions(rule, device.uid, deviceType, ir.functions);
  return true;
}

function targetHasMappedInput(
  ir: Readonly<ElectricalIr>,
  target: IrDevice,
  mapping: DeviceTypeSymbolMapping | undefined,
): boolean {
  if (mapping === undefined) return false;
  return mapping.functions.some((rule) => {
    if (
      !rule.families.includes("control") ||
      rule.traversalRole !== "channel-boundary"
    ) {
      return false;
    }
    const materialized = matchingFunction(
      ir.functions,
      target.uid,
      rule.functionKey,
    );
    return (
      materialized?.kind === "channel" &&
      materialized.direction === "input" &&
      materialized.terminals.length === 1
    );
  });
}

function rootSupportsLoads(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
): boolean {
  const sourceRules = mapping.functions.filter(
    (rule) =>
      rule.families.includes("control") &&
      rule.classification === "source" &&
      rule.traversalRole === "source-boundary",
  );
  if (sourceRules.length !== 1) return false;
  const source = sourceRules[0]!;
  if (
    matchingFunction(ir.functions, device.uid, source.functionKey) === undefined
  ) {
    return false;
  }
  const boundaries = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.functionKey === source.functionKey &&
      rule.families.includes("control") &&
      (rule.boundaryKind === "control-source" ||
        rule.boundaryKind === "control-return"),
  );
  if (
    boundaries.length !== 2 ||
    boundaries.filter(({ boundaryKind }) => boundaryKind === "control-source")
      .length !== 1 ||
    boundaries.filter(({ boundaryKind }) => boundaryKind === "control-return")
      .length !== 1 ||
    source.bindings.length !== 2 ||
    new Set(source.bindings.map(({ terminalKey }) => terminalKey)).size !== 2
  ) {
    return false;
  }
  return source.bindings.every((binding) => {
    const boundary = boundaries.find(
      ({ terminalKey }) => terminalKey === binding.terminalKey,
    );
    const terminal = ir.terminals.find(
      ({ id }) =>
        id.deviceUid === device.uid && id.terminalKey === binding.terminalKey,
    );
    return (
      boundary !== undefined &&
      terminal !== undefined &&
      terminal.role === boundary.requiredRole
    );
  });
}

function resolvedDeviceFacts(ir: Readonly<ElectricalIr>, uid: string) {
  const device = ir.devices.find((candidate) => candidate.uid === uid);
  if (device === undefined) {
    throw new Error(
      `Resolved device ${JSON.stringify(uid)} is absent from ElectricalIr.`,
    );
  }
  const deviceType = ir.deviceTypes.find(({ id }) => id === device.typeId);
  if (deviceType === undefined) {
    throw new Error(
      `Resolved device type ${JSON.stringify(device.typeId)} is absent from ElectricalIr.`,
    );
  }
  return { device, deviceType };
}

function preparedDevice(
  view: PreparedDeviceSchematicView["view"],
  engine: QueryEngine,
  rootDevice: IrDevice,
  rootDeviceType: IrDeviceType,
  rootMapping: DeviceTypeSymbolMapping,
  mappings: readonly DeviceTypeSymbolMapping[],
): NormalizeSchematicViewResult {
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      view,
      engine,
      rootDevice,
      rootDeviceType,
      rootMapping,
      mappings,
    }),
  });
}

export function normalizeSchematicView(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  options: ViewNormalizationOptions = {},
): NormalizeSchematicViewResult {
  const captured = validateCapturedRequest(request);
  if ("ok" in captured) return captured;

  const mappings = options.mappings ?? projectDeviceTypeSymbolMappings(ir);
  const engine = (options.queryEngineFactory ?? createQueryEngine)(ir);
  const canonical = captured.root.value;

  if (captured.version === "intent" && captured.intent === "conductors") {
    const cable = engine.cable(captured.root);
    if (!cable.ok) return Object.freeze(cable);
    const view: Extract<
      NormalizedIntentSchematicView,
      { readonly intent: "conductors" }
    > = Object.freeze({
      format: "schematic-view/0.2",
      family: "control",
      intent: "conductors",
      root: Object.freeze({
        kind: "cable",
        cableUid: cable.value.cable.uid,
        designation: cable.value.cable.designation,
      }),
      flow: captured.flow,
    });
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        view,
        engine,
        rootSelector: captured.root,
        mappings,
      }),
    });
  }

  const resolved = engine.resolveObject(captured.root);
  if (!resolved.ok) return Object.freeze(resolved);
  const family = captured.version === "legacy" ? captured.family : "control";
  const intent = captured.version === "intent" ? captured.intent : undefined;
  if (resolved.value.kind !== "device") {
    const scope = intent === undefined ? "root" : `${intent} root`;
    return invalid(
      `Invalid ${scope}: expected a device; resolved ${resolved.value.kind}.`,
      captured,
      canonical,
      family,
    );
  }
  const { device: rootDevice, deviceType: rootDeviceType } =
    resolvedDeviceFacts(ir, resolved.value.uid);
  const rootMapping = mappings.find(
    ({ typeId }) => typeId === rootDevice.typeId,
  );

  if (captured.version === "legacy") {
    if (
      rootMapping === undefined ||
      !rootSupportsFamily(ir, rootDevice, rootMapping, captured.family)
    ) {
      const contract =
        captured.family === "control"
          ? "exactly one mapped coil root"
          : "at least one mapped load terminal";
      return invalid(
        `Invalid ${captured.family} root: expected ${contract}.`,
        captured,
        canonical,
        captured.family,
        rootDevice.uid,
      );
    }
    const view: NormalizedLegacySchematicView = Object.freeze({
      format: "schematic-view/0.1",
      family: captured.family,
      root: Object.freeze({
        deviceUid: rootDevice.uid,
        designation: rootDevice.designation,
      }),
      flow: captured.flow,
    });
    return preparedDevice(
      view,
      engine,
      rootDevice,
      rootDeviceType,
      rootMapping,
      mappings,
    );
  }

  if (captured.intent === "trace") {
    if (
      rootMapping === undefined ||
      !rootSupportsTrace(ir, rootDevice, rootDeviceType, mappings)
    ) {
      return invalid(
        "Invalid trace root: expected one supported mapped trace-root rule.",
        captured,
        canonical,
        "control",
        rootDevice.uid,
      );
    }
    const target = engine.resolveObject(captured.target);
    if (!target.ok) return Object.freeze(target);
    if (target.value.kind !== "device") {
      return invalid(
        `Invalid trace target: expected a device; resolved ${target.value.kind}.`,
        captured,
        canonical,
        "control",
        rootDevice.uid,
      );
    }
    if (target.value.uid === rootDevice.uid) {
      return invalid(
        "Invalid trace target: expected a device different from the root.",
        captured,
        canonical,
        "control",
        rootDevice.uid,
      );
    }
    const { device: targetDevice } = resolvedDeviceFacts(ir, target.value.uid);
    const targetMapping = mappings.find(
      ({ typeId }) => typeId === targetDevice.typeId,
    );
    if (!targetHasMappedInput(ir, targetDevice, targetMapping)) {
      return invalid(
        "Invalid trace target: expected at least one mapped input channel.",
        captured,
        canonical,
        "control",
        rootDevice.uid,
      );
    }
    const view: Extract<
      NormalizedIntentSchematicView,
      { readonly intent: "trace" }
    > = Object.freeze({
      format: "schematic-view/0.2",
      family: "control",
      intent: "trace",
      root: Object.freeze({
        kind: "device",
        deviceUid: rootDevice.uid,
        designation: rootDevice.designation,
      }),
      target: Object.freeze({
        deviceUid: targetDevice.uid,
        designation: targetDevice.designation,
      }),
      includePower: captured.includePower,
      flow: captured.flow,
    });
    return preparedDevice(
      view,
      engine,
      rootDevice,
      rootDeviceType,
      rootMapping,
      mappings,
    );
  }

  if (
    rootMapping === undefined ||
    !rootSupportsLoads(ir, rootDevice, rootMapping)
  ) {
    return invalid(
      "Invalid loads root: expected exactly one mapped control source with a source/return terminal pair.",
      captured,
      canonical,
      "control",
      rootDevice.uid,
    );
  }
  const view: Extract<
    NormalizedIntentSchematicView,
    { readonly intent: "loads" }
  > = Object.freeze({
    format: "schematic-view/0.2",
    family: "control",
    intent: "loads",
    root: Object.freeze({
      kind: "device",
      deviceUid: rootDevice.uid,
      designation: rootDevice.designation,
    }),
    flow: captured.flow,
  });
  return preparedDevice(
    view,
    engine,
    rootDevice,
    rootDeviceType,
    rootMapping,
    mappings,
  );
}
