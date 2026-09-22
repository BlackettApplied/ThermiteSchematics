import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import { createQueryEngine, type QueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { serializeAgentToolResult } from "../src/common/serializer.js";
import {
  createInternalReadTools,
  type ReadToolDependencies,
} from "../src/read-tools.js";
import {
  compareSearchMatches,
  resolveCompiledProject,
  type ResolveObjectsRequest,
  type SearchMatch,
} from "../src/resolve.js";

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
  target: ResolveObjectsRequest["target"],
): ResolveObjectsRequest {
  return { format: "agent-tool-request/0.1", project, target };
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

function searchMatches(
  outcome: Awaited<
    ReturnType<ReturnType<typeof injectedTools>["tools"]["resolve"]>
  >,
) {
  if (!outcome.ok || outcome.value.mode !== "search") {
    throw new Error("Expected a search result.");
  }
  return outcome.value.matches;
}

describe("D4 exact resolution", () => {
  it("resolves UID and designation through the production query engine", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const designation = await tools.resolve(
      request({ by: "designation", value: "LS1" }),
    );
    const uid = await tools.resolve(request({ by: "uid", value: ls1Uid }));
    const expected = {
      mode: "resolve",
      object: {
        kind: "device",
        uid: ls1Uid,
        designation: "LS1",
        description: "Normally open field limit switch permissive",
        aliases: [],
      },
    };
    expect(designation).toEqual({ ok: true, diagnostics: [], value: expected });
    expect(uid).toEqual(designation);
  });

  it("preserves exact Q001 and never resolves aliases", async () => {
    const ir = structuredClone(motorIr);
    ir.devices.find(({ uid }) => uid === ls1Uid)!.aliases = ["LIMIT-ALIAS"];
    const { tools } = injectedTools(ir);
    const missing = await tools.resolve(
      request({ by: "designation", value: "LIMIT-ALIAS" }),
    );
    expect(missing).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "Q001",
        message: 'No project object has designation "LIMIT-ALIAS".',
        input: "LIMIT-ALIAS",
      },
      failureClass: "expected",
    });
  });
});

