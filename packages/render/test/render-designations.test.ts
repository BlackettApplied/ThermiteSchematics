import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  renderSchematic,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { errorContractCases } from "./render-contract-fixture.js";
import { renderErrorContext } from "../src/render-error-context.js";
import {
  transformerFixture,
  transformerRequest,
} from "./transformer-control-fixture.js";
import { svgSemanticId } from "../src/svg/escape.js";
import {
  PrintableFontBudgetError,
  fontBudgetFailure,
} from "../../cli/src/printable-font.js";
import type { RenderOutcome, SchematicViewRequest } from "../src/types.js";

let cases: Awaited<ReturnType<typeof errorContractCases>>;
let core: ElectricalIr;
beforeAll(async () => {
  cases = await errorContractCases();
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error("compile");
  core = c.ir;
});

function errorOf<T>(result: RenderOutcome<T>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw Error(`Expected ${code}`);
  expect(result.error.code).toBe(code);
  return result.error;
}

// All seven R codes have an emitted example. Project/page/font errors have no
// affected device; their own scope must survive without an invented designation.
it.each([
  ["R001", "K1"],
  ["R002", "T1"],
  ["R003", "TB1"],
  ["R004", "RIO2"],
  ["R005", "K1"],
  ["R006", "PX1"],
  ["R007", undefined],
] as const)("locates the affected object for %s", async (code, designation) => {
  if (code === "R007") {
    const error = fontBudgetFailure(
      new PrintableFontBudgetError(70_000, 60_000),
    );
    expect(error).toMatchObject({
      code,
      details: { bytes: 70_000, maximum: 60_000 },
    });
    expect(error).not.toHaveProperty("details.designation");
    return;
  }
  const c = cases.find((c) => c.code === code);
  if (!c) throw Error(code);
  let result: RenderOutcome<unknown>;
  if (code === "R001") {
    result = await renderSchematic(core, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "K1" },
      family: "control",
      flow: "sideways",
    } as unknown as SchematicViewRequest);
  } else if (code === "R004") {
    const wire = c.ir.wires.find((w) => w.designation === "W-RIO2-L+");
    if (!wire) throw Error("wire");
    const engine = createElkEngine(),
      layout = engine.layout.bind(engine);
    engine.layout = async (...args) => {
      const output = await layout(...args);
      const section = output.edges?.find(
        (e) => e.id === JSON.stringify(["wire", wire.uid]),
      )?.sections?.[0];
      if (!section) throw Error("section");
      section.startPoint.x += 1;
      return output;
    };
    result = await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(c.ir, c.view);
  } else if (code === "R002") {
    const fixture = await transformerFixture("same");
    try {
      result = await renderSchematic(
        fixture.ir,
        transformerRequest("left-to-right"),
      );
    } finally {
      await fixture.dispose();
    }
  } else if (code === "R005") {
    const input = structuredClone(core);
    const wire = input.wires.find((w) => w.designation === "W-CTL-007");
    if (!wire) throw Error("wire");
    wire.properties = { ...wire.properties, label: "bad\u0001label" };
    result = await renderSchematic(input, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "K1" },
      family: "control",
    });
  } else if ("packet" in c)
    result = await renderSchematicPacket(c.ir, c.packet);
  else result = await renderSchematic(c.ir, c.view);
  const error = errorOf(result, code);
  if (code === "R001")
    expect(error.details).toMatchObject({ designation: "K1" });
  if (code === "R002")
    expect(error.details).toMatchObject({
      input: { designation: "T1", terminal: { terminalKey: "X1" } },
      return: { designation: "T1", terminal: { terminalKey: "X1" } },
    });
  if (code === "R003") {
    expect(error.details).toMatchObject({ designation: "TB1" });
    // The positive name already existed; the changed contract omits an unknown
    // endpoint's designation instead of substituting its UID.
    const unknown = { deviceUid: "unknown-device", terminalKey: "X" };
    const contextual = renderErrorContext(core, {
      code: "R003",
      family: "control",
      root: "LS1",
      deviceUid: "unknown-device",
      typeId: "unknown-type",
      message: "Unsupported endpoint.",
      details: { terminalIds: [unknown] },
    });
    expect(contextual.details?.stoppedAt).toEqual([
      { ...unknown, functionKeys: [] },
    ]);
  }
  if (code === "R004")
    // R004 has no new designation fields in this PR: pin its existing structure.
    expect(error.details).toMatchObject({
      conductors: expect.arrayContaining([
        expect.objectContaining({
          designation: "W-RIO2-L+",
          terminals: expect.arrayContaining([
            expect.objectContaining({
              designation: "RIO2",
              terminalKey: "L+",
              functionKeys: expect.any(Array),
            }),
          ]),
        }),
      ]),
    });
  if (code === "R006")
    expect(error.details).toMatchObject({
      circuitGroups: [
        {
          functionKeys: ["PX1/supply", "PX1/output"],
          functionDisplayKeys: ["PX1/supply", "PX1/output"],
        },
      ],
    });
  if (code === "R005")
    expect(error.details).toMatchObject({
      designation: "W-CTL-007",
      terminals: expect.arrayContaining([
        expect.objectContaining({ designation: "K1", terminalKey: "A1" }),
      ]),
    });
  expect(
    JSON.stringify({ message: error.message, details: error.details }),
  ).toContain(designation);
});

