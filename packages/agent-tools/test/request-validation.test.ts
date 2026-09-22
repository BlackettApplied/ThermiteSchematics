import { Buffer } from "node:buffer";

import { computeFileIntegrity } from "@thermite/compiler";
import { describe, expect, it } from "vitest";

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
import { serializeAgentToolReport } from "../src/common/serializer.js";
import {
  errorSanitizerDependencies,
  sanitizedErrorCode,
  sanitizedErrorDetail,
  type ErrorSanitizerDependencies,
} from "../src/common/tool-failure.js";
import { validateCreateViewRequest } from "../src/create-view.js";
import { validateInspectRequest } from "../src/inspect.js";
import { validateGraphQueryRequest } from "../src/query.js";
import { validateResolveRequest } from "../src/resolve.js";
import {
  isCanonicalFileIntegrity,
  isPortableSourcePatchPath,
  parseJsonPointer,
  validateApplySourcePatchRequest,
} from "../src/source-patch-request.js";
import { validateValidateProjectRequest } from "../src/validate.js";
import { createAgentTools } from "../src/toolbox.js";

const BASE_BYTES = Buffer.from("{}\n", "utf8");
const BASE_INTEGRITY = computeFileIntegrity(BASE_BYTES);

interface MutableOperation {
  op?: unknown;
  path?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

interface MutableFilePatch {
  path?: unknown;
  expectedIntegrity?: unknown;
  operations?: unknown;
  [key: string]: unknown;
}

interface MutablePatchRequest {
  format?: unknown;
  project?: unknown;
  patchFormat?: unknown;
  dryRun?: unknown;
  files?: unknown;
  [key: string]: unknown;
}

function validPatchRequest(): MutablePatchRequest {
  return {
    format: "agent-tool-request/0.1",
    project: ".",
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      {
        path: "devices/equipment.json",
        expectedIntegrity: BASE_INTEGRITY,
        operations: [{ op: "test", path: "", value: {} }],
      },
    ],
  };
}

function filesOf(request: MutablePatchRequest): MutableFilePatch[] {
  return request.files as MutableFilePatch[];
}

function operationsOf(file: MutableFilePatch): MutableOperation[] {
  return file.operations as MutableOperation[];
}

