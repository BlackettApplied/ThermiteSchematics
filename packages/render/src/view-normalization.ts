import { SYMBOL_PROFILES, symbolProfile } from "@thermite/schema";
import {
  formatSymbolFunctionShape,
  symbolFunctionMatchesShape,
} from "@thermite/compiler";
import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
} from "@thermite/compiler";
import { createQueryEngine, type QueryEngine } from "@thermite/query";
import {
  acceptedTraceRoots,
  acceptedTraceRootDescription,
} from "./intent-rules.js";
import {
  rootProfileFunction,
  unsupportedProfileError,
  sensorRoleProblem,
} from "./preflight.js";
import type { InvalidViewRequestError } from "./errors.js";
import {
  projectDeviceTypeSymbolMappings,
  type DeviceTypeSymbolMapping,
} from "./symbols/mappings.js";
import {
  rootSupportsFamily,
  rootSupportsTrace,
  rootSupportsLoads,
  targetHasMappedInput,
} from "./view-roots.js";
import { invalid, rejectedView } from "./view-request-errors.js";
import type {
  NormalizedIntentSchematicView,
  NormalizedLegacySchematicView,
  SchematicViewFamily,
} from "./types.js";
import type {
  ValidatedRequest,
  IntentValidatedRequest,
  LegacyValidatedRequest,
  PreparedDeviceSchematicView,
  NormalizeSchematicViewResult,
  ViewNormalizationOptions,
} from "./view-spec-types.js";