it("resolves UID circuit selectors even before drawing with a custom title", async () => {
  const device = core.devices.find((d) => d.designation === "K1");
  if (!device) throw Error("device");
  const error = errorOf(
    await renderSchematicPacket(core, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Custom title",
          groups: [
            {
              id: "bad-coil",
              conductors: [],
              functions: [
                { device: { by: "uid", value: device.uid }, key: "ABSENT" },
              ],
            },
          ],
        },
      ],
    }),
    "R006",
  );
  expect(error.details).toMatchObject({
    circuitGroups: [
      {
        groupId: "bad-coil",
        functionKeys: [`${device.uid}/ABSENT`],
        functionDisplayKeys: ["K1/ABSENT"],
      },
    ],
  });
});

it.each(["terminal", "function", "aggregate"] as const)(
  "keeps the %s key alongside the text owner's designation",
  (kind) => {
    const device = core.devices.find((d) => d.designation === "K1");
    if (!device) throw Error("device");
    const key = kind === "terminal" ? "A1" : "coil";
    const error = renderErrorContext(core, {
      code: "R005",
      family: "control",
      root: "K1",
      ownerKind: kind,
      ownerId: svgSemanticId(kind, [device.uid, key]),
      field:
        kind === "terminal"
          ? "terminal.key"
          : kind === "function"
            ? "function.key"
            : "aggregate.key",
      reason: "xml-illegal-code-point",
      message: "Invalid render text.",
    });
    expect(error.details).toMatchObject({
      designation: "K1",
      [`${kind === "aggregate" ? "aggregate" : kind}Key`]: key,
    });
  },
);

it("does not fabricate a designation for an unresolved text owner or a project title", () => {
  for (const ownerKind of ["device", "project"] as const) {
    const error = renderErrorContext(core, {
      code: "R005",
      family: "control",
      root: "K1",
      ownerKind,
      ownerId: "absent",
      field: "title.project-line",
      reason: "xml-illegal-code-point",
      message: "Invalid render text.",
    });
    expect(error.details).toBeUndefined();
  }
});