describe("D11 Layer 0 request snapshots", () => {
  it("iteratively detaches 20,000 levels before returning frozen Layer-1 bytes", async () => {
    let deep: unknown = null;
    for (let depth = 0; depth < 20_000; depth += 1) deep = [deep];
    const outcome = await createAgentTools().validate({
      format: "agent-tool-request/0.1",
      project: ".",
      extra: deep,
    });
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message:
          'A001 Invalid validate request at "/extra": additional property.',
        field: "/extra",
        reason: "additional-property",
      },
      failureClass: "expected",
    });
    if (outcome.ok) throw new Error("Expected Layer-1 rejection.");
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.error)).toBe(true);
    expect(
      serializeAgentToolReport("validate", outcome.diagnostics, outcome.error),
    ).toBe(
      [
        "{",
        '  "format": "agent-tool-report/0.1",',
        '  "tool": "validate",',
        '  "diagnostics": [],',
        '  "error": {',
        '    "code": "A001",',
        '    "message": "A001 Invalid validate request at \\"/extra\\": additional property.",',
        '    "field": "/extra",',
        '    "reason": "additional-property"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("rejects the complete non-JSON value inventory before Layer 1", () => {
    const cases: readonly [
      unknown,
      string,
      "non-finite-number" | "unsupported-value",
    ][] = [
      [Number.NaN, "/files/0/operations/0/value", "non-finite-number"],
      [
        Number.POSITIVE_INFINITY,
        "/files/0/operations/0/value",
        "non-finite-number",
      ],
      [
        Number.NEGATIVE_INFINITY,
        "/files/0/operations/0/value",
        "non-finite-number",
      ],
      [undefined, "/files/0/operations/0/value", "unsupported-value"],
      [1n, "/files/0/operations/0/value", "unsupported-value"],
      [
        Symbol("value-secret"),
        "/files/0/operations/0/value",
        "unsupported-value",
      ],
      [() => undefined, "/files/0/operations/0/value", "unsupported-value"],
      [new Date(0), "/files/0/operations/0/value", "unsupported-value"],
      [new Array(1), "/files/0/operations/0/value/0", "unsupported-value"],
    ];

    for (const [value, field, reason] of cases) {
      const request = validPatchRequest();
      operationsOf(filesOf(request)[0]!)[0]!.value = value;
      const result = validateApplySourcePatchRequest(request);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "A001", field, reason },
      });
      expect(JSON.stringify(result)).not.toContain("value-secret");
    }

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const request = validPatchRequest();
    operationsOf(filesOf(request)[0]!)[0]!.value = cyclic;
    expect(validateApplySourcePatchRequest(request)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/self",
        reason: "unsupported-value",
      },
    });
  });

  it("rejects proxies before invoking any trap", () => {
    let trapCount = 0;
    const proxy = new Proxy(validPatchRequest(), {
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
    });
    expect(validateApplySourcePatchRequest(proxy)).toEqual({
      ok: false,
      error: {
        code: "A001",
        message:
          'A001 Invalid apply-source-patch request at "": hostile object.',
        field: "",
        reason: "hostile-object",
      },
    });
    expect(trapCount).toBe(0);
  });

  it("uses code-unit key order and makes Layer 0 absolute", () => {
    let getterCount = 0;
    const request = validPatchRequest();
    request.format = "wrong-version";
    Object.defineProperty(request, "dryRun", {
      enumerable: true,
      get() {
        getterCount += 1;
        return true;
      },
    });
    expect(validateApplySourcePatchRequest(request)).toEqual({
      ok: false,
      error: {
        code: "A001",
        message:
          'A001 Invalid apply-source-patch request at "/dryRun": hostile object.',
        field: "/dryRun",
        reason: "hostile-object",
      },
    });
    expect(getterCount).toBe(0);

    const record = {};
    for (const key of ["z", "a", "A"]) {
      Object.defineProperty(record, key, {
        enumerable: true,
        get: () => true,
      });
    }
    expect(
      detachAndFreezePlainJson("apply-source-patch", record),
    ).toMatchObject({
      ok: false,
      error: { field: "/A", reason: "hostile-object" },
    });
  });

  it("calls Reflect.ownKeys once and collapses symbol keys to the containing pointer", () => {
    const first = Symbol("first-secret");
    const second = Symbol("second-secret");
    const nested = {
      descendant: Number.NaN,
      [first]: true,
      [second]: false,
    };
    const ownKeyCounts = new Map<object, number>();
    const dependencies: PlainJsonDependencies = {
      ...plainJsonDependencies,
      ownKeys(value) {
        ownKeyCounts.set(value, (ownKeyCounts.get(value) ?? 0) + 1);
        return Reflect.ownKeys(value);
      },
    };
    const result = detachAndFreezePlainJson(
      "apply-source-patch",
      { nested },
      dependencies,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "A001",
        message:
          'A001 Invalid apply-source-patch request at "/nested": unsupported value.',
        field: "/nested",
        reason: "unsupported-value",
      },
    });
    expect(ownKeyCounts.get(nested)).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(
      detachAndFreezePlainJson(
        "apply-source-patch",
        { [first]: true },
        dependencies,
      ),
    ).toMatchObject({
      ok: false,
      error: { field: "", reason: "unsupported-value" },
    });
  });

  it("classifies array extra accessors as hostile without invoking them and data extras as unsupported", () => {
    let getterCalls = 0;
    const accessorExtra = [true] as unknown[];
    Object.defineProperty(accessorExtra, "extra", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    const accessorRequest = validPatchRequest();
    operationsOf(filesOf(accessorRequest)[0]!)[0]!.value = accessorExtra;
    expect(validateApplySourcePatchRequest(accessorRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/extra",
        reason: "hostile-object",
      },
    });
    expect(getterCalls).toBe(0);

    const dataExtra = [true] as unknown[] & { extra?: boolean };
    dataExtra.extra = true;
    const dataRequest = validPatchRequest();
    operationsOf(filesOf(dataRequest)[0]!)[0]!.value = dataExtra;
    expect(validateApplySourcePatchRequest(dataRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/extra",
        reason: "unsupported-value",
      },
    });
  });

  it("rejects accessors, non-enumerable keys, array extras, custom prototypes, and nested proxies", () => {
    let getterCount = 0;
    const accessorValue = {};
    Object.defineProperty(accessorValue, "secret", {
      enumerable: true,
      get() {
        getterCount += 1;
        return true;
      },
    });
    const accessorRequest = validPatchRequest();
    operationsOf(filesOf(accessorRequest)[0]!)[0]!.value = accessorValue;
    expect(validateApplySourcePatchRequest(accessorRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/secret",
        reason: "hostile-object",
      },
    });
    expect(getterCount).toBe(0);

    const hiddenValue = {};
    Object.defineProperty(hiddenValue, "hidden", {
      enumerable: false,
      value: true,
    });
    const hiddenRequest = validPatchRequest();
    operationsOf(filesOf(hiddenRequest)[0]!)[0]!.value = hiddenValue;
    expect(validateApplySourcePatchRequest(hiddenRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/hidden",
        reason: "unsupported-value",
      },
    });

    const arrayExtra = [true] as unknown[] & { extra?: boolean };
    arrayExtra.extra = true;
    const arrayRequest = validPatchRequest();
    operationsOf(filesOf(arrayRequest)[0]!)[0]!.value = arrayExtra;
    expect(validateApplySourcePatchRequest(arrayRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value/extra",
        reason: "unsupported-value",
      },
    });

    const customPrototypeRequest = validPatchRequest();
    operationsOf(filesOf(customPrototypeRequest)[0]!)[0]!.value = Object.create(
      { inherited: true },
    );
    expect(
      validateApplySourcePatchRequest(customPrototypeRequest),
    ).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value",
        reason: "unsupported-value",
      },
    });

    let proxyTrapCount = 0;
    const nestedProxy = new Proxy(
      {},
      {
        ownKeys() {
          proxyTrapCount += 1;
          return [];
        },
      },
    );
    const proxyRequest = validPatchRequest();
    operationsOf(filesOf(proxyRequest)[0]!)[0]!.value = nestedProxy;
    expect(validateApplySourcePatchRequest(proxyRequest)).toMatchObject({
      ok: false,
      error: {
        field: "/files/0/operations/0/value",
        reason: "hostile-object",
      },
    });
    expect(proxyTrapCount).toBe(0);
  });

  it("maps throwing prototype, key, and descriptor reflection to hostile-object", () => {
    const cases: readonly [Partial<PlainJsonDependencies>, string][] = [
      [
        {
          getPrototypeOf() {
            throw new Error("prototype");
          },
        },
        "",
      ],
      [
        {
          ownKeys() {
            throw new Error("keys");
          },
        },
        "",
      ],
      [
        {
          getOwnPropertyDescriptor() {
            throw new Error("descriptor");
          },
        },
        "/value",
      ],
    ];
    for (const [dependency, field] of cases) {
      const dependencies = {
        ...plainJsonDependencies,
        ...dependency,
      } as PlainJsonDependencies;
      expect(
        detachAndFreezePlainJson(
          "apply-source-patch",
          { value: true },
          dependencies,
        ),
      ).toMatchObject({
        ok: false,
        error: { field, reason: "hostile-object" },
      });
    }
  });

  it("returns a detached recursively frozen snapshot", () => {
    const request = validPatchRequest();
    const result = validateApplySourcePatchRequest(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(request);
    expect(result.value.files).not.toBe(request.files);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.files)).toBe(true);
    expect(Object.isFrozen(result.value.files[0])).toBe(true);
    expect(Object.isFrozen(result.value.files[0]!.operations)).toBe(true);
    expect(Object.isFrozen(result.value.files[0]!.operations[0]!.value)).toBe(
      true,
    );
  });
});

