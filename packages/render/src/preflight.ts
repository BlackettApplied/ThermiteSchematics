import type {
  ElectricalIr,
  IrDevice,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import {
  symbolProfile,
  SYMBOL_PROFILES,
  resolveSensorSupply,
} from "@thermite/schema";
import { symbolFunctionMatchesShape } from "@thermite/compiler";
import type {
  RenderError,
  UnsupportedSymbolMappingError,
  UnsupportedSymbolProfile,
} from "./errors.js";
import type { NormalizedSchematicView } from "./types.js";
import type { DeviceTypeSymbolMapping } from "./symbols/mappings.js";
import { isFunctionTraversable } from "./symbols/validate.js";

const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);

export function hasFunctionBinding(
  mapping: DeviceTypeSymbolMapping | undefined,
  f: IrFunction,
  family: "power" | "control",
): boolean {
  return (
    !!mapping &&
    (mapping.functions.some(
      (r) => r.functionKey === f.id.functionKey && r.families.includes(family),
    ) ||
      mapping.aggregates.some(
        (r) =>
          r.functionKeys.includes(f.id.functionKey) &&
          r.families.includes(family),
      ))
  );
}

/** Keep the public R classification and request descriptors; classify the cause additively. */
export function unsupportedProfileError<E extends RenderError>(
  ir: Readonly<ElectricalIr>,
  error: E,
  device: IrDevice,
  f: IrFunction | undefined,
  family: UnsupportedSymbolProfile["family"],
  cause?: string,
): E {
  const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
  const profile = type.symbol ?? "<missing>";
  const functionKey = f?.id.functionKey;
  const shape = f ? `${f.kind}/${f.terminals.length}` : "terminal-only";
  return Object.freeze({
    ...error,
    ...("reason" in error ? {} : { reason: "unsupported-symbol-profile" }),
    unsupported: {
      deviceUid: device.uid,
      designation: device.designation,
      typeId: type.id,
      profile,
      family,
      ...(functionKey === undefined ? {} : { functionKey }),
    },
    message: cause?.startsWith("Invalid sensor supply roles")
      ? `${cause} Device ${JSON.stringify(device.designation)}, type ${JSON.stringify(type.id)}, profile ${JSON.stringify(profile)}, ${family} function ${JSON.stringify(functionKey)}.`
      : `Unsupported symbol profile: device ${JSON.stringify(device.designation)}, type ${JSON.stringify(type.id)}, profile ${JSON.stringify(profile)} has no ${family} rule for ${f ? `function ${JSON.stringify(functionKey)} (${shape}; terminals ${f.terminals.map((t) => `${device.designation}.${t.terminalKey}`).join(", ")})` : "its terminals"}.${cause ? ` ${cause}` : ""} Check the profile and authored function shape against the symbol catalog; a profile change does not change connectivity.`,
    details: {
      ...error.details,
      reason: "unsupported-symbol-profile",
      unsupportedDeviceUid: device.uid,
      designation: device.designation,
      typeId: type.id,
      profile,
      resolvedProfile: symbolProfile(type) ?? null,
      family,
      ...(f
        ? {
            functionKey,
            functionKind: f.kind,
            terminalKeys: f.terminals.map((t) => t.terminalKey),
            terminals: f.terminals.map((t) => ({
              ...t,
              designation: device.designation,
            })),
          }
        : {}),
      ...(cause ? { cause } : {}),
    },
  }) as E;
}

/** Only functions touched by this rooted family are candidates. Other functions on
 * a multi-function device, parallel loads and disconnected devices are not selected. */
