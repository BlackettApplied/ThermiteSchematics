import type { ElectricalIr, IrDeviceType } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  InvalidSymbolCatalogError,
  InvalidSymbolMappingError,
} from "../src/errors.js";
import {
  TRACE_ROOT_RULES,
  validateTraceRootRules,
  type TraceRootRule,
} from "../src/intent-rules.js";
import {
  PRESENTATION_CLASSES,
  PRESENTATION_CLASS_RANK,
  type PresentationClass,
} from "../src/ordering.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type { SymbolDefinition } from "../src/symbols/types.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  FUNCTION_OMISSION_REASONS,
  SCHEMATIC_VIEW_FAMILIES,
  TRAVERSAL_ROLES,
  type DeviceTypeSymbolMapping,
  type FunctionOmissionReason,
  type SchematicViewFamily,
  type TraversalRole,
} from "../src/symbols/mappings.js";
import {
  isFunctionTraversable,
  resolveSelectedSymbolRule,
  validateDeviceTypeSymbolMappings,
  validateMaterializedFunctionFacts,
} from "../src/symbols/validate.js";
import {
  compileCoreFixture,
  coreMapping,
  coreType,
  materializeTypeFunctions,
  mutableCoreMappings,
  required,
} from "./fixtures.js";

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

type OmissionRow = readonly [
  typeId: string,
  functionKeys: readonly string[],
  families: readonly SchematicViewFamily[],
  reason: FunctionOmissionReason,
];

const OMISSION_ROWS: readonly OmissionRow[] = [
  [
    "core:supply-480v-3ph",
    ["three_phase_source", "protective_earth"],
    ["control"],
    "outside-family",
  ],
  [
    "core:breaker-3p",
    ["pole1", "pole2", "pole3"],
    ["control"],
    "outside-family",
  ],
  [
    "core:breaker-3p",
    ["trip"],
    ["control", "power"],
    "metadata-only-mechanism",
  ],
  ["core:contactor-3p-1no", ["coil"], ["power"], "outside-family"],
  [
    "core:contactor-3p-1no",
    ["pole1", "pole2", "pole3"],
    ["control"],
    "outside-family",
  ],
  ["core:contactor-3p-1no", ["aux13"], ["power"], "outside-family"],
  [
    "core:overload-3p-1nc",
    ["pole1", "pole2", "pole3"],
    ["control"],
    "outside-family",
  ],
  ["core:overload-3p-1nc", ["aux95"], ["power"], "outside-family"],
  [
    "core:overload-3p-1nc",
    ["trip"],
    ["control", "power"],
    "metadata-only-mechanism",
  ],
  [
    "core:motor-3ph",
    ["motor_load", "protective_earth"],
    ["control"],
    "outside-family",
  ],
  ["core:pushbutton-nc", ["contact11"], ["power"], "outside-family"],
  ["core:limit-switch-2wire", ["contact13"], ["power"], "outside-family"],
  ["core:prox-pnp-3wire", ["supply", "output"], ["power"], "outside-family"],
  [
    "core:plc-compact",
    ["di0", "di1", "do0", "do1"],
    ["power"],
    "outside-family",
  ],
  ["core:plc-compact", ["supply"], ["power"], "outside-family"],
  ["core:psu-24vdc", ["dc_output"], ["power"], "outside-family"],
  ["core:psu-24vdc", ["ac_input"], ["control", "power"], "unsupported-v0.1"],
];

type ClassRoleRow = readonly [
  typeId: string,
  keys: readonly string[],
  classification: PresentationClass,
  traversalRole: TraversalRole,
  aggregate?: boolean,
];