describe("D11 Layer 1 structural validation", () => {
  it("uses every generic structural reason at declaration-order pointers", () => {
    const cases: readonly [
      string,
      (request: MutablePatchRequest) => void,
      string,
      string,
    ][] = [
      [
        "missing format",
        (request) => delete request.format,
        "/format",
        "missing",
      ],
      [
        "wrong format type",
        (request) => (request.format = 1),
        "/format",
        "wrong-type",
      ],
      [
        "empty format",
        (request) => (request.format = ""),
        "/format",
        "empty-string",
      ],
      [
        "wrong format literal",
        (request) => (request.format = "wrong"),
        "/format",
        "unsupported-value",
      ],
      [
        "missing project",
        (request) => delete request.project,
        "/project",
        "missing",
      ],
      [
        "empty project",
        (request) => (request.project = ""),
        "/project",
        "empty-string",
      ],
      [
        "wrong patch format",
        (request) => (request.patchFormat = "wrong"),
        "/patchFormat",
        "unsupported-value",
      ],
      [
        "wrong dryRun",
        (request) => (request.dryRun = "true"),
        "/dryRun",
        "wrong-type",
      ],
      [
        "wrong files",
        (request) => (request.files = {}),
        "/files",
        "wrong-type",
      ],
      [
        "empty files",
        (request) => (request.files = []),
        "/files",
        "empty-array",
      ],
      [
        "wrong file",
        (request) => (request.files = [false]),
        "/files/0",
        "wrong-type",
      ],
      [
        "missing file path",
        (request) => delete filesOf(request)[0]!.path,
        "/files/0/path",
        "missing",
      ],
      [
        "empty file path",
        (request) => (filesOf(request)[0]!.path = ""),
        "/files/0/path",
        "empty-string",
      ],
      [
        "empty integrity",
        (request) => (filesOf(request)[0]!.expectedIntegrity = ""),
        "/files/0/expectedIntegrity",
        "empty-string",
      ],
      [
        "empty operations",
        (request) => (filesOf(request)[0]!.operations = []),
        "/files/0/operations",
        "empty-array",
      ],
      [
        "wrong operation",
        (request) => (filesOf(request)[0]!.operations = [false]),
        "/files/0/operations/0",
        "wrong-type",
      ],
      [
        "missing op",
        (request) => delete operationsOf(filesOf(request)[0]!)[0]!.op,
        "/files/0/operations/0/op",
        "missing",
      ],
      [
        "empty op",
        (request) => (operationsOf(filesOf(request)[0]!)[0]!.op = ""),
        "/files/0/operations/0/op",
        "empty-string",
      ],
      [
        "unknown op",
        (request) => (operationsOf(filesOf(request)[0]!)[0]!.op = "copy"),
        "/files/0/operations/0/op",
        "unsupported-value",
      ],
      [
        "wrong pointer",
        (request) => (operationsOf(filesOf(request)[0]!)[0]!.path = 1),
        "/files/0/operations/0/path",
        "wrong-type",
      ],
      [
        "missing value",
        (request) => delete operationsOf(filesOf(request)[0]!)[0]!.value,
        "/files/0/operations/0/value",
        "missing",
      ],
      [
        "operation extra",
        (request) => (operationsOf(filesOf(request)[0]!)[0]!.extra = true),
        "/files/0/operations/0/extra",
        "additional-property",
      ],
      [
        "file extra",
        (request) => (filesOf(request)[0]!.extra = true),
        "/files/0/extra",
        "additional-property",
      ],
      [
        "request extra",
        (request) => (request.extra = true),
        "/extra",
        "additional-property",
      ],
    ];
    for (const [name, mutate, field, reason] of cases) {
      const request = validPatchRequest();
      mutate(request);
      expect(validateApplySourcePatchRequest(request), name).toMatchObject({
        ok: false,
        error: { code: "A001", field, reason },
      });
    }
  });

  it("exempts only operation path from empty-string validation", () => {
    for (const op of ["test", "add", "remove", "replace"]) {
      const request = validPatchRequest();
      operationsOf(filesOf(request)[0]!)[0] =
        op === "remove" ? { op, path: "" } : { op, path: "", value: {} };
      expect(validateApplySourcePatchRequest(request), op).toMatchObject({
        ok: true,
      });
    }
  });

  it("rejects unknown, move, and copy at op before members and extras", () => {
    for (const op of ["unknown", "move", "copy"]) {
      const request = validPatchRequest();
      operationsOf(filesOf(request)[0]!)[0] = {
        op,
        from: 42,
        extra: true,
      };
      expect(validateApplySourcePatchRequest(request)).toEqual({
        ok: false,
        error: {
          code: "A001",
          message:
            'A001 Invalid apply-source-patch request at "/files/0/operations/0/op": unsupported value.',
          field: "/files/0/operations/0/op",
          reason: "unsupported-value",
        },
      });
    }
  });

  it("treats value on remove as an additional property after path", () => {
    const request = validPatchRequest();
    operationsOf(filesOf(request)[0]!)[0] = {
      op: "remove",
      path: "/present",
      value: true,
    };
    expect(validateApplySourcePatchRequest(request)).toEqual({
      ok: false,
      error: {
        code: "A001",
        message:
          'A001 Invalid apply-source-patch request at "/files/0/operations/0/value": additional property.',
        field: "/files/0/operations/0/value",
        reason: "additional-property",
      },
    });
  });
});