describe("D4 finite search facts and ranking", () => {
  it("locks the complete LS1 text-search ranking and source-field values", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const matches = searchMatches(
      await tools.resolve(request({ by: "text", value: "LS1" })),
    );
    expect(matches.map(({ object }) => object.designation)).toEqual([
      "LS1",
      "CBL1",
      "JP1",
      "JB1",
    ]);
    expect(matches.map(({ match }) => match)).toEqual([
      { kind: "exact", field: "designation", text: "LS1" },
      {
        kind: "prefix",
        field: "description",
        text: "LS1 field cable; conductor 2- is a terminated spare",
      },
      {
        kind: "substring",
        field: "description",
        text: "Distributes +24 VDC from TB1.1 to the LS1 cable feed at TB1.2",
      },
      {
        kind: "substring",
        field: "description",
        text: "Field junction box for LS1",
      },
    ]);
  });

  it("selects all six text fields in their frozen rank order", async () => {
    const ir = structuredClone(motorIr);
    const ls1 = ir.devices.find(({ uid }) => uid === ls1Uid)!;
    ls1.aliases = ["ALIAS-FULL"];
    const { tools } = injectedTools(ir);
    const cases = [
      ["LS1", "designation", "LS1"],
      ["+24VDC", "name", "+24VDC"],
      [ls1Uid, "uid", ls1Uid],
      ["ALIAS-FULL", "alias", "ALIAS-FULL"],
      ["core:limit-switch-2wire", "typeId", "core:limit-switch-2wire"],
      [
        "Normally open field limit switch permissive",
        "description",
        "Normally open field limit switch permissive",
      ],
    ] as const;
    for (const [value, field, text] of cases) {
      const matches = searchMatches(
        await tools.resolve(request({ by: "text", value })),
      );
      expect(matches[0]?.match).toEqual({ kind: "exact", field, text });
    }
  });

  it("ranks match kind before field and aliases lexically without duplicates", async () => {
    const ir = structuredClone(motorIr);
    const ls1 = ir.devices.find(({ uid }) => uid === ls1Uid)!;
    ls1.aliases = ["LS", "z-needle", "a-needle", "a-needle", "LS1"];
    const { tools } = injectedTools(ir);

    const exactAlias = searchMatches(
      await tools.resolve(request({ by: "text", value: "LS" })),
    ).find(({ object }) => object.uid === ls1Uid);
    expect(exactAlias?.match).toEqual({
      kind: "exact",
      field: "alias",
      text: "LS",
    });

    const fieldRank = searchMatches(
      await tools.resolve(request({ by: "text", value: "LS1" })),
    ).find(({ object }) => object.uid === ls1Uid);
    expect(fieldRank?.match).toEqual({
      kind: "exact",
      field: "designation",
      text: "LS1",
    });

    const lexicalAlias = searchMatches(
      await tools.resolve(request({ by: "text", value: "needle" })),
    );
    expect(lexicalAlias).toHaveLength(1);
    expect(lexicalAlias[0]?.match).toEqual({
      kind: "substring",
      field: "alias",
      text: "a-needle",
    });
  });

  it("keeps type search exact, finite, and empty without Q001", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const typeMatches = searchMatches(
      await tools.resolve(
        request({ by: "type", value: "core:cable-2pair-shielded" }),
      ),
    );
    expect(typeMatches).toEqual([
      {
        object: {
          kind: "cable",
          uid: "c4c1bfdf-567a-4f6c-9e08-147342061afe",
          designation: "CBL1",
          description: "LS1 field cable; conductor 2- is a terminated spare",
          aliases: [],
        },
        match: {
          kind: "exact",
          field: "typeId",
          text: "core:cable-2pair-shielded",
        },
      },
    ]);
    expect(
      searchMatches(
        await tools.resolve(request({ by: "type", value: "core:missing" })),
      ),
    ).toEqual([]);
  });

  it("sorts multiple exact type instances by display then kind and UID", () => {
    const ir = structuredClone(motorIr);
    const ls1 = ir.devices.find(({ uid }) => uid === ls1Uid)!;
    const second = {
      ...structuredClone(ls1),
      uid: "00000000-0000-4000-8000-000000000001",
      designation: "A-LS1",
    };
    ir.devices.push(second);
    const views = new Map(
      [ls1, second].map((object) => [
        object.uid,
        {
          kind: "device" as const,
          uid: object.uid,
          designation: object.designation,
          description: object.description,
          aliases: object.aliases,
        },
      ]),
    );
    const engine = {
      resolveObject(selector: { readonly value: string }) {
        return { ok: true as const, value: views.get(selector.value)! };
      },
    } as unknown as QueryEngine;
    const result = resolveCompiledProject(ir, engine, {
      by: "type",
      value: "core:limit-switch-2wire",
    });
    if (!result.ok || result.value.mode !== "search") {
      throw new Error("Expected type search success.");
    }
    expect(
      result.value.matches.map(({ object }) => object.designation),
    ).toEqual(["A-LS1", "LS1"]);
  });

  it("is case-sensitive and excludes property labels and endpoint references", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    for (const value of ["ls1", "LS1-SWITCHED-RETURN", "PLC1.X1.0"]) {
      expect(
        searchMatches(await tools.resolve(request({ by: "text", value }))),
      ).toEqual([]);
    }
  });

  it("uses code-unit object display, kind, and UID tie breakers", () => {
    const ranked = (
      object: SearchMatch["object"],
      text = "same",
    ): SearchMatch => ({
      object,
      match: { kind: "exact", field: "alias", text },
    });
    const matches = [
      ranked({ kind: "device", uid: "b", designation: "same", aliases: [] }),
      ranked({ kind: "device", uid: "a", designation: "same", aliases: [] }),
      ranked({ kind: "wire", uid: "u", aliases: [] }),
      ranked({
        kind: "device",
        uid: "kind-first",
        designation: "wire:u",
        aliases: [],
      }),
      ranked({ kind: "device", uid: "unicode", designation: "ä", aliases: [] }),
      ranked({ kind: "device", uid: "ascii", designation: "Z", aliases: [] }),
    ].sort(compareSearchMatches);
    expect(matches.map(({ object }) => object.uid)).toEqual([
      "ascii",
      "a",
      "b",
      "kind-first",
      "u",
      "unicode",
    ]);
  });
});

