import { SYMBOL_PROFILES, resolveSensorSupply } from "@thermite/schema";
import {
  symbolFunctionMatchesShape,
  type IrDeviceType,
} from "@thermite/compiler";
import { symbolProfile } from "./profiles.js";
import type { PresentationClass } from "../ordering.js";
import type { SchematicViewFamily } from "../types.js";
import type { SymbolDefinition, SymbolPortBinding } from "./types.js";

export type { SchematicViewFamily } from "../types.js";

export type TraversalRole =
  | "source-boundary"
  | "load-boundary"
  | "channel-boundary"
  | "coil-root"
  | "control-contact"
  | "command-contact"
  | "permissive-contact"
  | "protection-contact"
  | "power-contact"
  | "breaker-pole"
  | "overload-pole"
  | "terminal-display"
  | "non-traversable";

export interface FunctionSymbolRule {
  readonly functionKey: string;
  readonly families: readonly SchematicViewFamily[];
  readonly symbolId: SymbolDefinition["id"];
  readonly bindings: readonly SymbolPortBinding[];
  readonly classification: PresentationClass;
  readonly traversalRole: TraversalRole;
}

export interface AggregateSymbolPortBinding extends SymbolPortBinding {
  readonly memberFunctionKey: string;
}

export interface AggregateSymbolRule {
  readonly key: string;
  readonly families: readonly SchematicViewFamily[];
  readonly functionKeys: readonly string[];
  readonly symbolId: SymbolDefinition["id"];
  readonly bindings: readonly AggregateSymbolPortBinding[];
  readonly classification: PresentationClass;
  readonly traversalRole: TraversalRole;
}

export type FunctionOmissionReason =
  | "metadata-only-mechanism"
  | "boundary-metadata-only"
  | "outside-family"
  | "unsupported-v0.1";

export interface ExplicitFunctionOmissionRule {
  readonly functionKey: string;
  readonly families: readonly SchematicViewFamily[];
  readonly reason: FunctionOmissionReason;
}

export type BoundaryKind =
  | "control-source"
  | "control-return"
  | "power-source"
  | "protective-earth-source";

export interface BoundaryTerminalRule {
  readonly functionKey: string;
  readonly terminalKey: string;
  readonly families: readonly SchematicViewFamily[];
  readonly boundaryKind: BoundaryKind;
  readonly requiredRole: string;
}

export interface DeviceTypeSymbolMapping {
  readonly typeId: string;
  readonly functions: readonly FunctionSymbolRule[];
  readonly aggregates: readonly AggregateSymbolRule[];
  readonly omissions: readonly ExplicitFunctionOmissionRule[];
  readonly boundaryTerminals: readonly BoundaryTerminalRule[];
}

export const SCHEMATIC_VIEW_FAMILIES = Object.freeze([
  "control",
  "power",
] as const satisfies readonly SchematicViewFamily[]);

export const TRAVERSAL_ROLES = Object.freeze([
  "source-boundary",
  "load-boundary",
  "channel-boundary",
  "coil-root",
  "control-contact",
  "command-contact",
  "permissive-contact",
  "protection-contact",
  "power-contact",
  "breaker-pole",
  "overload-pole",
  "terminal-display",
  "non-traversable",
] as const satisfies readonly TraversalRole[]);

export const FUNCTION_OMISSION_REASONS = Object.freeze([
  "metadata-only-mechanism",
  "boundary-metadata-only",
  "outside-family",
  "unsupported-v0.1",
] as const satisfies readonly FunctionOmissionReason[]);

export const BOUNDARY_KINDS = Object.freeze([
  "control-source",
  "control-return",
  "power-source",
  "protective-earth-source",
] as const satisfies readonly BoundaryKind[]);

const CONTROL = ["control"] as const;
const POWER = ["power"] as const;
const BOTH_FAMILIES = ["control", "power"] as const;