const CLASS_ROLE_ROWS: readonly ClassRoleRow[] = [
  [
    "core:supply-480v-3ph",
    ["three-phase-source"],
    "source",
    "source-boundary",
    true,
  ],
  [
    "core:breaker-3p",
    ["pole1", "pole2", "pole3"],
    "protection",
    "breaker-pole",
  ],
  ["core:contactor-3p-1no", ["coil"], "coil", "coil-root"],
  [
    "core:contactor-3p-1no",
    ["pole1", "pole2", "pole3"],
    "power-contact",
    "power-contact",
  ],
  ["core:contactor-3p-1no", ["aux13"], "control-contact", "control-contact"],
  [
    "core:overload-3p-1nc",
    ["pole1", "pole2", "pole3"],
    "overload",
    "overload-pole",
  ],
  ["core:overload-3p-1nc", ["aux95"], "protection", "protection-contact"],
  ["core:motor-3ph", ["motor"], "load", "load-boundary", true],
  ["core:pushbutton-nc", ["contact11"], "command", "command-contact"],
  [
    "core:limit-switch-2wire",
    ["contact13"],
    "permissive",
    "permissive-contact",
  ],
  [
    "core:prox-pnp-3wire",
    ["pnp-sensor"],
    "permissive",
    "non-traversable",
    true,
  ],
  ["core:plc-compact", ["di0", "di1"], "plc-input", "channel-boundary"],
  ["core:plc-compact", ["do0", "do1"], "plc-output", "channel-boundary"],
  ["core:plc-compact", ["supply"], "load", "load-boundary"],
  ["core:psu-24vdc", ["dc_output"], "source", "source-boundary"],
  [
    "core:terminal-block-8",
    [
      "terminal1",
      "terminal2",
      "terminal3",
      "terminal4",
      "terminal5",
      "terminal6",
      "terminal7",
      "terminal8",
    ],
    "terminal",
    "terminal-display",
  ],
  [
    "core:junction-box-8",
    [
      "terminal1",
      "terminal2",
      "terminal3",
      "terminal4",
      "terminal5",
      "terminal6",
      "terminal7",
      "terminal8",
    ],
    "terminal",
    "terminal-display",
  ],
];

function validate(mappings: readonly DeviceTypeSymbolMapping[]): void {
  validateDeviceTypeSymbolMappings(
    coreIr.deviceTypes,
    mappings,
    SYMBOL_CATALOG,
  );
}

function expectMappingFailure(
  mutate: (mappings: DeviceTypeSymbolMapping[]) => void,
): void {
  const mappings = mutableCoreMappings();
  mutate(mappings);
  expect(() => validate(mappings)).toThrow(InvalidSymbolMappingError);
}

function mutableTraceRules(): TraceRootRule[] {
  return structuredClone(TRACE_ROOT_RULES) as TraceRootRule[];
}

function expectTraceRuleFailure(
  mutate: (
    deviceTypes: IrDeviceType[],
    mappings: DeviceTypeSymbolMapping[],
    rules: TraceRootRule[],
  ) => void,
): void {
  const deviceTypes = structuredClone(coreIr.deviceTypes);
  const mappings = mutableCoreMappings();
  const rules = mutableTraceRules();
  mutate(deviceTypes, mappings, rules);
  expect(() => validateTraceRootRules(deviceTypes, mappings, rules)).toThrow(
    InvalidSymbolMappingError,
  );
}

function mutableType(typeId: string): IrDeviceType {
  return structuredClone(coreType(coreIr, typeId));
}

describe("closed trace-root intent rules", () => {
  it("freezes the exact two-wire and PNP representation and role table", () => {
    expect(TRACE_ROOT_RULES).toEqual([
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
    ]);
    const visit = (value: unknown, seen = new Set<object>()): void => {
      if (typeof value !== "object" || value === null || seen.has(value))
        return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const member of Object.values(value)) visit(member, seen);
    };
    visit(TRACE_ROOT_RULES);
  });

  it("validates both rules against exact compiled type and control mappings", () => {
    expect(() =>
      validateTraceRootRules(
        coreIr.deviceTypes,
        CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
      ),
    ).not.toThrow();
    expect(() =>
      validateTraceRootRules(
        [...coreIr.deviceTypes].reverse(),
        [...CORE_DEVICE_TYPE_SYMBOL_MAPPINGS].reverse(),
      ),
    ).not.toThrow();
  });

  it("rejects contradictory type facts, roles, bindings, and representations", () => {
    const failures: readonly Parameters<typeof expectTraceRuleFailure>[0][] = [
      (_types, _mappings, rules) => {
        rules.push(structuredClone(rules[0]!));
      },
      (types) => {
        const pnp = required(
          types.find(({ id }) => id === "core:prox-pnp-3wire"),
        );
        const output = required(
          pnp.functions.find(({ key }) => key === "output"),
        );
        if (output.kind === "channel") output.direction = "input";
      },
      (types) => {
        const limit = required(
          types.find(({ id }) => id === "core:limit-switch-2wire"),
        );
        required(
          limit.functions.find(({ key }) => key === "contact13"),
        ).terminalKeys.reverse();
      },
      (_types, _mappings, rules) => {
        const ports = rules[0]!.representation.ports as Array<{
          role: string;
        }>;
        ports[1]!.role = "positive-supply";
      },
      (_types, mappings) => {
        required(
          mappings.find(({ typeId }) => typeId === "core:limit-switch-2wire"),
        ).functions[0]!.symbolId = "ais:contact-no";
      },
      (_types, mappings) => {
        required(
          mappings.find(({ typeId }) => typeId === "core:prox-pnp-3wire"),
        ).aggregates[0]!.bindings[2]!.terminalKey = "1";
      },
      (_types, mappings) => {
        const limit = required(
          mappings.find(({ typeId }) => typeId === "core:limit-switch-2wire"),
        );
        limit.functions.push(structuredClone(limit.functions[0]!));
      },
      (_types, mappings) => {
        const index = mappings.findIndex(
          ({ typeId }) => typeId === "core:prox-pnp-3wire",
        );
        mappings.splice(index, 1);
      },
    ];
    for (const failure of failures) expectTraceRuleFailure(failure);
  });
});

