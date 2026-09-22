import type { IrDeviceType, IrFunction } from "@thermite/compiler";

import { InvalidSymbolMappingError } from "./errors.js";
import type {
  DeviceTypeSymbolMapping,
  TraversalRole,
} from "./symbols/mappings.js";
import { validateMaterializedFunctionFacts } from "./symbols/validate.js";
import type { SymbolDefinition } from "./symbols/types.js";

export type TraceRootPortRole = "signal" | "positive-supply" | "return-supply";

export type TraceRootFunctionFact =
  | {
      readonly key: string;
      readonly kind: "contact";
      readonly normalState: "open" | "closed";
      readonly terminalKeys: readonly string[];
    }
  | {
      readonly key: string;
      readonly kind: "channel";
      readonly direction: "input" | "output";
      readonly terminalKeys: readonly string[];
    }
  | {
      readonly key: string;
      readonly kind: "load";
      readonly terminalKeys: readonly string[];
    };

export interface TraceRootPortRule {
  readonly role: TraceRootPortRole;
  readonly portId: string;
  readonly terminalKey: string;
  readonly memberFunctionKey: string;
}

export interface TraceRootRepresentationRule {
  readonly kind: "function" | "aggregate";
  readonly key: string;
  readonly symbolId: SymbolDefinition["id"];
  readonly classification: "permissive";
  readonly traversalRole: TraversalRole;
  readonly functions: readonly TraceRootFunctionFact[];
  readonly ports: readonly TraceRootPortRule[];
}

export interface TraceRootRule {
  readonly typeId: string;
  readonly representation: TraceRootRepresentationRule;
}

const RULES = [
  {
    typeId: "core:limit-switch-2wire",
    representation: {
      kind: "function",
      key: "contact13",
      symbolId: "ais:switch-no",
      classification: "permissive",
      traversalRole: "permissive-contact",
      functions: [
        {
          key: "contact13",
          kind: "contact",
          normalState: "open",
          terminalKeys: ["13", "14"],
        },
      ],
      ports: [
        {
          role: "positive-supply",
          portId: "in",
          terminalKey: "13",
          memberFunctionKey: "contact13",
        },
        {
          role: "signal",
          portId: "out",
          terminalKey: "14",
          memberFunctionKey: "contact13",
        },
      ],
    },
  },
  {
    typeId: "core:prox-pnp-3wire",
    representation: {
      kind: "aggregate",
      key: "pnp-sensor",
      symbolId: "ais:switch-sensor-pnp",
      classification: "permissive",
      traversalRole: "non-traversable",
      functions: [
        { key: "supply", kind: "load", terminalKeys: ["1", "3"] },
        {
          key: "output",
          kind: "channel",
          direction: "output",
          terminalKeys: ["4"],
        },
      ],
      ports: [
        {
          role: "positive-supply",
          portId: "supply",
          terminalKey: "1",
          memberFunctionKey: "supply",
        },
        {
          role: "return-supply",
          portId: "return",
          terminalKey: "3",
          memberFunctionKey: "supply",
        },
        {
          role: "signal",
          portId: "signal",
          terminalKey: "4",
          memberFunctionKey: "output",
        },
      ],
    },
  },
] satisfies readonly TraceRootRule[];

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

export const TRACE_ROOT_RULES: readonly TraceRootRule[] = deepFreeze(RULES);