describe("D11 exhaustive wrong-literal inventory", () => {
  it("maps every non-empty wrong literal to unsupported-value", () => {
    const patchOp = validPatchRequest();
    operationsOf(filesOf(patchOp)[0]!)[0]!.op = "move";
    const cases: readonly [string, () => unknown, string, string][] = [
      [
        "outer format",
        () => validateValidateProjectRequest({ format: "wrong", project: "." }),
        "/format",
        "validate",
      ],
      [
        "resolve by",
        () =>
          validateResolveRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            target: { by: "alias", value: "x" },
          }),
        "/target/by",
        "resolve",
      ],
      [
        "inspect by",
        () =>
          validateInspectRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            selector: { by: "alias", value: "x" },
          }),
        "/selector/by",
        "inspect",
      ],
      [
        "query operation",
        () =>
          validateGraphQueryRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            query: {
              operation: "inspect",
              selector: { by: "uid", value: "x" },
            },
          }),
        "/query/operation",
        "query",
      ],
      [
        "query object by",
        () =>
          validateGraphQueryRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            query: {
              operation: "neighbors",
              selector: { by: "alias", value: "x" },
            },
          }),
        "/query/selector/by",
        "query",
      ],
      [
        "query terminal by",
        () =>
          validateGraphQueryRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            query: { operation: "net", selector: { by: "uid", value: "x" } },
          }),
        "/query/selector/by",
        "query",
      ],
      [
        "spec format",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/9",
              root: { by: "uid", value: "x" },
            },
          }),
        "/spec/format",
        "create-view",
      ],
      [
        "family",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/0.1",
              family: "signal",
              root: { by: "uid", value: "x" },
            },
          }),
        "/spec/family",
        "create-view",
      ],
      [
        "flow",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/0.1",
              family: "control",
              root: { by: "uid", value: "x" },
              flow: "diagonal",
            },
          }),
        "/spec/flow",
        "create-view",
      ],
      [
        "view root by",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/0.2",
              root: { by: "alias", value: "x" },
              intent: { kind: "loads" },
            },
          }),
        "/spec/root/by",
        "create-view",
      ],
      [
        "intent kind",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/0.2",
              root: { by: "uid", value: "x" },
              intent: { kind: "path" },
            },
          }),
        "/spec/intent/kind",
        "create-view",
      ],
      [
        "trace to by",
        () =>
          validateCreateViewRequest({
            format: "agent-tool-request/0.1",
            project: ".",
            spec: {
              format: "schematic-view-request/0.2",
              root: { by: "uid", value: "x" },
              intent: {
                kind: "trace",
                to: { by: "alias", value: "y" },
                includePower: true,
              },
            },
          }),
        "/spec/intent/to/by",
        "create-view",
      ],
      [
        "patch format",
        () =>
          validateApplySourcePatchRequest({
            ...validPatchRequest(),
            patchFormat: "wrong",
          }),
        "/patchFormat",
        "apply-source-patch",
      ],
      [
        "patch op",
        () => validateApplySourcePatchRequest(patchOp),
        "/files/0/operations/0/op",
        "apply-source-patch",
      ],
    ];
    for (const [name, validate, field, tool] of cases) {
      expect(validate(), name).toEqual({
        ok: false,
        error: {
          code: "A001",
          message:
            "A001 Invalid " +
            tool +
            " request at " +
            JSON.stringify(field) +
            ": unsupported value.",
          field,
          reason: "unsupported-value",
        },
      });
    }
  });
});

