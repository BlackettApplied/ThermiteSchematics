import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DIAGNOSTIC_CATALOG, type Diagnostic } from "@thermite/schema";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  assembleElectricalIr,
  compileLoadedProject,
  compileProject,
  deriveProjectNets,
  evaluateRules,
  expandResolvedProject,
  generateLibraryLock,
  loadProject,
  normalizeProjectGraph,
  resolveLoadedProject,
  serializeIr,
  verifyLibraryLock,
  type ElectricalIr,
  type LoadedProject,
  type M3RuleId,
} from "../src/index.js";
import {
  compileLoadedProjectWithStages,
  compileProjectWithStages,
} from "../src/compiler.js";
import { createRuleContext } from "../src/rules/context.js";
import { exclusiveTerminalAssignmentRule } from "../src/rules/exclusive-terminal-assignment.js";
import { invalidCableConductorRule } from "../src/rules/invalid-cable-conductor.js";
import { analyzePotentialDeclarations } from "../src/rules/potential-analysis.js";
import { ELECTRICAL_RULES } from "../src/rules/registry.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const rulesFixtureRoot = join(packageRoot, "fixtures", "rules");
const rulesSourceRoot = join(packageRoot, "src", "rules");
const referentialFixtureRoot = join(
  packageRoot,
  "fixtures",
  "referential-diagnostics",
);
const structuralFixtureRoot = join(
  repositoryRoot,
  "packages",
  "cli",
  "fixtures",
  "duplicate uid cross scopes",
);
const fixtureNames = [
  "invalid-connector-port",
  "invalid-circuit-symbol",
  "invalid-connection-review",
  "missing-required-connection",
  "partial-connection-model",
  "deferred-connection",
  "invalid-communication-port",
  "invalid-channel-assignment",
  "invalid-terminal-order",
  "invalid-cable-conductor",
  "several-invalid-cable-conductors",
  "exclusive-terminal-second-wire",
  "shared-absent-policy-fanout",
  "exclusive-jumper-cable",
  "e200-excluded-from-exclusive-count",
  "exact-duplicate-potential",
  "compatible-partial-potential",
  "conflicting-potential-name",
  "conflicting-potential-field",
  "three-way-potential-set",
  "topological-error-potential-conflict",
  "multi-net-potential-independence",
  "voltage-type-mismatch",
  "nominal-voltage-mismatch",
  "dual-voltage-mismatch",
  "zero-voltage-return",
  "missing-partial-voltage-facts",
  "conflict-suppresses-rating",
  "compatible-partial-later-voltage-origin",
] as const;

const e200FixtureNames = [
  "invalid-cable-conductor",
  "several-invalid-cable-conductors",
] as const;

const exactFixtureByRule = {
  E200: "invalid-cable-conductor",
  E201: "exclusive-terminal-second-wire",
  E300: "conflicting-potential-name",
  E301: "voltage-type-mismatch",
  E302: "nominal-voltage-mismatch",
  W902: "exact-duplicate-potential",
  E202: "invalid-channel-assignment",
  E203: "invalid-terminal-order",
  E204: "invalid-communication-port",
  E207: "invalid-connector-port",
  E205: "invalid-connection-review",
  E206: "invalid-circuit-symbol",
  W903: "missing-required-connection",
  W904: "partial-connection-model",
  W905: "deferred-connection",
} as const satisfies Record<M3RuleId, FixtureName>;

const pipelineRuleErrorFixtures = [
  ["E200", "invalid-cable-conductor"],
  ["E201", "exclusive-terminal-second-wire"],
  ["E300", "conflicting-potential-name"],
  ["E301", "voltage-type-mismatch"],
  ["E302", "nominal-voltage-mismatch"],
] as const satisfies readonly (readonly [M3RuleId, FixtureName])[];

type FixtureName = (typeof fixtureNames)[number];

const irByFixture = new Map<FixtureName, ElectricalIr>();
const expectedByFixture = new Map<FixtureName, Diagnostic[]>();

async function assembleFixtureIr(
  name: FixtureName,
  root: string,
): Promise<ElectricalIr> {
  const loaded = await loadProject(root);
  if (!loaded.ok) {
    throw new Error(
      `Rule fixture ${name} failed structural loading: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }

  const verified = verifyLibraryLock(loaded.project);
  if (!verified.ok) {
    throw new Error(
      `Rule fixture ${name} failed lock verification: ${JSON.stringify(verified.diagnostics)}`,
    );
  }

  const resolution = resolveLoadedProject(loaded.project);
  if (!resolution.ok) {
    throw new Error(
      `Rule fixture ${name} failed resolution: ${JSON.stringify(resolution.diagnostics)}`,
    );
  }

  expect(loaded.diagnostics).toEqual([]);
  expect(verified.diagnostics).toEqual([]);
  expect(resolution.diagnostics).toEqual([]);

  const expansion = expandResolvedProject(resolution);
  const graph = normalizeProjectGraph(expansion, resolution);
  const derived = deriveProjectNets(expansion, graph);
  return assembleElectricalIr(
    loaded.project,
    verified.lock,
    expansion,
    graph,
    derived,
  );
}

beforeAll(async () => {
  await Promise.all(
    fixtureNames.map(async (name) => {
      const root = join(rulesFixtureRoot, name);
      irByFixture.set(name, await assembleFixtureIr(name, root));
      expectedByFixture.set(
        name,
        JSON.parse(
          await readFile(join(root, "expected.json"), "utf8"),
        ) as Diagnostic[],
      );
    }),
  );
});

function fixtureIr(name: FixtureName): ElectricalIr {
  const ir = irByFixture.get(name);
  if (ir === undefined) {
    throw new Error(`Rule fixture ${name} was not compiled.`);
  }
  return ir;
}

function fixtureExpected(name: FixtureName): Diagnostic[] {
  const expected = expectedByFixture.get(name);
  if (expected === undefined) {
    throw new Error(`Rule fixture ${name} has no expected diagnostics.`);
  }
  return expected;
}

async function loadedProject(root: string): Promise<LoadedProject> {
  const loaded = await loadProject(root);
  if (!loaded.ok) {
    throw new Error(
      `Pipeline fixture failed structural loading: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }
  return loaded.project;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }

  for (const member of Object.values(value)) {
    deepFreeze(member);
  }
  Object.freeze(value);
}

