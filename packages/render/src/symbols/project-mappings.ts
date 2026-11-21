import { SYMBOL_PROFILES, resolveSensorSupply } from "@thermite/schema";
import {
  symbolFunctionMatchesShape,
  type IrDeviceType,
} from "@thermite/compiler";
import type { PresentationClass } from "../ordering.js";
import type { SchematicViewFamily } from "../types.js";
import type { SymbolDefinition } from "./types.js";
import type {
  AggregateSymbolRule,
  BoundaryTerminalRule,
  DeviceTypeSymbolMapping,
  ExplicitFunctionOmissionRule,
  FunctionSymbolRule,
  TraversalRole,
  ROOTED_SYMBOL_PROFILES,
} from "./mappings.js";
import { symbolProfile } from "./profiles.js";
import { protectionFamilyRules } from "./protection-control.js";
import { sourceBoundaryRules } from "./source-winding.js";

const IN_OUT = ["in", "out"] as const;
type FunctionDefinition = IrDeviceType["functions"][number];
type AddAggregate = (
  key: string,
  symbolId: SymbolDefinition["id"],
  family: "power" | "control",
  members: IrDeviceType["functions"],
  ports: readonly string[],
  classification: PresentationClass,
  traversalRole: TraversalRole,
) => void;
type MakeRule = (
  symbolId: SymbolDefinition["id"],
  ports: readonly string[],
  classification: PresentationClass,
  traversalRole: TraversalRole,
) => FunctionSymbolRule;
interface Projection {
  type: IrDeviceType;
  definitions: IrDeviceType["functions"];
  profile: string | undefined;
  definition: (typeof SYMBOL_PROFILES)[number];
  functions: FunctionSymbolRule[];
  aggregates: AggregateSymbolRule[];
  omissions: ExplicitFunctionOmissionRule[];
  boundaryTerminals: BoundaryTerminalRule[];
  role: (key: string) => string | undefined;
  bound: Set<string>;
  bothFamilies: readonly SchematicViewFamily[];
  power: readonly SchematicViewFamily[];
  addAggregate: AddAggregate;
}

export function projectDeviceTypeSymbolMapping(
  type: IrDeviceType,
  definitions: IrDeviceType["functions"],
  bothFamilies: readonly SchematicViewFamily[],
  power: readonly SchematicViewFamily[],
  rootedProfiles: typeof ROOTED_SYMBOL_PROFILES,
): DeviceTypeSymbolMapping[] {
  const profile = symbolProfile(type);
  const definition = SYMBOL_PROFILES.find((p) => p.id === profile);
  if (!definition || !rootedProfiles.includes(definition.id)) return [];
  const functions: FunctionSymbolRule[] = [],
    aggregates: AggregateSymbolRule[] = [],
    omissions: ExplicitFunctionOmissionRule[] = [],
    boundaryTerminals: BoundaryTerminalRule[] = [];
  const role = (key: string) => type.terminals.find((t) => t.key === key)?.role;
  const bound = new Set<string>();
  const addAggregate = aggregateAdder(aggregates, bound);
  const context: Projection = {
    type,
    definitions,
    profile,
    definition,
    functions,
    aggregates,
    omissions,
    boundaryTerminals,
    role,
    bound,
    bothFamilies,
    power,
    addAggregate,
  };
  const earth = definitions.filter(
    (f) =>
      f.kind === "bus" &&
      f.terminalKeys.length === 1 &&
      role(f.terminalKeys[0]!) === "protective_earth",
  );
  if (profile === "thermite:motor-3ph" || profile === "thermite:power-source")
    addPowerAggregates(context, earth);
  if (profile === "thermite:sensor-3wire") addSensorAggregate(context);
  for (const f of definitions) projectFunction(context, f);
  addOmissions(context);
  return [
    {
      typeId: type.id,
      functions,
      aggregates,
      omissions,
      boundaryTerminals,
    },
  ];
}

