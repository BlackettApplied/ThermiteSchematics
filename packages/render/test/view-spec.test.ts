import type { ElectricalIr } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it } from "vitest";

import type { InvalidViewRequestError } from "../src/errors.js";
import {
  classifyRuntimeInput,
  normalizeSchematicView,
} from "../src/view-spec.js";
import { compileCoreFixture } from "./fixtures.js";

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

const validRequest = {
  format: "schematic-view-request/0.1",
  root: { by: "designation", value: "K1" },
  family: "control",
} as const;

const validTraceRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "LS1" },
  intent: {
    kind: "trace",
    to: { by: "designation", value: "PLC1" },
    includePower: true,
  },
} as const;

const validConductorsRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "CBL1" },
  intent: { kind: "conductors" },
} as const;

const validLoadsRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
} as const;

function errorFor(request: unknown): InvalidViewRequestError {
  const result = normalizeSchematicView(coreIr, request, {
    queryEngineFactory: () => {
      throw new Error("Malformed requests must not construct query.");
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok || result.error.code !== "R001") {
    throw new Error("Expected R001.");
  }
  return result.error;
}

function revokedProxy(): object {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  return revocable.proxy;
}

describe("schematic view request normalization", () => {
  it("normalizes designation and UID roots with default and explicit flow", () => {
    let constructions = 0;
    const first = normalizeSchematicView(coreIr, validRequest, {
      queryEngineFactory: (ir) => {
        constructions++;
        return createQueryEngine(ir);
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.view).toEqual({
      format: "schematic-view/0.1",
      family: "control",
      root: {
        deviceUid: first.value.rootDevice.uid,
        designation: "K1",
      },
      flow: "left-to-right",
    });

    const second = normalizeSchematicView(coreIr, {
      ...validRequest,
      root: { by: "uid", value: first.value.rootDevice.uid },
      flow: "top-to-bottom",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.view.flow).toBe("top-to-bottom");
    expect(constructions).toBe(1);
  });

  it.each([null, [], true, 1, 1n, Symbol("request"), "request", undefined])(
    "totally rejects a non-record request %#",
    (request) => {
      expect(errorFor(request)).toEqual({
        code: "R001",
        message: "Invalid request: expected an object.",
        requestedFormat: { kind: "missing" },
        requestedRoot: { kind: "missing" },
        requestedFamily: { kind: "missing" },
        requestedFlow: { kind: "missing" },
        root: "<missing>",
      });
    },
  );

  it.each([
    ["missing", {}, { kind: "missing" }, "missing"],
    ["undefined", { format: undefined }, { kind: "missing" }, "missing"],
    [
      "number",
      { format: 1 },
      { kind: "non-string", inputType: "number" },
      "number",
    ],
    [
      "wrong",
      { format: "wrong" },
      { kind: "string", value: "wrong" },
      "'wrong'",
    ],
  ] as const)(
    "reports invalid format: %s",
    (name, override, descriptor, received) => {
      const request = { ...validRequest, ...override } as Record<
        string,
        unknown
      >;
      if (name === "missing") delete request.format;
      const error = errorFor(request);
      expect(error.requestedFormat).toEqual(descriptor);
      expect(error.message).toBe(
        `Invalid format: expected schematic-view-request/0.1; received ${received}.`,
      );
      expect(error.root).toBe("K1");
      expect("family" in error).toBe(false);
    },
  );

  it.each([
    ["missing", {}, { kind: "missing" }, "<missing>"],
    ["undefined", { root: undefined }, { kind: "missing" }, "<missing>"],
    [
      "string",
      { root: "K1" },
      { kind: "non-object", inputType: "string" },
      "<invalid-root:string>",
    ],
    [
      "null",
      { root: null },
      { kind: "non-object", inputType: "null" },
      "<invalid-root:null>",
    ],
    [
      "array",
      { root: [] },
      { kind: "non-object", inputType: "array" },
      "<invalid-root:array>",
    ],
  ] as const)(
    "reports invalid root value: %s",
    (name, override, descriptor, root) => {
      const request = { ...validRequest, ...override } as Record<
        string,
        unknown
      >;
      if (name === "missing") delete request.root;
      const error = errorFor(request);
      expect(error.requestedRoot).toEqual(descriptor);
      expect(error.root).toBe(root);
      expect(error.message).toBe(
        "Invalid root: expected { by: 'uid' | 'designation', value: string }.",
      );
    },
  );

  it.each([
    [{ value: "K1" }, { kind: "missing" }],
    [{ by: undefined, value: "K1" }, { kind: "missing" }],
    [
      { by: 1, value: "K1" },
      { kind: "non-string", inputType: "number" },
    ],
    [
      { by: "id", value: "K1" },
      { kind: "string", value: "id" },
    ],
  ] as const)("describes malformed root.by %#", (root, by) => {
    const error = errorFor({ ...validRequest, root });
    expect(error.requestedRoot).toEqual({
      kind: "malformed-selector",
      by,
      value: { kind: "string", value: "K1" },
    });
    expect(error.root).toBe("<invalid-root-selector>");
  });

  it.each([
    [{ by: "designation" }, { kind: "missing" }],
    [{ by: "designation", value: undefined }, { kind: "missing" }],
    [
      { by: "designation", value: false },
      { kind: "non-string", inputType: "boolean" },
    ],
  ] as const)("describes malformed root.value %#", (root, value) => {
    const error = errorFor({ ...validRequest, root });
    expect(error.requestedRoot).toEqual({
      kind: "malformed-selector",
      by: { kind: "string", value: "designation" },
      value,
    });
  });

  it.each([
    ["missing", {}, { kind: "missing" }, "missing"],
    ["undefined", { family: undefined }, { kind: "missing" }, "missing"],
    [
      "object",
      { family: {} },
      { kind: "non-string", inputType: "object" },
      "object",
    ],
    [
      "wrong",
      { family: "bogus" },
      { kind: "string", value: "bogus" },
      "'bogus'",
    ],
  ] as const)(
    "reports invalid family: %s",
    (name, override, descriptor, received) => {
      const request = { ...validRequest, ...override } as Record<
        string,
        unknown
      >;
      if (name === "missing") delete request.family;
      const error = errorFor(request);
      expect(error.requestedFamily).toEqual(descriptor);
      expect(error.message).toBe(
        `Invalid family: expected control or power; received ${received}.`,
      );
      expect(error.root).toBe("K1");
      expect("family" in error).toBe(false);
    },
  );

  it.each([
    [undefined, { kind: "missing" }],
    [1, { kind: "non-string", inputType: "number" }],
    ["diagonal", { kind: "string", value: "diagonal" }],
  ] as const)("handles flow value %#", (flow, descriptor) => {
    const error =
      flow === undefined ? undefined : errorFor({ ...validRequest, flow });
    if (flow === undefined) {
      const normalized = normalizeSchematicView(coreIr, {
        ...validRequest,
        flow,
      });
      expect(normalized.ok).toBe(true);
      if (normalized.ok)
        expect(normalized.value.view.flow).toBe("left-to-right");
    } else {
      expect(error!.requestedFlow).toEqual(descriptor);
      expect(error!.message).toContain("Invalid flow:");
    }
  });

  it("returns Q001 unchanged only after request validation", () => {
    const result = normalizeSchematicView(coreIr, {
      ...validRequest,
      root: { by: "designation", value: "UNKNOWN" },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "Q001",
        message: 'No project object has designation "UNKNOWN".',
        input: "UNKNOWN",
      },
    });
  });

  it("returns R001 for non-device and family-incompatible roots", () => {
    const wire = coreIr.wires[0]!;
    const nonDevice = normalizeSchematicView(coreIr, {
      ...validRequest,
      root: { by: "uid", value: wire.uid },
    });
    expect(nonDevice.ok).toBe(false);
    if (!nonDevice.ok) {
      expect(nonDevice.error).toMatchObject({
        code: "R001",
        family: "control",
        root: wire.uid,
      });
      expect("deviceUid" in nonDevice.error).toBe(false);
    }

    const incompatible = normalizeSchematicView(coreIr, {
      ...validRequest,
      family: "power",
    });
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.error).toMatchObject({
        code: "R001",
        family: "power",
        deviceUid: coreIr.devices.find(
          ({ designation }) => designation === "K1",
        )!.uid,
        root: "K1",
      });
    }
  });

  it("freezes the representative R001 JSON shapes and declaration order", () => {
    expect(JSON.stringify(errorFor(null))).toBe(
      '{"code":"R001","message":"Invalid request: expected an object.","requestedFormat":{"kind":"missing"},"requestedRoot":{"kind":"missing"},"requestedFamily":{"kind":"missing"},"requestedFlow":{"kind":"missing"},"root":"<missing>"}',
    );
    expect(
      JSON.stringify(
        errorFor({
          root: { by: "designation", value: "K1" },
          family: "control",
        }),
      ),
    ).toBe(
      '{"code":"R001","message":"Invalid format: expected schematic-view-request/0.1; received missing.","requestedFormat":{"kind":"missing"},"requestedRoot":{"kind":"selector","by":"designation","value":"K1"},"requestedFamily":{"kind":"string","value":"control"},"requestedFlow":{"kind":"missing"},"root":"K1"}',
    );
    expect(
      JSON.stringify(
        errorFor({ ...validRequest, root: { by: "id", value: "K1" } }),
      ),
    ).toBe(
      '{"code":"R001","message":"Invalid root: expected { by: \'uid\' | \'designation\', value: string }.","requestedFormat":{"kind":"string","value":"schematic-view-request/0.1"},"requestedRoot":{"kind":"malformed-selector","by":{"kind":"string","value":"id"},"value":{"kind":"string","value":"K1"}},"requestedFamily":{"kind":"string","value":"control"},"requestedFlow":{"kind":"missing"},"root":"<invalid-root-selector>"}',
    );
  });
});

describe("descriptor-only hostile request inspection", () => {
  it("never invokes accessors and reports every outer accessor at its stage", () => {
    for (const key of ["format", "root", "family", "flow"] as const) {
      let getterCalls = 0;
      const request = { ...validRequest } as Record<string, unknown>;
      Object.defineProperty(request, key, {
        enumerable: true,
        get() {
          getterCalls++;
          return validRequest[key];
        },
      });
      const error = errorFor(request);
      expect(getterCalls).toBe(0);
      expect(
        error[
          `requested${key[0]!.toUpperCase()}${key.slice(1)}` as keyof InvalidViewRequestError
        ],
      ).toEqual({
        kind: "uninspectable",
      });
    }
  });

  it("catches a revoked top-level Proxy with all descriptors uninspectable", () => {
    const error = errorFor(revokedProxy());
    expect(error).toEqual({
      code: "R001",
      message: "Invalid request: unable to inspect object.",
      requestedFormat: { kind: "uninspectable" },
      requestedRoot: { kind: "uninspectable" },
      requestedFamily: { kind: "uninspectable" },
      requestedFlow: { kind: "uninspectable" },
      root: "<uninspectable-request>",
    });
  });

  it.each(["format", "root", "family", "flow"] as const)(
    "catches an outer %s descriptor trap while still snapshotting later keys",
    (failingKey) => {
      const snapshots: PropertyKey[] = [];
      const request = new Proxy(validRequest, {
        getOwnPropertyDescriptor(target, key) {
          snapshots.push(key);
          if (key === failingKey) throw new Error("trap");
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const error = errorFor(request);
      expect(snapshots).toEqual(["format", "root", "family", "flow"]);
      expect(
        error[
          `requested${failingKey[0]!.toUpperCase()}${failingKey.slice(1)}` as keyof InvalidViewRequestError
        ],
      ).toEqual({
        kind: "uninspectable",
      });
    },
  );

  it.each(["by", "value"] as const)(
    "never invokes and catches root.%s accessor/trap states",
    (key) => {
      let getterCalls = 0;
      const root: Record<string, unknown> = {
        by: "designation",
        value: "K1",
      };
      Object.defineProperty(root, key, {
        get() {
          getterCalls++;
          return key === "by" ? "designation" : "K1";
        },
      });
      const accessorError = errorFor({ ...validRequest, root });
      expect(getterCalls).toBe(0);
      expect(accessorError.requestedRoot).toMatchObject({
        kind: "malformed-selector",
        [key]: { kind: "uninspectable" },
      });

      const trappedRoot = new Proxy(validRequest.root, {
        getOwnPropertyDescriptor(target, property) {
          if (property === key) throw new Error("trap");
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      expect(
        errorFor({ ...validRequest, root: trappedRoot }).requestedRoot,
      ).toMatchObject({
        kind: "malformed-selector",
        [key]: { kind: "uninspectable" },
      });
    },
  );

  it.each([
    ["format", (proxy: object) => ({ ...validRequest, format: proxy })],
    ["family", (proxy: object) => ({ ...validRequest, family: proxy })],
    ["flow", (proxy: object) => ({ ...validRequest, flow: proxy })],
    [
      "root.by",
      (proxy: object) => ({
        ...validRequest,
        root: { by: proxy, value: "K1" },
      }),
    ],
    [
      "root.value",
      (proxy: object) => ({
        ...validRequest,
        root: { by: "designation", value: proxy },
      }),
    ],
    ["root", (proxy: object) => ({ ...validRequest, root: proxy })],
  ] as const)(
    "catches a revoked Proxy stored as data at %s",
    (position, make) => {
      const error = errorFor(make(revokedProxy()));
      if (position === "root") {
        expect(error.requestedRoot).toEqual({ kind: "uninspectable" });
        expect(error.root).toBe("<uninspectable-root>");
      } else if (position.startsWith("root.")) {
        expect(error.requestedRoot).toMatchObject({
          kind: "malformed-selector",
          [position.slice(5)]: { kind: "uninspectable" },
        });
        expect(error.root).toBe("<invalid-root-selector>");
      } else {
        const field =
          `requested${position[0]!.toUpperCase()}${position.slice(1)}` as keyof InvalidViewRequestError;
        expect(error[field]).toEqual({ kind: "uninspectable" });
      }
    },
  );

  it("uses the frozen snapshot and caught-classifier order exactly once", () => {
    const events: string[] = [];
    const rootTarget = { by: "designation", value: "K1" };
    const root = new Proxy(rootTarget, {
      getOwnPropertyDescriptor(target, key) {
        events.push(`snapshot-root:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const requestTarget = { ...validRequest, root };
    const request = new Proxy(requestTarget, {
      getOwnPropertyDescriptor(target, key) {
        events.push(`snapshot-request:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const labels = new Map<unknown, string>([
      [request, "request"],
      [requestTarget.format, "format"],
      [root, "root"],
      [requestTarget.family, "family"],
      [undefined, "flow"],
      [rootTarget.by, "by"],
      [rootTarget.value, "value"],
    ]);
    const original = Array.isArray;
    Array.isArray = ((value: unknown) => {
      events.push(`classify:${labels.get(value) ?? "unknown"}`);
      return original(value);
    }) as typeof Array.isArray;
    try {
      const result = normalizeSchematicView(coreIr, request);
      expect(result.ok).toBe(true);
    } finally {
      Array.isArray = original;
    }
    expect(events).toEqual([
      "classify:request",
      "snapshot-request:format",
      "snapshot-request:root",
      "snapshot-request:family",
      "snapshot-request:flow",
      "classify:format",
      "classify:root",
      "classify:family",
      "snapshot-root:by",
      "snapshot-root:value",
      "classify:by",
      "classify:value",
    ]);
  });

  it("keeps earlier validation precedence over later snapshot and classification failures", () => {
    const laterTrap = (stage: "root" | "family" | "flow") =>
      new Proxy(
        { ...validRequest, format: "bad" },
        {
          getOwnPropertyDescriptor(target, key) {
            if (key === stage) throw new Error("later");
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
    for (const stage of ["root", "family", "flow"] as const) {
      expect(errorFor(laterTrap(stage)).message).toContain("Invalid format:");
    }
    expect(
      errorFor({ ...validRequest, format: "bad", family: revokedProxy() })
        .message,
    ).toContain("Invalid format:");
    expect(
      errorFor({
        ...validRequest,
        root: { by: "id", value: "K1" },
        family: revokedProxy(),
      }).message,
    ).toContain("Invalid root:");
    expect(
      errorFor({ ...validRequest, family: "bad", flow: revokedProxy() })
        .message,
    ).toContain("Invalid family:");
  });

  it("classifies revoked Proxy values without leaking Array.isArray", () => {
    expect(classifyRuntimeInput(revokedProxy())).toEqual({
      kind: "uninspectable",
    });
  });
});

describe("schematic-view-request/0.2 normalization", () => {
  it.each([
    [
      "trace",
      validTraceRequest,
      {
        format: "schematic-view/0.2",
        family: "control",
        intent: "trace",
        root: {
          kind: "device",
          designation: "LS1",
        },
        target: { designation: "PLC1" },
        includePower: true,
        flow: "left-to-right",
      },
    ],
    [
      "conductors",
      { ...validConductorsRequest, flow: "top-to-bottom" },
      {
        format: "schematic-view/0.2",
        family: "control",
        intent: "conductors",
        root: {
          kind: "cable",
          designation: "CBL1",
        },
        flow: "top-to-bottom",
      },
    ],
    [
      "loads",
      validLoadsRequest,
      {
        format: "schematic-view/0.2",
        family: "control",
        intent: "loads",
        root: {
          kind: "device",
          designation: "PS1",
        },
        flow: "left-to-right",
      },
    ],
  ] as const)(
    "normalizes the exact %s structure after constructing one query engine",
    (_name, request, expected) => {
      let constructions = 0;
      const result = normalizeSchematicView(coreIr, request, {
        queryEngineFactory: (ir) => {
          constructions++;
          return createQueryEngine(ir);
        },
      });
      expect(constructions).toBe(1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.view).toMatchObject(expected);
      expect(Object.keys(result.value.view)).toEqual(
        expected.intent === "trace"
          ? [
              "format",
              "family",
              "intent",
              "root",
              "target",
              "includePower",
              "flow",
            ]
          : ["format", "family", "intent", "root", "flow"],
      );
      expect(Object.isFrozen(result.value.view)).toBe(true);
      expect(Object.isFrozen(result.value.view.root)).toBe(true);
    },
  );

  it.each([
    ["missing", {}, { kind: "missing" }, "Invalid intent: expected an object."],
    [
      "undefined",
      { intent: undefined },
      { kind: "missing" },
      "Invalid intent: expected an object.",
    ],
    [
      "string",
      { intent: "trace" },
      { kind: "non-object", inputType: "string" },
      "Invalid intent: expected an object.",
    ],
    [
      "null",
      { intent: null },
      { kind: "non-object", inputType: "null" },
      "Invalid intent: expected an object.",
    ],
    [
      "array",
      { intent: [] },
      { kind: "non-object", inputType: "array" },
      "Invalid intent: expected an object.",
    ],
  ] as const)(
    "rejects %s intent values without constructing query",
    (name, override, descriptor, message) => {
      const request = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        ...override,
      } as Record<string, unknown>;
      if (name === "missing") delete request.intent;
      const error = errorFor(request);
      expect(error.requestedIntent).toEqual(descriptor);
      expect(error.requestedFamily).toEqual({ kind: "missing" });
      expect(error.message).toBe(message);
    },
  );

  it.each([
    ["missing", {}, { kind: "missing" }, "missing"],
    ["undefined", { kind: undefined }, { kind: "missing" }, "missing"],
    [
      "number",
      { kind: 1 },
      { kind: "non-string", inputType: "number" },
      "number",
    ],
    [
      "unknown",
      { kind: "unknown" },
      { kind: "string", value: "unknown" },
      "'unknown'",
    ],
  ] as const)(
    "rejects %s intent.kind with the closed descriptor",
    (name, intent, intentKind, received) => {
      const error = errorFor({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent,
      });
      expect(error.requestedIntent).toEqual({
        kind: "malformed-intent",
        intentKind,
      });
      expect(error.message).toBe(
        `Invalid intent kind: expected trace, conductors, or loads; received ${received}.`,
      );
    },
  );

  it.each(["conductors", "loads"] as const)(
    "rejects own forbidden %s fields in to-before-includePower order",
    (kind) => {
      const both = errorFor({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: kind === "loads" ? "PS1" : "CBL1" },
        intent: { kind, to: undefined, includePower: undefined },
      });
      expect(both.message).toBe(
        `Invalid ${kind} intent: property 'to' is not allowed.`,
      );
      expect(both.requestedTarget).toEqual({ kind: "missing" });
      expect(both.requestedIncludePower).toEqual({ kind: "missing" });
      expect(Object.keys(both)).toEqual([
        "code",
        "message",
        "requestedFormat",
        "requestedRoot",
        "requestedFamily",
        "requestedIntent",
        "requestedTarget",
        "requestedIncludePower",
        "requestedFlow",
        "family",
        "root",
      ]);

      const inherited = Object.create({
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      }) as Record<string, unknown>;
      inherited.kind = kind;
      const accepted = normalizeSchematicView(coreIr, {
        format: "schematic-view-request/0.2",
        root: {
          by: "designation",
          value: kind === "loads" ? "PS1" : "CBL1",
        },
        intent: inherited,
      });
      expect(accepted.ok).toBe(true);
    },
  );

  it.each([
    ["conductors", "to"],
    ["conductors", "includePower"],
    ["loads", "to"],
    ["loads", "includePower"],
  ] as const)("rejects %s own %s by presence", (kind, field) => {
    const intent: Record<string, unknown> = { kind };
    intent[field] = undefined;
    const error = errorFor({
      format: "schematic-view-request/0.2",
      root: {
        by: "designation",
        value: kind === "loads" ? "PS1" : "CBL1",
      },
      intent,
    });
    expect(error.message).toBe(
      `Invalid ${kind} intent: property '${field}' is not allowed.`,
    );
  });

  it.each([
    [undefined, { kind: "missing" }],
    [false, { kind: "non-string", inputType: "boolean" }],
    ["diagonal", { kind: "string", value: "diagonal" }],
  ] as const)(
    "validates v0.2 flow after the complete intent %#",
    (flow, descriptor) => {
      const request = { ...validLoadsRequest, flow };
      if (flow === undefined) {
        const result = normalizeSchematicView(coreIr, request);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.view.flow).toBe("left-to-right");
        return;
      }
      const error = errorFor(request);
      expect(error.requestedFlow).toEqual(descriptor);
      expect(error.message).toContain("Invalid flow:");
    },
  );

  it.each([
    [
      "target missing",
      { kind: "trace", includePower: true },
      "Invalid trace target: expected { by: 'uid' | 'designation', value: string }.",
      { kind: "missing" },
    ],
    [
      "target malformed",
      { kind: "trace", to: { by: "name", value: "PLC1" }, includePower: true },
      "Invalid trace target: expected { by: 'uid' | 'designation', value: string }.",
      {
        kind: "malformed-selector",
        by: { kind: "string", value: "name" },
        value: { kind: "string", value: "PLC1" },
      },
    ],
    [
      "boolean missing",
      { kind: "trace", to: { by: "designation", value: "PLC1" } },
      "Invalid trace includePower: expected boolean; received missing.",
      { kind: "selector", by: "designation", value: "PLC1" },
    ],
    [
      "boolean string",
      {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: "true",
      },
      "Invalid trace includePower: expected boolean; received string.",
      { kind: "selector", by: "designation", value: "PLC1" },
    ],
  ] as const)("rejects trace %s", (_name, intent, message, target) => {
    const error = errorFor({
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent,
    });
    expect(error.message).toBe(message);
    expect(error.requestedTarget).toEqual(target);
    expect(error.requestedIncludePower).toBeDefined();
  });

  it("snapshots the v0.2 descriptor tree in the frozen order and invokes no getter", () => {
    const events: string[] = [];
    let getterCalls = 0;
    const intentTarget = {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: true,
    };
    const intent = new Proxy(intentTarget, {
      getOwnPropertyDescriptor(target, key) {
        events.push(`intent:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const requestTarget = {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent,
      flow: "left-to-right",
    };
    const request = new Proxy(requestTarget, {
      getOwnPropertyDescriptor(target, key) {
        events.push(`request:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    Object.defineProperty(intentTarget.to, "value", {
      enumerable: true,
      get() {
        getterCalls++;
        return "PLC1";
      },
    });
    const error = errorFor(request);
    expect(getterCalls).toBe(0);
    expect(events.slice(0, 7)).toEqual([
      "request:format",
      "request:root",
      "request:intent",
      "request:flow",
      "intent:kind",
      "intent:to",
      "intent:includePower",
    ]);
    expect(error.message).toBe(
      "Invalid trace target: expected { by: 'uid' | 'designation', value: string }.",
    );
    expect(error.requestedTarget).toMatchObject({
      kind: "malformed-selector",
      value: { kind: "uninspectable" },
    });
  });

  it.each(["intent", "kind", "to", "includePower"] as const)(
    "rejects a %s accessor at its exact v0.2 precedence point",
    (stage) => {
      let getterCalls = 0;
      const intent: Record<string, unknown> = {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      };
      const request: Record<string, unknown> = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent,
      };
      Object.defineProperty(stage === "intent" ? request : intent, stage, {
        enumerable: true,
        get() {
          getterCalls++;
          return stage === "intent" ? intent : undefined;
        },
      });
      const error = errorFor(request);
      expect(getterCalls).toBe(0);
      expect(error.message).toBe(
        stage === "intent"
          ? "Invalid intent: property is uninspectable."
          : stage === "kind"
            ? "Invalid intent kind: property is uninspectable."
            : stage === "to"
              ? "Invalid trace target: property is uninspectable."
              : "Invalid trace includePower: property is uninspectable.",
      );
    },
  );

  it.each(["intent", "kind", "to", "includePower"] as const)(
    "contains a revoked Proxy stored at %s",
    (stage) => {
      const proxy = revokedProxy();
      const intent: Record<string, unknown> = {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      };
      const request: Record<string, unknown> = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent,
      };
      if (stage === "intent") request.intent = proxy;
      else intent[stage] = proxy;
      const error = errorFor(request);
      expect(error.message).toBe(
        stage === "intent"
          ? "Invalid intent: property is uninspectable."
          : stage === "kind"
            ? "Invalid intent kind: property is uninspectable."
            : stage === "to"
              ? "Invalid trace target: property is uninspectable."
              : "Invalid trace includePower: property is uninspectable.",
      );
    },
  );

  it.each(["kind", "to", "includePower"] as const)(
    "contains a throwing nested %s descriptor trap",
    (stage) => {
      const target = {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      };
      const intent = new Proxy(target, {
        getOwnPropertyDescriptor(record, key) {
          if (key === stage) throw new Error("descriptor trap");
          return Reflect.getOwnPropertyDescriptor(record, key);
        },
      });
      const error = errorFor({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent,
      });
      expect(error.message).toBe(
        stage === "kind"
          ? "Invalid intent kind: property is uninspectable."
          : stage === "to"
            ? "Invalid trace target: property is uninspectable."
            : "Invalid trace includePower: property is uninspectable.",
      );
    },
  );

  it("freezes the exact v0.2 R001 field order and omission rules", () => {
    const trace = errorFor({
      ...validTraceRequest,
      intent: { ...validTraceRequest.intent, includePower: undefined },
    });
    expect(Object.keys(trace)).toEqual([
      "code",
      "message",
      "requestedFormat",
      "requestedRoot",
      "requestedFamily",
      "requestedIntent",
      "requestedTarget",
      "requestedIncludePower",
      "requestedFlow",
      "family",
      "root",
    ]);
    expect(Object.isFrozen(trace)).toBe(true);
    for (const descriptor of [
      trace.requestedFormat,
      trace.requestedRoot,
      trace.requestedFamily,
      trace.requestedIntent,
      trace.requestedTarget,
      trace.requestedIncludePower,
      trace.requestedFlow,
    ]) {
      expect(Object.isFrozen(descriptor)).toBe(true);
    }

    const conductors = errorFor({
      ...validConductorsRequest,
      intent: { kind: "conductors", includePower: true },
    });
    expect(Object.keys(conductors)).not.toContain("requestedTarget");
    expect(Object.keys(conductors)).toContain("requestedIncludePower");
  });

  it("returns exact query and post-resolution capability failures", () => {
    const requests = [
      [
        { ...validConductorsRequest, root: { by: "designation", value: "K1" } },
        { code: "Q002", expectedKind: "cable", actualKind: "device" },
      ],
      [
        {
          ...validConductorsRequest,
          root: { by: "designation", value: "UNKNOWN" },
        },
        { code: "Q001", input: "UNKNOWN" },
      ],
      [
        { ...validTraceRequest, root: { by: "designation", value: "CBL1" } },
        {
          code: "R001",
          message: "Invalid trace root: expected a device; resolved cable.",
          family: "control",
          root: "CBL1",
        },
      ],
      [
        { ...validTraceRequest, root: { by: "designation", value: "K1" } },
        {
          code: "R001",
          message:
            "Invalid trace root: expected one supported mapped trace-root rule.",
          family: "control",
          root: "K1",
        },
      ],
      [
        {
          ...validTraceRequest,
          intent: {
            ...validTraceRequest.intent,
            to: { by: "designation", value: "LS1" },
          },
        },
        {
          code: "R001",
          message:
            "Invalid trace target: expected a device different from the root.",
          root: "LS1",
        },
      ],
      [
        {
          ...validTraceRequest,
          intent: {
            ...validTraceRequest.intent,
            to: { by: "designation", value: "CBL1" },
          },
        },
        {
          code: "R001",
          message: "Invalid trace target: expected a device; resolved cable.",
          root: "LS1",
        },
      ],
      [
        {
          ...validTraceRequest,
          intent: {
            ...validTraceRequest.intent,
            to: { by: "designation", value: "K1" },
          },
        },
        {
          code: "R001",
          message:
            "Invalid trace target: expected at least one mapped input channel.",
          root: "LS1",
        },
      ],
      [
        { ...validLoadsRequest, root: { by: "designation", value: "CBL1" } },
        {
          code: "R001",
          message: "Invalid loads root: expected a device; resolved cable.",
          root: "CBL1",
        },
      ],
      [
        { ...validLoadsRequest, root: { by: "designation", value: "K1" } },
        {
          code: "R001",
          message:
            "Invalid loads root: expected exactly one mapped control source with a source/return terminal pair.",
          root: "K1",
        },
      ],
    ] as const;

    for (const [request, expected] of requests) {
      const result = normalizeSchematicView(coreIr, request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject(expected);
    }
  });
});