describe("D11 Layer 2a grammar and precedence", () => {
  it("accepts exactly the portable source-target grammar", () => {
    for (const path of [
      "equipment.json",
      "devices/equipment.json",
      "space name/source.json",
      "é/源.json",
    ]) {
      expect(isPortableSourcePatchPath(path), path).toBe(true);
    }
    for (const path of [
      "",
      "/absolute.json",
      "//server/share.json",
      "C:relative.json",
      "C:/absolute.json",
      "C:\\absolute.json",
      "\\\\server\\share.json",
      "\\\\?\\C:\\device.json",
      "devices\\equipment.json",
      "devices//equipment.json",
      "devices/./equipment.json",
      "devices/../equipment.json",
      "devices/",
      "devices/" + String.fromCharCode(0) + ".json",
      "devices/" + String.fromCharCode(31) + ".json",
      "devices/" + String.fromCharCode(127) + ".json",
      "devices/" + String.fromCharCode(159) + ".json",
    ]) {
      expect(isPortableSourcePatchPath(path), JSON.stringify(path)).toBe(false);
    }
  });

  it("accepts only canonical standard-padded SHA-256 integrity", () => {
    expect(isCanonicalFileIntegrity(BASE_INTEGRITY)).toBe(true);
    for (const integrity of [
      "",
      BASE_INTEGRITY.slice("sha256-".length),
      "sha512-" + BASE_INTEGRITY.slice("sha256-".length),
      BASE_INTEGRITY.replace(/=$/u, ""),
      "sha256-_" + BASE_INTEGRITY.slice("sha256-".length + 1),
      "sha256-AAAA=",
      "sha256-" + "A".repeat(44),
      BASE_INTEGRITY + "extra",
    ]) {
      expect(isCanonicalFileIntegrity(integrity), integrity).toBe(false);
    }
  });

  it("parses RFC 6901 escapes and rejects every other tilde sequence", () => {
    expect(parseJsonPointer("")).toEqual({ ok: true, tokens: [] });
    expect(parseJsonPointer("/")).toEqual({ ok: true, tokens: [""] });
    expect(parseJsonPointer("/a~1b/m~0n/~01")).toEqual({
      ok: true,
      tokens: ["a/b", "m~n", "~1"],
    });
    expect(parseJsonPointer("/line\nbreak")).toEqual({
      ok: true,
      tokens: ["line\nbreak"],
    });
    for (const pointer of ["a", "~", "/~", "/~2", "/a~~0", "/a~x"]) {
      expect(parseJsonPointer(pointer), pointer).toEqual({ ok: false });
    }
  });

  it("returns exact Layer-2a descriptors in document order", () => {
    const invalidPath = validPatchRequest();
    filesOf(invalidPath)[0]!.path = "bad/../path.json";
    filesOf(invalidPath)[0]!.expectedIntegrity = "bad";
    expect(validateApplySourcePatchRequest(invalidPath)).toEqual({
      ok: false,
      error: {
        code: "A003",
        message:
          'A003 Unsafe source patch target "<patch-target>": invalid path.',
        file: "<patch-target>",
        reason: "invalid-path",
      },
    });

    const invalidIntegrity = validPatchRequest();
    filesOf(invalidIntegrity)[0]!.expectedIntegrity = "sha256-bad";
    operationsOf(filesOf(invalidIntegrity)[0]!)[0]!.path = "/bad~2";
    expect(validateApplySourcePatchRequest(invalidIntegrity)).toEqual({
      ok: false,
      error: {
        code: "A001",
        message:
          'A001 Invalid apply-source-patch request at "/files/0/expectedIntegrity": invalid integrity.',
        field: "/files/0/expectedIntegrity",
        reason: "invalid-integrity",
      },
    });

    const invalidPointer = validPatchRequest();
    operationsOf(filesOf(invalidPointer)[0]!)[0]!.path = '/bad~2/"line\n';
    expect(validateApplySourcePatchRequest(invalidPointer)).toEqual({
      ok: false,
      error: {
        code: "A002",
        message:
          'A002 Source patch failed for "devices/equipment.json" operation 0 at "/bad~2/\\"line\\n": invalid pointer.',
        file: "devices/equipment.json",
        operationIndex: 0,
        path: '/bad~2/"line\n',
        reason: "invalid-pointer",
      },
    });

    const duplicate = validPatchRequest();
    filesOf(duplicate).push(structuredClone(filesOf(duplicate)[0]!));
    expect(validateApplySourcePatchRequest(duplicate)).toEqual({
      ok: false,
      error: {
        code: "A003",
        message:
          'A003 Unsafe source patch target "devices/equipment.json": duplicate file.',
        file: "devices/equipment.json",
        reason: "duplicate-file",
      },
    });
  });

  it("locks the nine precedence-ladder rows as literal cases", () => {
    const rows: readonly [
      string,
      () => unknown,
      { code: string; field?: string; file?: string; reason: string },
    ][] = [
      [
        "Layer 0 before Layer 1",
        () => {
          const request = validPatchRequest();
          request.format = "wrong";
          Object.defineProperty(request, "dryRun", {
            enumerable: true,
            get: () => true,
          });
          return request;
        },
        { code: "A001", field: "/dryRun", reason: "hostile-object" },
      ],
      [
        "format before 2a path",
        () => {
          const request = validPatchRequest();
          request.format = "wrong";
          filesOf(request)[0]!.path = "../bad.json";
          return request;
        },
        { code: "A001", field: "/format", reason: "unsupported-value" },
      ],
      [
        "empty path before integrity grammar",
        () => {
          const request = validPatchRequest();
          filesOf(request)[0]!.path = "";
          filesOf(request)[0]!.expectedIntegrity = "bad";
          return request;
        },
        { code: "A001", field: "/files/0/path", reason: "empty-string" },
      ],
      [
        "empty integrity before pointer grammar",
        () => {
          const request = validPatchRequest();
          filesOf(request)[0]!.expectedIntegrity = "";
          operationsOf(filesOf(request)[0]!)[0]!.path = "/bad~2";
          return request;
        },
        {
          code: "A001",
          field: "/files/0/expectedIntegrity",
          reason: "empty-string",
        },
      ],
      [
        "unknown op before variant members",
        () => {
          const request = validPatchRequest();
          operationsOf(filesOf(request)[0]!)[0] = { op: "copy", extra: true };
          return request;
        },
        {
          code: "A001",
          field: "/files/0/operations/0/op",
          reason: "unsupported-value",
        },
      ],
      [
        "2a path before integrity",
        () => {
          const request = validPatchRequest();
          filesOf(request)[0]!.path = "../bad.json";
          filesOf(request)[0]!.expectedIntegrity = "bad";
          return request;
        },
        { code: "A003", file: "<patch-target>", reason: "invalid-path" },
      ],
      [
        "2a integrity before pointer",
        () => {
          const request = validPatchRequest();
          filesOf(request)[0]!.expectedIntegrity = "bad";
          operationsOf(filesOf(request)[0]!)[0]!.path = "/bad~2";
          return request;
        },
        {
          code: "A001",
          field: "/files/0/expectedIntegrity",
          reason: "invalid-integrity",
        },
      ],
      [
        "2a file-0 pointer before file-1 duplicate",
        () => {
          const request = validPatchRequest();
          operationsOf(filesOf(request)[0]!)[0]!.path = "/bad~2";
          filesOf(request).push(structuredClone(filesOf(request)[0]!));
          return request;
        },
        {
          code: "A002",
          file: "devices/equipment.json",
          reason: "invalid-pointer",
        },
      ],
      [
        "worked round-4 file-1 path before file-0 later mismatch",
        () => {
          const request = validPatchRequest();
          filesOf(request)[0]!.expectedIntegrity = computeFileIntegrity(
            Buffer.from("stale", "utf8"),
          );
          filesOf(request).push({
            path: "../bad.json",
            expectedIntegrity: BASE_INTEGRITY,
            operations: [{ op: "test", path: "", value: {} }],
          });
          return request;
        },
        { code: "A003", file: "<patch-target>", reason: "invalid-path" },
      ],
    ];
    for (const [name, request, expected] of rows) {
      expect(validateApplySourcePatchRequest(request()), name).toMatchObject({
        ok: false,
        error: expected,
      });
    }
  });
});

