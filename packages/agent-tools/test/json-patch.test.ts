import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { JsonValue } from "../src/common/contracts.js";
import { applyJsonPatch, structurallyEqualJson } from "../src/json-patch.js";
import {
  createSourcePatchPlan,
  type SourcePatchTargetSnapshot,
} from "../src/source-patch.js";
import {
  validateApplySourcePatchRequest,
  type ApplySourcePatchRequest,
  type SourcePatchOperation,
} from "../src/source-patch-request.js";

function apply(
  document: JsonValue,
  operations: readonly SourcePatchOperation[],
) {
  return applyJsonPatch(
    "connections/field-terminations.json",
    document,
    operations,
  );
}

function validatedRequest(request: unknown): ApplySourcePatchRequest {
  const result = validateApplySourcePatchRequest(request);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}

describe("D9 structural JSON equality", () => {
  it("ignores object key order and preserves array/scalar type and value", () => {
    expect(
      structurallyEqualJson(
        { a: 1, nested: { x: true, y: null } },
        { nested: { y: null, x: true }, a: 1 },
      ),
    ).toBe(true);
    expect(structurallyEqualJson([1, "1"], [1, "1"])).toBe(true);
    expect(structurallyEqualJson([1, 2], [2, 1])).toBe(false);
    expect(structurallyEqualJson(1, "1")).toBe(false);
    expect(structurallyEqualJson(false, 0)).toBe(false);
    expect(structurallyEqualJson(0, -0)).toBe(true);
    expect(structurallyEqualJson({ a: 1 }, { a: 1, b: null })).toBe(false);
  });

  it("compares, clones, and freezes 20,000-level JSON iteratively", () => {
    let left: JsonValue = null;
    let right: JsonValue = null;
    for (let depth = 0; depth < 20_000; depth += 1) {
      left = [left];
      right = [right];
    }
    expect(structurallyEqualJson(left, right)).toBe(true);

    const result = apply({}, [{ op: "add", path: "/deep", value: left }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let current = (result.value as { readonly deep: JsonValue }).deep;
    for (let depth = 0; depth < 20_000; depth += 1) {
      expect(Object.isFrozen(current)).toBe(true);
      current = (current as readonly JsonValue[])[0]!;
    }
    expect(current).toBeNull();
  });
});

describe("D9 JSON Patch operations", () => {
  it("tests the root structurally and rejects all root mutations", () => {
    expect(
      apply({ a: 1, nested: { left: true, right: false } }, [
        {
          op: "test",
          path: "",
          value: {
            nested: { right: false, left: true },
            a: 1,
          },
        },
      ]),
    ).toMatchObject({ ok: true });
    expect(
      apply({ a: 1 }, [{ op: "test", path: "", value: { a: 2 } }]),
    ).toEqual({
      ok: false,
      error: {
        code: "A002",
        message:
          'A002 Source patch failed for "connections/field-terminations.json" operation 0 at "": test failed.',
        file: "connections/field-terminations.json",
        operationIndex: 0,
        path: "",
        reason: "test-failed",
      },
    });

    for (const operation of [
      { op: "add", path: "", value: {} },
      { op: "remove", path: "" },
      { op: "replace", path: "", value: {} },
    ] as const) {
      expect(apply({}, [operation]), operation.op).toEqual({
        ok: false,
        error: {
          code: "A002",
          message:
            'A002 Source patch failed for "connections/field-terminations.json" operation 0 at "": root mutation.',
          file: "connections/field-terminations.json",
          operationIndex: 0,
          path: "",
          reason: "root-mutation",
        },
      });
    }
  });

  it("applies object add/replace/remove/test in request order", () => {
    const document = {
      object: { existing: 1, remove: true },
      untouched: "same",
    };
    const result = apply(document, [
      { op: "test", path: "/object/existing", value: 1 },
      { op: "add", path: "/object/existing", value: 2 },
      { op: "add", path: "/object/added", value: { z: 2, a: 1 } },
      { op: "replace", path: "/object/existing", value: 3 },
      { op: "remove", path: "/object/remove" },
      {
        op: "test",
        path: "/object",
        value: { added: { a: 1, z: 2 }, existing: 3 },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        object: { existing: 3, added: { z: 2, a: 1 } },
        untouched: "same",
      },
    });
    expect(document).toEqual({
      object: { existing: 1, remove: true },
      untouched: "same",
    });
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.object)).toBe(true);
    }
  });

  it("inserts, appends, replaces, removes, and tests arrays", () => {
    expect(
      apply({ values: ["a", "c"] }, [
        { op: "add", path: "/values/1", value: "b" },
        { op: "add", path: "/values/-", value: "d" },
        { op: "replace", path: "/values/3", value: "D" },
        { op: "remove", path: "/values/0" },
        { op: "test", path: "/values/0", value: "b" },
      ]),
    ).toEqual({
      ok: true,
      value: { values: ["b", "c", "D"] },
    });
    expect(
      apply({ values: ["a"] }, [{ op: "add", path: "/values/1", value: "b" }]),
    ).toEqual({
      ok: true,
      value: { values: ["a", "b"] },
    });
  });

  it("decodes pointer escapes and treats __proto__ as ordinary data", () => {
    const document = JSON.parse(
      '{"a/b":{"~key":1},"__proto__":{"safe":true}}',
    ) as JsonValue;
    const result = apply(document, [
      { op: "replace", path: "/a~1b/~0key", value: 2 },
      { op: "add", path: "/__proto__/added", value: true },
      { op: "test", path: "/__proto__/safe", value: true },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        "a/b": { "~key": 2 },
        ["__proto__"]: { safe: true, added: true },
      },
    });
    if (result.ok) {
      expect(Object.getPrototypeOf(result.value)).toBeNull();
      expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
    }
  });

  it("preserves request insertion order after sorted Layer 0 traversal", () => {
    const request = validatedRequest({
      format: "agent-tool-request/0.1",
      project: ".",
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: "connections/field-terminations.json",
          expectedIntegrity:
            "sha256-uH5wquZl1n/aAVaxmhG7cdvaUl7sOUBVYKjQOaYKvmE=",
          operations: [
            {
              op: "add",
              path: "/objects/0",
              value: {
                uid: "wire-uid",
                kind: "wire",
                designation: "W-FLD-004",
                endpoints: [{ device: "JB1", terminal: "X1.3" }],
                properties: {
                  label: "0V-JB1-LS1",
                  size: "18AWG",
                  color: "blue/white",
                },
              },
            },
          ],
        },
      ],
    });
    const operation = request.files[0]!.operations[0]!;
    if (operation.op !== "add") throw new Error("Expected an add operation.");
    expect(Object.keys(operation.value)).toEqual([
      "designation",
      "endpoints",
      "kind",
      "properties",
      "uid",
    ]);

    const result = apply({ objects: [] }, [operation]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      readonly objects: readonly {
        readonly properties: Readonly<Record<string, JsonValue>>;
      }[];
    };
    expect(Object.keys(value.objects[0]!)).toEqual([
      "uid",
      "kind",
      "designation",
      "endpoints",
      "properties",
    ]);
    expect(Object.keys(value.objects[0]!.properties)).toEqual([
      "label",
      "size",
      "color",
    ]);
  });

  it("clones inserted request values instead of aliasing them", () => {
    const inserted = { nested: [1, 2] };
    const result = apply({}, [
      { op: "add", path: "/first", value: inserted },
      { op: "add", path: "/second", value: inserted },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      readonly first: { readonly nested: readonly number[] };
      readonly second: { readonly nested: readonly number[] };
    };
    expect(value.first).not.toBe(inserted);
    expect(value.first).not.toBe(value.second);
    expect(value.first.nested).not.toBe(value.second.nested);
  });
});

