import type { Diagnostic } from "@thermite/schema";
import { describe, expect, it } from "vitest";

import * as agentToolsPackage from "../src/index.js";
import {
  createA001Error,
  createA002Error,
  createA003Error,
  createA004Error,
} from "../src/common/errors.js";
import {
  detachAndFreezePlainJson,
  plainJsonDependencies,
  type PlainJsonDependencies,
} from "../src/common/plain-json.js";
import {
  serializeAgentToolReport,
  serializeAgentToolResult,
} from "../src/common/serializer.js";

describe("complete public contract", () => {
  it("exports only the frozen Task 6 runtime surface", () => {
    expect(agentToolsPackage.AGENT_TOOLS_VERSION).toBe("agent-tools/0.1");
    expect(Object.keys(agentToolsPackage).sort()).toEqual([
      "AGENT_TOOLS_VERSION",
      "createAgentTools",
      "serializeAgentToolReport",
      "serializeAgentToolResult",
    ]);
  });

  it("constructs the exact A001-A004 shapes and JSON-quoted messages", () => {
    const a001 = createA001Error(
      "create-view",
      "/spec/intent\nkind",
      "unsupported-value",
    );
    expect(a001).toEqual({
      code: "A001",
      message:
        'A001 Invalid create-view request at "/spec/intent\\nkind": unsupported value.',
      field: "/spec/intent\nkind",
      reason: "unsupported-value",
    });

    const a002 = createA002Error(
      'connections/a"b.json',
      3,
      "/items/line\nbreak",
      "missing-target",
    );
    expect(a002).toEqual({
      code: "A002",
      message:
        'A002 Source patch failed for "connections/a\\"b.json" operation 3 at "/items/line\\nbreak": missing target.',
      file: 'connections/a"b.json',
      operationIndex: 3,
      path: "/items/line\nbreak",
      reason: "missing-target",
    });

    const a003 = createA003Error('connections/a"b.json', "not-project-source");
    expect(a003).toEqual({
      code: "A003",
      message:
        'A003 Unsafe source patch target "connections/a\\"b.json": not project source.',
      file: 'connections/a"b.json',
      reason: "not-project-source",
    });

    const a004 = createA004Error(
      "devices/equipment.json",
      "sha256-expected=",
      "sha256-actual=",
    );
    expect(a004).toEqual({
      code: "A004",
      message:
        'A004 Guarded file "devices/equipment.json" does not match its required integrity.',
      file: "devices/equipment.json",
      expectedIntegrity: "sha256-expected=",
      actualIntegrity: "sha256-actual=",
    });

    expect([a001, a002, a003, a004].every(Object.isFrozen)).toBe(true);
  });

  it("serializes exact result/report bytes without failureClass", () => {
    const diagnostic: Diagnostic = {
      code: "E001",
      severity: "error",
      message: "Agent validate tool failure (compile/E001).",
      file: "<project>",
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    const error = createA001Error("validate", "/format", "unsupported-value");

    expect(
      serializeAgentToolResult("validate", {
        valid: true,
      }),
    ).toBe(
      '{\n  "format": "agent-tool-result/0.1",\n  "tool": "validate",\n  "value": {\n    "valid": true\n  }\n}\n',
    );
    expect(
      serializeAgentToolResult("inspect", {
        object: {
          properties: {
            z: 3,
            nested: { z: 2, a: 1 },
            a: 0,
          },
        },
      }),
    ).toBe(
      '{\n  "format": "agent-tool-result/0.1",\n  "tool": "inspect",\n  "value": {\n    "object": {\n      "properties": {\n        "a": 0,\n        "nested": {\n          "a": 1,\n          "z": 2\n        },\n        "z": 3\n      }\n    }\n  }\n}\n',
    );
    expect(serializeAgentToolReport("validate", [diagnostic], error)).toBe(
      '{\n  "format": "agent-tool-report/0.1",\n  "tool": "validate",\n  "diagnostics": [\n    {\n      "code": "E001",\n      "severity": "error",\n      "message": "Agent validate tool failure (compile/E001).",\n      "file": "<project>",\n      "line": 1,\n      "column": 1,\n      "jsonPointer": ""\n    }\n  ],\n  "error": {\n    "code": "A001",\n    "message": "A001 Invalid validate request at \\"/format\\": unsupported value.",\n    "field": "/format",\n    "reason": "unsupported-value"\n  }\n}\n',
    );
    expect(serializeAgentToolReport("validate", [], null)).toBe(
      '{\n  "format": "agent-tool-report/0.1",\n  "tool": "validate",\n  "diagnostics": [],\n  "error": null\n}\n',
    );
    expect(serializeAgentToolReport("validate", [], error)).not.toContain(
      "failureClass",
    );
  });
});

describe("Layer 0 detached plain JSON", () => {
  it("detaches aliases into recursively frozen null-prototype snapshots", () => {
    const shared = { terminal: { deviceUid: "device", terminalKey: "13" } };
    const source = {
      z: [shared],
      a: shared,
    };

    const result = detachAndFreezePlainJson("inspect", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = result.value as {
      readonly a: {
        readonly terminal: {
          readonly deviceUid: string;
          readonly terminalKey: string;
        };
      };
      readonly z: readonly [
        {
          readonly terminal: {
            readonly deviceUid: string;
            readonly terminalKey: string;
          };
        },
      ];
    };
    expect(Object.keys(snapshot)).toEqual(["a", "z"]);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.getPrototypeOf(snapshot.a)).toBeNull();
    expect(snapshot.a).not.toBe(source.a);
    expect(snapshot.z[0]).not.toBe(source.z[0]);
    expect(snapshot.a).not.toBe(snapshot.z[0]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.a)).toBe(true);
    expect(Object.isFrozen(snapshot.a.terminal)).toBe(true);
    expect(Object.isFrozen(snapshot.z)).toBe(true);

    source.a.terminal.terminalKey = "14";
    expect(snapshot.a.terminal.terminalKey).toBe("13");
  });

  it("preserves JSON keys such as __proto__ as ordinary detached data", () => {
    const source = Object.create(null) as Record<string, unknown>;
    source.__proto__ = { safe: true };
    const result = detachAndFreezePlainJson("apply-source-patch", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = result.value as {
      readonly __proto__: { readonly safe: boolean };
    };
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true);
    expect(snapshot.__proto__.safe).toBe(true);
  });

  it("uses the frozen primitive/non-JSON reason assignments", () => {
    const cases: readonly [
      unknown,
      "non-finite-number" | "unsupported-value",
      string,
    ][] = [
      [Number.NaN, "non-finite-number", ""],
      [Number.POSITIVE_INFINITY, "non-finite-number", ""],
      [undefined, "unsupported-value", ""],
      [1n, "unsupported-value", ""],
      [Symbol("value-secret"), "unsupported-value", ""],
      [() => undefined, "unsupported-value", ""],
      [new Date(0), "unsupported-value", ""],
      [new Array(1), "unsupported-value", "/0"],
    ];

    for (const [value, reason, field] of cases) {
      const result = detachAndFreezePlainJson("resolve", value);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "A001", field, reason },
      });
    }

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(detachAndFreezePlainJson("resolve", cyclic)).toMatchObject({
      ok: false,
      error: { field: "/self", reason: "unsupported-value" },
    });
  });

  it("rejects array extras and non-enumerable record properties", () => {
    const array = [1] as unknown[] & { extra?: boolean };
    array.extra = true;
    expect(detachAndFreezePlainJson("query", array)).toMatchObject({
      ok: false,
      error: { field: "/extra", reason: "unsupported-value" },
    });

    const record = {};
    Object.defineProperty(record, "hidden", {
      value: true,
      enumerable: false,
    });
    expect(detachAndFreezePlainJson("query", record)).toMatchObject({
      ok: false,
      error: { field: "/hidden", reason: "unsupported-value" },
    });
  });

  it("rejects proxies before invoking any trap", () => {
    let trapCount = 0;
    const proxy = new Proxy(
      { format: "agent-tool-request/0.1" },
      {
        get() {
          trapCount += 1;
          return undefined;
        },
        getOwnPropertyDescriptor() {
          trapCount += 1;
          return undefined;
        },
        getPrototypeOf() {
          trapCount += 1;
          return null;
        },
        ownKeys() {
          trapCount += 1;
          return [];
        },
      },
    );

    expect(detachAndFreezePlainJson("validate", proxy)).toEqual({
      ok: false,
      error: {
        code: "A001",
        message: 'A001 Invalid validate request at "": hostile object.',
        field: "",
        reason: "hostile-object",
      },
    });
    expect(trapCount).toBe(0);
  });

  it("reports accessors without invoking them before later schema checks", () => {
    let getterCount = 0;
    const request = { format: "wrong-version" } as Record<string, unknown>;
    Object.defineProperty(request, "dryRun", {
      enumerable: true,
      get() {
        getterCount += 1;
        return true;
      },
    });

    expect(
      detachAndFreezePlainJson("apply-source-patch", request),
    ).toMatchObject({
      ok: false,
      error: { field: "/dryRun", reason: "hostile-object" },
    });
    expect(getterCount).toBe(0);
  });

  it("uses code-unit key order for descriptor failures", () => {
    const record = {};
    Object.defineProperty(record, "z", {
      enumerable: true,
      get: () => true,
    });
    Object.defineProperty(record, "a", {
      enumerable: true,
      get: () => true,
    });

    expect(detachAndFreezePlainJson("validate", record)).toMatchObject({
      ok: false,
      error: { field: "/a", reason: "hostile-object" },
    });
  });

  it("collapses symbol keys to the containing pointer before descendants", () => {
    const rootSecret = Symbol("root-secret");
    const nestedSecretOne = Symbol("nested-secret-one");
    const nestedSecretTwo = Symbol("nested-secret-two");
    const nested = {
      value: Number.NaN,
      [nestedSecretOne]: "first",
      [nestedSecretTwo]: "second",
    };
    const root = {
      nested,
      [rootSecret]: "root",
    };

    const rootResult = detachAndFreezePlainJson("query", root);
    expect(rootResult).toMatchObject({
      ok: false,
      error: { field: "", reason: "unsupported-value" },
    });
    expect(JSON.stringify(rootResult)).not.toContain("root-secret");

    const nestedResult = detachAndFreezePlainJson("query", { nested });
    expect(nestedResult).toMatchObject({
      ok: false,
      error: { field: "/nested", reason: "unsupported-value" },
    });
    expect(JSON.stringify(nestedResult)).not.toContain("nested-secret");
  });

  it("exposes only an internal dependency seam and maps reflection throws", () => {
    const dependencies: PlainJsonDependencies = {
      ...plainJsonDependencies,
      getPrototypeOf() {
        throw new Error("unobservable reflection detail");
      },
    };
    expect(detachAndFreezePlainJson("inspect", {}, dependencies)).toMatchObject(
      {
        ok: false,
        error: { field: "", reason: "hostile-object" },
      },
    );
  });
});