it("names cable-core endpoints when a UID wiring selection fails before drawing", async () => {
  const cable = core.cables.find((c) => c.designation === "CBL1");
  const conductor = core.cableConductors.find(
    (c) => c.cableUid === cable?.uid && c.id.conductorId === "1+",
  );
  if (!conductor) throw Error("core");
  const error = errorOf(
    await renderSchematicPacket(core, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Core ordering",
          conductors: [JSON.stringify(conductor.id)],
          deviceOrder: ["ABSENT"],
        },
      ],
    }),
    "R006",
  );
  expect(error.details?.devices).toEqual([
    {
      deviceUid: conductor.endpoints[0].terminal.deviceUid,
      designation: "TB1",
      functions: [],
      terminals: ["2"],
    },
    {
      deviceUid: conductor.endpoints[1].terminal.deviceUid,
      designation: "JB1",
      functions: [],
      terminals: ["X1.1"],
    },
  ]);
});

it("escapes the full terminal identity in wiring width refusals", async () => {
  const { prepareWiringDrawing } = await import("../src/wiring.js");
  const input = structuredClone(core);
  const wire = input.wires.find((w) => w.designation === "W-CTL-007")!;
  const terminal = wire.endpoints[0].terminal;
  const device = input.devices.find((d) => d.uid === terminal.deviceUid)!;
  device.designation = 'OL"1';
  terminal.terminalKey = "W".repeat(40) + '"\\\n';
  await expect(
    prepareWiringDrawing(input, {
      format: "wiring-view-request/0.1",
      title: "Width refusal",
      conductors: [wire.uid],
    }),
  ).rejects.toThrow(
    `Wiring terminal ${JSON.stringify(`${device.designation}.${terminal.terminalKey}`)} label is too wide.`,
  );
});

it.each(["input", "return"] as const)(
  "omits an unknown transformer %s designation while keeping its identity",
  async (unknownSide) => {
    const { normalizeSchematicView } = await import("../src/view-spec.js");
    const { createSelectionContext } =
      await import("../src/selection/context.js");
    const { pairTransformerPaths } =
      await import("../src/selection/transformer.js");
    const fixture = await transformerFixture();
    try {
      const normalized = normalizeSchematicView(
        fixture.ir,
        transformerRequest("left-to-right"),
      );
      if (
        !normalized.ok ||
        normalized.value.view.format !== "schematic-view/0.1"
      )
        throw Error("normalize");
      const created = createSelectionContext({
        ir: fixture.ir,
        ...normalized.value,
      });
      if (!created.ok) throw Error("context");
      const device = fixture.ir.devices.find((d) => d.designation === "T1")!;
      const candidates = (["input", "return"] as const).map((side) => ({
        classRank: 2,
        distance: 1,
        boundary: {
          kind: "source" as const,
          label: "X1",
          netId: "same-net",
          terminal: {
            deviceUid: side === unknownSide ? "unknown-device" : device.uid,
            terminalKey: "X1",
          },
        },
        functionIds: [{ deviceUid: device.uid, functionKey: "secondary" }],
      }));
      // Deliberately inconsistent caller identity: winding selection still uses
      // its real function owner, while one reported boundary device is unknown.
      const paths = candidates.map((candidate, i) => ({
        candidate,
        path: {
          id: `path-${i}`,
          lane: i === 0 ? "input" : "return",
          steps: [],
          start: { terminal: candidate.boundary.terminal },
          end: { terminal: candidate.boundary.terminal },
        },
      }));
      const arms = paths.map((path) => ({
        start: path.path.start.terminal,
        result: { ok: true as const, value: path },
        candidates: [path.candidate],
        policy: {
          lane: path.path.lane,
          allowFunctions: false,
          boundaryAtEnd: true,
          constrainRoot: false,
          boundaries: () => [path.candidate],
        },
      }));
      const result = pairTransformerPaths(created.value, arms, paths);
      expect(result.ok).toBe(false);
      if (result.ok) throw Error("Expected pair refusal");
      expect(result.error.code).toBe("R002");
      expect(result.error.details?.[unknownSide]).toEqual(
        candidates[unknownSide === "input" ? 0 : 1]!.boundary,
      );
      expect(
        result.error.details?.[unknownSide === "input" ? "return" : "input"],
      ).toMatchObject({ designation: "T1" });
    } finally {
      await fixture.dispose();
    }
  },
);