function aggregateAdder(
  aggregates: AggregateSymbolRule[],
  bound: Set<string>,
): AddAggregate {
  return (
    key: string,
    symbolId: SymbolDefinition["id"],
    family: "power" | "control",
    members: IrDeviceType["functions"],
    ports: readonly string[],
    classification: PresentationClass,
    traversalRole: TraversalRole,
  ) => {
    const bindings = members.flatMap((f) =>
      f.terminalKeys.map((terminalKey) => ({
        terminalKey,
        memberFunctionKey: f.key,
      })),
    );
    if (bindings.length !== ports.length) return;
    aggregates.push({
      key,
      symbolId,
      families: [family],
      functionKeys: members.map((f) => f.key),
      bindings: bindings.map((b, i) => ({ ...b, portId: ports[i]! })),
      classification,
      traversalRole,
    });
    for (const f of members) bound.add(f.key);
  };
}

function addPowerAggregates(
  context: Projection,
  earth: IrDeviceType["functions"],
) {
  const { definitions, profile, role } = context;
  const main = definitions.filter(
    (f) =>
      f.kind === (profile === "thermite:motor-3ph" ? "load" : "source") &&
      f.terminalKeys.length === 3 &&
      (profile !== "thermite:power-source" ||
        f.terminalKeys.every((t, i) => role(t) === `phase_${i + 1}_source`)),
  );
  for (const f of main) addPowerAggregate(context, main, earth, f);
}

function addPowerAggregate(
  context: Projection,
  main: IrDeviceType["functions"],
  earth: IrDeviceType["functions"],
  f: FunctionDefinition,
) {
  const { profile, addAggregate, boundaryTerminals, role, power } = context;
  const motor = profile === "thermite:motor-3ph",
    pe = main.length === 1 && earth.length === 1 ? earth : [];
  addAggregate(
    main.length === 1
      ? motor
        ? "motor"
        : "three-phase-source"
      : `${motor ? "motor" : "three-phase-source"}:${f.key}`,
    motor
      ? pe.length
        ? "ais:motor-3ph"
        : "ais:motor-3ph-unbonded"
      : pe.length
        ? "ais:power-source-3ph"
        : "ais:power-source-3wire",
    "power",
    [f, ...pe],
    motor
      ? ["U", "V", "W", ...(pe.length ? ["PE"] : [])]
      : ["L1", "L2", "L3", ...(pe.length ? ["PE"] : [])],
    motor ? "load" : "source",
    motor ? "load-boundary" : "source-boundary",
  );
  if (!motor)
    for (const t of f.terminalKeys)
      boundaryTerminals.push({
        functionKey: f.key,
        terminalKey: t,
        families: power,
        boundaryKind: "power-source",
        requiredRole: role(t)!,
      });
  if (!motor)
    for (const e of pe)
      boundaryTerminals.push({
        functionKey: e.key,
        terminalKey: e.terminalKeys[0]!,
        families: power,
        boundaryKind: "protective-earth-source",
        requiredRole: "protective_earth",
      });
}

function addSensorAggregate(context: Projection) {
  const { definitions, role, addAggregate } = context;
  const supplies = definitions.filter(
    (f) => f.kind === "load" && f.terminalKeys.length === 2,
  );
  const outputs = definitions.filter(
    (f) =>
      f.kind === "channel" &&
      f.direction === "output" &&
      f.terminalKeys.length === 1,
  );
  if (
    supplies.length === 1 &&
    outputs.length === 1 &&
    new Set([...supplies[0]!.terminalKeys, ...outputs[0]!.terminalKeys])
      .size === 3
  ) {
    const supply = supplies[0]!,
      output = outputs[0]!;
    const supplyRoles = resolveSensorSupply(
      supply.terminalKeys.map((key) => ({ key, role: role(key) })),
    );
    if (supplyRoles.ok) {
      const ordered = {
        ...supply,
        terminalKeys: [supplyRoles.positive, supplyRoles.return],
      };
      addAggregate(
        "pnp-sensor",
        "ais:switch-sensor-pnp",
        "control",
        [ordered, output],
        ["supply", "return", "signal"],
        "permissive",
        "non-traversable",
      );
    }
  }
}