function reverseHydrationOrder(ir: ElectricalIr): void {
  for (const key of [
    "libraries",
    "deviceTypes",
    "cableTypes",
    "devices",
    "terminals",
    "functions",
    "internalRelations",
    "gangedGroups",
    "wires",
    "jumpers",
    "cables",
    "cableConductors",
    "relations",
    "potentials",
    "nets",
  ] as const) {
    ir[key].reverse();
  }

  for (const library of ir.libraries) library.files.reverse();
  for (const type of ir.deviceTypes) {
    type.terminals.reverse();
    type.functions.reverse();
    type.internalRelations.reverse();
  }
  for (const type of ir.cableTypes) type.conductors.reverse();
  for (const net of ir.nets) {
    net.terminalIds.reverse();
    net.conductiveElementIds.reverse();
    net.potentialUids.reverse();
  }

  for (const index of Object.values(ir.indexes)) index.reverse();
  for (const entry of ir.indexes.terminalIdsByDeviceUid) entry.value.reverse();
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value.reverse();
  }
  for (const entry of ir.indexes.terminalIdsByConductiveElement) {
    entry.value.reverse();
  }
  for (const entry of ir.indexes.conductorIdsByCableUid) {
    entry.value.reverse();
  }
  for (const entry of ir.indexes.instanceRefsByTypeId) entry.value.reverse();
}

