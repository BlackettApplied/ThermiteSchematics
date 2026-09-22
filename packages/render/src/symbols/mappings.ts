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

/** Explicit reusable library profiles. Unknown types never acquire behavior by name. */
export function projectDeviceTypeSymbolMappings(
  ir: Readonly<import("@thermite/compiler").ElectricalIr>,
): readonly DeviceTypeSymbolMapping[] {
  const mappings: DeviceTypeSymbolMapping[] = [
    ...CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  ];
  for (const type of ir.deviceTypes) {
    if (
      mappings.some((m) => m.typeId === type.id) ||
      ![
        "thermite:io-module",
        "thermite:terminal-strip",
        "thermite:dc-supply",
      ].includes(type.symbol ?? "")
    )
      continue;
    const functions: FunctionSymbolRule[] = [],
      omissions: ExplicitFunctionOmissionRule[] = [],
      boundaryTerminals: BoundaryTerminalRule[] = [];
    for (const f of type.functions) {
      const terminals = f.terminalKeys;
      let rule: FunctionSymbolRule | undefined;
      if (
        f.kind === "channel" &&
        terminals.length === 1 &&
        type.symbol === "thermite:io-module"
      ) {
        const input = f.direction === "input";
        rule = {
          functionKey: f.key,
          families: CONTROL,
          symbolId: input ? "ais:plc-di" : "ais:plc-do",
          bindings: [
            { portId: input ? "DI" : "DO", terminalKey: terminals[0]! },
          ],
          classification: input ? "plc-input" : "plc-output",
          traversalRole: "channel-boundary",
        };
      } else if (f.kind === "bus" && terminals.length === 1) {
        rule = {
          functionKey: f.key,
          families: BOTH_FAMILIES,
          symbolId: "ais:terminal",
          bindings: [
            { portId: "in", terminalKey: terminals[0]! },
            { portId: "out", terminalKey: terminals[0]! },
          ],
          classification: "terminal",
          traversalRole: "terminal-display",
        };
      } else if (
        f.kind === "load" &&
        terminals.length === 2 &&
        type.terminals.find((t) => t.key === terminals[0])?.rating
          ?.voltage_type === "DC"
      ) {
        rule = {
          functionKey: f.key,
          families: CONTROL,
          symbolId: "ais:dc-load",
          bindings: [
            { portId: "positive", terminalKey: terminals[0]! },
            { portId: "return", terminalKey: terminals[1]! },
          ],
          classification: "load",
          traversalRole: "load-boundary",
        };
      } else if (
        f.kind === "source" &&
        terminals.length === 2 &&
        type.terminals.find((t) => t.key === terminals[0])?.role ===
          "dc_positive_output" &&
        type.terminals.find((t) => t.key === terminals[1])?.role ===
          "dc_return_output"
      ) {
        rule = {
          functionKey: f.key,
          families: CONTROL,
          symbolId: "ais:power-source-dc",
          bindings: [
            { portId: "positive", terminalKey: terminals[0]! },
            { portId: "return", terminalKey: terminals[1]! },
          ],
          classification: "source",
          traversalRole: "source-boundary",
        };
        boundaryTerminals.push(
          {
            functionKey: f.key,
            terminalKey: terminals[0]!,
            families: CONTROL,
            boundaryKind: "control-source",
            requiredRole: "dc_positive_output",
          },
          {
            functionKey: f.key,
            terminalKey: terminals[1]!,
            families: CONTROL,
            boundaryKind: "control-return",
            requiredRole: "dc_return_output",
          },
        );
      }
      if (rule) {
        functions.push(rule);
        if (!rule.families.includes("power"))
          omissions.push({
            functionKey: f.key,
            families: POWER,
            reason: "outside-family",
          });
      } else
        omissions.push({
          functionKey: f.key,
          families: BOTH_FAMILIES,
          reason:
            f.kind === "mechanism"
              ? "metadata-only-mechanism"
              : "unsupported-v0.1",
        });
    }
    mappings.push({
      typeId: type.id,
      functions,
      aggregates: [],
      omissions,
      boundaryTerminals,
    });
  }
  return mappings;
}