describe("D9 Layer-2d A002 inventory and precedence", () => {
  it("returns missing-target for absent object targets and scalar parents", () => {
    for (const operation of [
      { op: "test", path: "/missing", value: null },
      { op: "remove", path: "/missing" },
      { op: "replace", path: "/missing", value: null },
      { op: "add", path: "/scalar/child", value: true },
    ] as const) {
      const result = apply({ scalar: 1 }, [operation]);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "A002",
          operationIndex: 0,
          path: operation.path,
          reason: "missing-target",
        },
      });
    }
  });

  it("returns invalid-array-index for every malformed or out-of-bounds application", () => {
    const cases: readonly SourcePatchOperation[] = [
      { op: "test", path: "/values/01", value: "a" },
      { op: "test", path: "/values/-", value: "a" },
      { op: "remove", path: "/values/2" },
      { op: "replace", path: "/values/3", value: "a" },
      { op: "add", path: "/values/3", value: "a" },
      { op: "add", path: "/values/-1", value: "a" },
      { op: "add", path: "/values/1.0", value: "a" },
      {
        op: "test",
        path: "/values/999999999999999999999999",
        value: "a",
      },
      { op: "add", path: "/values/-/child", value: "a" },
    ];
    for (const operation of cases) {
      expect(apply({ values: ["a", "b"] }, [operation])).toMatchObject({
        ok: false,
        error: {
          path: operation.path,
          reason: "invalid-array-index",
        },
      });
    }
  });

  it("returns exact test-failed bytes and the first operation index", () => {
    expect(
      apply({ present: true }, [
        { op: "test", path: "/present", value: true },
        { op: "test", path: "/present", value: false },
        { op: "remove", path: "/missing" },
      ]),
    ).toEqual({
      ok: false,
      error: {
        code: "A002",
        message:
          'A002 Source patch failed for "connections/field-terminations.json" operation 1 at "/present": test failed.',
        file: "connections/field-terminations.json",
        operationIndex: 1,
        path: "/present",
        reason: "test-failed",
      },
    });
  });

  it("returns no partial result and leaves input untouched after a later failure", () => {
    const document = { values: [1], stable: true };
    const result = apply(document, [
      { op: "add", path: "/values/-", value: 2 },
      { op: "replace", path: "/stable", value: false },
      { op: "remove", path: "/missing" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        operationIndex: 2,
        reason: "missing-target",
      },
    });
    expect(result).not.toHaveProperty("value");
    expect(document).toEqual({ values: [1], stable: true });
  });
});