function projectFunction(context: Projection, f: FunctionDefinition) {
  const { type, profile, definition, functions, bound, bothFamilies } = context;
  const terminals = f.terminalKeys;
  if (bound.has(f.key) || profile === "thermite:sensor-3wire") return;
  const supportedFamilies = definition.support
    .filter(
      (s) =>
        (s.family === "power" || s.family === "control") &&
        s.functions.some((shape) => symbolFunctionMatchesShape(type, f, shape)),
    )
    .map((s) => s.family as "power" | "control");
  const families = bothFamilies.filter((family) =>
    supportedFamilies.includes(family),
  );
  let rule: FunctionSymbolRule | undefined;
  const make = (
    symbolId: SymbolDefinition["id"],
    ports: readonly string[],
    classification: PresentationClass,
    traversalRole: TraversalRole,
  ): FunctionSymbolRule => ({
    functionKey: f.key,
    families,
    symbolId,
    bindings: ports.map((portId, i) => ({
      portId,
      terminalKey: terminals[i]!,
    })),
    classification,
    traversalRole,
  });
  if (families.length) {
    rule = functionRule(context, f, families, terminals, make);
  }
  if (rule) functions.push(...protectionFamilyRules(profile, type, f, rule));
}

function functionRule(
  context: Projection,
  f: FunctionDefinition,
  families: readonly SchematicViewFamily[],
  terminals: readonly string[],
  make: MakeRule,
): FunctionSymbolRule | undefined {
  const { profile, boundaryTerminals, role } = context;
  let rule: FunctionSymbolRule | undefined;
  if (f.kind === "bus" && terminals.length === 1)
    rule = {
      ...make("ais:terminal", ["in"], "terminal", "terminal-display"),
      bindings: [
        { portId: "in", terminalKey: terminals[0]! },
        { portId: "out", terminalKey: terminals[0]! },
      ],
    };
  else if (f.kind === "coil")
    rule = make("ais:coil", ["A1", "A2"], "coil", "coil-root");
  else if (profile === "thermite:fuse")
    rule = make("ais:fuse", IN_OUT, "protection", "breaker-pole");
  else if (f.kind === "contact") {
    rule = contactRule(context, f, families, terminals, make);
  } else if (f.kind === "load" && terminals.length === 2)
    rule = make(
      profile === "thermite:motor"
        ? "ais:motor"
        : profile === "thermite:lamp"
          ? "ais:lamp"
          : families.includes("power")
            ? "ais:ac-load"
            : "ais:dc-load",
      families.includes("power") && profile !== "thermite:motor"
        ? ["line", "neutral"]
        : ["positive", "return"],
      "load",
      "load-boundary",
    );
  else if (
    f.kind === "channel" &&
    terminals.length === 1 &&
    profile !== "thermite:sensor-3wire"
  )
    rule = make(
      f.direction === "input" ? "ais:plc-di" : "ais:plc-do",
      [f.direction === "input" ? "DI" : "DO"],
      f.direction === "input" ? "plc-input" : "plc-output",
      "channel-boundary",
    );
  else if (f.kind === "source" && terminals.length === 2) {
    const winding = profile === "thermite:transformer";
    rule = make(
      winding ? "ais:source-winding" : "ais:power-source-dc",
      winding ? ["feed", "return"] : ["positive", "return"],
      "source",
      "source-boundary",
    );
    boundaryTerminals.push(...sourceBoundaryRules(f, role, winding));
  }
  return rule;
}
function contactRule(
  context: Projection,
  f: Extract<FunctionDefinition, { kind: "contact" }>,
  families: readonly SchematicViewFamily[],
  terminals: readonly string[],
  make: MakeRule,
): FunctionSymbolRule | undefined {
  const { profile, functions, role } = context;
  let rule: FunctionSymbolRule | undefined;
  const open = f.normal_state === "open";
  if (profile === "thermite:disconnector") {
    for (const family of families)
      functions.push({
        ...make(
          terminals.every((t) => role(t) === "aux")
            ? open
              ? "ais:contact-no"
              : "ais:contact-nc"
            : "ais:disconnector",
          ["in", "out"],
          family === "power" ? "power-contact" : "permissive",
          family === "power" ? "power-contact" : "permissive-contact",
        ),
        families: [family],
      });
  } else if (profile === "thermite:breaker") {
    rule = breakerRule(context, f, terminals, make, open);
  } else rule = ordinaryContactRule(profile, families, open, make);
  return rule;
}
function breakerRule(
  context: Projection,
  f: FunctionDefinition,
  terminals: readonly string[],
  make: MakeRule,
  open: boolean,
): FunctionSymbolRule {
  const { type, role } = context;
  let rule: FunctionSymbolRule;
  const explicit = type.circuitSymbols?.[f.key];
  const power = terminals.map((key) => role(key));
  const pole =
    explicit === "breaker" ||
    (!explicit &&
      power.includes("power_input") &&
      power.includes("power_output"));
  const symbol: SymbolDefinition["id"] =
    explicit === "contact-no" || explicit === "contact-nc"
      ? `ais:${explicit}`
      : pole
        ? "ais:breaker-pole"
        : open
          ? "ais:contact-no"
          : "ais:contact-nc";
  rule = make(
    symbol,
    IN_OUT,
    pole ? "protection" : "power-contact",
    pole ? "breaker-pole" : "power-contact",
  );
  return rule;
}
function ordinaryContactRule(
  profile: Projection["profile"],
  families: readonly SchematicViewFamily[],
  open: boolean,
  make: MakeRule,
): FunctionSymbolRule {
  let rule: FunctionSymbolRule;
  if (profile === "thermite:overload")
    rule = families.includes("power")
      ? make("ais:overload-pole", ["in", "out"], "overload", "overload-pole")
      : make(
          open ? "ais:contact-no" : "ais:overload-contact-nc",
          ["in", "out"],
          "protection",
          "protection-contact",
        );
  else if (profile === "thermite:estop" || profile === "thermite:selector")
    rule = make(
      `ais:${profile === "thermite:estop" ? "estop" : "selector"}-${open ? "no" : "nc"}`,
      ["in", "out"],
      profile === "thermite:estop" ? "command" : "permissive",
      profile === "thermite:estop" ? "command-contact" : "permissive-contact",
    );
  else if (profile === "thermite:pushbutton")
    rule = make(
      open ? "ais:pushbutton-no" : "ais:pushbutton-nc",
      ["in", "out"],
      "command",
      "command-contact",
    );
  else if (profile === "thermite:switch")
    rule = make(
      open ? "ais:switch-no" : "ais:switch-nc",
      ["in", "out"],
      "permissive",
      "permissive-contact",
    );
  else
    rule = make(
      open ? "ais:contact-no" : "ais:contact-nc",
      ["in", "out"],
      families.includes("power") ? "power-contact" : "control-contact",
      families.includes("power") ? "power-contact" : "control-contact",
    );
  return rule;
}

function addOmissions(context: Projection) {
  const { definitions, functions, aggregates, omissions, bothFamilies } =
    context;
  // Preserve omission diagnostics for every function/family without a binding.
  for (const f of definitions) {
    const supported = [
      ...functions.filter((r) => r.functionKey === f.key),
      ...aggregates.filter((r) => r.functionKeys.includes(f.key)),
    ].flatMap((r) => r.families);
    const absent = bothFamilies.filter((family) => !supported.includes(family));
    if (absent.length)
      omissions.push({
        functionKey: f.key,
        families: absent,
        reason:
          f.kind === "mechanism"
            ? "metadata-only-mechanism"
            : supported.length
              ? "outside-family"
              : "unsupported-v0.1",
      });
  }
}
