import type {
  IrDeviceType,
  IrDeviceTypeFunction,
  IrFunction,
} from "@thermite/compiler";

import {
  InvalidSymbolCatalogError,
  InvalidSymbolMappingError,
  unsupportedSymbolMappingError,
  type UnsupportedSymbolMappingError,
} from "../errors.js";
import { PRESENTATION_CLASSES, type PresentationClass } from "../ordering.js";
import {
  BOUNDARY_KINDS,
  FUNCTION_OMISSION_REASONS,
  SCHEMATIC_VIEW_FAMILIES,
  TRAVERSAL_ROLES,
  type AggregateSymbolRule,
  type BoundaryKind,
  type DeviceTypeSymbolMapping,
  type FunctionOmissionReason,
  type FunctionSymbolRule,
  type SchematicViewFamily,
  type TraversalRole,
} from "./mappings.js";
import {
  SYMBOL_SIDES,
  SYMBOL_STYLES,
  type SymbolDefinition,
  type SymbolPoint,
  type SymbolPrimitive,
} from "./types.js";

function invalidCatalog(detail: string): never {
  throw new InvalidSymbolCatalogError(`Invalid symbol catalog: ${detail}`);
}

function invalidMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid symbol mapping: ${detail}`);
}

function assertCatalog(condition: unknown, detail: string): asserts condition {
  if (!condition) invalidCatalog(detail);
}

function assertMapping(condition: unknown, detail: string): asserts condition {
  if (!condition) invalidMapping(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function validatePositiveInteger(value: number, context: string): void {
  assertCatalog(
    Number.isFinite(value) && Number.isInteger(value) && value > 0,
    `${context} must be a positive finite integer.`,
  );
}

function validatePoint(
  value: SymbolPoint,
  width: number,
  height: number,
  context: string,
): void {
  assertCatalog(
    isRecord(value) && hasExactKeys(value, ["x", "y"]),
    `${context} must be a point.`,
  );
  assertCatalog(
    Number.isFinite(value.x) && Number.isInteger(value.x),
    `${context}.x must be a finite integer.`,
  );
  assertCatalog(
    Number.isFinite(value.y) && Number.isInteger(value.y),
    `${context}.y must be a finite integer.`,
  );
  assertCatalog(
    value.x >= 0 && value.x <= width && value.y >= 0 && value.y <= height,
    `${context} is outside the symbol bounds.`,
  );
}

function validatePrimitive(
  primitive: SymbolPrimitive,
  width: number,
  height: number,
  context: string,
): void {
  assertCatalog(isRecord(primitive), `${context} must be an object.`);
  assertCatalog(
    (SYMBOL_STYLES as readonly unknown[]).includes(primitive.style),
    `${context} has unknown style ${JSON.stringify(primitive.style)}.`,
  );
  switch (primitive.kind) {
    case "line":
      assertCatalog(
        hasExactKeys(primitive, ["kind", "from", "to", "style"]),
        `${context} has unknown fields.`,
      );
      validatePoint(primitive.from, width, height, `${context}.from`);
      validatePoint(primitive.to, width, height, `${context}.to`);
      assertCatalog(
        primitive.from.x !== primitive.to.x ||
          primitive.from.y !== primitive.to.y,
        `${context} must have distinct endpoints.`,
      );
      return;
    case "polyline":
      assertCatalog(
        hasExactKeys(primitive, ["kind", "points", "style"]),
        `${context} has unknown fields.`,
      );
      assertCatalog(
        Array.isArray(primitive.points) && primitive.points.length >= 2,
        `${context} must contain at least two points.`,
      );
      primitive.points.forEach((point, index) =>
        validatePoint(point, width, height, `${context}.points[${index}]`),
      );
      return;
    case "rect": {
      const keys = ["kind", "x", "y", "width", "height", "style"];
      if (primitive.radius !== undefined) keys.push("radius");
      assertCatalog(
        hasExactKeys(primitive, keys),
        `${context} has unknown fields.`,
      );
      validatePoint(
        { x: primitive.x, y: primitive.y },
        width,
        height,
        `${context}.origin`,
      );
      validatePositiveInteger(primitive.width, `${context}.width`);
      validatePositiveInteger(primitive.height, `${context}.height`);
      assertCatalog(
        primitive.x + primitive.width <= width &&
          primitive.y + primitive.height <= height,
        `${context} is outside the symbol bounds.`,
      );
      if (primitive.radius !== undefined) {
        validatePositiveInteger(primitive.radius, `${context}.radius`);
        assertCatalog(
          primitive.radius <= Math.min(primitive.width, primitive.height) / 2,
          `${context}.radius is too large.`,
        );
      }
      return;
    }
    case "circle":
      assertCatalog(
        hasExactKeys(primitive, ["kind", "center", "radius", "style"]),
        `${context} has unknown fields.`,
      );
      validatePoint(primitive.center, width, height, `${context}.center`);
      validatePositiveInteger(primitive.radius, `${context}.radius`);
      assertCatalog(
        primitive.center.x - primitive.radius >= 0 &&
          primitive.center.x + primitive.radius <= width &&
          primitive.center.y - primitive.radius >= 0 &&
          primitive.center.y + primitive.radius <= height,
        `${context} is outside the symbol bounds.`,
      );
      return;
    case "arc":
      assertCatalog(
        hasExactKeys(primitive, [
          "kind",
          "from",
          "to",
          "radiusX",
          "radiusY",
          "clockwise",
          "style",
        ]),
        `${context} has unknown fields.`,
      );
      validatePoint(primitive.from, width, height, `${context}.from`);
      validatePoint(primitive.to, width, height, `${context}.to`);
      validatePositiveInteger(primitive.radiusX, `${context}.radiusX`);
      validatePositiveInteger(primitive.radiusY, `${context}.radiusY`);
      assertCatalog(
        primitive.radiusX <= width && primitive.radiusY <= height,
        `${context} radius exceeds the symbol bounds.`,
      );
      assertCatalog(
        Math.min(primitive.from.x, primitive.to.x) - primitive.radiusX >= 0 &&
          Math.max(primitive.from.x, primitive.to.x) + primitive.radiusX <=
            width &&
          Math.min(primitive.from.y, primitive.to.y) - primitive.radiusY >= 0 &&
          Math.max(primitive.from.y, primitive.to.y) + primitive.radiusY <=
            height,
        `${context} curve can extend outside the symbol bounds.`,
      );
      assertCatalog(
        primitive.from.x !== primitive.to.x ||
          primitive.from.y !== primitive.to.y,
        `${context} must have distinct endpoints.`,
      );
      assertCatalog(
        typeof primitive.clockwise === "boolean",
        `${context}.clockwise must be boolean.`,
      );
      return;
    default:
      invalidCatalog(
        `${context} has unknown kind ${JSON.stringify((primitive as { kind?: unknown }).kind)}.`,
      );
  }
}

export function validateSymbolCatalog(
  catalog: readonly SymbolDefinition[],
): readonly SymbolDefinition[] {
  assertCatalog(isArrayValue(catalog), "catalog must be an array.");
  assertCatalog(catalog.length > 0, "catalog must not be empty.");
  const symbolIds = new Set<string>();
  catalog.forEach((definition, symbolIndex) => {
    const context = `symbols[${symbolIndex}]`;
    assertCatalog(
      isPlainObject(definition) &&
        hasExactKeys(definition, [
          "format",
          "id",
          "size",
          "ports",
          "primitives",
        ]),
      `${context} must have the exact symbol fields.`,
    );
    assertCatalog(
      definition.format === "ais-symbol/0.1",
      `${context} has an unsupported format.`,
    );
    assertCatalog(
      typeof definition.id === "string" &&
        /^ais:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id),
      `${context} has an invalid ID.`,
    );
    assertCatalog(
      !symbolIds.has(definition.id),
      `duplicate symbol ID ${JSON.stringify(definition.id)}.`,
    );
    symbolIds.add(definition.id);
    assertCatalog(
      isPlainObject(definition.size) &&
        hasExactKeys(definition.size, ["width", "height"]),
      `${context}.size must have width and height.`,
    );
    validatePositiveInteger(definition.size.width, `${context}.size.width`);
    validatePositiveInteger(definition.size.height, `${context}.size.height`);
    assertCatalog(
      isArrayValue(definition.ports) && definition.ports.length > 0,
      `${context}.ports must be a nonempty array.`,
    );
    assertCatalog(
      isArrayValue(definition.primitives) && definition.primitives.length > 0,
      `${context}.primitives must be a nonempty array.`,
    );

    const portIds = new Set<string>();
    const portOrders = new Set<number>();
    definition.ports.forEach((port, portIndex) => {
      const portContext = `${context}.ports[${portIndex}]`;
      assertCatalog(
        isPlainObject(port) &&
          hasExactKeys(port, ["id", "side", "offset", "order"]),
        `${portContext} must have the exact port fields.`,
      );
      assertCatalog(
        typeof port.id === "string" && port.id.length > 0,
        `${portContext}.id must be a nonempty string.`,
      );
      assertCatalog(
        !portIds.has(port.id),
        `${context} has duplicate port ID ${JSON.stringify(port.id)}.`,
      );
      portIds.add(port.id);
      assertCatalog(
        (SYMBOL_SIDES as readonly unknown[]).includes(port.side),
        `${portContext} is not on a symbol boundary.`,
      );
      assertCatalog(
        Number.isFinite(port.offset) &&
          port.offset >= 0 &&
          port.offset <= 1 &&
          Number.isInteger(port.offset * 8),
        `${portContext}.offset must be an eighth in [0, 1].`,
      );
      assertCatalog(
        Number.isInteger(port.order) && port.order >= 0,
        `${portContext}.order must be a nonnegative integer.`,
      );
      assertCatalog(
        !portOrders.has(port.order),
        `${context} has duplicate port order ${port.order}.`,
      );
      portOrders.add(port.order);
    });
    definition.primitives.forEach((primitive, primitiveIndex) =>
      validatePrimitive(
        primitive,
        definition.size.width,
        definition.size.height,
        `${context}.primitives[${primitiveIndex}]`,
      ),
    );
  });
  return catalog;
}

function uniqueStrings(
  values: readonly string[],
  context: string,
  allowEmpty = false,
): void {
  assertMapping(Array.isArray(values), `${context} must be an array.`);
  assertMapping(
    allowEmpty || values.length > 0,
    `${context} must not be empty.`,
  );
  const seen = new Set<string>();
  for (const value of values) {
    assertMapping(
      typeof value === "string" && value.length > 0,
      `${context} must contain nonempty strings.`,
    );
    assertMapping(
      !seen.has(value),
      `${context} contains duplicate ${JSON.stringify(value)}.`,
    );
    seen.add(value);
  }
}

function validateFamilies(
  families: readonly SchematicViewFamily[],
  context: string,
): void {
  uniqueStrings(families, context);
  for (const family of families) {
    assertMapping(
      (SCHEMATIC_VIEW_FAMILIES as readonly unknown[]).includes(family),
      `${context} contains unknown family ${JSON.stringify(family)}.`,
    );
  }
}

const ALLOWED_CLASS_ROLES: Readonly<
  Record<PresentationClass, readonly TraversalRole[]>
> = Object.freeze({
  source: ["source-boundary"],
  protection: ["breaker-pole", "protection-contact"],
  "power-contact": ["power-contact"],
  "control-contact": ["control-contact"],
  command: ["command-contact"],
  permissive: ["permissive-contact", "non-traversable"],
  coil: ["coil-root"],
  overload: ["overload-pole"],
  load: ["load-boundary"],
  terminal: ["terminal-display"],
  "plc-input": ["channel-boundary"],
  "plc-output": ["channel-boundary"],
  rail: [],
  junction: [],
});

function validateClassRole(
  classification: PresentationClass,
  traversalRole: TraversalRole,
  context: string,
): void {
  assertMapping(
    (PRESENTATION_CLASSES as readonly unknown[]).includes(classification),
    `${context} has unknown presentation class ${JSON.stringify(classification)}.`,
  );
  assertMapping(
    (TRAVERSAL_ROLES as readonly unknown[]).includes(traversalRole),
    `${context} has missing or unknown traversal role ${JSON.stringify(traversalRole)}.`,
  );
  assertMapping(
    ALLOWED_CLASS_ROLES[classification].includes(traversalRole),
    `${context} has illegal class/role pairing ${classification}/${traversalRole}.`,
  );
}

function findTypeFunction(
  deviceType: IrDeviceType,
  functionKey: string,
  context: string,
): IrDeviceTypeFunction {
  const matches = deviceType.functions.filter(({ key }) => key === functionKey);
  assertMapping(
    matches.length === 1,
    `${context} references unknown or duplicate function ${JSON.stringify(functionKey)}.`,
  );
  return matches[0]!;
}

function findTerminalRole(
  deviceType: IrDeviceType,
  terminalKey: string,
  context: string,
): string | undefined {
  const matches = deviceType.terminals.filter(({ key }) => key === terminalKey);
  assertMapping(
    matches.length === 1,
    `${context} references unknown or duplicate terminal ${JSON.stringify(terminalKey)}.`,
  );
  return matches[0]!.role;
}

function expectFunctionFacts(
  definition: IrDeviceTypeFunction,
  expectedKind: IrDeviceTypeFunction["kind"],
  context: string,
  expectedState?: "open" | "closed",
  expectedDirection?: "input" | "output",
): void {
  assertMapping(
    definition.kind === expectedKind,
    `${context} expected kind ${expectedKind}; received ${definition.kind}.`,
  );
  if (expectedState !== undefined) {
    assertMapping(
      definition.kind === "contact" &&
        definition.normal_state === expectedState,
      `${context} expected contact state ${expectedState}.`,
    );
  }
  if (expectedDirection !== undefined) {
    assertMapping(
      definition.kind === "channel" &&
        definition.direction === expectedDirection,
      `${context} expected channel direction ${expectedDirection}.`,
    );
  }
}

function validateFunctionSymbolFacts(
  definition: IrDeviceTypeFunction,
  symbolId: SymbolDefinition["id"],
  context: string,
): void {
  switch (symbolId) {
    case "ais:power-source-dc":
      expectFunctionFacts(definition, "source", context);
      return;
    case "ais:dc-load":
      expectFunctionFacts(definition, "load", context);
      return;
    case "ais:breaker-pole":
      expectFunctionFacts(definition, "contact", context, "closed");
      return;
    case "ais:contact-no":
    case "ais:pushbutton-no":
    case "ais:switch-no":
      expectFunctionFacts(definition, "contact", context, "open");
      return;
    case "ais:contact-nc":
    case "ais:pushbutton-nc":
    case "ais:switch-nc":
    case "ais:overload-contact-nc":
    case "ais:overload-pole":
      expectFunctionFacts(definition, "contact", context, "closed");
      return;
    case "ais:coil":
      expectFunctionFacts(definition, "coil", context);
      return;
    case "ais:terminal":
      expectFunctionFacts(definition, "bus", context);
      return;
    case "ais:plc-di":
      expectFunctionFacts(definition, "channel", context, undefined, "input");
      return;
    case "ais:plc-do":
      expectFunctionFacts(definition, "channel", context, undefined, "output");
      return;
    default:
      invalidMapping(`${context} uses a non-function symbol ${symbolId}.`);
  }
}

function symbolById(
  catalog: readonly SymbolDefinition[],
  symbolId: SymbolDefinition["id"],
  context: string,
): SymbolDefinition {
  const matches = catalog.filter(({ id }) => id === symbolId);
  assertMapping(
    matches.length === 1,
    `${context} references unknown or duplicate symbol ${JSON.stringify(symbolId)}.`,
  );
  return matches[0]!;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    new Set(left).size === new Set(right).size &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function validatePortBindings(
  symbol: SymbolDefinition,
  bindings: readonly {
    readonly portId: string;
    readonly terminalKey: string;
  }[],
  context: string,
  allowPassThrough: boolean,
): void {
  assertMapping(
    Array.isArray(bindings),
    `${context}.bindings must be an array.`,
  );
  const symbolPorts = new Set(symbol.ports.map(({ id }) => id));
  const seenPorts = new Set<string>();
  const seenTerminals = new Set<string>();
  for (const binding of bindings) {
    assertMapping(
      symbolPorts.has(binding.portId),
      `${context} binds unknown port ${JSON.stringify(binding.portId)}.`,
    );
    assertMapping(
      !seenPorts.has(binding.portId),
      `${context} duplicates port ${JSON.stringify(binding.portId)}.`,
    );
    seenPorts.add(binding.portId);
    assertMapping(
      typeof binding.terminalKey === "string" && binding.terminalKey.length > 0,
      `${context} has an invalid terminal binding.`,
    );
    if (!allowPassThrough) {
      assertMapping(
        !seenTerminals.has(binding.terminalKey),
        `${context} binds terminal ${JSON.stringify(binding.terminalKey)} twice.`,
      );
    }
    seenTerminals.add(binding.terminalKey);
  }
  assertMapping(
    seenPorts.size === symbolPorts.size,
    `${context} does not bind every symbol port.`,
  );
}

function validateFunctionRule(
  deviceType: IrDeviceType,
  rule: FunctionSymbolRule,
  catalog: readonly SymbolDefinition[],
  context: string,
): void {
  validateFamilies(rule.families, `${context}.families`);
  validateClassRole(rule.classification, rule.traversalRole, context);
  const definition = findTypeFunction(deviceType, rule.functionKey, context);
  const symbol = symbolById(catalog, rule.symbolId, context);
  const passThrough = rule.symbolId === "ais:terminal";
  validatePortBindings(symbol, rule.bindings, context, passThrough);
  const boundTerminals = rule.bindings.map(({ terminalKey }) => terminalKey);
  assertMapping(
    sameStringSet(boundTerminals, definition.terminalKeys),
    `${context} does not cover the exact function terminals.`,
  );
  if (passThrough) {
    assertMapping(
      definition.terminalKeys.length === 1 &&
        rule.bindings.length === 2 &&
        rule.bindings[0]!.terminalKey === rule.bindings[1]!.terminalKey,
      `${context} has an invalid terminal pass-through binding.`,
    );
  }
  for (const binding of rule.bindings) {
    findTerminalRole(deviceType, binding.terminalKey, context);
    assertMapping(
      definition.terminalKeys.includes(binding.terminalKey),
      `${context} binds outside function ${JSON.stringify(rule.functionKey)}.`,
    );
  }
  validateFunctionSymbolFacts(definition, rule.symbolId, context);
  if (rule.symbolId === "ais:dc-load") {
    assertMapping(
      rule.classification === "load" && rule.traversalRole === "load-boundary",
      `${context} requires load/load-boundary.`,
    );
  }
}

function validateAggregateMemberFacts(
  rule: AggregateSymbolRule,
  member: IrDeviceTypeFunction,
  context: string,
): void {
  if (rule.symbolId === "ais:power-source-3ph") {
    expectFunctionFacts(
      member,
      member.key === "protective_earth" ? "bus" : "source",
      context,
    );
    return;
  }
  if (rule.symbolId === "ais:motor-3ph") {
    expectFunctionFacts(
      member,
      member.key === "protective_earth" ? "bus" : "load",
      context,
    );
    return;
  }
  if (rule.symbolId === "ais:switch-sensor-pnp") {
    if (member.key === "output") {
      expectFunctionFacts(member, "channel", context, undefined, "output");
    } else {
      expectFunctionFacts(member, "load", context);
    }
    return;
  }
  invalidMapping(`${context} uses a non-aggregate symbol ${rule.symbolId}.`);
}

function validateAggregateRule(
  deviceType: IrDeviceType,
  rule: AggregateSymbolRule,
  catalog: readonly SymbolDefinition[],
  context: string,
): void {
  validateFamilies(rule.families, `${context}.families`);
  validateClassRole(rule.classification, rule.traversalRole, context);
  uniqueStrings(rule.functionKeys, `${context}.functionKeys`);
  const members = new Map(
    rule.functionKeys.map((functionKey) => [
      functionKey,
      findTypeFunction(deviceType, functionKey, context),
    ]),
  );
  validatePortBindings(
    symbolById(catalog, rule.symbolId, context),
    rule.bindings,
    context,
    false,
  );
  const coveredByMember = new Map<string, string[]>();
  for (const binding of rule.bindings) {
    const member = members.get(binding.memberFunctionKey);
    assertMapping(
      member !== undefined,
      `${context} has a binding outside the member-function union.`,
    );
    findTerminalRole(deviceType, binding.terminalKey, context);
    assertMapping(
      member.terminalKeys.includes(binding.terminalKey),
      `${context} attributes ${JSON.stringify(binding.terminalKey)} to the wrong member.`,
    );
    const covered = coveredByMember.get(binding.memberFunctionKey) ?? [];
    covered.push(binding.terminalKey);
    coveredByMember.set(binding.memberFunctionKey, covered);
  }
  for (const [functionKey, member] of members) {
    const covered = coveredByMember.get(functionKey) ?? [];
    assertMapping(
      covered.length > 0,
      `${context} member ${functionKey} has no binding.`,
    );
    assertMapping(
      sameStringSet(covered, member.terminalKeys),
      `${context} member ${functionKey} does not cover every required terminal.`,
    );
    validateAggregateMemberFacts(rule, member, `${context}.${functionKey}`);
  }
}

type RenderedRule =
  | { readonly kind: "function"; readonly rule: FunctionSymbolRule }
  | { readonly kind: "aggregate"; readonly rule: AggregateSymbolRule };

function renderedRulesForPair(
  mapping: DeviceTypeSymbolMapping,
  functionKey: string,
  family: SchematicViewFamily,
): readonly RenderedRule[] {
  return [
    ...mapping.functions
      .filter(
        (rule) =>
          rule.functionKey === functionKey && rule.families.includes(family),
      )
      .map((rule) => ({ kind: "function" as const, rule })),
    ...mapping.aggregates
      .filter(
        (rule) =>
          rule.functionKeys.includes(functionKey) &&
          rule.families.includes(family),
      )
      .map((rule) => ({ kind: "aggregate" as const, rule })),
  ];
}

function validateBoundaryRule(
  deviceType: IrDeviceType,
  mapping: DeviceTypeSymbolMapping,
  rule: DeviceTypeSymbolMapping["boundaryTerminals"][number],
  context: string,
): void {
  validateFamilies(rule.families, `${context}.families`);
  assertMapping(
    (BOUNDARY_KINDS as readonly unknown[]).includes(rule.boundaryKind),
    `${context} has unknown boundary kind ${JSON.stringify(rule.boundaryKind)}.`,
  );
  assertMapping(
    typeof rule.requiredRole === "string" && rule.requiredRole.length > 0,
    `${context} has an invalid required role.`,
  );
  const definition = findTypeFunction(deviceType, rule.functionKey, context);
  assertMapping(
    definition.terminalKeys.includes(rule.terminalKey),
    `${context} terminal does not belong to its function.`,
  );
  const actualRole = findTerminalRole(deviceType, rule.terminalKey, context);
  assertMapping(
    actualRole === rule.requiredRole,
    `${context} requires role ${JSON.stringify(rule.requiredRole)}; compiled role is ${JSON.stringify(actualRole)}.`,
  );
  const expectedFamily: SchematicViewFamily =
    rule.boundaryKind === "control-source" ||
    rule.boundaryKind === "control-return"
      ? "control"
      : "power";
  assertMapping(
    rule.families.every((family) => family === expectedFamily),
    `${context} boundary kind is outside ${expectedFamily}.`,
  );
  for (const family of rule.families) {
    const rendered = renderedRulesForPair(mapping, rule.functionKey, family);
    assertMapping(
      rendered.length === 1 &&
        rendered[0]!.rule.classification === "source" &&
        rendered[0]!.rule.traversalRole === "source-boundary",
      `${context} is a boundary fallback on an unmapped type/function/role.`,
    );
  }
}

function validateDeviceTypeMapping(
  deviceType: IrDeviceType,
  mapping: DeviceTypeSymbolMapping,
  catalog: readonly SymbolDefinition[],
): void {
  assertMapping(
    mapping.typeId === deviceType.id,
    `mapping ${JSON.stringify(mapping.typeId)} does not match its compiled type.`,
  );
  assertMapping(
    Array.isArray(mapping.functions),
    `${mapping.typeId}.functions must be an array.`,
  );
  assertMapping(
    Array.isArray(mapping.aggregates),
    `${mapping.typeId}.aggregates must be an array.`,
  );
  assertMapping(
    Array.isArray(mapping.omissions),
    `${mapping.typeId}.omissions must be an array.`,
  );
  assertMapping(
    Array.isArray(mapping.boundaryTerminals),
    `${mapping.typeId}.boundaryTerminals must be an array.`,
  );
  uniqueStrings(
    mapping.aggregates.map(({ key }) => key),
    `${mapping.typeId}.aggregateKeys`,
    true,
  );
  mapping.functions.forEach((rule, index) =>
    validateFunctionRule(
      deviceType,
      rule,
      catalog,
      `${mapping.typeId}.functions[${index}]`,
    ),
  );
  mapping.aggregates.forEach((rule, index) =>
    validateAggregateRule(
      deviceType,
      rule,
      catalog,
      `${mapping.typeId}.aggregates[${index}]`,
    ),
  );
  mapping.omissions.forEach((rule, index) => {
    const context = `${mapping.typeId}.omissions[${index}]`;
    findTypeFunction(deviceType, rule.functionKey, context);
    validateFamilies(rule.families, `${context}.families`);
    assertMapping(
      (FUNCTION_OMISSION_REASONS as readonly unknown[]).includes(rule.reason),
      `${context} has unknown reason ${JSON.stringify(rule.reason)}.`,
    );
  });
  const boundaryKeys = new Set<string>();
  mapping.boundaryTerminals.forEach((rule, index) => {
    const context = `${mapping.typeId}.boundaryTerminals[${index}]`;
    validateBoundaryRule(deviceType, mapping, rule, context);
    for (const family of rule.families) {
      const key = JSON.stringify([
        rule.functionKey,
        rule.terminalKey,
        family,
        rule.boundaryKind,
      ]);
      assertMapping(!boundaryKeys.has(key), `${context} duplicates ${key}.`);
      boundaryKeys.add(key);
    }
  });
}

export type MappingCoverageKind = "function" | "aggregate" | "omission";

export interface MappingCoverageEntry {
  readonly typeId: string;
  readonly functionKey: string;
  readonly family: SchematicViewFamily;
  readonly coverage: MappingCoverageKind;
  readonly ruleKey: string;
}

function coverageForPair(
  mapping: DeviceTypeSymbolMapping,
  functionKey: string,
  family: SchematicViewFamily,
): MappingCoverageEntry[] {
  return [
    ...mapping.functions
      .filter(
        (rule) =>
          rule.functionKey === functionKey && rule.families.includes(family),
      )
      .map((rule) => ({
        typeId: mapping.typeId,
        functionKey,
        family,
        coverage: "function" as const,
        ruleKey: rule.functionKey,
      })),
    ...mapping.aggregates
      .filter(
        (rule) =>
          rule.functionKeys.includes(functionKey) &&
          rule.families.includes(family),
      )
      .map((rule) => ({
        typeId: mapping.typeId,
        functionKey,
        family,
        coverage: "aggregate" as const,
        ruleKey: rule.key,
      })),
    ...mapping.omissions
      .filter(
        (rule) =>
          rule.functionKey === functionKey && rule.families.includes(family),
      )
      .map((rule) => ({
        typeId: mapping.typeId,
        functionKey,
        family,
        coverage: "omission" as const,
        ruleKey: rule.reason,
      })),
  ];
}

export function validateDeviceTypeSymbolMappings(
  deviceTypes: readonly IrDeviceType[],
  mappings: readonly DeviceTypeSymbolMapping[],
  catalog: readonly SymbolDefinition[],
): readonly MappingCoverageEntry[] {
  validateSymbolCatalog(catalog);
  const typeById = new Map<string, IrDeviceType>();
  for (const deviceType of deviceTypes) {
    assertMapping(
      !typeById.has(deviceType.id),
      `duplicate compiled device type ${JSON.stringify(deviceType.id)}.`,
    );
    typeById.set(deviceType.id, deviceType);
  }
  const mappingByTypeId = new Map<string, DeviceTypeSymbolMapping>();
  for (const mapping of mappings) {
    assertMapping(
      !mappingByTypeId.has(mapping.typeId),
      `duplicate mapping ${JSON.stringify(mapping.typeId)}.`,
    );
    const deviceType = typeById.get(mapping.typeId);
    assertMapping(
      deviceType !== undefined,
      `mapping ${JSON.stringify(mapping.typeId)} is not a compiled device type.`,
    );
    mappingByTypeId.set(mapping.typeId, mapping);
    validateDeviceTypeMapping(deviceType, mapping, catalog);
  }
  const coverage: MappingCoverageEntry[] = [];
  for (const deviceType of deviceTypes) {
    const mapping = mappingByTypeId.get(deviceType.id);
    assertMapping(mapping !== undefined, `${deviceType.id} has no mapping.`);
    for (const definition of deviceType.functions) {
      for (const family of SCHEMATIC_VIEW_FAMILIES) {
        const entries = coverageForPair(mapping, definition.key, family);
        assertMapping(
          entries.length === 1,
          `${JSON.stringify([deviceType.id, definition.key, family])} has ${entries.length} coverage entries; expected one.`,
        );
        coverage.push(Object.freeze(entries[0]!));
      }
    }
  }
  return Object.freeze(coverage);
}

export function validateMaterializedFunctionFacts(
  deviceType: IrDeviceType,
  materialized: IrFunction,
): void {
  const context = `${deviceType.id}.${materialized.id.functionKey}`;
  const definition = findTypeFunction(
    deviceType,
    materialized.id.functionKey,
    context,
  );
  assertMapping(
    definition.kind === materialized.kind,
    `${context} materialized kind disagrees with its device type.`,
  );
  if (definition.kind === "contact") {
    assertMapping(
      materialized.kind === "contact" &&
        materialized.normal_state === definition.normal_state,
      `${context} materialized state disagrees with its device type.`,
    );
  }
  if (definition.kind === "channel") {
    assertMapping(
      materialized.kind === "channel" &&
        materialized.direction === definition.direction,
      `${context} materialized direction disagrees with its device type.`,
    );
  }
  const terminalKeys = materialized.terminals.map((terminal) => {
    assertMapping(
      terminal.deviceUid === materialized.id.deviceUid,
      `${context} has a terminal on another device.`,
    );
    return terminal.terminalKey;
  });
  assertMapping(
    sameStringSet(terminalKeys, definition.terminalKeys),
    `${context} materialized terminals disagree with its device type.`,
  );
}

export type ResolvedSymbolRule = RenderedRule;

export type ResolveSelectedSymbolRuleResult =
  | { readonly ok: true; readonly value: ResolvedSymbolRule }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError };

export interface ResolveSelectedSymbolRuleRequest {
  readonly deviceType: IrDeviceType;
  readonly deviceUid: string;
  readonly materializedFunctions: readonly IrFunction[];
  readonly functionKey: string;
  readonly family: SchematicViewFamily;
  readonly root: string;
  readonly mapping?: DeviceTypeSymbolMapping;
  readonly catalog: readonly SymbolDefinition[];
}

function unsupportedSelected(
  request: ResolveSelectedSymbolRuleRequest,
): ResolveSelectedSymbolRuleResult {
  return Object.freeze({
    ok: false,
    error: unsupportedSymbolMappingError({
      family: request.family,
      deviceUid: request.deviceUid,
      typeId: request.deviceType.id,
      functionKey: request.functionKey,
      root: request.root,
    }),
  });
}

export function resolveSelectedSymbolRule(
  request: ResolveSelectedSymbolRuleRequest,
): ResolveSelectedSymbolRuleResult {
  validateSymbolCatalog(request.catalog);
  if (
    request.mapping === undefined ||
    request.mapping.typeId !== request.deviceType.id
  ) {
    return unsupportedSelected(request);
  }
  const rendered = renderedRulesForPair(
    request.mapping,
    request.functionKey,
    request.family,
  );
  if (rendered.length === 0) return unsupportedSelected(request);
  assertMapping(
    rendered.length === 1,
    `${request.deviceType.id}.${request.functionKey}/${request.family} resolves more than once.`,
  );
  const selected = rendered[0]!;
  try {
    if (selected.kind === "function") {
      validateFunctionRule(
        request.deviceType,
        selected.rule,
        request.catalog,
        `${request.deviceType.id}.${request.functionKey}`,
      );
      const materialized = request.materializedFunctions.find(
        ({ id }) =>
          id.deviceUid === request.deviceUid &&
          id.functionKey === request.functionKey,
      );
      if (materialized === undefined) return unsupportedSelected(request);
      validateMaterializedFunctionFacts(request.deviceType, materialized);
    } else {
      validateAggregateRule(
        request.deviceType,
        selected.rule,
        request.catalog,
        `${request.deviceType.id}.${selected.rule.key}`,
      );
      for (const memberFunctionKey of selected.rule.functionKeys) {
        const materialized = request.materializedFunctions.find(
          ({ id }) =>
            id.deviceUid === request.deviceUid &&
            id.functionKey === memberFunctionKey,
        );
        if (materialized === undefined) return unsupportedSelected(request);
        validateMaterializedFunctionFacts(request.deviceType, materialized);
      }
    }
  } catch (error) {
    if (error instanceof InvalidSymbolMappingError) {
      return unsupportedSelected(request);
    }
    throw error;
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze(selected),
  });
}

export function isFunctionTraversable(
  family: SchematicViewFamily,
  traversalRole: TraversalRole,
): boolean {
  return family === "control"
    ? traversalRole === "control-contact" ||
        traversalRole === "command-contact" ||
        traversalRole === "permissive-contact" ||
        traversalRole === "protection-contact"
    : traversalRole === "power-contact" ||
        traversalRole === "breaker-pole" ||
        traversalRole === "overload-pole";
}

const BOUNDARY_KIND_EXHAUSTIVE: Readonly<Record<BoundaryKind, true>> =
  Object.freeze({
    "control-source": true,
    "control-return": true,
    "power-source": true,
    "protective-earth-source": true,
  });

const OMISSION_REASON_EXHAUSTIVE: Readonly<
  Record<FunctionOmissionReason, true>
> = Object.freeze({
  "metadata-only-mechanism": true,
  "boundary-metadata-only": true,
  "outside-family": true,
  "unsupported-v0.1": true,
});

void BOUNDARY_KIND_EXHAUSTIVE;
void OMISSION_REASON_EXHAUSTIVE;