describe("D4 complete core symbol mapping", () => {
  it("validates all 12 core device types and exactly 90 type/function/family pairs", () => {
    expect(coreIr.deviceTypes).toHaveLength(12);
    expect(
      coreIr.deviceTypes.flatMap(({ functions }) => functions),
    ).toHaveLength(45);
    expect(coreIr.cableTypes.map(({ id }) => id)).toEqual([
      "core:cable-2pair-shielded",
    ]);
    expect(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS).toHaveLength(12);

    const coverage = validateDeviceTypeSymbolMappings(
      coreIr.deviceTypes,
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
      SYMBOL_CATALOG,
    );
    expect(coverage).toHaveLength(90);
    expect(
      new Set(
        coverage.map(({ typeId, functionKey, family }) =>
          JSON.stringify([typeId, functionKey, family]),
        ),
      ).size,
    ).toBe(90);
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(coverage.every(Object.isFrozen)).toBe(true);
    for (const deviceType of coreIr.deviceTypes) {
      for (const definition of deviceType.functions) {
        for (const family of SCHEMATIC_VIEW_FAMILIES) {
          expect(
            coverage.filter(
              (entry) =>
                entry.typeId === deviceType.id &&
                entry.functionKey === definition.key &&
                entry.family === family,
            ),
          ).toHaveLength(1);
        }
      }
    }
  });

  it("matches every expanded row of the exact omission matrix", () => {
    const expected = OMISSION_ROWS.flatMap(
      ([typeId, functionKeys, families, reason]) =>
        functionKeys.flatMap((functionKey) =>
          families.map((family) => [typeId, functionKey, family, reason]),
        ),
    );
    const actual = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) =>
      mapping.omissions.flatMap((rule) =>
        rule.families.map((family) => [
          mapping.typeId,
          rule.functionKey,
          family,
          rule.reason,
        ]),
      ),
    );
    expect(actual.map(JSON.stringify).sort()).toEqual(
      expected.map(JSON.stringify).sort(),
    );
  });

  it("matches every rendered class/role matrix row without coupling the vocabularies", () => {
    const expected = CLASS_ROLE_ROWS.flatMap(
      ([typeId, keys, classification, traversalRole, aggregate = false]) =>
        keys.map((key) => [
          typeId,
          aggregate ? "aggregate" : "function",
          key,
          classification,
          traversalRole,
        ]),
    );
    const actual = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) => [
      ...mapping.functions.map((rule) => [
        mapping.typeId,
        "function",
        rule.functionKey,
        rule.classification,
        rule.traversalRole,
      ]),
      ...mapping.aggregates.map((rule) => [
        mapping.typeId,
        "aggregate",
        rule.key,
        rule.classification,
        rule.traversalRole,
      ]),
    ]);
    expect(actual.map(JSON.stringify).sort()).toEqual(
      expected.map(JSON.stringify).sort(),
    );
  });

  it("matches every direct function symbol and ordered terminal binding", () => {
    const poles = (
      typeId: string,
      symbolId: string,
      terminals: readonly (readonly [string, string, string])[],
    ) =>
      terminals.map(([functionKey, input, output]) => [
        typeId,
        functionKey,
        symbolId,
        [`in=${input}`, `out=${output}`],
      ]);
    const terminalRows = (typeId: string, prefix: string) =>
      Array.from({ length: 8 }, (_, index) => {
        const terminalKey = `${prefix}${index + 1}`;
        return [
          typeId,
          `terminal${index + 1}`,
          "ais:terminal",
          [`in=${terminalKey}`, `out=${terminalKey}`],
        ];
      });
    const expected = [
      ...poles("core:breaker-3p", "ais:breaker-pole", [
        ["pole1", "1/L1", "2/T1"],
        ["pole2", "3/L2", "4/T2"],
        ["pole3", "5/L3", "6/T3"],
      ]),
      ["core:contactor-3p-1no", "coil", "ais:coil", ["A1=A1", "A2=A2"]],
      ...poles("core:contactor-3p-1no", "ais:contact-no", [
        ["pole1", "1/L1", "2/T1"],
        ["pole2", "3/L2", "4/T2"],
        ["pole3", "5/L3", "6/T3"],
        ["aux13", "13", "14"],
      ]),
      ...poles("core:overload-3p-1nc", "ais:overload-pole", [
        ["pole1", "1/L1", "2/T1"],
        ["pole2", "3/L2", "4/T2"],
        ["pole3", "5/L3", "6/T3"],
      ]),
      [
        "core:overload-3p-1nc",
        "aux95",
        "ais:overload-contact-nc",
        ["in=95", "out=96"],
      ],
      [
        "core:pushbutton-nc",
        "contact11",
        "ais:pushbutton-nc",
        ["in=11", "out=12"],
      ],
      [
        "core:limit-switch-2wire",
        "contact13",
        "ais:switch-no",
        ["in=13", "out=14"],
      ],
      [
        "core:plc-compact",
        "supply",
        "ais:dc-load",
        ["positive=L+", "return=M"],
      ],
      ["core:plc-compact", "di0", "ais:plc-di", ["DI=X1.0"]],
      ["core:plc-compact", "di1", "ais:plc-di", ["DI=X1.1"]],
      ["core:plc-compact", "do0", "ais:plc-do", ["DO=X2.0"]],
      ["core:plc-compact", "do1", "ais:plc-do", ["DO=X2.1"]],
      [
        "core:psu-24vdc",
        "dc_output",
        "ais:power-source-dc",
        ["positive=+", "return=-"],
      ],
      ...terminalRows("core:terminal-block-8", ""),
      ...terminalRows("core:junction-box-8", "X1."),
    ];
    const actual = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) =>
      mapping.functions.map((rule) => [
        mapping.typeId,
        rule.functionKey,
        rule.symbolId,
        rule.bindings.map(
          ({ portId, terminalKey }) => `${portId}=${terminalKey}`,
        ),
      ]),
    );
    expect(actual).toEqual(expected);
  });

  it("keeps every presentation class and traversal role exhaustive at compile time and runtime", () => {
    const expectedRanks: Readonly<Record<PresentationClass, number>> = {
      source: 0,
      "plc-output": 1,
      "plc-input": 2,
      protection: 3,
      command: 4,
      permissive: 5,
      "power-contact": 6,
      "control-contact": 7,
      overload: 8,
      coil: 9,
      load: 10,
      terminal: 11,
      rail: 12,
      junction: 13,
    };
    const usedRoles = new Set(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) => [
        ...mapping.functions.map(({ traversalRole }) => traversalRole),
        ...mapping.aggregates.map(({ traversalRole }) => traversalRole),
      ]),
    );
    expect(PRESENTATION_CLASS_RANK).toEqual(expectedRanks);
    expect(Object.keys(PRESENTATION_CLASS_RANK).sort()).toEqual(
      [...PRESENTATION_CLASSES].sort(),
    );
    expect([...usedRoles].sort()).toEqual([...TRAVERSAL_ROLES].sort());
    expect(FUNCTION_OMISSION_REASONS).toEqual([
      "metadata-only-mechanism",
      "boundary-metadata-only",
      "outside-family",
      "unsupported-v0.1",
    ]);
  });

  it("uses only traversal roles for the exact control and power pass-through sets", () => {
    const control = new Set([
      "control-contact",
      "command-contact",
      "permissive-contact",
      "protection-contact",
    ]);
    const power = new Set(["power-contact", "breaker-pole", "overload-pole"]);
    for (const role of TRAVERSAL_ROLES) {
      expect(isFunctionTraversable("control", role)).toBe(control.has(role));
      expect(isFunctionTraversable("power", role)).toBe(power.has(role));
    }
  });

  it("matches the exact typed boundary-terminal fallback rules", () => {
    expect(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) =>
        mapping.boundaryTerminals.map((rule) => ({
          typeId: mapping.typeId,
          ...rule,
        })),
      ),
    ).toEqual([
      {
        typeId: "core:supply-480v-3ph",
        functionKey: "three_phase_source",
        terminalKey: "L1",
        families: ["power"],
        boundaryKind: "power-source",
        requiredRole: "phase_1_source",
      },
      {
        typeId: "core:supply-480v-3ph",
        functionKey: "three_phase_source",
        terminalKey: "L2",
        families: ["power"],
        boundaryKind: "power-source",
        requiredRole: "phase_2_source",
      },
      {
        typeId: "core:supply-480v-3ph",
        functionKey: "three_phase_source",
        terminalKey: "L3",
        families: ["power"],
        boundaryKind: "power-source",
        requiredRole: "phase_3_source",
      },
      {
        typeId: "core:supply-480v-3ph",
        functionKey: "protective_earth",
        terminalKey: "PE",
        families: ["power"],
        boundaryKind: "protective-earth-source",
        requiredRole: "protective_earth",
      },
      {
        typeId: "core:psu-24vdc",
        functionKey: "dc_output",
        terminalKey: "+",
        families: ["control"],
        boundaryKind: "control-source",
        requiredRole: "dc_positive_output",
      },
      {
        typeId: "core:psu-24vdc",
        functionKey: "dc_output",
        terminalKey: "-",
        families: ["control"],
        boundaryKind: "control-return",
        requiredRole: "dc_return_output",
      },
    ]);
  });

  it("expands contactor and overload functions only in their exact families", () => {
    const rows = [
      ["core:contactor-3p-1no", "control", ["coil", "aux13"]],
      ["core:contactor-3p-1no", "power", ["pole1", "pole2", "pole3"]],
      ["core:overload-3p-1nc", "control", ["aux95"]],
      ["core:overload-3p-1nc", "power", ["pole1", "pole2", "pole3"]],
    ] as const;
    for (const [typeId, family, functionKeys] of rows) {
      const mapping = coreMapping(typeId);
      expect(
        mapping.functions
          .filter((rule) => rule.families.includes(family))
          .map(({ functionKey }) => functionKey),
      ).toEqual(functionKeys);
    }
  });

  it("validates every compiled materialized function state, direction, and terminal set", () => {
    const deviceTypeById = new Map(
      coreIr.deviceTypes.map((deviceType) => [deviceType.id, deviceType]),
    );
    const typeIdByDeviceUid = new Map(
      coreIr.devices.map(({ uid, typeId }) => [uid, typeId]),
    );
    for (const materialized of coreIr.functions) {
      const typeId = required(typeIdByDeviceUid.get(materialized.id.deviceUid));
      validateMaterializedFunctionFacts(
        required(deviceTypeById.get(typeId)),
        materialized,
      );
    }
    const pnp = coreType(coreIr, "core:prox-pnp-3wire");
    for (const materialized of materializeTypeFunctions(pnp, "PNP1")) {
      validateMaterializedFunctionFacts(pnp, materialized);
    }
  });

  it.each([
    [
      "SRC1",
      "core:supply-480v-3ph",
      "three-phase-source",
      "three_phase_source",
      [
        ["L1", "L1", "three_phase_source"],
        ["L2", "L2", "three_phase_source"],
        ["L3", "L3", "three_phase_source"],
        ["PE", "PE", "protective_earth"],
      ],
    ],
    [
      "M1",
      "core:motor-3ph",
      "motor",
      "motor_load",
      [
        ["U", "U", "motor_load"],
        ["V", "V", "motor_load"],
        ["W", "W", "motor_load"],
        ["PE", "PE", "protective_earth"],
      ],
    ],
    [
      "PNP1",
      "core:prox-pnp-3wire",
      "pnp-sensor",
      "output",
      [
        ["supply", "1", "supply"],
        ["return", "3", "supply"],
        ["signal", "4", "output"],
      ],
    ],
  ] as const)(
    "preserves disjoint aggregate binding-union provenance for %s",
    (
      designation,
      typeId,
      aggregateKey,
      selectedFunctionKey,
      expectedBindings,
    ) => {
      const deviceType = coreType(coreIr, typeId);
      const mapping = coreMapping(typeId);
      const aggregate = required(
        mapping.aggregates.find(({ key }) => key === aggregateKey),
      );
      expect(
        aggregate.bindings.map(({ portId, terminalKey, memberFunctionKey }) => [
          portId,
          terminalKey,
          memberFunctionKey,
        ]),
      ).toEqual(expectedBindings);

      const requiredByMember = new Map(
        aggregate.functionKeys.map((functionKey) => [
          functionKey,
          new Set(
            required(
              deviceType.functions.find(({ key }) => key === functionKey),
            ).terminalKeys,
          ),
        ]),
      );
      for (const [functionKey, terminals] of requiredByMember) {
        expect(
          new Set(
            aggregate.bindings
              .filter(
                ({ memberFunctionKey }) => memberFunctionKey === functionKey,
              )
              .map(({ terminalKey }) => terminalKey),
          ),
        ).toEqual(terminals);
      }
      const intersection = [...requiredByMember.values()].reduce<Set<string>>(
        (shared, terminals) =>
          new Set([...shared].filter((terminal) => terminals.has(terminal))),
      );
      expect(intersection.size).toBe(0);

      const device = coreIr.devices.find(
        (candidate) => candidate.designation === designation,
      );
      const deviceUid = device?.uid ?? designation;
      const materializedFunctions =
        device === undefined
          ? materializeTypeFunctions(deviceType, deviceUid)
          : coreIr.functions.filter(({ id }) => id.deviceUid === deviceUid);
      const resolved = resolveSelectedSymbolRule({
        deviceType,
        deviceUid,
        materializedFunctions,
        functionKey: selectedFunctionKey,
        family: typeId === "core:prox-pnp-3wire" ? "control" : "power",
        root: designation,
        mapping,
        catalog: SYMBOL_CATALOG,
      });
      expect(resolved).toMatchObject({
        ok: true,
        value: { kind: "aggregate", rule: { key: aggregateKey } },
      });
    },
  );

  it("deep-freezes the renderer-owned core mapping DTOs", () => {
    const visit = (value: unknown, seen = new Set<object>()): void => {
      if (typeof value !== "object" || value === null || seen.has(value))
        return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const member of Object.values(value)) visit(member, seen);
    };
    visit(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS);
  });

  it("rejects an uncovered function/family", () => {
    expectMappingFailure((mappings) => {
      const breaker = mappings.find(
        ({ typeId }) => typeId === "core:breaker-3p",
      )!;
      breaker.omissions = breaker.omissions.filter(
        ({ functionKey }) => functionKey !== "pole1",
      );
    });
  });

  it("rejects rendered/omitted overlap", () => {
    expectMappingFailure((mappings) => {
      const breaker = mappings.find(
        ({ typeId }) => typeId === "core:breaker-3p",
      )!;
      breaker.functions[0]!.families = ["control", "power"];
    });
  });

  it("rejects an aggregate member without a binding", () => {
    expectMappingFailure((mappings) => {
      const pnp = mappings.find(
        ({ typeId }) => typeId === "core:prox-pnp-3wire",
      )!;
      pnp.aggregates[0]!.bindings = pnp.aggregates[0]!.bindings.filter(
        ({ memberFunctionKey }) => memberFunctionKey !== "output",
      );
    });
  });

  it("rejects an aggregate required terminal without a binding", () => {
    expectMappingFailure((mappings) => {
      const source = mappings.find(
        ({ typeId }) => typeId === "core:supply-480v-3ph",
      )!;
      source.aggregates[0]!.bindings = source.aggregates[0]!.bindings.filter(
        ({ terminalKey }) => terminalKey !== "L3",
      );
    });
  });

  it("rejects a binding outside the member-function union", () => {
    expectMappingFailure((mappings) => {
      const pnp = mappings.find(
        ({ typeId }) => typeId === "core:prox-pnp-3wire",
      )!;
      pnp.aggregates[0]!.bindings[2]!.memberFunctionKey = "missing";
    });
  });

  it.each([undefined, "unknown-role"])(
    "rejects missing or unknown traversal role %s",
    (traversalRole) => {
      expectMappingFailure((mappings) => {
        mappings[1]!.functions[0]!.traversalRole = traversalRole;
      });
    },
  );

  it("rejects an illegal presentation class/traversal role pairing", () => {
    expectMappingFailure((mappings) => {
      mappings[1]!.functions[0]!.traversalRole = "coil-root";
    });
  });

  it("keeps ais:dc-load closed over load facts, full coverage, and load/load-boundary", () => {
    const failures: Array<
      (
        deviceTypes: IrDeviceType[],
        mappings: DeviceTypeSymbolMapping[],
        catalog: SymbolDefinition[],
      ) => void
    > = [
      (deviceTypes) => {
        const plc = required(
          deviceTypes.find(({ id }) => id === "core:plc-compact"),
        );
        (
          required(plc.functions.find(({ key }) => key === "supply")) as {
            kind: string;
          }
        ).kind = "source";
      },
      (_deviceTypes, mappings) => {
        const plc = required(
          mappings.find(({ typeId }) => typeId === "core:plc-compact"),
        );
        required(
          plc.functions.find(({ functionKey }) => functionKey === "supply"),
        ).bindings[1]!.terminalKey = "X1.0";
      },
      (_deviceTypes, mappings, catalog) => {
        const symbol = required(catalog.find(({ id }) => id === "ais:dc-load"));
        symbol.ports.push({
          id: "extra",
          side: "west",
          offset: 1 / 2,
          order: 2,
        });
        const plc = required(
          mappings.find(({ typeId }) => typeId === "core:plc-compact"),
        );
        required(
          plc.functions.find(({ functionKey }) => functionKey === "supply"),
        ).bindings.push({ portId: "extra", terminalKey: "X1.0" });
      },
      (_deviceTypes, mappings) => {
        const plc = required(
          mappings.find(({ typeId }) => typeId === "core:plc-compact"),
        );
        required(
          plc.functions.find(({ functionKey }) => functionKey === "supply"),
        ).bindings[1]!.terminalKey = "L+";
      },
      (_deviceTypes, mappings) => {
        const plc = required(
          mappings.find(({ typeId }) => typeId === "core:plc-compact"),
        );
        required(
          plc.functions.find(({ functionKey }) => functionKey === "supply"),
        ).bindings.pop();
      },
      (_deviceTypes, mappings) => {
        const plc = required(
          mappings.find(({ typeId }) => typeId === "core:plc-compact"),
        );
        const rule = required(
          plc.functions.find(({ functionKey }) => functionKey === "supply"),
        );
        rule.classification = "permissive";
        rule.traversalRole = "non-traversable";
      },
    ];

    for (const mutate of failures) {
      const deviceTypes = structuredClone(coreIr.deviceTypes);
      const mappings = mutableCoreMappings();
      const catalog = structuredClone(SYMBOL_CATALOG);
      mutate(deviceTypes, mappings, catalog);
      expect(() =>
        validateDeviceTypeSymbolMappings(deviceTypes, mappings, catalog),
      ).toThrow(InvalidSymbolMappingError);
    }
  });

  it("rejects a boundary fallback whose rendered type/function/role is unmapped", () => {
    expectMappingFailure((mappings) => {
      const psu = mappings.find(({ typeId }) => typeId === "core:psu-24vdc")!;
      psu.functions[0]!.classification = "permissive";
      psu.functions[0]!.traversalRole = "non-traversable";
    });
  });

  it("rejects a non-device cable symbol mapping", () => {
    expectMappingFailure((mappings) => {
      const cable = structuredClone(mappings[0]!);
      cable.typeId = "core:cable-2pair-shielded";
      mappings.push(cable);
    });
  });

  it("rejects wrong omission reason and empty/unknown omission families", () => {
    for (const mutate of [
      (rule: DeviceTypeSymbolMapping["omissions"][number]) => {
        rule.reason = "free-form";
      },
      (rule: DeviceTypeSymbolMapping["omissions"][number]) => {
        rule.families = [];
      },
      (rule: DeviceTypeSymbolMapping["omissions"][number]) => {
        rule.families = ["diagram"];
      },
    ]) {
      expectMappingFailure((mappings) => mutate(mappings[0]!.omissions[0]!));
    }
  });

  it("rejects compiled contact-state and channel-direction disagreement", () => {
    const breaker = mutableType("core:breaker-3p");
    breaker.functions[0]!.normal_state = "open";
    const plc = mutableType("core:plc-compact");
    plc.functions.find(({ key }) => key === "di0")!.direction = "output";
    for (const changed of [breaker, plc]) {
      const deviceTypes = coreIr.deviceTypes.map((deviceType) =>
        deviceType.id === changed.id ? changed : deviceType,
      );
      expect(() =>
        validateDeviceTypeSymbolMappings(
          deviceTypes,
          CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
          SYMBOL_CATALOG,
        ),
      ).toThrow(InvalidSymbolMappingError);
    }
  });

  it("allows only ais:terminal to bind two ports to one structural terminal", () => {
    for (const mapping of CORE_DEVICE_TYPE_SYMBOL_MAPPINGS) {
      for (const rule of mapping.functions) {
        const uniqueTerminals = new Set(
          rule.bindings.map(({ terminalKey }) => terminalKey),
        );
        if (rule.symbolId === "ais:terminal") {
          expect(rule.bindings).toHaveLength(2);
          expect(uniqueTerminals.size).toBe(1);
        } else {
          expect(uniqueTerminals.size).toBe(rule.bindings.length);
        }
      }
    }
  });

  it("returns frozen R003 for an unsupported selected mapping", () => {
    const breaker = coreType(coreIr, "core:breaker-3p");
    const device = required(
      coreIr.devices.find(({ typeId }) => typeId === breaker.id),
    );
    const result = resolveSelectedSymbolRule({
      deviceType: breaker,
      deviceUid: device.uid,
      materializedFunctions: coreIr.functions.filter(
        ({ id }) => id.deviceUid === device.uid,
      ),
      functionKey: "pole1",
      family: "power",
      root: device.designation,
      catalog: SYMBOL_CATALOG,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R003",
        message:
          'Unsupported symbol mapping: function "pole1" on type "core:breaker-3p" has no valid power binding.',
        family: "power",
        deviceUid: device.uid,
        typeId: "core:breaker-3p",
        functionKey: "pole1",
        root: device.designation,
      },
    });
    if (!result.ok) expect(Object.isFrozen(result.error)).toBe(true);
  });

  it("returns R003 when a selected function is explicitly omitted or its IR facts disagree", () => {
    const breaker = coreType(coreIr, "core:breaker-3p");
    const device = required(
      coreIr.devices.find(({ typeId }) => typeId === breaker.id),
    );
    const materializedFunctions = coreIr.functions.filter(
      ({ id }) => id.deviceUid === device.uid,
    );
    const base = {
      deviceType: breaker,
      deviceUid: device.uid,
      functionKey: "pole1",
      root: device.designation,
      mapping: coreMapping(breaker.id),
      catalog: SYMBOL_CATALOG,
    } as const;
    expect(
      resolveSelectedSymbolRule({
        ...base,
        materializedFunctions,
        family: "control",
      }),
    ).toMatchObject({ ok: false, error: { code: "R003" } });

    const corrupt = structuredClone(materializedFunctions);
    corrupt.find(({ id }) => id.functionKey === "pole1")!.normal_state = "open";
    expect(
      resolveSelectedSymbolRule({
        ...base,
        materializedFunctions: corrupt,
        family: "power",
      }),
    ).toMatchObject({ ok: false, error: { code: "R003" } });
  });

  it("throws catalog corruption instead of translating it to R003", () => {
    const breaker = coreType(coreIr, "core:breaker-3p");
    const device = required(
      coreIr.devices.find(({ typeId }) => typeId === breaker.id),
    );
    const catalog = structuredClone(SYMBOL_CATALOG);
    catalog[0]!.primitives[0]!.style = "foreign";
    expect(() =>
      resolveSelectedSymbolRule({
        deviceType: breaker,
        deviceUid: device.uid,
        materializedFunctions: coreIr.functions.filter(
          ({ id }) => id.deviceUid === device.uid,
        ),
        functionKey: "pole1",
        family: "power",
        root: device.designation,
        mapping: coreMapping(breaker.id),
        catalog,
      }),
    ).toThrow(InvalidSymbolCatalogError);
  });
});