function invalid(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid trace intent rule: ${detail}`);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateFunctionFact(
  deviceType: IrDeviceType,
  fact: TraceRootFunctionFact,
  context: string,
): void {
  const matches = deviceType.functions.filter(({ key }) => key === fact.key);
  if (matches.length !== 1) {
    invalid(`${context} function ${JSON.stringify(fact.key)} is not unique.`);
  }
  const definition = matches[0]!;
  if (
    definition.kind !== fact.kind ||
    !sameStrings(definition.terminalKeys, fact.terminalKeys)
  ) {
    invalid(`${context} function ${JSON.stringify(fact.key)} facts disagree.`);
  }
  if (
    fact.kind === "contact" &&
    (definition.kind !== "contact" ||
      definition.normal_state !== fact.normalState)
  ) {
    invalid(`${context} contact ${JSON.stringify(fact.key)} state disagrees.`);
  }
  if (
    fact.kind === "channel" &&
    (definition.kind !== "channel" || definition.direction !== fact.direction)
  ) {
    invalid(
      `${context} channel ${JSON.stringify(fact.key)} direction disagrees.`,
    );
  }
}

function validatePortRoles(
  representation: TraceRootRepresentationRule,
  context: string,
): void {
  const roleCounts = new Map<TraceRootPortRole, number>();
  const portIds = new Set<string>();
  const terminalKeys = new Set<string>();
  const functionKeys = new Set(representation.functions.map(({ key }) => key));
  for (const port of representation.ports) {
    roleCounts.set(port.role, (roleCounts.get(port.role) ?? 0) + 1);
    if (portIds.has(port.portId)) {
      invalid(`${context} duplicates port ${JSON.stringify(port.portId)}.`);
    }
    if (terminalKeys.has(port.terminalKey)) {
      invalid(
        `${context} assigns more than one role to terminal ${JSON.stringify(port.terminalKey)}.`,
      );
    }
    if (!functionKeys.has(port.memberFunctionKey)) {
      invalid(
        `${context} port ${JSON.stringify(port.portId)} names an unknown member function.`,
      );
    }
    const fact = representation.functions.find(
      ({ key }) => key === port.memberFunctionKey,
    )!;
    if (!fact.terminalKeys.includes(port.terminalKey)) {
      invalid(
        `${context} port ${JSON.stringify(port.portId)} is outside its member function.`,
      );
    }
    portIds.add(port.portId);
    terminalKeys.add(port.terminalKey);
  }
  if (
    roleCounts.get("signal") !== 1 ||
    roleCounts.get("positive-supply") !== 1 ||
    (roleCounts.get("return-supply") ?? 0) > 1
  ) {
    invalid(
      `${context} must define one signal, one positive supply, and at most one return supply.`,
    );
  }
}

function validateRepresentation(
  deviceType: IrDeviceType,
  mapping: DeviceTypeSymbolMapping,
  rule: TraceRootRule,
): void {
  const context = rule.typeId;
  const expected = rule.representation;
  validatePortRoles(expected, context);
  for (const fact of expected.functions) {
    validateFunctionFact(deviceType, fact, context);
  }

  const rendered =
    expected.kind === "function"
      ? mapping.functions.filter(
          ({ functionKey }) => functionKey === expected.key,
        )
      : mapping.aggregates.filter(({ key }) => key === expected.key);
  if (rendered.length !== 1) {
    invalid(
      `${context} representation ${JSON.stringify(expected.key)} is not unique.`,
    );
  }
  const actual = rendered[0]!;
  if (
    !sameStrings(actual.families, ["control"]) ||
    actual.symbolId !== expected.symbolId ||
    actual.classification !== expected.classification ||
    actual.traversalRole !== expected.traversalRole
  ) {
    invalid(
      `${context} representation ${JSON.stringify(expected.key)} facts disagree.`,
    );
  }

  const expectedFunctionKeys = expected.functions.map(({ key }) => key);
  const actualFunctionKeys =
    expected.kind === "function"
      ? [(actual as DeviceTypeSymbolMapping["functions"][number]).functionKey]
      : (actual as DeviceTypeSymbolMapping["aggregates"][number]).functionKeys;
  if (!sameStrings(actualFunctionKeys, expectedFunctionKeys)) {
    invalid(`${context} representation member functions disagree.`);
  }

  const actualPorts = actual.bindings.map((binding) => ({
    portId: binding.portId,
    terminalKey: binding.terminalKey,
    memberFunctionKey:
      expected.kind === "function"
        ? expected.key
        : (
            binding as DeviceTypeSymbolMapping["aggregates"][number]["bindings"][number]
          ).memberFunctionKey,
  }));
  if (
    actualPorts.length !== expected.ports.length ||
    actualPorts.some((port, index) => {
      const expectedPort = expected.ports[index]!;
      return (
        port.portId !== expectedPort.portId ||
        port.terminalKey !== expectedPort.terminalKey ||
        port.memberFunctionKey !== expectedPort.memberFunctionKey
      );
    })
  ) {
    invalid(`${context} representation port bindings disagree.`);
  }

  for (const functionKey of expectedFunctionKeys) {
    const alternatives = [
      ...mapping.functions.filter(
        (candidate) =>
          candidate.functionKey === functionKey &&
          candidate.families.includes("control"),
      ),
      ...mapping.aggregates.filter(
        (candidate) =>
          candidate.functionKeys.includes(functionKey) &&
          candidate.families.includes("control"),
      ),
    ];
    if (alternatives.length !== 1 || alternatives[0] !== actual) {
      invalid(
        `${context}.${functionKey} does not resolve to exactly the trace representation.`,
      );
    }
  }
}

export function validateTraceRootRules(
  deviceTypes: readonly IrDeviceType[],
  mappings: readonly DeviceTypeSymbolMapping[],
  rules: readonly TraceRootRule[] = TRACE_ROOT_RULES,
): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.typeId)) {
      invalid(`duplicate device type ${JSON.stringify(rule.typeId)}.`);
    }
    seen.add(rule.typeId);
    const types = deviceTypes.filter(({ id }) => id === rule.typeId);
    const mapped = mappings.filter(({ typeId }) => typeId === rule.typeId);
    if (types.length !== 1 || mapped.length !== 1) {
      invalid(
        `${rule.typeId} requires exactly one compiled device type and mapping.`,
      );
    }
    validateRepresentation(types[0]!, mapped[0]!, rule);
  }
}

export function traceRootRuleForType(
  typeId: string,
): TraceRootRule | undefined {
  return TRACE_ROOT_RULES.find((rule) => rule.typeId === typeId);
}

export function materializedTraceRootFunctions(
  rule: TraceRootRule,
  deviceUid: string,
  deviceType: IrDeviceType,
  functions: readonly IrFunction[],
): readonly IrFunction[] {
  return Object.freeze(
    rule.representation.functions.map(({ key }) => {
      const matches = functions.filter(
        ({ id }) => id.deviceUid === deviceUid && id.functionKey === key,
      );
      if (matches.length !== 1) {
        invalid(
          `${rule.typeId} instance ${JSON.stringify(deviceUid)} does not materialize ${JSON.stringify(key)} exactly once.`,
        );
      }
      validateMaterializedFunctionFacts(deviceType, matches[0]!);
      return matches[0]!;
    }),
  );
}