function terminalFunctions(
  terminalKeys: readonly string[],
): readonly FunctionSymbolRule[] {
  return terminalKeys.map((terminalKey, index) => ({
    functionKey: `terminal${index + 1}`,
    families: BOTH_FAMILIES,
    symbolId: "ais:terminal",
    bindings: [
      { portId: "in", terminalKey },
      { portId: "out", terminalKey },
    ],
    classification: "terminal",
    traversalRole: "terminal-display",
  }));
}

const MAPPINGS = [
  {
    typeId: "core:supply-480v-3ph",
    functions: [],
    aggregates: [
      {
        key: "three-phase-source",
        families: POWER,
        functionKeys: ["three_phase_source", "protective_earth"],
        symbolId: "ais:power-source-3ph",
        bindings: [
          {
            portId: "L1",
            terminalKey: "L1",
            memberFunctionKey: "three_phase_source",
          },
          {
            portId: "L2",
            terminalKey: "L2",
            memberFunctionKey: "three_phase_source",
          },
          {
            portId: "L3",
            terminalKey: "L3",
            memberFunctionKey: "three_phase_source",
          },
          {
            portId: "PE",
            terminalKey: "PE",
            memberFunctionKey: "protective_earth",
          },
        ],
        classification: "source",
        traversalRole: "source-boundary",
      },
    ],
    omissions: [
      {
        functionKey: "three_phase_source",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "protective_earth",
        families: CONTROL,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [
      {
        functionKey: "three_phase_source",
        terminalKey: "L1",
        families: POWER,
        boundaryKind: "power-source",
        requiredRole: "phase_1_source",
      },
      {
        functionKey: "three_phase_source",
        terminalKey: "L2",
        families: POWER,
        boundaryKind: "power-source",
        requiredRole: "phase_2_source",
      },
      {
        functionKey: "three_phase_source",
        terminalKey: "L3",
        families: POWER,
        boundaryKind: "power-source",
        requiredRole: "phase_3_source",
      },
      {
        functionKey: "protective_earth",
        terminalKey: "PE",
        families: POWER,
        boundaryKind: "protective-earth-source",
        requiredRole: "protective_earth",
      },
    ],
  },
  {
    typeId: "core:breaker-3p",
    functions: [
      {
        functionKey: "pole1",
        families: POWER,
        symbolId: "ais:breaker-pole",
        bindings: [
          { portId: "in", terminalKey: "1/L1" },
          { portId: "out", terminalKey: "2/T1" },
        ],
        classification: "protection",
        traversalRole: "breaker-pole",
      },
      {
        functionKey: "pole2",
        families: POWER,
        symbolId: "ais:breaker-pole",
        bindings: [
          { portId: "in", terminalKey: "3/L2" },
          { portId: "out", terminalKey: "4/T2" },
        ],
        classification: "protection",
        traversalRole: "breaker-pole",
      },
      {
        functionKey: "pole3",
        families: POWER,
        symbolId: "ais:breaker-pole",
        bindings: [
          { portId: "in", terminalKey: "5/L3" },
          { portId: "out", terminalKey: "6/T3" },
        ],
        classification: "protection",
        traversalRole: "breaker-pole",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "pole1",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole2",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole3",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "trip",
        families: BOTH_FAMILIES,
        reason: "metadata-only-mechanism",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:contactor-3p-1no",
    functions: [
      {
        functionKey: "coil",
        families: CONTROL,
        symbolId: "ais:coil",
        bindings: [
          { portId: "A1", terminalKey: "A1" },
          { portId: "A2", terminalKey: "A2" },
        ],
        classification: "coil",
        traversalRole: "coil-root",
      },
      {
        functionKey: "pole1",
        families: POWER,
        symbolId: "ais:contact-no",
        bindings: [
          { portId: "in", terminalKey: "1/L1" },
          { portId: "out", terminalKey: "2/T1" },
        ],
        classification: "power-contact",
        traversalRole: "power-contact",
      },
      {
        functionKey: "pole2",
        families: POWER,
        symbolId: "ais:contact-no",
        bindings: [
          { portId: "in", terminalKey: "3/L2" },
          { portId: "out", terminalKey: "4/T2" },
        ],
        classification: "power-contact",
        traversalRole: "power-contact",
      },
      {
        functionKey: "pole3",
        families: POWER,
        symbolId: "ais:contact-no",
        bindings: [
          { portId: "in", terminalKey: "5/L3" },
          { portId: "out", terminalKey: "6/T3" },
        ],
        classification: "power-contact",
        traversalRole: "power-contact",
      },
      {
        functionKey: "aux13",
        families: CONTROL,
        symbolId: "ais:contact-no",
        bindings: [
          { portId: "in", terminalKey: "13" },
          { portId: "out", terminalKey: "14" },
        ],
        classification: "control-contact",
        traversalRole: "control-contact",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "coil",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "pole1",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole2",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole3",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "aux13",
        families: POWER,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:overload-3p-1nc",
    functions: [
      {
        functionKey: "pole1",
        families: POWER,
        symbolId: "ais:overload-pole",
        bindings: [
          { portId: "in", terminalKey: "1/L1" },
          { portId: "out", terminalKey: "2/T1" },
        ],
        classification: "overload",
        traversalRole: "overload-pole",
      },
      {
        functionKey: "pole2",
        families: POWER,
        symbolId: "ais:overload-pole",
        bindings: [
          { portId: "in", terminalKey: "3/L2" },
          { portId: "out", terminalKey: "4/T2" },
        ],
        classification: "overload",
        traversalRole: "overload-pole",
      },
      {
        functionKey: "pole3",
        families: POWER,
        symbolId: "ais:overload-pole",
        bindings: [
          { portId: "in", terminalKey: "5/L3" },
          { portId: "out", terminalKey: "6/T3" },
        ],
        classification: "overload",
        traversalRole: "overload-pole",
      },
      {
        functionKey: "aux95",
        families: CONTROL,
        symbolId: "ais:overload-contact-nc",
        bindings: [
          { portId: "in", terminalKey: "95" },
          { portId: "out", terminalKey: "96" },
        ],
        classification: "protection",
        traversalRole: "protection-contact",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "pole1",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole2",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "pole3",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "aux95",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "trip",
        families: BOTH_FAMILIES,
        reason: "metadata-only-mechanism",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:motor-3ph",
    functions: [],
    aggregates: [
      {
        key: "motor",
        families: POWER,
        functionKeys: ["motor_load", "protective_earth"],
        symbolId: "ais:motor-3ph",
        bindings: [
          {
            portId: "U",
            terminalKey: "U",
            memberFunctionKey: "motor_load",
          },
          {
            portId: "V",
            terminalKey: "V",
            memberFunctionKey: "motor_load",
          },
          {
            portId: "W",
            terminalKey: "W",
            memberFunctionKey: "motor_load",
          },
          {
            portId: "PE",
            terminalKey: "PE",
            memberFunctionKey: "protective_earth",
          },
        ],
        classification: "load",
        traversalRole: "load-boundary",
      },
    ],
    omissions: [
      {
        functionKey: "motor_load",
        families: CONTROL,
        reason: "outside-family",
      },
      {
        functionKey: "protective_earth",
        families: CONTROL,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:pushbutton-nc",
    functions: [
      {
        functionKey: "contact11",
        families: CONTROL,
        symbolId: "ais:pushbutton-nc",
        bindings: [
          { portId: "in", terminalKey: "11" },
          { portId: "out", terminalKey: "12" },
        ],
        classification: "command",
        traversalRole: "command-contact",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "contact11",
        families: POWER,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:limit-switch-2wire",
    functions: [
      {
        functionKey: "contact13",
        families: CONTROL,
        symbolId: "ais:switch-no",
        bindings: [
          { portId: "in", terminalKey: "13" },
          { portId: "out", terminalKey: "14" },
        ],
        classification: "permissive",
        traversalRole: "permissive-contact",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "contact13",
        families: POWER,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:prox-pnp-3wire",
    functions: [],
    aggregates: [
      {
        key: "pnp-sensor",
        families: CONTROL,
        functionKeys: ["supply", "output"],
        symbolId: "ais:switch-sensor-pnp",
        bindings: [
          {
            portId: "supply",
            terminalKey: "1",
            memberFunctionKey: "supply",
          },
          {
            portId: "return",
            terminalKey: "3",
            memberFunctionKey: "supply",
          },
          {
            portId: "signal",
            terminalKey: "4",
            memberFunctionKey: "output",
          },
        ],
        classification: "permissive",
        traversalRole: "non-traversable",
      },
    ],
    omissions: [
      {
        functionKey: "supply",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "output",
        families: POWER,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:plc-compact",
    functions: [
      {
        functionKey: "supply",
        families: CONTROL,
        symbolId: "ais:dc-load",
        bindings: [
          { portId: "positive", terminalKey: "L+" },
          { portId: "return", terminalKey: "M" },
        ],
        classification: "load",
        traversalRole: "load-boundary",
      },
      {
        functionKey: "di0",
        families: CONTROL,
        symbolId: "ais:plc-di",
        bindings: [{ portId: "DI", terminalKey: "X1.0" }],
        classification: "plc-input",
        traversalRole: "channel-boundary",
      },
      {
        functionKey: "di1",
        families: CONTROL,
        symbolId: "ais:plc-di",
        bindings: [{ portId: "DI", terminalKey: "X1.1" }],
        classification: "plc-input",
        traversalRole: "channel-boundary",
      },
      {
        functionKey: "do0",
        families: CONTROL,
        symbolId: "ais:plc-do",
        bindings: [{ portId: "DO", terminalKey: "X2.0" }],
        classification: "plc-output",
        traversalRole: "channel-boundary",
      },
      {
        functionKey: "do1",
        families: CONTROL,
        symbolId: "ais:plc-do",
        bindings: [{ portId: "DO", terminalKey: "X2.1" }],
        classification: "plc-output",
        traversalRole: "channel-boundary",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "di0",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "di1",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "do0",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "do1",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "supply",
        families: POWER,
        reason: "outside-family",
      },
    ],
    boundaryTerminals: [],
  },
  {
    typeId: "core:psu-24vdc",
    functions: [
      {
        functionKey: "dc_output",
        families: CONTROL,
        symbolId: "ais:power-source-dc",
        bindings: [
          { portId: "positive", terminalKey: "+" },
          { portId: "return", terminalKey: "-" },
        ],
        classification: "source",
        traversalRole: "source-boundary",
      },
    ],
    aggregates: [],
    omissions: [
      {
        functionKey: "dc_output",
        families: POWER,
        reason: "outside-family",
      },
      {
        functionKey: "ac_input",
        families: BOTH_FAMILIES,
        reason: "unsupported-v0.1",
      },
    ],
    boundaryTerminals: [
      {
        functionKey: "dc_output",
        terminalKey: "+",
        families: CONTROL,
        boundaryKind: "control-source",
        requiredRole: "dc_positive_output",
      },
      {
        functionKey: "dc_output",
        terminalKey: "-",
        families: CONTROL,
        boundaryKind: "control-return",
        requiredRole: "dc_return_output",
      },
    ],
  },
  {
    typeId: "core:terminal-block-8",
    functions: terminalFunctions(["1", "2", "3", "4", "5", "6", "7", "8"]),
    aggregates: [],
    omissions: [],
    boundaryTerminals: [],
  },
  {
    typeId: "core:junction-box-8",
    functions: terminalFunctions([
      "X1.1",
      "X1.2",
      "X1.3",
      "X1.4",
      "X1.5",
      "X1.6",
      "X1.7",
      "X1.8",
    ]),
    aggregates: [],
    omissions: [],
    boundaryTerminals: [],
  },
] satisfies readonly DeviceTypeSymbolMapping[];

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

export const CORE_DEVICE_TYPE_SYMBOL_MAPPINGS: readonly DeviceTypeSymbolMapping[] =
  deepFreeze(MAPPINGS);

export function findDeviceTypeSymbolMapping(
  typeId: string,
  mappings: readonly DeviceTypeSymbolMapping[] = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
): DeviceTypeSymbolMapping | undefined {
  return mappings.find((mapping) => mapping.typeId === typeId);
}

/** Cataloged rooted capabilities. Traversal remains the selection engine's job. */
export const ROOTED_SYMBOL_PROFILES = Object.freeze(
  SYMBOL_PROFILES.filter((p) =>
    p.support.some(
      (s) =>
        s.family === "power" || s.family === "control" || s.family === "loads",
    ),
  ).map((p) => p.id),
);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** IR is already admitted. Preserve authored function order independently of
 * collection storage order, while leaving each function's terminal order intact. */
function orderedFunctions(type: IrDeviceType): IrDeviceType["functions"] {
  return [...type.functions].sort(
    (a, b) =>
      a.source.line - b.source.line ||
      a.source.column - b.source.column ||
      compareText(a.key, b.key),
  );
}

/** Bind authored functions, terminal order and roles through a single profile path.
 * The exported core table above remains a compatibility reference for callers
 * supplying explicit mappings; production never selects it by type ID.
 */
export function projectDeviceTypeSymbolMappings(
  ir: Readonly<import("@thermite/compiler").ElectricalIr>,
): readonly DeviceTypeSymbolMapping[] {
  return [...ir.deviceTypes]
    .sort((a, b) => compareText(a.id, b.id))
    .flatMap((type) => {
      const definitions = orderedFunctions(type);
      const profile = symbolProfile(type);
      const definition = SYMBOL_PROFILES.find((p) => p.id === profile);
      if (!definition || !ROOTED_SYMBOL_PROFILES.includes(definition.id))
        return [];
      const functions: FunctionSymbolRule[] = [],
        aggregates: AggregateSymbolRule[] = [],
        omissions: ExplicitFunctionOmissionRule[] = [],
        boundaryTerminals: BoundaryTerminalRule[] = [];
      const role = (key: string) =>
        type.terminals.find((t) => t.key === key)?.role;
      const bound = new Set<string>();
      const addAggregate = (
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
      const earth = definitions.filter(
        (f) =>
          f.kind === "bus" &&
          f.terminalKeys.length === 1 &&
          role(f.terminalKeys[0]!) === "protective_earth",
      );
      if (
        profile === "thermite:motor-3ph" ||
        profile === "thermite:power-source"
      ) {
        const main = definitions.filter(
          (f) =>
            f.kind === (profile === "thermite:motor-3ph" ? "load" : "source") &&
            f.terminalKeys.length === 3 &&
            (profile !== "thermite:power-source" ||
              f.terminalKeys.every(
                (t, i) => role(t) === `phase_${i + 1}_source`,
              )),
        );
        for (const f of main) {
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
                families: POWER,
                boundaryKind: "power-source",
                requiredRole: role(t)!,
              });
          if (!motor)
            for (const e of pe)
              boundaryTerminals.push({
                functionKey: e.key,
                terminalKey: e.terminalKeys[0]!,
                families: POWER,
                boundaryKind: "protective-earth-source",
                requiredRole: "protective_earth",
              });
        }
      }
      if (profile === "thermite:sensor-3wire") {
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
      for (const f of definitions) {
        const terminals = f.terminalKeys;
        if (bound.has(f.key) || profile === "thermite:sensor-3wire") continue;
        const supportedFamilies = definition.support
          .filter(
            (s) =>
              (s.family === "power" || s.family === "control") &&
              s.functions.some((shape) =>
                symbolFunctionMatchesShape(type, f, shape),
              ),
          )
          .map((s) => s.family as "power" | "control");
        const families = BOTH_FAMILIES.filter((family) =>
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
          else if (f.kind === "contact") {
            const open = f.normal_state === "open";
            if (profile === "thermite:disconnector") {
              for (const family of families)
                functions.push({
                  ...make(
                    "ais:disconnector",
                    ["in", "out"],
                    family === "power" ? "power-contact" : "permissive",
                    family === "power" ? "power-contact" : "permissive-contact",
                  ),
                  families: [family],
                });
            } else if (profile === "thermite:breaker") {
              const explicit = type.circuitSymbols?.[f.key];
              const power = terminals.map((key) => role(key));
              const pole =
                explicit === "breaker" ||
                (!explicit &&
                  power.includes("power_input") &&
                  power.includes("power_output"));
              const symbol =
                explicit === "contact-no"
                  ? "ais:contact-no"
                  : explicit === "contact-nc"
                    ? "ais:contact-nc"
                    : pole
                      ? "ais:breaker-pole"
                      : open
                        ? "ais:contact-no"
                        : "ais:contact-nc";
              rule = make(
                symbol,
                ["in", "out"],
                pole ? "protection" : "power-contact",
                pole ? "breaker-pole" : "power-contact",
              );
            } else if (profile === "thermite:overload")
              rule = families.includes("power")
                ? make(
                    "ais:overload-pole",
                    ["in", "out"],
                    "overload",
                    "overload-pole",
                  )
                : make(
                    open ? "ais:contact-no" : "ais:overload-contact-nc",
                    ["in", "out"],
                    "protection",
                    "protection-contact",
                  );
            else if (profile === "thermite:fuse")
              rule = make(
                "ais:fuse",
                ["in", "out"],
                "protection",
                "breaker-pole",
              );
            else if (
              profile === "thermite:estop" ||
              profile === "thermite:selector"
            )
              rule = make(
                `ais:${profile === "thermite:estop" ? "estop" : "selector"}-${open ? "no" : "nc"}`,
                ["in", "out"],
                profile === "thermite:estop" ? "command" : "permissive",
                profile === "thermite:estop"
                  ? "command-contact"
                  : "permissive-contact",
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
                families.includes("power")
                  ? "power-contact"
                  : "control-contact",
                families.includes("power")
                  ? "power-contact"
                  : "control-contact",
              );
          } else if (f.kind === "other" && profile === "thermite:fuse")
            rule = make(
              "ais:fuse",
              ["in", "out"],
              "protection",
              "breaker-pole",
            );
          else if (f.kind === "load" && terminals.length === 2)
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
            rule = make(
              "ais:power-source-dc",
              ["positive", "return"],
              "source",
              "source-boundary",
            );
            for (const [i, boundaryKind] of [
              "control-source",
              "control-return",
            ].entries())
              boundaryTerminals.push({
                functionKey: f.key,
                terminalKey: terminals[i]!,
                families: CONTROL,
                boundaryKind: boundaryKind as BoundaryKind,
                requiredRole: role(terminals[i]!)!,
              });
          }
        }
        if (rule) functions.push(rule);
      }
      // Preserve omission diagnostics for every function/family without a binding.
      for (const f of definitions) {
        const supported = [
          ...functions.filter((r) => r.functionKey === f.key),
          ...aggregates.filter((r) => r.functionKeys.includes(f.key)),
        ].flatMap((r) => r.families);
        const absent = BOTH_FAMILIES.filter(
          (family) => !supported.includes(family),
        );
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
      return [
        {
          typeId: type.id,
          functions,
          aggregates,
          omissions,
          boundaryTerminals,
        },
      ];
    });
}