function addSyntheticPotential(
  ir: ElectricalIr,
  netId: string,
  index: number,
  name: string,
  electrical: ElectricalIr["potentials"][number]["electrical"],
): void {
  const net = ir.nets.find(({ id }) => id === netId);
  const terminal = net?.terminalIds[0];

  if (net === undefined || terminal === undefined) {
    throw new Error(`Suppression test net ${JSON.stringify(netId)} is empty.`);
  }

  const uid = `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const source = {
    file: "sources/suppression-meta.json",
    line: index + 1,
    column: 1,
    jsonPointer: `/objects/${index}`,
  };

  ir.potentials.push({
    uid,
    name,
    electrical,
    aliases: [],
    terminal: { ...terminal },
    terminalSource: { ...source },
    source,
    netId,
  });
  net.potentialUids.push(uid);
}

function configureSuppressedFinding(
  ir: ElectricalIr,
  netId: string,
  code: "E300" | "E301" | "E302" | "W902",
): void {
  if (code === "W902") {
    addSyntheticPotential(ir, netId, 0, "CONTROL", {
      nominal_voltage: 24,
      voltage_type: "DC",
    });
    addSyntheticPotential(ir, netId, 1, "CONTROL", {
      nominal_voltage: 24,
      voltage_type: "DC",
    });
    return;
  }

  if (code === "E300") {
    addSyntheticPotential(ir, netId, 0, "CONTROL-A", {
      nominal_voltage: 24,
      voltage_type: "DC",
    });
    addSyntheticPotential(ir, netId, 1, "CONTROL-B", {
      nominal_voltage: 24,
      voltage_type: "DC",
    });
    return;
  }

  const net = ir.nets.find(({ id }) => id === netId);
  const terminalId = net?.terminalIds[0];
  const terminal =
    terminalId === undefined
      ? undefined
      : ir.terminals.find(
          ({ id }) =>
            id.deviceUid === terminalId.deviceUid &&
            id.terminalKey === terminalId.terminalKey,
        );

  if (terminal === undefined) {
    throw new Error(
      `Suppression test net ${JSON.stringify(netId)} has no terminal.`,
    );
  }

  terminal.rating =
    code === "E301"
      ? { nominal_voltage: 24, voltage_type: "DC" }
      : { nominal_voltage: 48, voltage_type: "DC" };
  addSyntheticPotential(ir, netId, 0, "CONTROL", {
    nominal_voltage: 24,
    voltage_type: code === "E301" ? "AC" : "DC",
  });
}

function removePotential(ir: ElectricalIr, uid: string): void {
  const potentialIndex = ir.potentials.findIndex(
    (potential) => potential.uid === uid,
  );
  if (potentialIndex < 0) {
    throw new Error(`Potential ${JSON.stringify(uid)} was not found.`);
  }
  ir.potentials.splice(potentialIndex, 1);

  for (const net of ir.nets) {
    const netIndex = net.potentialUids.indexOf(uid);
    if (netIndex >= 0) net.potentialUids.splice(netIndex, 1);
  }
}

interface StageGateSource {
  objects: Array<{
    conductors?: Array<{ id: string; endpoints: unknown[] }>;
  }>;
}

interface StageGateLibrary {
  types: Array<{
    kind: string;
    conductors?: Array<{ id: string }>;
  }>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

async function compileStructuralStageGate(
  mutate: (projectRoot: string, libraryRoot: string) => Promise<void>,
) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-m3-stage-gate-"),
  );
  const projectRoot = join(temporaryRoot, "project");
  const libraryRoot = join(temporaryRoot, "library");
  const evaluateRulesStage = vi.fn((): Diagnostic[] => []);

  try {
    await cp(join(rulesFixtureRoot, "invalid-cable-conductor"), projectRoot, {
      recursive: true,
    });
    await cp(join(rulesFixtureRoot, "library"), libraryRoot, {
      recursive: true,
    });
    await mutate(projectRoot, libraryRoot);

    const compiled = await compileProjectWithStages(
      projectRoot,
      repositoryRoot,
      { evaluateRules: evaluateRulesStage },
    );
    return { compiled, evaluateRulesStage };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("M3 IR-only rule engine through E302 and W902", () => {
  it.each(fixtureNames)(
    "matches the complete %s diagnostic sidecar",
    (name) => {
      expect(evaluateRules(fixtureIr(name))).toEqual(fixtureExpected(name));
    },
  );

  it("emits exactly one E200 per invalid conductor and stays silent for valid conductors", () => {
    for (const name of e200FixtureNames) {
      const ir = fixtureIr(name);
      const diagnostics = evaluateRules(ir);
      const invalidConductors = ir.cableConductors.filter(
        ({ typeConductor }) => typeConductor === null,
      );
      const validConductors = ir.cableConductors.filter(
        ({ typeConductor }) => typeConductor !== null,
      );

      expect(diagnostics).toHaveLength(invalidConductors.length);
      expect(diagnostics.every(({ code }) => code === "E200")).toBe(true);
      expect(
        validConductors.every(
          ({ source }) =>
            !diagnostics.some(
              ({ file, jsonPointer }) =>
                file === source.file && jsonPointer === source.jsonPointer,
            ),
        ),
      ).toBe(true);
    }
  });

  it("is pure, deep-freeze safe, and repeatable", () => {
    const ir = structuredClone(fixtureIr("e200-excluded-from-exclusive-count"));
    const snapshot = structuredClone(ir);
    deepFreeze(ir);

    const first = evaluateRules(ir);
    const second = evaluateRules(ir);

    expect(first).toEqual(
      fixtureExpected("e200-excluded-from-exclusive-count"),
    );
    expect(second).toEqual(first);
    expect(ir).toEqual(snapshot);
  });

  it("normalizes identically after primary arrays and index insertion order are reversed", () => {
    const baseline = fixtureIr("three-way-potential-set");
    const shuffled = structuredClone(baseline);
    reverseHydrationOrder(shuffled);

    expect(evaluateRules(shuffled)).toEqual(evaluateRules(baseline));
  });

  it("anchors the second direct wire at its authored endpoint and relates policy before the permitted assignment", () => {
    const diagnostics = evaluateRules(
      fixtureIr("exclusive-terminal-second-wire"),
    );

    expect(diagnostics).toEqual(
      fixtureExpected("exclusive-terminal-second-wire"),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "E201",
      jsonPointer: "/objects/4/endpoints/0",
      uid: "20100000-0000-4000-8000-000000000005",
    });
    expect(diagnostics[0]?.related?.map(({ note }) => note)).toEqual([
      'The library terminal "TARGET.E" declares connection policy "exclusive" here.',
      'Earlier permitted direct assignment from wire "W-FIRST" lands here.',
    ]);
  });

  it("keeps explicit shared, absent output-channel policy, and downstream fanout clean", () => {
    const ir = fixtureIr("shared-absent-policy-fanout");
    const targetTerminals = ir.terminals.filter(
      ({ id }) => id.deviceUid === "20200000-0000-4000-8000-000000000001",
    );

    expect(
      targetTerminals.map(({ id, connectionPolicy }) => [
        id.terminalKey,
        connectionPolicy ?? null,
      ]),
    ).toEqual([
      ["E", "exclusive"],
      ["S", "shared"],
      ["X2.0", null],
    ]);
    expect(evaluateRules(ir)).toEqual([]);
  });

  it("counts jumpers and cable conductors as direct terminal assignments", () => {
    const diagnostics = evaluateRules(fixtureIr("exclusive-jumper-cable"));

    expect(diagnostics).toEqual(fixtureExpected("exclusive-jumper-cable"));
    expect(
      diagnostics.map(({ jsonPointer, uid }) => ({ jsonPointer, uid })),
    ).toEqual([
      {
        jsonPointer: "/objects/5/endpoints/0",
        uid: "20300000-0000-4000-8000-000000000006",
      },
      {
        jsonPointer: "/objects/6/conductors/0/endpoints/0",
        uid: "20300000-0000-4000-8000-000000000007",
      },
    ]);
  });

  it("excludes an E200-invalid conductor but still reports two remaining valid assignments", () => {
    const diagnostics = evaluateRules(
      fixtureIr("e200-excluded-from-exclusive-count"),
    );

    expect(diagnostics).toEqual(
      fixtureExpected("e200-excluded-from-exclusive-count"),
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["E200", "E201"]);
    expect(
      diagnostics.some(
        ({ code, jsonPointer }) =>
          code === "E201" &&
          jsonPointer === "/objects/4/conductors/0/endpoints/0",
      ),
    ).toBe(false);
  });

  it("marks each invalid conductor and its containing net for later suppression", () => {
    const ir = fixtureIr("several-invalid-cable-conductors");
    const context = createRuleContext(ir);
    const diagnostics = invalidCableConductorRule.evaluate(context);
    const invalidConductors = ir.cableConductors.filter(
      ({ typeConductor }) => typeConductor === null,
    );
    const affectedNetIds = new Set(
      invalidConductors.map((conductor) =>
        context.netIdForCableConductor(conductor),
      ),
    );

    expect(diagnostics).toHaveLength(invalidConductors.length);
    expect(context.invalidCableConductorIds).toHaveLength(
      invalidConductors.length,
    );
    expect(context.topologicallyAffectedNetIds).toEqual(affectedNetIds);
  });

  it("marks an over-assigned exclusive terminal's net for later suppression", () => {
    const ir = fixtureIr("exclusive-terminal-second-wire");
    const context = createRuleContext(ir);
    const terminal = ir.terminals.find(
      ({ connectionPolicy }) => connectionPolicy === "exclusive",
    );

    expect(terminal).toBeDefined();
    const diagnostics = exclusiveTerminalAssignmentRule.evaluate(context);

    expect(diagnostics).toHaveLength(1);
    expect(context.topologicallyAffectedNetIds).toEqual(
      new Set([context.netIdForTerminal(terminal!.id)]),
    );
  });

  it("treats complete 0 and -0 intent as an exact duplicate and ignores metadata", () => {
    const diagnostics = evaluateRules(fixtureIr("exact-duplicate-potential"));

    expect(diagnostics).toEqual(fixtureExpected("exact-duplicate-potential"));
    expect(diagnostics.map(({ code }) => code)).toEqual(["W902"]);
  });

  it("relates every subsequent exact duplicate to the earliest exact declaration", () => {
    const ir = structuredClone(fixtureIr("exact-duplicate-potential"));
    const second = ir.potentials.find(
      ({ uid }) => uid === "30000000-0000-4000-8000-000000000003",
    );

    expect(second).toBeDefined();
    const third = structuredClone(second!);
    third.uid = "30000000-0000-4000-8000-000000000004";
    third.source = {
      ...third.source,
      line: third.source.line + 20,
      jsonPointer: "/objects/3",
    };
    ir.potentials.push(third);
    ir.nets.find(({ id }) => id === third.netId)!.potentialUids.push(third.uid);

    const diagnostics = evaluateRules(ir);
    expect(diagnostics.map(({ code }) => code)).toEqual(["W902", "W902"]);
    expect(diagnostics.map(({ related }) => related?.[0]?.note)).toEqual([
      'Earliest exact duplicate declaration uid "30000000-0000-4000-8000-000000000002" is here.',
      'Earliest exact duplicate declaration uid "30000000-0000-4000-8000-000000000002" is here.',
    ]);
  });

  it("merges compatible partial declarations with each field's earliest origin", () => {
    const ir = fixtureIr("compatible-partial-potential");
    const context = createRuleContext(ir);
    const analysis = analyzePotentialDeclarations(context);
    const net = ir.nets.find(({ potentialUids }) => potentialUids.length > 0);

    expect(net).toBeDefined();
    expect(analysis).toEqual({ duplicates: [], conflicts: [] });
    expect(evaluateRules(ir)).toEqual([]);

    const effective = context.effectivePotentialIntentsByNetId.get(net!.id);
    expect(effective).toBeDefined();
    expect(effective).toMatchObject({
      name: "+24VDC",
      electrical: {
        nominal_voltage: 24,
        voltage_type: "DC",
        polarity: "positive",
        current: 1,
      },
    });
    expect(effective?.origins.name.uid).toBe(
      "30100000-0000-4000-8000-000000000002",
    );
    expect(
      Object.fromEntries(
        Object.entries(effective?.origins.electrical ?? {}).map(
          ([field, fieldOrigin]) => [field, fieldOrigin.uid],
        ),
      ),
    ).toEqual({
      nominal_voltage: "30100000-0000-4000-8000-000000000002",
      voltage_type: "30100000-0000-4000-8000-000000000003",
      polarity: "30100000-0000-4000-8000-000000000003",
      current: "30100000-0000-4000-8000-000000000002",
    });
  });

  it("uses different required names as a conflict even when electrical values match", () => {
    const diagnostics = evaluateRules(fixtureIr("conflicting-potential-name"));

    expect(diagnostics).toEqual(fixtureExpected("conflicting-potential-name"));
    expect(diagnostics[0]?.message).toContain('field "name"');
  });

  it("names the unequal overlapping electrical field", () => {
    const diagnostics = evaluateRules(fixtureIr("conflicting-potential-field"));

    expect(diagnostics).toEqual(fixtureExpected("conflicting-potential-field"));
    expect(diagnostics[0]?.message).toContain('field "nominal_voltage"');
    expect(diagnostics[0]?.related?.[0]?.note).toContain(
      'field "nominal_voltage"',
    );
  });

  it.each([
    ["nominal_voltage", 25],
    ["voltage_type", "AC"],
    ["polarity", "negative"],
    ["current", 2],
    ["power", 25],
    ["frequency", 60],
  ] as const)(
    "classifies unequal overlapping %s as a conflict",
    (field, value) => {
      const ir = structuredClone(fixtureIr("exact-duplicate-potential"));
      const later = ir.potentials.find(
        ({ uid }) => uid === "30000000-0000-4000-8000-000000000003",
      );

      expect(later).toBeDefined();
      Object.assign(later!.electrical, { [field]: value });

      const diagnostics = evaluateRules(ir);
      expect(diagnostics.map(({ code }) => code)).toEqual(["E300"]);
      expect(diagnostics[0]?.message).toContain(
        `field ${JSON.stringify(field)}`,
      );
    },
  );

  it("emits a deterministic duplicate then a conflict related to every earlier incompatible declaration", () => {
    const diagnostics = evaluateRules(fixtureIr("three-way-potential-set"));

    expect(diagnostics).toEqual(fixtureExpected("three-way-potential-set"));
    expect(diagnostics.map(({ code, uid }) => ({ code, uid }))).toEqual([
      {
        code: "W902",
        uid: "30400000-0000-4000-8000-000000000004",
      },
      {
        code: "E300",
        uid: "30400000-0000-4000-8000-000000000005",
      },
    ]);
    expect(diagnostics[1]?.related?.map(({ line }) => line)).toEqual([
      10, 17, 24,
    ]);
  });

  it("uses UID as the final ordering tie-breaker for identical SourceRefs", () => {
    const ir = structuredClone(fixtureIr("exact-duplicate-potential"));
    const lowerUid = ir.potentials.find(
      ({ uid }) => uid === "30000000-0000-4000-8000-000000000002",
    );
    const higherUid = ir.potentials.find(
      ({ uid }) => uid === "30000000-0000-4000-8000-000000000003",
    );

    expect(lowerUid).toBeDefined();
    expect(higherUid).toBeDefined();
    higherUid!.source = { ...lowerUid!.source };
    ir.potentials.reverse();
    for (const net of ir.nets) net.potentialUids.reverse();

    const diagnostics = evaluateRules(ir);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.uid).toBe(higherUid!.uid);
    expect(diagnostics[0]?.related?.[0]?.note).toContain(lowerUid!.uid);
  });

  it("suppresses potential diagnostics only on a topologically affected net", () => {
    const suppressed = evaluateRules(
      fixtureIr("topological-error-potential-conflict"),
    );
    const independent = evaluateRules(
      fixtureIr("multi-net-potential-independence"),
    );

    expect(suppressed).toEqual(
      fixtureExpected("topological-error-potential-conflict"),
    );
    expect(suppressed.map(({ code }) => code)).toEqual(["E201"]);
    expect(independent).toEqual(
      fixtureExpected("multi-net-potential-independence"),
    );
    expect(independent.map(({ code }) => code)).toEqual(["E300", "W902"]);
  });

  it("suppresses a potential conflict on an E200-affected net", () => {
    const ir = structuredClone(fixtureIr("invalid-cable-conductor"));
    const conductor = ir.cableConductors.find(
      ({ typeConductor }) => typeConductor === null,
    );

    expect(conductor).toBeDefined();
    const net = ir.nets.find(({ conductiveElementIds }) =>
      conductiveElementIds.some(
        (element) =>
          element.kind === "cable_conductor" &&
          element.cableUid === conductor!.cableUid &&
          element.conductorId === conductor!.id.conductorId,
      ),
    );
    expect(net).toBeDefined();
    const terminal = net!.terminalIds[0]!;

    for (const [offset, name] of ["FIRST", "CONFLICT"].entries()) {
      const uid = `30700000-0000-4000-8000-00000000000${offset + 1}`;
      const source = {
        ...conductor!.source,
        line: conductor!.source.line + offset + 1,
        jsonPointer: `/synthetic-potentials/${offset}`,
      };
      ir.potentials.push({
        uid,
        name,
        electrical: { nominal_voltage: offset === 0 ? 24 : 48 },
        aliases: [],
        terminal: { ...terminal },
        terminalSource: source,
        source,
        netId: net!.id,
      });
      net!.potentialUids.push(uid);
    }

    expect(evaluateRules(ir)).toEqual(
      fixtureExpected("invalid-cable-conductor"),
    );
  });

  it.each(["W902", "E300", "E301", "E302"] as const)(
    "suppresses %s specifically on an E200-affected net",
    (suppressedCode) => {
      const affected = structuredClone(fixtureIr("invalid-cable-conductor"));
      const invalidConductor = affected.cableConductors.find(
        ({ typeConductor }) => typeConductor === null,
      );
      expect(invalidConductor).toBeDefined();
      const netId = createRuleContext(affected).netIdForCableConductor(
        invalidConductor!,
      );
      configureSuppressedFinding(affected, netId, suppressedCode);

      const control = structuredClone(affected);
      const controlConductor = control.cableConductors.find(
        ({ typeConductor }) => typeConductor === null,
      );
      const controlType = control.cableTypes.find(
        ({ id }) => id === controlConductor?.typeId,
      );
      expect(controlConductor).toBeDefined();
      expect(controlType?.conductors[0]).toBeDefined();
      controlConductor!.typeConductor = structuredClone(
        controlType!.conductors[0]!,
      );

      expect(evaluateRules(control).map(({ code }) => code)).toContain(
        suppressedCode,
      );
      const diagnostics = evaluateRules(affected);
      expect(diagnostics.map(({ code }) => code)).toEqual(["E200"]);
      expect(diagnostics.map(({ code }) => code)).not.toContain(suppressedCode);
    },
  );

  it.each(["W902", "E300", "E301", "E302"] as const)(
    "suppresses %s specifically on an E201-affected net",
    (suppressedCode) => {
      const affected = structuredClone(
        fixtureIr("exclusive-terminal-second-wire"),
      );
      const exclusiveTerminal = affected.terminals.find(
        ({ connectionPolicy }) => connectionPolicy === "exclusive",
      );
      expect(exclusiveTerminal).toBeDefined();
      const netId = createRuleContext(affected).netIdForTerminal(
        exclusiveTerminal!.id,
      );
      configureSuppressedFinding(affected, netId, suppressedCode);

      const control = structuredClone(affected);
      const controlTerminal = control.terminals.find(
        ({ connectionPolicy }) => connectionPolicy === "exclusive",
      );
      expect(controlTerminal).toBeDefined();
      controlTerminal!.connectionPolicy = "shared";

      expect(evaluateRules(control).map(({ code }) => code)).toContain(
        suppressedCode,
      );
      const diagnostics = evaluateRules(affected);
      expect(diagnostics.map(({ code }) => code)).toEqual(["E201"]);
      expect(diagnostics.map(({ code }) => code)).not.toContain(suppressedCode);
    },
  );

  it("gives a conflicting net no effective intent while retaining clean-net intent", () => {
    const ir = fixtureIr("multi-net-potential-independence");
    const context = createRuleContext(ir);
    analyzePotentialDeclarations(context);
    const netA = ir.potentials.find(({ name }) => name === "A-ORIGINAL")!.netId;
    const netB = ir.potentials.find(({ name }) => name === "B-CLEAN")!.netId;

    expect(context.conflictingPotentialNetIds).toEqual(new Set([netA]));
    expect(context.effectivePotentialIntentsByNetId.has(netA)).toBe(false);
    expect(context.effectivePotentialIntentsByNetId.get(netB)).toMatchObject({
      name: "B-CLEAN",
      electrical: { voltage_type: "DC", current: 2 },
    });
  });

  it("does not serialize effective potential state into the IR", () => {
    const ir = structuredClone(fixtureIr("compatible-partial-potential"));
    const before = serializeIr(ir);

    expect(evaluateRules(ir)).toEqual([]);
    expect(serializeIr(ir)).toBe(before);
    expect(before).not.toContain("effectivePotential");
    expect(before).not.toContain("effective_potential");
  });

  it("groups every AC/DC mismatch at one voltage-type origin in deterministic library order", () => {
    const diagnostics = evaluateRules(fixtureIr("voltage-type-mismatch"));

    expect(diagnostics).toEqual(fixtureExpected("voltage-type-mismatch"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "E301",
      jsonPointer: "/objects/5",
      uid: "31000000-0000-4000-8000-000000000006",
    });
    expect(diagnostics[0]?.related?.map(({ note }) => note)).toEqual([
      'Terminal "ALPHA.T" is rated for voltage type "DC" here.',
      'Terminal "MID.T" is rated for voltage type "DC" here.',
      'Terminal "ZETA.T" is rated for voltage type "DC" here.',
    ]);
    expect(diagnostics[0]?.message).toContain('"ALPHA.T", "MID.T", "ZETA.T"');
  });

  it("emits E302 for an exactly unequal positive nominal-voltage class", () => {
    const diagnostics = evaluateRules(fixtureIr("nominal-voltage-mismatch"));

    expect(diagnostics).toEqual(fixtureExpected("nominal-voltage-mismatch"));
    expect(diagnostics.map(({ code }) => code)).toEqual(["E302"]);
  });

  it("gives E301 per-terminal precedence while E302 still reports other terminals", () => {
    const diagnostics = evaluateRules(fixtureIr("dual-voltage-mismatch"));

    expect(diagnostics).toEqual(fixtureExpected("dual-voltage-mismatch"));
    expect(diagnostics.map(({ code }) => code)).toEqual(["E301", "E302"]);
    expect(diagnostics[0]?.related?.map(({ note }) => note)).toEqual([
      'Terminal "DUAL.T" is rated for voltage type "DC" here.',
    ]);
    expect(diagnostics[1]?.related?.map(({ note }) => note)).toEqual([
      'Terminal "VOLTAGE.T" is rated for nominal voltage 48 V here.',
    ]);
    expect(diagnostics[1]?.message).not.toContain("DUAL.T");
  });

  it("keeps zero-voltage return intent and missing or non-overlapping facts clean", () => {
    expect(evaluateRules(fixtureIr("zero-voltage-return"))).toEqual([]);
    expect(evaluateRules(fixtureIr("missing-partial-voltage-facts"))).toEqual(
      [],
    );
  });

  it("still compares explicit voltage type at zero volts", () => {
    const ir = structuredClone(fixtureIr("zero-voltage-return"));
    ir.potentials[0]!.electrical.voltage_type = "AC";

    expect(evaluateRules(ir).map(({ code }) => code)).toEqual(["E301"]);
  });

  it("requires both nominal values to be positive but not both voltage types to be present", () => {
    const zeroRated = structuredClone(fixtureIr("nominal-voltage-mismatch"));
    zeroRated.terminals[0]!.rating!.nominal_voltage = 0;
    expect(evaluateRules(zeroRated)).toEqual([]);

    const missingRatedType = structuredClone(
      fixtureIr("nominal-voltage-mismatch"),
    );
    delete missingRatedType.terminals[0]!.rating!.voltage_type;
    expect(evaluateRules(missingRatedType).map(({ code }) => code)).toEqual([
      "E302",
    ]);
  });

  it("suppresses terminal compatibility on a net with an E300 conflict", () => {
    const diagnostics = evaluateRules(fixtureIr("conflict-suppresses-rating"));

    expect(diagnostics).toEqual(fixtureExpected("conflict-suppresses-rating"));
    expect(diagnostics.map(({ code }) => code)).toEqual(["E300"]);
  });

  it.each(["E301", "E302"] as const)(
    "suppresses %s specifically on an E300-conflicting net",
    (suppressedCode) => {
      const conflicting = structuredClone(
        fixtureIr("conflict-suppresses-rating"),
      );
      const later = conflicting.potentials.find(
        ({ uid }) => uid === "31500000-0000-4000-8000-000000000003",
      );
      expect(later).toBeDefined();
      if (suppressedCode === "E302") {
        later!.electrical.voltage_type = "DC";
      }

      const control = structuredClone(conflicting);
      removePotential(control, "31500000-0000-4000-8000-000000000002");
      expect(evaluateRules(control).map(({ code }) => code)).toContain(
        suppressedCode,
      );

      const diagnostics = evaluateRules(conflicting);
      expect(diagnostics.map(({ code }) => code)).toEqual(["E300"]);
      expect(diagnostics.map(({ code }) => code)).not.toContain(suppressedCode);
    },
  );

  it("suppresses E302 only for the terminal already affected by a dual E301 mismatch", () => {
    const affected = evaluateRules(fixtureIr("dual-voltage-mismatch"));
    const nominalFinding = affected.find(({ code }) => code === "E302");

    expect(affected.map(({ code }) => code)).toEqual(["E301", "E302"]);
    expect(nominalFinding?.message).not.toContain("DUAL.T");
    expect(nominalFinding?.related?.map(({ note }) => note)).not.toContain(
      'Terminal "DUAL.T" is rated for nominal voltage 48 V here.',
    );

    const control = structuredClone(fixtureIr("dual-voltage-mismatch"));
    const dualDevice = control.devices.find(
      ({ designation }) => designation === "DUAL",
    );
    const dualTerminal = control.terminals.find(
      ({ id }) => id.deviceUid === dualDevice?.uid && id.terminalKey === "T",
    );
    expect(dualTerminal?.rating).toBeDefined();
    dualTerminal!.rating!.voltage_type = "AC";

    const unsuppressed = evaluateRules(control);
    expect(unsuppressed.map(({ code }) => code)).toEqual(["E302"]);
    expect(unsuppressed[0]?.message).toContain("DUAL.T");
    expect(unsuppressed[0]?.related?.map(({ note }) => note)).toContain(
      'Terminal "DUAL.T" is rated for nominal voltage 48 V here.',
    );
  });

  it("anchors each merged compatibility finding at the later declaration that first supplied its field", () => {
    const diagnostics = evaluateRules(
      fixtureIr("compatible-partial-later-voltage-origin"),
    );

    expect(diagnostics).toEqual(
      fixtureExpected("compatible-partial-later-voltage-origin"),
    );
    expect(
      diagnostics.map(({ code, jsonPointer, uid }) => ({
        code,
        jsonPointer,
        uid,
      })),
    ).toEqual([
      {
        code: "E301",
        jsonPointer: "/objects/2",
        uid: "31600000-0000-4000-8000-000000000003",
      },
      {
        code: "E302",
        jsonPointer: "/objects/5",
        uid: "31600000-0000-4000-8000-000000000006",
      },
    ]);
  });

  it("keeps grouped compatibility diagnostics stable when IR hydration order is reversed", () => {
    const baseline = fixtureIr("voltage-type-mismatch");
    const shuffled = structuredClone(baseline);
    reverseHydrationOrder(shuffled);

    expect(evaluateRules(shuffled)).toEqual(evaluateRules(baseline));
  });

  it("keeps every M3 code cataloged with one producer and one exact fixture", () => {
    const ids = ELECTRICAL_RULES.map(({ id }) => id);

    expect(ids).toEqual([
      "E200",
      "E201",
      "E300",
      "E301",
      "E302",
      "W902",
      "E202",
      "E203",
      "E204",
      "E207",
      "E205",
      "E206",
      "W903",
      "W904",
      "W905",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(exactFixtureByRule)).toEqual(ids);
    expect(new Set(Object.values(exactFixtureByRule)).size).toBe(ids.length);

    for (const rule of ELECTRICAL_RULES) {
      const fixture = exactFixtureByRule[rule.id];
      const catalog =
        DIAGNOSTIC_CATALOG[rule.id as keyof typeof DIAGNOSTIC_CATALOG];
      const expected = fixtureExpected(fixture);
      const diagnostics = rule.evaluate(createRuleContext(fixtureIr(fixture)));
      const producers = ELECTRICAL_RULES.filter((candidate) =>
        candidate
          .evaluate(createRuleContext(fixtureIr(fixture)))
          .some(({ code }) => code === rule.id),
      );

      expect(catalog, rule.id).toBeDefined();
      expect(expected, rule.id).toHaveLength(1);
      expect(expected[0], rule.id).toMatchObject({ code: rule.id });
      expect(diagnostics, rule.id).toEqual(expected);
      expect(
        producers.map(({ id }) => id),
        rule.id,
      ).toEqual([rule.id]);
      expect(
        diagnostics.every(
          ({ code, severity }) =>
            code === rule.id && severity === catalog.severity,
        ),
      ).toBe(true);
    }
  });

  it("keeps every broken fixture message and related note specific and reviewable", () => {
    for (const name of fixtureNames) {
      for (const diagnostic of fixtureExpected(name)) {
        expect(diagnostic.message, `${name} ${diagnostic.code}`).toMatch(
          /\.$/u,
        );
        expect(
          diagnostic.related?.length,
          `${name} ${diagnostic.code}`,
        ).toBeGreaterThan(0);
        for (const related of diagnostic.related ?? []) {
          expect(related.note, `${name} ${diagnostic.code}`).toMatch(/\.$/u);
        }

        if (diagnostic.code === "E200") {
          expect(diagnostic.message, name).toMatch(
            /^Cable ".+" conductor ".+" is not declared by selected cable type ".+"/u,
          );
        } else if (diagnostic.code === "E202") {
          expect(diagnostic.message).toContain("declared I/O channel");
        } else if (diagnostic.code === "E203") {
          expect(diagnostic.message).toContain("terminalOrder");
        } else if (diagnostic.code === "E207") {
          expect(diagnostic.message, name).toMatch(/connector port/iu);
        } else if (diagnostic.code === "E206") {
          expect(diagnostic.message).toContain("circuitSymbols");
        } else if (diagnostic.code === "E204") {
          expect(diagnostic.message).toContain("declared communication port");
        } else if (["E205", "W903", "W904", "W905"].includes(diagnostic.code)) {
          expect(diagnostic.message).toContain("D1");
        } else if (diagnostic.code === "E201") {
          expect(diagnostic.message, name).toMatch(
            /^Terminal ".+\..+" has connection policy "exclusive", but (?:wire|jumper|cable) /u,
          );
        } else if (diagnostic.code === "E301" || diagnostic.code === "E302") {
          const displays = (diagnostic.related ?? []).flatMap(({ note }) => {
            const match = /^Terminal "([^"]+)" is rated/u.exec(note);
            return match?.[1] === undefined ? [] : [match[1]];
          });
          expect(displays.length, `${name} ${diagnostic.code}`).toBeGreaterThan(
            0,
          );
          for (const display of displays) {
            expect(diagnostic.message, `${name} ${diagnostic.code}`).toContain(
              JSON.stringify(display),
            );
          }
        } else {
          expect(diagnostic.message, name).toMatch(
            /^Potential declaration ".+"/u,
          );
        }
      }
    }
  });

  it("has no rule-module imports of loader, resolution, parser, or source model APIs", async () => {
    const forbiddenImport =
      /(?:from\s+|import\s*\()["'][^"']*(?:loader|resolution(?:-catalog)?|parser|source-types|generated)[^"']*["']/u;

    for (const file of await sourceFiles(rulesSourceRoot)) {
      expect(await readFile(file, "utf8"), file).not.toMatch(forbiddenImport);
    }
  });
});

describe("M3 compiler pipeline integration", () => {
  it.each(pipelineRuleErrorFixtures)(
    "returns %s through the public failure arm without exposing IR",
    async (code, name) => {
      const compiled = await compileProject(join(rulesFixtureRoot, name));

      expect(compiled).toMatchObject({
        ok: false,
        toolFailure: false,
        diagnostics: [{ code }],
      });
      expect(compiled.diagnostics).toEqual(fixtureExpected(name));
      expect(Object.hasOwn(compiled, "ir")).toBe(false);
    },
  );

  it("preserves warning success with normalized W902 diagnostics and IR", async () => {
    const name = "exact-duplicate-potential";
    const compiled = await compileProject(join(rulesFixtureRoot, name));

    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual(fixtureExpected(name));
    if (!compiled.ok) return;
    expect(Object.hasOwn(compiled, "ir")).toBe(true);
    expect(evaluateRules(compiled.ir)).toEqual(fixtureExpected(name));
  });

  it("keeps repeated compileLoadedProject calls synchronous and deterministic", async () => {
    const project = await loadedProject(
      join(rulesFixtureRoot, "exact-duplicate-potential"),
    );

    const first = compileLoadedProject(project);
    const second = compileLoadedProject(project);

    expect(first).not.toBeInstanceOf(Promise);
    expect(second).not.toBeInstanceOf(Promise);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(serializeIr(second.ir)).toBe(serializeIr(first.ir));
  });

  it("does not invoke the rule stage after structural E0xx diagnostics", async () => {
    const evaluateRulesStage = vi.fn((): Diagnostic[] => []);
    const compiled = await compileProjectWithStages(
      structuralFixtureRoot,
      repositoryRoot,
      { evaluateRules: evaluateRulesStage },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toContain("E020");
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("keeps malformed endpoint cardinality solely at E015 before rules", async () => {
    const { compiled, evaluateRulesStage } = await compileStructuralStageGate(
      async (projectRoot) => {
        const sourcePath = join(projectRoot, "sources", "objects.json");
        const source = JSON.parse(
          await readFile(sourcePath, "utf8"),
        ) as StageGateSource;
        source.objects[2]!.conductors![0]!.endpoints.pop();
        await writeJson(sourcePath, source);
      },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(["E015"]);
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("keeps duplicate cable-instance conductor IDs solely at E021 before rules", async () => {
    const { compiled, evaluateRulesStage } = await compileStructuralStageGate(
      async (projectRoot) => {
        const sourcePath = join(projectRoot, "sources", "objects.json");
        const source = JSON.parse(
          await readFile(sourcePath, "utf8"),
        ) as StageGateSource;
        source.objects[2]!.conductors![1]!.id =
          source.objects[2]!.conductors![0]!.id;
        await writeJson(sourcePath, source);
      },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(["E021"]);
    expect(compiled.diagnostics.map(({ code }) => code)).not.toContain("E200");
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("keeps duplicate cable-type conductor IDs solely at E031 before rules", async () => {
    const { compiled, evaluateRulesStage } = await compileStructuralStageGate(
      async (_projectRoot, libraryRoot) => {
        const libraryPath = join(libraryRoot, "types", "connectivity.json");
        const library = JSON.parse(
          await readFile(libraryPath, "utf8"),
        ) as StageGateLibrary;
        const cableType = library.types.find(
          ({ kind }) => kind === "cable_type",
        );
        expect(cableType?.conductors?.[0]).toBeDefined();
        expect(cableType?.conductors?.[1]).toBeDefined();
        cableType!.conductors![1]!.id = cableType!.conductors![0]!.id;
        await writeJson(libraryPath, library);
      },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(["E031"]);
    expect(compiled.diagnostics.map(({ code }) => code)).not.toContain("E200");
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("does not invoke the rule stage after lock E1xx diagnostics", async () => {
    const project = structuredClone(
      await loadedProject(join(rulesFixtureRoot, "exact-duplicate-potential")),
    );
    project.libraryLock = { state: "missing" };
    const evaluateRulesStage = vi.fn((): Diagnostic[] => []);

    const compiled = compileLoadedProjectWithStages(project, {
      evaluateRules: evaluateRulesStage,
    });

    expect(compiled).toMatchObject({
      ok: false,
      toolFailure: false,
      diagnostics: [{ code: "E105" }],
    });
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("does not invoke the rule stage after E100-E104 referential diagnostics", async () => {
    const project = await loadedProject(referentialFixtureRoot);
    project.libraryLock = {
      state: "valid",
      rawBytes: new Uint8Array(),
      value: generateLibraryLock(project),
      nodes: new Map(),
    };
    const evaluateRulesStage = vi.fn((): Diagnostic[] => []);

    const compiled = compileLoadedProjectWithStages(project, {
      evaluateRules: evaluateRulesStage,
    });

    expect(compiled.ok).toBe(false);
    expect(new Set(compiled.diagnostics.map(({ code }) => code))).toEqual(
      new Set(["E100", "E101", "E102", "E103", "E104"]),
    );
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).not.toHaveBeenCalled();
  });

  it("routes unexpected rule-engine exceptions through E001", async () => {
    const project = await loadedProject(
      join(rulesFixtureRoot, "exact-duplicate-potential"),
    );
    const evaluateRulesStage = vi.fn((): Diagnostic[] => {
      throw new Error("injected rule-engine failure");
    });

    const compiled = compileLoadedProjectWithStages(project, {
      evaluateRules: evaluateRulesStage,
    });

    expect(compiled).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Compilation tool failure (injected rule-engine failure).",
          file: "system.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
      toolFailure: true,
    });
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
    expect(evaluateRulesStage).toHaveBeenCalledOnce();
  });
});
