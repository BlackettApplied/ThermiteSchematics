import type { ElectricalIr } from "@thermite/compiler";

import type {
  RequestedBooleanInput,
  RequestedIntentInput,
  RequestedRootInput,
  RequestedStringInput,
  RuntimeInputType,
} from "./errors.js";
import type { SchematicFlow, SchematicViewFamily } from "./types.js";
import { invalid } from "./view-request-errors.js";
import { normalizeCapturedView } from "./view-normalization.js";
import type {
  RuntimeInputClassification,
  OwnSnapshot,
  CapturedValue,
  RequestDescriptorSnapshot,
  LegacyValidatedRequest,
  IntentValidatedRequest,
  ValidatedRequest,
  NormalizeSchematicViewResult,
  ViewNormalizationOptions,
} from "./view-spec-types.js";
export type {
  PreparedSchematicView,
  NormalizeSchematicViewResult,
  ViewNormalizationOptions,
} from "./view-spec-types.js";

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

export function normalizeSchematicView(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  options: ViewNormalizationOptions = {},
): NormalizeSchematicViewResult {
  const captured = validateCapturedRequest(request);
  if ("ok" in captured) return captured;
  return normalizeCapturedView(ir, captured, options);
}