describe("D11 pure 2b, 2c, then 2d coordination", () => {
  const file0Bytes = Buffer.from('{"present":true}\n', "utf8");
  const file1Bytes = Buffer.from('{"stable":1}\n', "utf8");
  const file0Integrity = "sha256-/tn6+16iwTe/BsexAlv1cFHkCvd1W1ygd9UtAu0FZjI=";
  const file1Integrity = "sha256-bUBDSgkWr99Z2xMbFMfRXe20MuW1JdPmnBjwoKctiYM=";
  const staleFile1Integrity =
    "sha256-6hvpHx7X6Y/oOB1mBz1jMk/PX8isklSr2KomJs2RInc=";

  function request(expectedFile1 = file1Integrity) {
    return validatedRequest({
      format: "agent-tool-request/0.1",
      project: ".",
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: "a.json",
          expectedIntegrity: file0Integrity,
          operations: [{ op: "remove", path: "/missing" }],
        },
        {
          path: "b.json",
          expectedIntegrity: expectedFile1,
          operations: [{ op: "test", path: "/stable", value: 1 }],
        },
      ],
    });
  }

  function targets(): Map<string, SourcePatchTargetSnapshot> {
    return new Map([
      ["a.json", { rawBytes: file0Bytes, value: { present: true } }],
      ["b.json", { rawBytes: file1Bytes, value: { stable: 1 } }],
    ]);
  }

  it("runs all 2b membership checks before any 2c or 2d candidate", () => {
    const missingSecond = targets();
    missingSecond.delete("b.json");
    expect(
      createSourcePatchPlan(request(staleFile1Integrity), missingSecond),
    ).toEqual({
      ok: false,
      error: {
        code: "A003",
        message:
          'A003 Unsafe source patch target "b.json": not project source.',
        file: "b.json",
        reason: "not-project-source",
      },
    });
  });

  it("freezes the round-5 worked example: file-1 A004 beats file-0 missing-target", () => {
    expect(
      createSourcePatchPlan(request(staleFile1Integrity), targets()),
    ).toEqual({
      ok: false,
      error: {
        code: "A004",
        message:
          'A004 Guarded file "b.json" does not match its required integrity.',
        file: "b.json",
        expectedIntegrity:
          "sha256-6hvpHx7X6Y/oOB1mBz1jMk/PX8isklSr2KomJs2RInc=",
        actualIntegrity: "sha256-bUBDSgkWr99Z2xMbFMfRXe20MuW1JdPmnBjwoKctiYM=",
      },
    });
  });

  it("enters 2d only after 2b and 2c and keeps request operation order", () => {
    expect(createSourcePatchPlan(request(), targets())).toEqual({
      ok: false,
      error: {
        code: "A002",
        message:
          'A002 Source patch failed for "a.json" operation 0 at "/missing": missing target.',
        file: "a.json",
        operationIndex: 0,
        path: "/missing",
        reason: "missing-target",
      },
    });
  });
});