export function preflightRootedProfiles(
  ir: Readonly<ElectricalIr>,
  view: NormalizedSchematicView,
  mappings: readonly DeviceTypeSymbolMapping[],
): UnsupportedSymbolMappingError | undefined {
  if ("intent" in view && view.intent === "conductors") return;
  const rootUid = "deviceUid" in view.root ? view.root.deviceUid : undefined;
  if (!rootUid) return;
  const loads = "intent" in view && view.intent === "loads";
  const trace = "intent" in view && view.intent === "trace";
  const map = new Map(mappings.map((m) => [m.typeId, m]));
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const fs = new Map<string, IrFunction[]>();
  for (const f of ir.functions)
    for (const t of f.terminals) fs.set(key(t), [...(fs.get(key(t)) ?? []), f]);
  const adjacent = new Map<string, TerminalId[]>();
  for (const c of [...ir.wires, ...ir.jumpers, ...ir.cableConductors]) {
    const [a, b] = c.endpoints.map((e) => e.terminal) as [
      TerminalId,
      TerminalId,
    ];
    adjacent.set(key(a), [...(adjacent.get(key(a)) ?? []), b]);
    adjacent.set(key(b), [...(adjacent.get(key(b)) ?? []), a]);
  }
  const rootFunctions = ir.functions.filter(
    (f) =>
      f.id.deviceUid === rootUid &&
      (loads
        ? f.kind === "source"
        : trace
          ? f.kind === "contact" || f.kind === "load" || f.kind === "channel"
          : view.family === "control"
            ? f.kind === "coil"
            : f.kind === "load"),
  );
  const allRootTerminals = rootFunctions.flatMap((f) => f.terminals);
  const netByTerminal = new Map(
    ir.indexes.netIdByTerminal.map((e) => [key(e.key), e.value]),
  );
  const sourceNets = new Set(
    allRootTerminals.map((t) => netByTerminal.get(key(t))),
  );
  const rootMapping = map.get(devices.get(rootUid)!.typeId);
  const rootBindings = [
    ...(rootMapping?.functions
      .filter(
        (r) =>
          r.families.includes(view.family) &&
          (view.family === "control"
            ? r.traversalRole === "coil-root"
            : r.traversalRole === "load-boundary"),
      )
      .flatMap((r) => r.bindings) ?? []),
    ...(rootMapping?.aggregates
      .filter(
        (r) =>
          r.families.includes(view.family) &&
          r.traversalRole === "load-boundary",
      )
      .flatMap((r) => r.bindings) ?? []),
  ];
  const starts =
    loads || trace
      ? [allRootTerminals]
      : rootBindings.map((b) => [
          { deviceUid: rootUid, terminalKey: b.terminalKey },
        ]);
  for (const start of starts) {
    const queue = [...start],
      seen = new Set<string>();
    let unsupported: UnsupportedSymbolMappingError | undefined;
    let supportedBoundary = false;
    const returnArm =
      view.family === "control" &&
      rootBindings.find((b) => b.terminalKey === start[0]?.terminalKey)
        ?.portId === "A2";
    const earthArm =
      view.family === "power" &&
      rootBindings.find((b) => b.terminalKey === start[0]?.terminalKey)
        ?.portId === "PE";
    const boundaryKind =
      view.family === "power"
        ? earthArm
          ? "protective-earth-source"
          : "power-source"
        : returnArm
          ? "control-return"
          : "control-source";
    for (let i = 0; i < queue.length; i++) {
      const terminal = queue[i]!;
      if (seen.has(key(terminal))) continue;
      seen.add(key(terminal));
      const device = devices.get(terminal.deviceUid)!;
      const mapping = map.get(device.typeId);
      const functions = fs.get(key(terminal)) ?? [];
      const exactPotential = ir.potentials.some(
        (p) =>
          key(p.terminal) === key(terminal) &&
          p.electrical.polarity ===
            (earthArm ? "protective_earth" : returnArm ? "return" : "positive"),
      );
      const boundary = mapping?.boundaryTerminals.some(
        (b) =>
          b.terminalKey === terminal.terminalKey &&
          b.families.includes(view.family) &&
          b.boundaryKind === boundaryKind,
      );
      const channel =
        !returnArm &&
        view.family === "control" &&
        functions.some(
          (f) =>
            f.kind === "channel" &&
            f.direction === "output" &&
            hasFunctionBinding(mapping, f, "control"),
        );
      if (
        !loads &&
        !trace &&
        device.uid !== rootUid &&
        (boundary ||
          channel ||
          ((view.family === "control" || earthArm) && exactPotential))
      ) {
        supportedBoundary = true;
        continue;
      }
      queue.push(...(adjacent.get(key(terminal)) ?? []));
      if (device.uid === rootUid) continue;
      for (const f of functions) {
        const relevant = loads
          ? f.kind === "load" &&
            new Set(f.terminals.map((t) => netByTerminal.get(key(t)))).size >=
              2 &&
            f.terminals.every((t) => sourceNets.has(netByTerminal.get(key(t))))
          : trace
            ? f.kind === "bus" ||
              ("includePower" in view &&
                view.includePower &&
                f.kind === "source")
            : ["contact", "bus", "other", "source"].includes(f.kind) ||
              (view.family === "control" &&
                f.kind === "channel" &&
                f.direction === "output");
        if (!relevant) continue;
        if (!hasFunctionBinding(mapping, f, view.family)) {
          unsupported ??= unsupportedProfileError(
            ir,
            {
              code: "R003",
              family: view.family,
              deviceUid: device.uid,
              typeId: device.typeId,
              functionKey: f.id.functionKey,
              root: view.root.designation,
              message: "Unsupported mapping.",
            },
            device,
            f,
            view.family,
          );
          continue;
        }
        const rule = mapping?.functions.find(
          (r) =>
            r.functionKey === f.id.functionKey &&
            r.families.includes(view.family),
        );
        if (
          !loads &&
          !trace &&
          rule &&
          isFunctionTraversable(view.family, rule.traversalRole)
        )
          queue.push(...f.terminals);
      }
    }
    // A valid boundary leaves unsupported side branches outside the selected path.
    if (unsupported && (!supportedBoundary || loads || trace))
      return unsupported;
  }
}