describe("D2 freshness, shuffle determinism, and immutable outcomes", () => {
  it("returns byte-identical search output for shuffled IR iteration order", async () => {
    const shuffled = structuredClone(motorIr);
    for (const collection of [
      shuffled.devices,
      shuffled.wires,
      shuffled.jumpers,
      shuffled.cables,
      shuffled.relations,
      shuffled.potentials,
    ]) {
      collection.reverse();
    }
    shuffled.indexes.objectRefByUid.reverse();
    shuffled.indexes.objectRefByDesignation.reverse();
    shuffled.indexes.instanceRefsByTypeId.reverse();

    const baseline = await injectedTools(motorIr).tools.resolve(
      request({ by: "text", value: "LS1" }),
    );
    const reordered = await injectedTools(shuffled).tools.resolve(
      request({ by: "text", value: "LS1" }),
    );
    expect(reordered).toEqual(baseline);
    if (!baseline.ok || !reordered.ok) throw new Error("Expected success.");
    expect(serializeAgentToolResult("resolve", reordered.value)).toBe(
      serializeAgentToolResult("resolve", baseline.value),
    );
  });

  it("compiles exactly once per call and observes changed compiler snapshots", async () => {
    let current = structuredClone(motorIr);
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: structuredClone(current),
    }));
    const { tools } = injectedTools(current, compile);
    expect(
      searchMatches(
        await tools.resolve(request({ by: "text", value: "FRESH-ALIAS" })),
      ),
    ).toEqual([]);
    current.devices.find(({ uid }) => uid === ls1Uid)!.aliases = [
      "FRESH-ALIAS",
    ];
    expect(
      searchMatches(
        await tools.resolve(request({ by: "text", value: "FRESH-ALIAS" })),
      )[0]?.object.uid,
    ).toBe(ls1Uid);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenNthCalledWith(1, project, repositoryRoot);
    expect(compile).toHaveBeenNthCalledWith(2, project, repositoryRoot);
  });

  it("detaches and recursively freezes the complete outcome", async () => {
    const ir = structuredClone(motorIr);
    ir.devices.find(({ uid }) => uid === ls1Uid)!.aliases = ["FROZEN-ALIAS"];
    const outcome = await injectedTools(ir).tools.resolve(
      request({ by: "text", value: "FROZEN-ALIAS" }),
    );
    if (!outcome.ok || outcome.value.mode !== "search") {
      throw new Error("Expected search success.");
    }
    const match = outcome.value.matches[0]!;
    ir.devices.find(({ uid }) => uid === ls1Uid)!.aliases[0] = "MUTATED";
    expect(match.object.aliases).toEqual(["FROZEN-ALIAS"]);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.diagnostics)).toBe(true);
    expect(Object.isFrozen(outcome.value)).toBe(true);
    expect(Object.isFrozen(outcome.value.matches)).toBe(true);
    expect(Object.isFrozen(match)).toBe(true);
    expect(Object.isFrozen(match.object.aliases)).toBe(true);
    expect(() => (match.object.aliases as string[]).push("changed")).toThrow(
      TypeError,
    );
  });
});

describe("D11 resolve errors and validation precedence", () => {
  it("finishes Layer 0 before literal validation and performs no compile", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const tools = injectedTools(motorIr, compile).tools;
    const target = { by: "text" } as Record<string, unknown>;
    Object.defineProperty(target, "value", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const outcome = await tools.resolve({
      format: "wrong",
      project,
      target,
    } as unknown as ResolveObjectsRequest);
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message:
          'A001 Invalid resolve request at "/target/value": hostile object.',
        field: "/target/value",
        reason: "hostile-object",
      },
      failureClass: "expected",
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("uses declaration order and exact A001 bytes for malformed requests", async () => {
    const tools = injectedTools(motorIr).tools;
    const outcome = await tools.resolve({
      format: "wrong-version",
      project: "",
      target: { by: "unknown", value: "" },
    } as unknown as ResolveObjectsRequest);
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message:
          'A001 Invalid resolve request at "/format": unsupported value.',
        field: "/format",
        reason: "unsupported-value",
      },
      failureClass: "expected",
    });
  });

  it("sanitizes compile tool failures without leaking the requested path", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const outcome = await tools.resolve({
      format: "agent-tool-request/0.1",
      project: "Z:/private/missing-project",
      target: { by: "text", value: "LS1" },
    });
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Agent resolve tool failure (compile/E001).",
          file: "system.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
      error: null,
      failureClass: "tool",
    });
    expect(JSON.stringify(outcome)).not.toContain("private");
  });
});