describe("A-code messages and the E001 sanitizer", () => {
  it("JSON-quotes all A001-A004 placeholders exactly once", () => {
    expect(
      createA001Error(
        "apply-source-patch",
        '/field/"quote\\slash\n',
        "unsupported-value",
      ).message,
    ).toBe(
      'A001 Invalid apply-source-patch request at "/field/\\"quote\\\\slash\\n": unsupported value.',
    );
    expect(
      createA002Error(
        'connections/a"b\\c.json',
        7,
        '/path/"quote\\slash\n',
        "missing-target",
      ).message,
    ).toBe(
      'A002 Source patch failed for "connections/a\\"b\\\\c.json" operation 7 at "/path/\\"quote\\\\slash\\n": missing target.',
    );
    expect(
      createA003Error('connections/a"b\\c.json', "not-project-source").message,
    ).toBe(
      'A003 Unsafe source patch target "connections/a\\"b\\\\c.json": not project source.',
    );
    expect(
      createA004Error(
        'connections/a"b\\c.json',
        "sha256-expected=",
        "sha256-actual=",
      ).message,
    ).toBe(
      'A004 Guarded file "connections/a\\"b\\\\c.json" does not match its required integrity.',
    );
  });

  it("is proxy-first, trap-free, descriptor-only, and closed-code", () => {
    let trapCount = 0;
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          trapCount += 1;
          return {
            configurable: true,
            enumerable: true,
            value: trapCount % 2 === 0 ? "EVEN" : "ODD",
            writable: true,
          };
        },
      },
    );
    expect(sanitizedErrorCode(proxy)).toBe("UNKNOWN");
    expect(trapCount).toBe(0);

    for (const primitive of [
      null,
      undefined,
      false,
      0,
      "EACCES",
      1n,
      Symbol("EACCES"),
    ]) {
      expect(sanitizedErrorCode(primitive)).toBe("UNKNOWN");
    }

    let getterCount = 0;
    const accessor = {};
    Object.defineProperty(accessor, "code", {
      get() {
        getterCount += 1;
        return "EACCES";
      },
    });
    expect(sanitizedErrorCode(accessor)).toBe("UNKNOWN");
    expect(getterCount).toBe(0);

    for (const code of [
      "",
      "lower",
      "1BAD",
      "BAD-DASH",
      "E" + "A".repeat(32),
    ]) {
      expect(sanitizedErrorCode({ code }), code).toBe("UNKNOWN");
    }
    for (const code of ["A", "EACCES", "ERR_FS_EISDIR", "E" + "A".repeat(31)]) {
      expect(sanitizedErrorCode({ code }), code).toBe(code);
    }

    let descriptorCalls = 0;
    const throwing: ErrorSanitizerDependencies = {
      ...errorSanitizerDependencies,
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error("must not escape");
      },
    };
    expect(sanitizedErrorCode({}, throwing)).toBe("UNKNOWN");
    expect(descriptorCalls).toBe(1);

    const order: string[] = [];
    const proxyFirst: ErrorSanitizerDependencies = {
      isProxy() {
        order.push("isProxy");
        return true;
      },
      getOwnPropertyDescriptor() {
        order.push("descriptor");
        throw new Error("must not run");
      },
    };
    expect(sanitizedErrorCode({}, proxyFirst)).toBe("UNKNOWN");
    expect(order).toEqual(["isProxy"]);
    expect(sanitizedErrorDetail("stage-write", { code: "EACCES" })).toBe(
      "stage-write/EACCES",
    );
  });
});