/** Diagnose the type itself, not its eligibility for a particular root role. */
export function sensorRoleProblem(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
) {
  const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
  if (symbolProfile(type) !== "thermite:sensor-3wire") return;
  for (const f of ir.functions.filter(
    (f) =>
      f.id.deviceUid === device.uid &&
      f.kind === "load" &&
      f.terminals.length === 2,
  )) {
    const roles = resolveSensorSupply(
      f.terminals.map((t) => ({
        key: t.terminalKey,
        role: type.terminals.find((p) => p.key === t.terminalKey)?.role,
      })),
    );
    if (!roles.ok)
      return {
        f,
        cause: `Invalid sensor supply roles for function ${JSON.stringify(f.id.functionKey)}: ${roles.reason}`,
      };
  }
}
export function rootProfileFunction(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  _mapping: DeviceTypeSymbolMapping | undefined,
  family: "control" | "power",
  intent?: "trace" | "loads",
): IrFunction | undefined {
  const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
  const profile = SYMBOL_PROFILES.find((p) => p.id === symbolProfile(type));
  if (type.symbol === undefined) return;
  const relevant = ir.functions.filter(
    (f) =>
      f.id.deviceUid === device.uid &&
      (intent === "trace"
        ? f.kind === "contact" ||
          f.kind === "load" ||
          (f.kind === "channel" && f.direction === "output")
        : intent === "loads"
          ? f.kind === "source"
          : family === "control"
            ? f.kind === "coil"
            : f.kind === "load"),
  );
  return relevant.find(
    (f) =>
      !profile ||
      !profile.support.some((s) =>
        s.functions.some((shape) =>
          symbolFunctionMatchesShape(
            type,
            type.functions.find((def) => def.key === f.id.functionKey)!,
            shape,
          ),
        ),
      ),
  );
}
