import {
  evaluateRules,
  type CompiledProjectPresentation,
  type ElectricalIr,
} from "@thermite/compiler";
import type { ELK } from "elkjs/lib/elk-api.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createSchematicRenderer,
  renderSchematic,
  type InvalidRenderTextError,
  type RenderTextField,
  type RenderTextOwnerKind,
  type RenderTextReason,
  type SchematicViewRequest,
} from "../src/index.js";
import {
  incompleteConductorsPathError,
  incompleteLoadsPathError,
  incompleteTracePathError,
} from "../src/errors.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { CORE_DEVICE_TYPE_SYMBOL_MAPPINGS } from "../src/symbols/mappings.js";
import { svgSemanticId } from "../src/svg/escape.js";
import {
  compileCoreFixture,
  mutableCoreMappings,
  pnpParallelTraceFixture,
  required,
} from "./fixtures.js";
import {
  b4CompiledContextN2Fixture,
  b4Terminal,
  sameB4Terminal,
  selectB4Trace,
} from "./b4-fixtures.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

let coreIr: ElectricalIr;

const controlRequest: SchematicViewRequest = {
  format: "schematic-view-request/0.1",
  root: { by: "designation", value: "K1" },
  family: "control",
  flow: "left-to-right",
};

const conductorsRequest: SchematicViewRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "CBL1" },
  intent: { kind: "conductors" },
  flow: "left-to-right",
};

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function noCallLayoutEngine() {
  const knownLayoutOptions = vi.fn(async () => []);
  const layout = vi.fn(async () => {
    throw new Error("layout must not be called");
  });
  return {
    engine: { knownLayoutOptions, layout } as unknown as ELK,
    knownLayoutOptions,
    layout,
  };
}

function selectedWire(ir: ElectricalIr, designation: string) {
  return required(ir.wires.find((wire) => wire.designation === designation));
}

function renameCableConductorId(
  value: unknown,
  from: string,
  to: string,
): void {
  if (Array.isArray(value)) {
    for (const member of value) renameCableConductorId(member, from, to);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (record.conductorId === from) record.conductorId = to;
  for (const member of Object.values(record)) {
    renameCableConductorId(member, from, to);
  }
}

function removeWire(ir: ElectricalIr, designation: string): void {
  const wire = selectedWire(ir, designation);
  const isWire = (value: { readonly kind: string; readonly uid?: string }) =>
    value.kind === "wire" && value.uid === wire.uid;
  ir.wires = ir.wires.filter(({ uid }) => uid !== wire.uid);
  for (const net of ir.nets) {
    net.conductiveElementIds = net.conductiveElementIds.filter(
      (id) => !isWire(id),
    );
  }
  ir.indexes.terminalIdsByConductiveElement =
    ir.indexes.terminalIdsByConductiveElement.filter(({ key }) => !isWire(key));
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = entry.value.filter((id) => !isWire(id));
  }
  ir.indexes.objectRefByUid = ir.indexes.objectRefByUid.filter(
    ({ key }) => key !== wire.uid,
  );
  ir.indexes.objectRefByDesignation = ir.indexes.objectRefByDesignation.filter(
    ({ value }) => value.kind !== "wire" || value.uid !== wire.uid,
  );
}

function emptyCable(ir: ElectricalIr): string {
  const cableUid = required(
    ir.cables.find(({ designation }) => designation === "CBL1"),
  ).uid;
  const isMember = (value: {
    readonly kind: string;
    readonly cableUid?: string;
  }) => value.kind === "cable_conductor" && value.cableUid === cableUid;
  ir.cableConductors = ir.cableConductors.filter(
    ({ id }) => id.cableUid !== cableUid,
  );
  required(
    ir.indexes.conductorIdsByCableUid.find(({ key }) => key === cableUid),
  ).value = [];
  for (const net of ir.nets) {
    net.conductiveElementIds = net.conductiveElementIds.filter(
      (id) => !isMember(id),
    );
  }
  ir.indexes.terminalIdsByConductiveElement =
    ir.indexes.terminalIdsByConductiveElement.filter(
      ({ key }) => !isMember(key),
    );
  for (const entry of ir.indexes.conductiveElementIdsByTerminal) {
    entry.value = entry.value.filter((id) => !isMember(id));
  }
  return cableUid;
}

