import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import { createQueryEngine, serializeQueryResult } from "@thermite/query";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { serializeAgentToolResult } from "../src/common/serializer.js";
import type { InspectObjectRequest } from "../src/inspect.js";
import {
  createInternalReadTools,
  type ReadToolDependencies,
} from "../src/read-tools.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolvePath(testRoot, "../../..");
const project = "examples/motor-starter";
const ls1Uid = "596f728b-1445-4c4b-8974-a3b4ea703636";
let motorIr: ElectricalIr;

beforeAll(async () => {
  const compiled = await compileProject(project, repositoryRoot);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  motorIr = compiled.ir;
});

function request(
  selector: InspectObjectRequest["selector"],
): InspectObjectRequest {
  return { format: "agent-tool-request/0.1", project, selector };
}

function injectedTools(
  ir: ElectricalIr,
  compile = vi.fn(async (): Promise<CompileResult> => ({
    ok: true,
    diagnostics: [],
    ir,
  })),
) {
  const dependencies: ReadToolDependencies = {
    compileProject: compile,
    createQueryEngine,
  };
  return {
    compile,
    tools: createInternalReadTools({ cwd: repositoryRoot }, dependencies),
  };
}

function inspectedObject(
  outcome: Awaited<
    ReturnType<ReturnType<typeof injectedTools>["tools"]["inspect"]>
  >,
) {
  if (!outcome.ok) throw new Error("Expected inspect success.");
  return outcome.value.object;
}

describe("D5 one-hop inspect mapping", () => {
  it("returns the complete LS1 one-hop device facts without recursive net expansion", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const object = inspectedObject(
      await tools.inspect(request({ by: "uid", value: ls1Uid })),
    );
    expect(object).toMatchObject({
      kind: "device",
      uid: ls1Uid,
      designation: "LS1",
      description: "Normally open field limit switch permissive",
      aliases: [],
      typeId: "core:limit-switch-2wire",
      location: "FIELD",
      functions: [
        {
          key: "contact13",
          kind: "contact",
          normalState: "open",
          terminals: [{ display: "LS1.13" }, { display: "LS1.14" }],
        },
      ],
      gangedGroups: [],
      internalRelations: [],
      projectRelations: [],
    });
    if (object.kind !== "device") throw new Error("Expected a device.");
    expect(object.terminals.map(({ id }) => id.terminalKey)).toEqual([
      "13",
      "14",
    ]);
    expect(object.terminals.map(({ elements }) => elements)).toEqual([
      [
        {
          kind: "wire",
          uid: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
          designation: "W-FLD-002",
          display: "W-FLD-002",
        },
      ],
      [
        {
          kind: "wire",
          uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
          designation: "W-FLD-003",
          display: "W-FLD-003",
        },
      ],
    ]);
    expect(object.terminals[0]?.net.potentials[0]?.name).toBe("+24VDC");
    expect(object.terminals[1]?.net.potentials).toEqual([]);
    for (const terminal of object.terminals) {
      expect(Object.keys(terminal.net)).toEqual(["id", "potentials"]);
      expect(terminal.net).not.toHaveProperty("terminals");
      expect(terminal.net).not.toHaveProperty("elements");
    }
  });

  it("preserves every non-device union projection and the cable depth boundary", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const cases = [
      [{ by: "designation", value: "W-PWR-007" }, "wire"],
      [{ by: "designation", value: "JP1" }, "jumper"],
      [{ by: "designation", value: "CBL1" }, "cable"],
      [{ by: "designation", value: "REL-CONTROLS-001" }, "relation"],
      [
        { by: "uid", value: "46be3efd-17b7-43ee-bb9d-a019c4fb2cdd" },
        "potential",
      ],
    ] as const;
    const objects = [];
    for (const [selector, kind] of cases) {
      const object = inspectedObject(await tools.inspect(request(selector)));
      expect(object.kind).toBe(kind);
      objects.push(object);
    }

    expect(Object.keys(objects[0]!)).toEqual([
      "kind",
      "uid",
      "designation",
      "aliases",
      "properties",
      "endpoints",
      "net",
    ]);
    expect(objects[0]).toMatchObject({
      properties: { color: "brown", label: "L1-K1-OL1", size: "10AWG" },
      endpoints: [{ display: "K1.2/T1" }, { display: "OL1.1/L1" }],
    });
    expect(objects[1]).toMatchObject({
      designation: "JP1",
      endpoints: [{ display: "TB1.1" }, { display: "TB1.2" }],
      net: { potentials: [{ name: "+24VDC" }] },
    });
    expect(objects[2]).toMatchObject({
      designation: "CBL1",
      typeId: "core:cable-2pair-shielded",
      conductorCount: 4,
      conductorIds: [
        { conductorId: "1+" },
        { conductorId: "1-" },
        { conductorId: "2+" },
        { conductorId: "2-" },
      ],
    });
    expect(objects[2]).not.toHaveProperty("conductors");
    expect(objects[3]).toMatchObject({
      designation: "REL-CONTROLS-001",
      verb: "controls",
      from: { designation: "PLC1" },
      to: { designation: "K1" },
    });
    expect(objects[4]).toMatchObject({
      name: "+24VDC",
      terminal: { display: "PS1.+" },
      net: { potentials: [{ name: "+24VDC" }] },
    });
  });

  it("equals the production inspect DTO and canonical query bytes", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const outcome = await tools.inspect(
      request({ by: "designation", value: "CBL1" }),
    );
    const direct = createQueryEngine(motorIr).inspect({
      by: "designation",
      value: "CBL1",
    });
    if (!outcome.ok || !direct.ok) throw new Error("Expected inspect success.");
    expect(outcome.value).toEqual(direct.value);
    expect(serializeQueryResult(outcome.value)).toBe(
      serializeQueryResult(direct.value),
    );
  });
});