type RootKind = "power" | "control" | "loads" | "trace";
interface DeviceContext {
  ir: Readonly<ElectricalIr>;
  captured: ValidatedRequest;
  engine: QueryEngine;
  mappings: readonly DeviceTypeSymbolMapping[];
  canonical: string;
  family: SchematicViewFamily;
  rootDevice: IrDevice;
  rootDeviceType: IrDeviceType;
  rootMapping: DeviceTypeSymbolMapping | undefined;
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

/** Root contracts come from the same executable roles and catalog shapes as binding. */
function acceptedRootContracts(kind: "power" | "control" | "loads" | "trace") {
  if (kind === "trace")
    return acceptedTraceRoots().map((r) => ({
      profile: r.profile,
      aliases: r.aliases,
      shapes: r.functions.map(
        (f) =>
          `${f.kind}/${f.terminalCount}${"normalState" in f ? `, normal state ${f.normalState}` : ""}${"direction" in f ? `, direction ${f.direction}` : ""}`,
      ),
    }));
  const family = kind;
  const fnKind =
    kind === "power" ? "load" : kind === "control" ? "coil" : "source";
  // These kinds receive load-boundary, coil-root and source-boundary roles in
  // projectDeviceTypeSymbolMappings. Include reusable profiles beyond core types.
  return SYMBOL_PROFILES.flatMap((p) => {
    const shapes = [
      ...new Set(
        p.support
          .filter((s) => s.family === family)
          .flatMap((s) =>
            s.functions
              .filter((f) => f.kind === fnKind)
              .map(formatSymbolFunctionShape),
          ),
      ),
    ];
    return shapes.length
      ? [
          {
            profile: p.id,
            aliases: [...p.aliases, ...p.coreAliases.map((b) => b.symbol)],
            shapes,
          },
        ]
      : [];
  });
}
function acceptedRootDescription(
  kind: "power" | "control" | "loads" | "trace",
) {
  if (kind === "trace") return acceptedTraceRootDescription();
  return acceptedRootContracts(kind)
    .map((r) =>
      "shapes" in r
        ? `${r.profile}${r.aliases.length ? ` (aliases ${r.aliases.join(", ")})` : ""}: ${r.shapes.join(" or ")}`
        : "",
    )
    .join("; ");
}

export function normalizeCapturedView(
  ir: Readonly<ElectricalIr>,
  captured: ValidatedRequest,
  options: ViewNormalizationOptions,
): NormalizeSchematicViewResult {
  const mappings = options.mappings ?? projectDeviceTypeSymbolMappings(ir);
  const engine = (options.queryEngineFactory ?? createQueryEngine)(ir);
  const canonical = captured.root.value;

  if (captured.version === "intent" && captured.intent === "conductors") {
    return normalizeConductors(captured, engine, mappings);
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

  const context: DeviceContext = {
    ir,
    captured,
    engine,
    mappings,
    canonical,
    family,
    rootDevice,
    rootDeviceType,
    rootMapping,
  };

  if (captured.version === "legacy") return normalizeLegacy(context, captured);
  if (captured.intent === "trace") return normalizeTrace(context, captured);
  return normalizeLoads(context, captured);
}
function normalizeConductors(
  captured: Extract<IntentValidatedRequest, { intent: "conductors" | "loads" }>,
  engine: QueryEngine,
  mappings: readonly DeviceTypeSymbolMapping[],
): NormalizeSchematicViewResult {
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
function normalizeLegacy(
  context: DeviceContext,
  captured: LegacyValidatedRequest,
): NormalizeSchematicViewResult {
  const {
    ir,
    rootMapping,
    rootDevice,
    canonical,
    engine,
    rootDeviceType,
    mappings,
  } = context;

  if (
    rootMapping === undefined ||
    !rootSupportsFamily(ir, rootDevice, rootMapping, captured.family)
  ) {
    const contract =
      captured.family === "control"
        ? "exactly one mapped coil root"
        : "at least one mapped load terminal";
    const rejected = invalid(
      `Invalid ${captured.family} root: expected ${contract}.`,
      captured,
      canonical,
      captured.family,
      rootDevice.uid,
    );
    return !rejected.ok && rejected.error.code === "R001"
      ? rejectRoot(context, rejected.error, captured.family)
      : rejected;
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
function normalizeTrace(
  context: DeviceContext,
  captured: Extract<IntentValidatedRequest, { intent: "trace" }>,
): NormalizeSchematicViewResult {
  const {
    ir,
    rootMapping,
    rootDevice,
    rootDeviceType,
    mappings,
    engine,
    canonical,
  } = context;

  if (
    rootMapping === undefined ||
    !rootSupportsTrace(ir, rootDevice, rootDeviceType, mappings)
  ) {
    const rejected = invalid(
      "Invalid trace root: expected one supported mapped trace-root rule.",
      captured,
      canonical,
      "control",
      rootDevice.uid,
    );
    if (rejected.ok || rejected.error.code !== "R001") return rejected;
    return rejectRoot(context, rejected.error, "trace");
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
    return rejectTraceTarget(context, targetDevice);
  }
  return preparedTraceView(context, captured, targetDevice, rootMapping);
}

function preparedTraceView(
  context: DeviceContext,
  captured: Extract<IntentValidatedRequest, { intent: "trace" }>,
  targetDevice: IrDevice,
  rootMapping: DeviceTypeSymbolMapping,
): NormalizeSchematicViewResult {
  const { rootDevice, engine, rootDeviceType, mappings } = context;
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
function normalizeLoads(
  context: DeviceContext,
  captured: Extract<IntentValidatedRequest, { intent: "conductors" | "loads" }>,
): NormalizeSchematicViewResult {
  const {
    ir,
    rootMapping,
    rootDevice,
    canonical,
    engine,
    rootDeviceType,
    mappings,
  } = context;

  if (
    rootMapping === undefined ||
    !rootSupportsLoads(ir, rootDevice, rootMapping)
  ) {
    const rejected = invalid(
      "Invalid loads root: expected exactly one mapped control source with a source/return terminal pair.",
      captured,
      canonical,
      "control",
      rootDevice.uid,
    );
    return !rejected.ok && rejected.error.code === "R001"
      ? rejectRoot(context, rejected.error, "loads")
      : rejected;
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

function rootFamiliesFor(context: DeviceContext): string[] {
  const { ir, rootMapping, rootDevice, rootDeviceType, mappings } = context;
  const rootFamilies: string[] = [];
  if (rootMapping) {
    for (const f of ["power", "control"] as const)
      if (rootSupportsFamily(ir, rootDevice, rootMapping, f))
        rootFamilies.push(f);
    if (rootSupportsLoads(ir, rootDevice, rootMapping))
      rootFamilies.push("loads");
    if (rootSupportsTrace(ir, rootDevice, rootDeviceType, mappings))
      rootFamilies.push("trace");
  }

  return rootFamilies;
}
function diagnoseRoot(
  context: DeviceContext,
  error: InvalidViewRequestError,
  kind: RootKind,
  rootFamilies: string[],
) {
  const { ir, rootDevice, rootDeviceType, rootMapping, family } = context;
  const roleProblem = sensorRoleProblem(ir, rootDevice);
  const unsupported =
    roleProblem?.f ??
    rootProfileFunction(
      ir,
      rootDevice,
      rootMapping,
      family,
      kind === "trace" || kind === "loads" ? kind : undefined,
    );
  const ownProfile = SYMBOL_PROFILES.find(
    (p) => p.id === symbolProfile(rootDeviceType),
  );
  const badProfile = rootDeviceType.symbol !== undefined && !ownProfile;
  const drawable = rootDeviceType.functions.filter(
    (f) => f.kind !== "mechanism",
  );
  const badShape =
    ownProfile &&
    drawable.length > 0 &&
    drawable.every(
      (f) =>
        !Object.hasOwn(rootDeviceType.circuitSymbols ?? {}, f.key) &&
        !ownProfile.support.some((s) =>
          s.functions.some((shape) =>
            symbolFunctionMatchesShape(rootDeviceType, f, shape),
          ),
        ),
    );
  return unsupported || badProfile || badShape
    ? unsupportedProfileError(
        ir,
        error,
        rootDevice,
        unsupported,
        family,
        roleProblem?.cause ??
          (badShape
            ? "Declared functions do not fit this profile's cataloged shapes."
            : undefined),
      )
    : {
        ...error,
        reason: "root-not-accepted" as const,
        message: `${error.message} Device ${JSON.stringify(rootDevice.designation)} is not accepted as a ${kind} root. ${kind === "trace" ? "Accepted trace profiles and shapes" : "Accepted profiles and shapes"}: ${acceptedRootDescription(kind)}. ${rootFamilies.length ? `This device can root: ${rootFamilies.join(", ")}. Choose another root or family.` : "This device cannot root a supported family. Choose a different root device."}`,
        details: {
          ...error.details,
          reason: "root-not-accepted",
          designation: rootDevice.designation,
          typeId: rootDevice.typeId,
          profile: rootDeviceType.symbol ?? "<missing>",
          family,
        },
      };
}
function rejectRoot(
  context: DeviceContext,
  error: InvalidViewRequestError,
  kind: RootKind,
): NormalizeSchematicViewResult {
  const rootFamilies = rootFamiliesFor(context);
  const diagnosed = diagnoseRoot(context, error, kind, rootFamilies);
  return rejectedView({
    ...diagnosed,
    ...(diagnosed.reason === "unsupported-symbol-profile"
      ? {
          message: `${diagnosed.message} ${error.message} ${kind === "trace" ? "Accepted trace profiles and shapes" : "Accepted profiles and shapes"}: ${acceptedRootDescription(kind)}.`,
        }
      : {}),
    details: {
      ...diagnosed.details,
      acceptedRoots: acceptedRootContracts(kind),
      rootFamilies,
      ...(kind === "trace" ? { acceptedTraceRoots: acceptedTraceRoots() } : {}),
    },
  });
}

function diagnoseTraceTarget(
  context: DeviceContext,
  targetDevice: IrDevice,
  unsupported: IrFunction | undefined,
  rejectedError: InvalidViewRequestError,
) {
  const { ir } = context;
  const type = ir.deviceTypes.find((t) => t.id === targetDevice.typeId)!;
  const profile = SYMBOL_PROFILES.find((p) => p.id === symbolProfile(type));
  const ownShapeMismatch =
    unsupported &&
    profile &&
    !profile.support.some((s) =>
      s.functions.some((shape) =>
        symbolFunctionMatchesShape(
          type,
          type.functions.find((f) => f.key === unsupported.id.functionKey)!,
          shape,
        ),
      ),
    );
  // Missing metadata is an eligibility failure, like a missing root profile.
  // A declared unknown symbol or its own mismatched shape is a type problem.
  const typeProblem =
    type.symbol !== undefined && (!profile || ownShapeMismatch);
  return typeProblem
    ? unsupportedProfileError(
        ir,
        rejectedError,
        targetDevice,
        unsupported,
        "control",
      )
    : {
        ...rejectedError,
        reason: "target-not-accepted" as const,
        message: `${rejectedError.message} Device ${JSON.stringify(targetDevice.designation)} is not accepted as an input target. Choose a different target device with a mapped input channel.`,
        details: {
          ...rejectedError.details,
          reason: "target-not-accepted",
          family: "control",
          profile: type.symbol ?? "<missing>",
        },
      };
}
function rejectTraceTarget(
  context: DeviceContext,
  targetDevice: IrDevice,
): NormalizeSchematicViewResult {
  const { ir, captured, canonical, rootDevice } = context;
  const unsupported = ir.functions.find(
    (f) =>
      f.id.deviceUid === targetDevice.uid &&
      f.kind === "channel" &&
      f.direction === "input",
  );
  const rejected = invalid(
    "Invalid trace target: expected at least one mapped input channel.",
    captured,
    canonical,
    "control",
    rootDevice.uid,
  );
  if (rejected.ok || rejected.error.code !== "R001") return rejected;

  const error = diagnoseTraceTarget(
    context,
    targetDevice,
    unsupported,
    rejected.error,
  );
  return rejectedView({
    ...error,
    targetDeviceUid: targetDevice.uid,
    targetDesignation: targetDevice.designation,
    details: {
      ...error.details,
      targetDeviceUid: targetDevice.uid,
      targetDesignation: targetDevice.designation,
    },
  });
}