describe("integrated renderer", () => {
  it("creates exact frozen readonly v0.2 R002 variants", () => {
    const variants = [
      {
        error: incompleteTracePathError(
          "root-device",
          "target-device",
          "signal",
          "LS1",
        ),
        keys: [
          "code",
          "family",
          "intent",
          "deviceUid",
          "targetDeviceUid",
          "segment",
          "message",
          "root",
        ],
      },
      {
        error: incompleteConductorsPathError("cable", "CBL1"),
        keys: [
          "code",
          "family",
          "intent",
          "cableUid",
          "segment",
          "message",
          "root",
        ],
      },
      {
        error: incompleteLoadsPathError("source-device", "PS1"),
        keys: [
          "code",
          "family",
          "intent",
          "deviceUid",
          "segment",
          "message",
          "root",
        ],
      },
    ] as const;

    for (const { error, keys } of variants) {
      const before = JSON.stringify(error);
      expect(Object.keys(error)).toEqual(keys);
      expect(Object.isFrozen(error)).toBe(true);
      for (const key of keys) {
        expect(Reflect.set(error, key, "mutated")).toBe(false);
      }
      expect(JSON.stringify(error)).toBe(before);
    }
  });

  it("runs the public normalize-select-present-layout-emit pipeline", async () => {
    const renderer = createSchematicRenderer();
    expect(Object.isFrozen(renderer)).toBe(true);

    const fromFactory = await renderer.render(coreIr, controlRequest);
    const fromConvenience = await renderSchematic(coreIr, controlRequest);
    expect(fromFactory).toEqual(fromConvenience);
    expect(fromFactory.ok).toBe(true);
    if (!fromFactory.ok) return;

    expect(fromFactory.value.view).toEqual({
      format: "schematic-view/0.1",
      family: "control",
      root: {
        deviceUid: required(
          coreIr.devices.find(({ designation }) => designation === "K1"),
        ).uid,
        designation: "K1",
      },
      flow: "left-to-right",
    });
    expect(fromFactory.value.svg.endsWith("\n")).toBe(true);
    expect(Object.isFrozen(fromFactory)).toBe(true);
    expect(Object.isFrozen(fromFactory.value)).toBe(true);
    expect(Object.isFrozen(fromFactory.value.summary.terminalIds[0])).toBe(
      true,
    );
    checkRestrictedSvgXml(fromFactory.value.svg);
  });

  it("attempts layout for the compiler-valid equal-shortest PNP regression deterministically", async () => {
    const ir = pnpParallelTraceFixture(coreIr);
    expect(evaluateRules(ir)).toEqual([]);
    const reordered = structuredClone(ir);
    for (const collection of [
      reordered.devices,
      reordered.terminals,
      reordered.functions,
      reordered.wires,
      reordered.nets,
      reordered.indexes.conductiveElementIdsByTerminal,
      reordered.indexes.terminalIdsByConductiveElement,
      reordered.indexes.netIdByTerminal,
    ]) {
      collection.reverse();
    }
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const request: SchematicViewRequest = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: false,
        },
        flow,
      };
      const baseline = await renderSchematic(ir, request);
      expect(
        baseline.ok,
        baseline.ok ? "" : JSON.stringify(baseline.error),
      ).toBe(true);
      if (!baseline.ok) return;
      checkRestrictedSvgXml(baseline.value.svg);

      const [repeated, permuted] = await Promise.all([
        renderSchematic(ir, request),
        renderSchematic(reordered, request),
      ]);
      expect(repeated).toEqual(baseline);
      expect(permuted).toEqual(baseline);
    }
  });

  it("locks the v23 compiled-context N=2 RIGHT failure and DOWN success across two production runs", async () => {
    const ir = b4CompiledContextN2Fixture(coreIr);
    expect(evaluateRules(ir)).toEqual([]);

    const plcInput = b4Terminal(ir, "PLC1", "X1.0");
    expect(
      required(ir.terminals.find(({ id }) => sameB4Terminal(id, plcInput)))
        .connectionPolicy,
    ).toBe("exclusive");
    const wFld001 = selectedWire(ir, "W-FLD-001");
    expect(
      required(
        ir.indexes.conductiveElementIdsByTerminal.find(({ key }) =>
          sameB4Terminal(key, plcInput),
        ),
      ).value,
    ).toEqual([{ kind: "wire", uid: wFld001.uid }]);

    const netId =
      "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9";
    const tb1Uid = "10418711-330f-4482-8dab-a274923215cb";
    const boundaryId = JSON.stringify([
      "boundary-segment",
      JSON.stringify(["junction", netId, tb1Uid, "3"]),
      JSON.stringify(["function", tb1Uid, "terminal3"]),
    ]);
    const wireId = JSON.stringify(["wire", wFld001.uid]);

    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const selected = selectB4Trace(ir, flow);
      const signal = required(
        selected.paths.find(({ lane }) => lane === "signal"),
      );
      expect(
        signal.steps.map((step) => {
          if (step.kind !== "conductor" || step.elementId.kind !== "wire") {
            throw new Error("Compiled-context N=2 selected a non-wire step.");
          }
          return {
            designation: required(
              ir.wires.find(({ uid }) => uid === step.elementId.uid),
            ).designation,
            uid: step.elementId.uid,
            from: `${
              required(
                ir.devices.find(({ uid }) => uid === step.from.deviceUid),
              ).designation
            }.${step.from.terminalKey}`,
            to: `${
              required(ir.devices.find(({ uid }) => uid === step.to.deviceUid))
                .designation
            }.${step.to.terminalKey}`,
          };
        }),
      ).toEqual([
        {
          designation: "EQ-1",
          uid: "f0000000-0000-4000-8000-000000000200",
          from: "LS1.4",
          to: "TB1.3",
        },
        {
          designation: "W-FLD-003",
          uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
          from: "LS1.4",
          to: "TB1.3",
        },
        {
          designation: "W-FLD-001",
          uid: "e84a9629-373c-4946-8b48-184b7464d474",
          from: "TB1.3",
          to: "PLC1.X1.0",
        },
      ]);

      const presented = buildPresentationGraph({ ir, selected });
      if (!presented.ok) throw new Error(JSON.stringify(presented.error));
      expect(presented.value.graph.nodes).toHaveLength(5);
      expect(presented.value.graph.locationGroups).toHaveLength(2);
      expect(presented.value.graph.deviceGroups).toHaveLength(3);

      const rawSizes: (readonly [number | undefined, number | undefined])[] =
        [];
      const canonicalOutputs: string[] = [];
      const delegate = createElkEngine();
      const renderer = createSchematicRendererWithDependencies({
        layoutEngine: {
          knownLayoutOptions: () => delegate.knownLayoutOptions(),
          async layout(graph) {
            const output = await delegate.layout(graph);
            rawSizes.push([output.width, output.height]);
            canonicalOutputs.push(
              JSON.stringify(output, (key, value) =>
                key.startsWith("$") ? undefined : value,
              ),
            );
            return output;
          },
        } as ELK,
      });
      const request: SchematicViewRequest = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: false,
        },
        flow,
      };

      const first = await renderer.render(ir, request);
      const second = await renderer.render(ir, request);
      expect(second).toEqual(first);
      expect(canonicalOutputs).toHaveLength(2);
      expect(canonicalOutputs[1]).toBe(canonicalOutputs[0]);

      if (flow === "left-to-right") {
        expect(rawSizes).toEqual([
          [1082.6, 377],
          [1082.6, 377],
        ]);
        expect(first).toEqual({
          ok: false,
          error: {
            code: "R004",
            message: `Invalid layout: edges ${boundaryId} and ${wireId} form an ambiguous intersection.`,
            family: "control",
            netId,
            root: "LS1",
          },
        });
      } else {
        expect(rawSizes).toEqual([
          [543.6, 828],
          [543.6, 828],
        ]);
        expect(first.ok, first.ok ? "" : JSON.stringify(first.error)).toBe(
          true,
        );
        if (first.ok) {
          checkRestrictedSvgXml(first.value.svg);
        }
      }
    }
  });

  it("returns detached frozen R/Q failures without entering later stages", async () => {
    const invalid = await renderSchematic(
      coreIr,
      null as unknown as SchematicViewRequest,
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        message: "Invalid request: expected an object.",
        root: "<missing>",
      },
    });
    expect(Object.isFrozen(invalid)).toBe(true);
    if (invalid.ok) return;
    expect(Object.isFrozen(invalid.error)).toBe(true);

    const missing = await renderSchematic(coreIr, {
      ...controlRequest,
      root: { by: "designation", value: "NO-SUCH-DEVICE" },
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "Q001", input: "NO-SUCH-DEVICE" },
    });
    expect(Object.isFrozen(missing)).toBe(true);
    if (!missing.ok) expect(Object.isFrozen(missing.error)).toBe(true);
  });

  it.each([
    ["device.location", "\0", "xml-illegal-code-point"],
    ["device.location", "\ud800", "unpaired-surrogate"],
    ["wire.properties.label", "\0", "xml-illegal-code-point"],
    ["wire.properties.label", "\udc00", "unpaired-surrogate"],
  ] as const)(
    "returns exact public R005 for %s before invoking ELK",
    async (field, value, reason) => {
      const ir = structuredClone(coreIr);
      let ownerKind: "device" | "wire";
      let ownerId: string;
      if (field === "device.location") {
        const device = required(
          ir.devices.find(({ designation }) => designation === "K1"),
        );
        device.location = value;
        ownerKind = "device";
        ownerId = svgSemanticId("device", [device.uid]);
      } else {
        const wire = selectedWire(ir, "W-CTL-007");
        wire.properties = { ...wire.properties, label: value };
        ownerKind = "wire";
        ownerId = svgSemanticId("wire", [wire.uid]);
      }
      const spy = noCallLayoutEngine();
      const result = await createSchematicRendererWithDependencies({
        layoutEngine: spy.engine,
      }).render(ir, controlRequest);

      expect(result).toEqual({
        ok: false,
        error: {
          code: "R005",
          message: `Invalid render text: ${ownerKind} ${ownerId} field ${field} contains ${reason}.`,
          family: "control",
          ownerKind,
          ownerId,
          field,
          reason,
          root: "K1",
        },
      });
      expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
      expect(spy.layout).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(value);
    },
  );

  it("returns exact cable endpoint R003 without invoking ELK", async () => {
    const mappings = mutableCoreMappings();
    const junctionBox = required(
      mappings.find(({ typeId }) => typeId === "core:junction-box-8"),
    );
    junctionBox.functions = junctionBox.functions.filter(
      ({ functionKey }) => functionKey !== "terminal1",
    );
    const jb1 = required(
      coreIr.devices.find(({ designation }) => designation === "JB1"),
    );
    const spy = noCallLayoutEngine();
    const result = await createSchematicRendererWithDependencies({
      mappings,
      layoutEngine: spy.engine,
    }).render(coreIr, conductorsRequest);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R003",
        message:
          'Unsupported symbol mapping: type "core:junction-box-8" has no valid control binding.',
        family: "control",
        deviceUid: jb1.uid,
        typeId: "core:junction-box-8",
        root: "CBL1",
      },
    });
    expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
    expect(spy.layout).not.toHaveBeenCalled();
  });

  it("returns every exact v0.2 R002 variant without invoking ELK", async () => {
    const cases = [
      {
        request: {
          format: "schematic-view-request/0.2" as const,
          root: { by: "designation" as const, value: "LS1" },
          intent: {
            kind: "trace" as const,
            to: { by: "designation" as const, value: "PLC1" },
            includePower: false,
          },
        },
        mutate(ir: ElectricalIr) {
          removeWire(ir, "W-FLD-003");
          return {
            code: "R002",
            family: "control",
            intent: "trace",
            deviceUid: required(
              ir.devices.find(({ designation }) => designation === "LS1"),
            ).uid,
            targetDeviceUid: required(
              ir.devices.find(({ designation }) => designation === "PLC1"),
            ).uid,
            segment: "signal",
            message:
              "Incomplete trace view: no signal path connects the requested devices.",
            root: "LS1",
          } as const;
        },
      },
      {
        request: conductorsRequest,
        mutate(ir: ElectricalIr) {
          return {
            code: "R002",
            family: "control",
            intent: "conductors",
            cableUid: emptyCable(ir),
            segment: "conductors",
            message:
              "Incomplete conductor view: the requested cable has no authored conductors.",
            root: "CBL1",
          } as const;
        },
      },
      {
        request: {
          format: "schematic-view-request/0.2" as const,
          root: { by: "designation" as const, value: "PS1" },
          intent: { kind: "loads" as const },
        },
        mutate(ir: ElectricalIr) {
          removeWire(ir, "W-CTL-002");
          return {
            code: "R002",
            family: "control",
            intent: "loads",
            deviceUid: required(
              ir.devices.find(({ designation }) => designation === "PS1"),
            ).uid,
            segment: "complete-load",
            message:
              "Incomplete loads view: the requested source has no complete renderable load.",
            root: "PS1",
          } as const;
        },
      },
    ] as const;
    for (const testCase of cases) {
      const ir = structuredClone(coreIr);
      const expected = testCase.mutate(ir);
      const spy = noCallLayoutEngine();
      const result = await createSchematicRendererWithDependencies({
        layoutEngine: spy.engine,
      }).render(ir, testCase.request);
      expect(result).toEqual({ ok: false, error: expected });
      if (!result.ok) expect(Object.isFrozen(result.error)).toBe(true);
      expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
      expect(spy.layout).not.toHaveBeenCalled();
    }
  });

  it("returns exact v0.2 R004 without emitting an artifact", async () => {
    const delegate = createElkEngine();
    const layout = vi.fn(async () => ({ id: "root" }));
    const result = await createSchematicRendererWithDependencies({
      layoutEngine: {
        knownLayoutOptions: () => delegate.knownLayoutOptions(),
        layout,
      } as unknown as ELK,
    }).render(coreIr, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R004",
        message: "Invalid layout: root.width is not a finite safe coordinate.",
        family: "control",
        root: "PS1",
      },
    });
    expect(layout).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    ["cable.designation", "\ud800", "unpaired-surrogate"],
    ["cable.conductor.id", "\ufffe", "xml-illegal-code-point"],
    ["cable.conductor.color", "\udc00", "unpaired-surrogate"],
    ["cable.conductor.size", "\0", "xml-illegal-code-point"],
  ] as const)(
    "returns exact cable-root R005 for %s before invoking ELK",
    async (field, value, reason) => {
      const ir = structuredClone(coreIr);
      const cable = required(
        ir.cables.find(({ designation }) => designation === "CBL1"),
      );
      const conductor = required(
        ir.cableConductors.find(
          ({ id }) => id.cableUid === cable.uid && id.conductorId === "1+",
        ),
      );
      let ownerKind: "cable" | "cable-conductor";
      let ownerId: string;
      if (field === "cable.designation") {
        cable.designation = value;
        required(
          ir.indexes.objectRefByDesignation.find(
            ({ value: reference }) =>
              reference.kind === "cable" && reference.uid === cable.uid,
          ),
        ).key = value;
        ownerKind = "cable";
        ownerId = svgSemanticId("cable", [cable.uid]);
      } else if (field === "cable.conductor.id") {
        renameCableConductorId(ir, "1+", value);
        ownerKind = "cable-conductor";
        ownerId = svgSemanticId("cable-conductor", [cable.uid, value]);
      } else {
        const metadata = required(conductor.typeConductor ?? undefined);
        if (field === "cable.conductor.color") metadata.color = value;
        else metadata.size = value;
        ownerKind = "cable-conductor";
        ownerId = svgSemanticId("cable-conductor", [cable.uid, "1+"]);
      }
      const request =
        field === "cable.designation"
          ? {
              ...conductorsRequest,
              root: { by: "uid" as const, value: cable.uid },
            }
          : conductorsRequest;
      const spy = noCallLayoutEngine();
      const result = await createSchematicRendererWithDependencies({
        layoutEngine: spy.engine,
      }).render(ir, request);

      const expectedOwner =
        field === "cable.designation"
          ? {
              ownerKind: "view" as const,
              ownerId: "normalized-view",
              field: "title.view-line" as const,
            }
          : { ownerKind, ownerId, field };
      expect(result).toEqual({
        ok: false,
        error: {
          code: "R005",
          message: `Invalid render text: ${expectedOwner.ownerKind} ${expectedOwner.ownerId} field ${expectedOwner.field} contains ${reason}.`,
          family: "control",
          ...expectedOwner,
          reason,
          root: field === "cable.designation" ? value : "CBL1",
        },
      });
      expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
      expect(spy.layout).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(value);
    },
  );

  it.each([
    {
      name: "collapsed-rail device designation",
      mutate(ir: ElectricalIr) {
        const device = required(
          ir.devices.find(({ designation }) => designation === "PS1"),
        );
        device.designation = "PS1\ud800";
        required(
          ir.indexes.objectRefByDesignation.find(
            ({ value }) => value.kind === "device" && value.uid === device.uid,
          ),
        ).key = device.designation;
        return {
          ownerKind: "device" as const,
          ownerId: svgSemanticId("device", [device.uid]),
          field: "device.designation" as const,
          reason: "unpaired-surrogate" as const,
        };
      },
    },
    {
      name: "wire designation shadowed by properties.label",
      mutate(ir: ElectricalIr) {
        const wire = selectedWire(ir, "W-CTL-007");
        wire.designation = "WIRE\ufffe";
        wire.properties = { ...wire.properties, label: "VISIBLE-WIRE" };
        required(
          ir.indexes.objectRefByDesignation.find(
            ({ value }) => value.kind === "wire" && value.uid === wire.uid,
          ),
        ).key = wire.designation;
        return {
          ownerKind: "wire" as const,
          ownerId: svgSemanticId("wire", [wire.uid]),
          field: "wire.designation" as const,
          reason: "xml-illegal-code-point" as const,
        };
      },
    },
  ])("preflights $name before invoking ELK", async ({ mutate }) => {
    const ir = structuredClone(coreIr);
    const expected = mutate(ir);
    const spy = noCallLayoutEngine();
    const result = await createSchematicRendererWithDependencies({
      layoutEngine: spy.engine,
    }).render(ir, controlRequest);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "R005",
        message: `Invalid render text: ${expected.ownerKind} ${expected.ownerId} field ${expected.field} contains ${expected.reason}.`,
        family: "control",
        ...expected,
        root: "K1",
      },
    });
    expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
    expect(spy.layout).not.toHaveBeenCalled();
  });

  it.each([
    ["\ud800", "unpaired-surrogate"],
    ["\ufffe", "xml-illegal-code-point"],
  ] as const)(
    "preflights an exactly mapped illegal device.type %j before ELK",
    async (typeId, reason) => {
      const ir = structuredClone(coreIr);
      const device = required(
        ir.devices.find(({ designation }) => designation === "K1"),
      );
      const priorTypeId = device.typeId;
      device.typeId = typeId;
      required(ir.deviceTypes.find(({ id }) => id === priorTypeId)).id = typeId;
      required(
        ir.indexes.instanceRefsByTypeId.find(({ key }) => key === priorTypeId),
      ).key = typeId;
      const mappings = structuredClone(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS).map(
        (mapping) =>
          mapping.typeId === priorTypeId ? { ...mapping, typeId } : mapping,
      );
      const spy = noCallLayoutEngine();
      const ownerId = svgSemanticId("device", [device.uid]);
      const result = await createSchematicRendererWithDependencies({
        mappings,
        layoutEngine: spy.engine,
      }).render(ir, controlRequest);

      expect(result).toEqual({
        ok: false,
        error: {
          code: "R005",
          message: `Invalid render text: device ${ownerId} field device.type contains ${reason}.`,
          family: "control",
          ownerKind: "device",
          ownerId,
          field: "device.type",
          reason,
          root: "K1",
        },
      });
      expect(spy.knownLayoutOptions).not.toHaveBeenCalled();
      expect(spy.layout).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(typeId);
    },
  );

  it("serializes legal source CR/LF/tab through the public pipeline", async () => {
    const ir = structuredClone(coreIr);
    required(
      ir.devices.find(({ designation }) => designation === "K1"),
    ).location = "P\rQ\nR\tS";
    const wire = selectedWire(ir, "W-CTL-007");
    wire.properties = { ...wire.properties, label: "W\tX\nY\rZ" };

    const result = await renderSchematic(ir, controlRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.svg).toContain("P&#xD;Q&#xA;R&#x9;S");
    expect(result.value.svg).toContain("W&#x9;X&#xA;Y&#xD;Z");
    expect(result.value.svg).not.toContain("\r");
    expect(result.value.svg).not.toContain("\t");
    checkRestrictedSvgXml(result.value.svg);
  });
});