describe("D2 inspect freshness, shuffle determinism, and freezing", () => {
  it("is byte-identical after every consumed IR collection is reversed", async () => {
    const shuffled = structuredClone(motorIr);
    for (const value of Object.values(shuffled.indexes)) value.reverse();
    shuffled.devices.reverse();
    shuffled.terminals.reverse();
    shuffled.functions.reverse();
    shuffled.internalRelations.reverse();
    shuffled.gangedGroups.reverse();
    shuffled.wires.reverse();
    shuffled.jumpers.reverse();
    shuffled.cables.reverse();
    shuffled.cableConductors.reverse();
    shuffled.relations.reverse();
    shuffled.potentials.reverse();
    shuffled.nets.reverse();
    for (const fn of shuffled.functions) fn.terminals.reverse();
    for (const group of shuffled.gangedGroups) group.functionIds.reverse();
    for (const net of shuffled.nets) {
      net.terminalIds.reverse();
      net.conductiveElementIds.reverse();
      net.potentialUids.reverse();
    }
    for (const entry of shuffled.indexes.terminalIdsByDeviceUid) {
      entry.value.reverse();
    }
    for (const entry of shuffled.indexes.conductiveElementIdsByTerminal) {
      entry.value.reverse();
    }

    const baseline = await injectedTools(motorIr).tools.inspect(
      request({ by: "designation", value: "LS1" }),
    );
    const reordered = await injectedTools(shuffled).tools.inspect(
      request({ by: "designation", value: "LS1" }),
    );
    expect(reordered).toEqual(baseline);
    if (!baseline.ok || !reordered.ok) throw new Error("Expected success.");
    expect(serializeAgentToolResult("inspect", reordered.value)).toBe(
      serializeAgentToolResult("inspect", baseline.value),
    );
  });

  it("compiles once per call and never serves a stale inspection", async () => {
    let current = structuredClone(motorIr);
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: structuredClone(current),
    }));
    const tools = injectedTools(current, compile).tools;
    const first = inspectedObject(
      await tools.inspect(request({ by: "designation", value: "LS1" })),
    );
    current.devices.find(({ uid }) => uid === ls1Uid)!.description =
      "Fresh description";
    const second = inspectedObject(
      await tools.inspect(request({ by: "designation", value: "LS1" })),
    );
    expect(first.description).toBe(
      "Normally open field limit switch permissive",
    );
    expect(second.description).toBe("Fresh description");
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("detaches and recursively freezes imported query DTO fields", async () => {
    const ir = structuredClone(motorIr);
    const outcome = await injectedTools(ir).tools.inspect(
      request({ by: "designation", value: "LS1" }),
    );
    if (!outcome.ok || outcome.value.object.kind !== "device") {
      throw new Error("Expected device inspection.");
    }
    const terminal = outcome.value.object.terminals[0]!;
    ir.terminals.find(({ id }) => id.deviceUid === ls1Uid)!.id.terminalKey =
      "mutated";
    expect(terminal.id.terminalKey).toBe("13");
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.value.object.terminals)).toBe(true);
    expect(Object.isFrozen(terminal.id)).toBe(true);
    expect(Object.isFrozen(terminal.net.potentials)).toBe(true);
    expect(() => {
      (terminal.id as { deviceUid: string }).deviceUid = "changed";
    }).toThrow(TypeError);
  });
});

describe("D5/D11 inspect failures", () => {
  it("preserves the production Q001 object exactly", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    expect(
      await tools.inspect(
        request({ by: "designation", value: "MISSING-OBJECT" }),
      ),
    ).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "Q001",
        message: 'No project object has designation "MISSING-OBJECT".',
        input: "MISSING-OBJECT",
      },
      failureClass: "expected",
    });
  });

  it("rejects unsupported selectors before compile with exact A001 bytes", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const tools = injectedTools(motorIr, compile).tools;
    const outcome = await tools.inspect({
      format: "agent-tool-request/0.1",
      project,
      selector: { by: "text", value: "LS1", depth: 2 },
    } as unknown as InspectObjectRequest);
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message:
          'A001 Invalid inspect request at "/selector/by": unsupported value.',
        field: "/selector/by",
        reason: "unsupported-value",
      },
      failureClass: "expected",
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("passes authored compile diagnostics through as an expected failure", async () => {
    const diagnostic = {
      code: "E010" as const,
      severity: "error" as const,
      message: 'Missing required property "objects".',
      file: "sources/devices.json",
      line: 2,
      column: 1,
      jsonPointer: "",
    };
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: false,
      diagnostics: [diagnostic],
      toolFailure: false,
    }));
    const outcome = await injectedTools(motorIr, compile).tools.inspect(
      request({ by: "designation", value: "LS1" }),
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [diagnostic],
      error: null,
      failureClass: "expected",
    });
    expect(Object.isFrozen(outcome.diagnostics[0])).toBe(true);
  });
});