const requests = {
  legacy: {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
    flow: "left-to-right",
  },
  trace: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: true,
    },
    flow: "left-to-right",
  },
  conductors: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "CBL1" },
    intent: { kind: "conductors" },
    flow: "left-to-right",
  },
  loads: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "PS1" },
    intent: { kind: "loads" },
    flow: "left-to-right",
  },
} as const satisfies Readonly<Record<string, SchematicViewRequest>>;

const authoredPresentation: CompiledProjectPresentation = {
  format: "project-presentation/0.1",
  revision: "A",
  backgroundColor: "#ffffff",
  titleBlockLines: ["Motor starter reference"],
};

function opaquePresentation(
  backgroundColor: string,
): CompiledProjectPresentation {
  return {
    format: "project-presentation/0.1",
    revision: "A",
    backgroundColor,
    titleBlockLines: ["Motor starter reference"],
  };
}

function attribute(line: string, name: string): string {
  const value = new RegExp(`${name}="([^"]*)"`, "u").exec(line)?.[1];
  return required(value);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(left: string, right: string): number {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function expectR005(
  ir: Readonly<ElectricalIr>,
  request: Readonly<SchematicViewRequest>,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  expected: InvalidRenderTextError,
): Promise<void> {
  const layout = vi.fn();
  const knownLayoutOptions = vi.fn();
  const renderer = createSchematicRendererWithDependencies({
    layoutEngine: { layout, knownLayoutOptions } as unknown as ELK,
  });
  const result = await renderer.render(ir, request, presentation);
  expect(result).toEqual({ ok: false, error: expected });
  expect(layout).not.toHaveBeenCalled();
  expect(knownLayoutOptions).not.toHaveBeenCalled();
  expect(expected.message).not.toContain("REJECTED-CONTENT");
  expect(expected.ownerId).not.toContain("REJECTED-CONTENT");
}

describe("M8 opaque canvas and deterministic title block", () => {
  it("freezes all normalized view identities and exact title display order", async () => {
    const expectedIdentities = {
      legacy: "View: K1 | control",
      trace: "View: LS1 -> PLC1 | control/trace",
      conductors: "View: CBL1 | control/conductors",
      loads: "View: PS1 | control/loads",
    } as const;
    for (const [name, request] of Object.entries(requests)) {
      const result = await renderSchematic(
        coreIr,
        request,
        authoredPresentation,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const titleLines = [
        ...result.value.svg.matchAll(
          /<text class="title-block-text"[^>]*>([^<]*)<\/text>/gu,
        ),
      ].map((match) => match[1]!.replaceAll("&gt;", ">"));
      expect(titleLines).toEqual([
        "Project: Motor Starter Reference System",
        "Revision: A",
        expectedIdentities[name as keyof typeof expectedIdentities],
        "Tool: Thermite Schematics 0.2.0 | render/0.3",
        "Motor starter reference",
      ]);
    }
  });

  it.each(["#ffffff", "#101828", "#000000"])(
    "covers the full %s canvas before drawing and keeps the invariant title palette",
    async (backgroundColor) => {
      const result = await renderSchematic(
        coreIr,
        requests.legacy,
        opaquePresentation(backgroundColor),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.value.svg.split("\n");
      const root = lines[1]!;
      expect(attribute(root, "data-project-name")).toBe(
        "Motor Starter Reference System",
      );
      expect(attribute(root, "data-project-revision")).toBe("A");
      expect(attribute(root, "data-tool-version")).toBe("0.2.0");
      expect(attribute(root, "data-renderer-version")).toBe("render/0.3");
      const [viewWidth, viewHeight] = attribute(root, "viewBox")
        .split(" ")
        .slice(2)
        .map(Number);
      const definitionsEnd = lines.indexOf("  </defs>");
      const canvas = lines[definitionsEnd + 1]!;
      expect(canvas).toContain('class="canvas-background"');
      expect(attribute(canvas, "x")).toBe("0");
      expect(attribute(canvas, "y")).toBe("0");
      expect(Number(attribute(canvas, "width"))).toBe(viewWidth);
      expect(Number(attribute(canvas, "height"))).toBe(viewHeight);
      expect(attribute(canvas, "fill")).toBe(backgroundColor);
      expect(canvas).not.toMatch(/opacity|alpha|filter|mask/u);
      expect(
        result.value.svg.match(/class="canvas-background"/gu),
      ).toHaveLength(1);

      const panel = required(
        lines.find((line) => line.includes('class="title-block-panel"')),
      );
      expect(attribute(panel, "fill")).toBe("#ffffff");
      expect(attribute(panel, "stroke")).toBe("#344054");
      expect(Number(attribute(panel, "height"))).toBe(86);
      expect(Number(attribute(panel, "y")) + 86 + 16).toBe(viewHeight);
      for (const titleLine of lines.filter((line) =>
        line.includes('class="title-block-text"'),
      )) {
        expect(attribute(titleLine, "fill")).toBe("#101828");
        expect(attribute(titleLine, "dominant-baseline")).toBe("hanging");
        expect(attribute(titleLine, "lengthAdjust")).toBe("spacingAndGlyphs");
        expect(titleLine).not.toMatch(/opacity|filter|mask/u);
      }
      expect(contrast("#101828", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses the exact default presentation without an authored context", async () => {
    const result = await renderSchematic(coreIr, requests.loads);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.svg).toContain('data-project-revision="UNSPECIFIED"');
    expect(result.value.svg).toContain('fill="#ffffff"');
    expect(result.value.svg).toContain("Revision: UNSPECIFIED");
    expect(result.value.svg).not.toContain("Motor starter reference");
  });
});

describe("M8 complete title R005 preflight", () => {
  it("freezes the exact exported owner, field, reason, and error vocabulary", () => {
    const owners: RenderTextOwnerKind[] = [
      "project",
      "presentation",
      "view",
      "renderer",
      "cable",
      "device",
      "function",
      "aggregate",
      "terminal",
      "wire",
      "jumper",
      "cable-conductor",
      "potential",
      "boundary",
    ];
    const fields: RenderTextField[] = [
      "project.name",
      "title.project-line",
      "title.revision-line",
      "title.view-line",
      "title.tool-line",
      "title.authored-line",
      "device.designation",
      "device.type",
      "device.location",
      "function.key",
      "aggregate.key",
      "terminal.key",
      "wire.properties.label",
      "wire.designation",
      "jumper.designation",
      "cable.designation",
      "cable.conductor.id",
      "cable.conductor.color",
      "cable.conductor.size",
      "potential.name",
      "boundary.label",
    ];
    const reasons: RenderTextReason[] = [
      "empty-string",
      "over-160-code-points",
      "forbidden-single-line-code-point",
      "unpaired-surrogate",
      "xml-illegal-code-point",
    ];
    expect(owners).toHaveLength(14);
    expect(fields).toHaveLength(21);
    expect(reasons).toHaveLength(5);
  });

  it("rejects empty and over-160-code-point project names with exact source rows", async () => {
    for (const [name, reason, message] of [
      [
        "",
        "empty-string",
        "Invalid render text: project project field project.name is empty.",
      ],
      [
        "\u{1f9f0}".repeat(161),
        "over-160-code-points",
        "Invalid render text: project project field project.name exceeds 160 Unicode code points.",
      ],
    ] as const) {
      const ir = structuredClone(coreIr);
      ir.project.name = name;
      await expectR005(ir, requests.legacy, undefined, {
        code: "R005",
        message,
        family: "control",
        ownerKind: "project",
        ownerId: "project",
        field: "project.name",
        reason,
        root: "K1",
      });
    }
    const accepted = structuredClone(coreIr);
    accepted.project.name = "\u{1f9f0}".repeat(160);
    expect((await renderSchematic(accepted, requests.legacy)).ok).toBe(true);
  });

  it.each([
    ["unpaired surrogate", "\ud800", "unpaired-surrogate"],
    ["XML NUL", "\u0000", "xml-illegal-code-point"],
    ["TAB", "\t", "forbidden-single-line-code-point"],
    ["LF", "\n", "forbidden-single-line-code-point"],
    ["CR", "\r", "forbidden-single-line-code-point"],
    ["NEL", "\u0085", "forbidden-single-line-code-point"],
    ["line separator", "\u2028", "forbidden-single-line-code-point"],
    ["paragraph separator", "\u2029", "forbidden-single-line-code-point"],
  ] as const)(
    "uses exact string-content precedence for %s",
    async (_name, value, reason) => {
      await expectR005(
        coreIr,
        requests.legacy,
        {
          ...authoredPresentation,
          titleBlockLines: [`prefix${value}REJECTED-CONTENT`],
        },
        {
          code: "R005",
          message: `Invalid render text: presentation presentation.titleBlock.lines[0] field title.authored-line contains ${reason}.`,
          family: "control",
          ownerKind: "presentation",
          ownerId: "presentation.titleBlock.lines[0]",
          field: "title.authored-line",
          reason,
          root: "K1",
        },
      );
    },
  );

  it("reports the earliest position and the fixed title source order", async () => {
    const ir = structuredClone(coreIr);
    ir.project.name = "REJECTED-CONTENT\ud800\u0000";
    await expectR005(
      ir,
      requests.legacy,
      {
        ...authoredPresentation,
        revision: "REJECTED-CONTENT\u2028",
        titleBlockLines: ["REJECTED-CONTENT\u2029"],
      },
      {
        code: "R005",
        message:
          "Invalid render text: project project field title.project-line contains unpaired-surrogate.",
        family: "control",
        ownerKind: "project",
        ownerId: "project",
        field: "title.project-line",
        reason: "unpaired-surrogate",
        root: "K1",
      },
    );
  });

  it.each([
    ["root", "\u2028"],
    ["target", "\u2029"],
  ] as const)(
    "validates the fully composed trace %s designation as the View line",
    async (which, value) => {
      const ir = structuredClone(coreIr);
      const root = required(
        ir.devices.find(({ designation }) => designation === "LS1"),
      );
      const target = required(
        ir.devices.find(({ designation }) => designation === "PLC1"),
      );
      const changed = which === "root" ? root : target;
      changed.designation = `REJECTED-CONTENT${value}`;
      required(
        ir.indexes.objectRefByDesignation.find(
          ({ value: reference }) =>
            reference.kind === "device" && reference.uid === changed.uid,
        ),
      ).key = changed.designation;
      const request = {
        ...requests.trace,
        root: { by: "uid" as const, value: root.uid },
        intent: {
          ...requests.trace.intent,
          to: { by: "uid" as const, value: target.uid },
        },
      };
      await expectR005(ir, request, authoredPresentation, {
        code: "R005",
        message:
          "Invalid render text: view normalized-view field title.view-line contains forbidden-single-line-code-point.",
        family: "control",
        ownerKind: "view",
        ownerId: "normalized-view",
        field: "title.view-line",
        reason: "forbidden-single-line-code-point",
        root: root.designation,
      });
    },
  );

  it("checks all title rows before the unchanged graph registry", async () => {
    const ir = structuredClone(coreIr);
    const device = required(
      ir.devices.find(({ designation }) => designation === "PB1"),
    );
    device.designation = "REJECTED-CONTENT\ud800";
    required(
      ir.indexes.objectRefByDesignation.find(
        ({ value }) => value.kind === "device" && value.uid === device.uid,
      ),
    ).key = device.designation;
    await expectR005(
      ir,
      requests.legacy,
      { ...authoredPresentation, titleBlockLines: ["REJECTED-CONTENT\u0085"] },
      {
        code: "R005",
        message:
          "Invalid render text: presentation presentation.titleBlock.lines[0] field title.authored-line contains forbidden-single-line-code-point.",
        family: "control",
        ownerKind: "presentation",
        ownerId: "presentation.titleBlock.lines[0]",
        field: "title.authored-line",
        reason: "forbidden-single-line-code-point",
        root: "K1",
      },
    );
  });
});
