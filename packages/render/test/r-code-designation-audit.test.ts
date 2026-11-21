import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import {
  compileProject,
  type ElectricalIr,
  type CompiledProjectPresentation,
} from "@thermite/compiler";
import {
  createSchematicRenderer,
  renderSchematic,
  renderSchematicPacket,
  renderSchematicSheets,
  normalizePaperPage,
  type RenderOutcome,
} from "../src/index.js";
import * as elkRuntime from "../src/layout/elk-runtime.js";
import * as legendPagination from "../src/packet/legend-pagination.js";
import { removeFixtures } from "../../cli/test/analog-output.cases.js";
import {
  legendIr,
  legendRequest,
  rejectLegendCandidate,
  assertNativeLegend,
  loopFixture,
  captureLoopFallback,
} from "./helpers/r-code-reaudit.js";
import { errorContractCases } from "./render-contract-fixture.js";
import {
  transformerFixture,
  transformerRequest,
} from "./transformer-control-fixture.js";

let core: ElectricalIr;
let presentation: CompiledProjectPresentation | undefined;
let cases: Awaited<ReturnType<typeof errorContractCases>>;
const observed: unknown[] = [];
afterAll(() => {
  const destination = process.env.THERMITE_AUDIT_R_DIAGNOSTICS;
  if (destination)
    writeFileSync(destination, JSON.stringify(observed, null, 2) + "\n");
});
beforeAll(async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error("Cannot compile the fixed audit fixture");
  core = compiled.ir;
  presentation = compiled.presentation;
  cases = await errorContractCases();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await removeFixtures();
});

it("the standalone page normalizer identifies its authored fields without inventing a view", () => {
  const result = normalizePaperPage({ unexpected: true });
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("Expected invalid page fields");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain("size, orientation and marginMm");
  expect(result.error.root).toBe("packet");
});

function device(name: string) {
  const found = core.devices.find((d) => d.designation === name);
  if (!found) throw Error(`Missing authored device ${name}`);
  return found;
}
function failure<T>(result: RenderOutcome<T>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw Error(`Expected ${code}`);
  expect(result.error.code).toBe(code);
  observed.push({ code, error: result.error });
  return result.error;
}
function names(error: unknown, ...expected: string[]) {
  for (const name of expected) expect(JSON.stringify(error)).toContain(name);
}
const control = () => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "uid" as const, value: device("K1").uid },
  family: "control" as const,
});

it("R001 maps an authored UID selector to the device designation", async () => {
  const result = await renderSchematic(
    core,
    JSON.parse(JSON.stringify({ ...control(), flow: "sideways" })),
  );
  const error = failure(result, "R001");
  expect(error.details).toMatchObject({ designation: "K1" });
});

it("R002 retains the involved transformer and both stopped terminals", async () => {
  const fixture = await transformerFixture("same");
  try {
    const error = failure(
      await renderSchematic(fixture.ir, transformerRequest("left-to-right")),
      "R002",
    );
    expect(error.details).toMatchObject({
      input: { designation: "T1" },
      return: { designation: "T1" },
    });
    names({ message: error.message, details: error.details }, "T1", "X1");
  } finally {
    await fixture.dispose();
  }
});

it("R001 trace-target wrapping retains the native UID-selected target designation", async () => {
  const error = failure(
    await renderSchematic(core, {
      format: "schematic-view-request/0.2",
      root: { by: "uid", value: device("LS1").uid },
      intent: {
        kind: "trace",
        to: { by: "uid", value: device("K1").uid },
        includePower: false,
      },
    }),
    "R001",
  );
  expect(error.details).toMatchObject({
    targetDeviceUid: device("K1").uid,
    targetDesignation: "K1",
  });
  names({ message: error.message, details: error.details }, "LS1", "K1");
});

it("R003 names the actual unsupported device instead of just its UID", async () => {
  const probe = cases.find((c) => c.code === "R003");
  if (!probe || !("view" in probe)) throw Error("Missing R003 fixture");
  const error = failure(await renderSchematic(probe.ir, probe.view), "R003");
  names({ message: error.message, details: error.details }, "TB1");
});

it.each(["function", "factory"])(
  "R004 global layout failure names its view through the public %s API",
  async (entry) => {
    const engine = elkRuntime.createElkEngine(),
      layout = engine.layout.bind(engine);
    engine.layout = async (...args) => {
      const result = await layout(...args);
      result.width = NaN;
      return result;
    };
    vi.spyOn(elkRuntime, "createElkEngine").mockReturnValue(engine);
    const result =
      entry === "factory"
        ? await createSchematicRenderer().render(core, control())
        : await renderSchematic(core, control());
    const error = failure(result, "R004");
    expect(error.details).toMatchObject({
      diagnosticContext: { views: [{ viewIndex: 0, title: "K1 / control" }] },
    });
    names({ message: error.message, details: error.details }, "K1");
  },
);

it("R005 names the actual conductor and its device endpoints", async () => {
  const ir = structuredClone(core),
    wire = ir.wires.find((w) => w.designation === "W-CTL-007");
  if (!wire) throw Error("Missing conductor");
  wire.properties = { ...wire.properties, label: "bad\u0001label" };
  const error = failure(await renderSchematic(ir, control()), "R005");
  names({ message: error.message, details: error.details }, "W-CTL-007", "K1");
});

it("R005 project title failures retain the authored view scope", async () => {
  const ir = structuredClone(core);
  ir.project.name = "bad\u0001name";
  const error = failure(await renderSchematic(ir, control()), "R005");
  expect(error.details).toMatchObject({
    diagnosticContext: { views: [{ viewIndex: 0, title: "K1 / control" }] },
  });
});

it("R006 invalid page names the authored packet view, without changing the message", async () => {
  const error = failure(
    await renderSchematicPacket(
      core,
      JSON.parse(
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          page: { size: "not-paper" },
          views: [
            {
              format: "documentation-view-request/0.1",
              kind: "bom",
              title: "Parts review",
            },
          ],
        }),
      ),
    ),
    "R006",
  );
  expect(error.message).toBe(
    "Use letter, tabloid, a4 or a3; landscape or portrait; and a margin from 5 to 25 mm.",
  );
  expect(error.details).toMatchObject({
    diagnosticContext: { views: [{ viewIndex: 0, title: "Parts review" }] },
  });
});

it("R006 implicit-sheet page failures resolve UID roots to a named view", async () => {
  const error = failure(
    await renderSchematicSheets(
      core,
      control(),
      undefined,
      JSON.parse('{"size":"not-paper"}'),
    ),
    "R006",
  );
  expect(error.details).toMatchObject({
    diagnosticContext: { views: [{ viewIndex: 0, title: "K1 / control" }] },
  });
});

it("R006 empty-view requests name the project and request field without inventing a view", async () => {
  const error = failure(
    await renderSchematicPacket(core, {
      format: "schematic-packet-request/0.1",
      views: [],
    }),
    "R006",
  );
  expect(error.details).toMatchObject({
    diagnosticContext: {
      projectName: core.project.name,
      requestField: "/views",
      views: [],
    },
  });
});

it("R006 view-budget failures name the first overflowing authored view", async () => {
  const views = Array.from({ length: 41 }, (_, i) => ({
    format: "documentation-view-request/0.1",
    kind: "bom",
    title: `Bill ${i}`,
  }));
  const error = failure(
    await renderSchematicPacket(
      core,
      JSON.parse(
        JSON.stringify({ format: "schematic-packet-request/0.1", views }),
      ),
    ),
    "R006",
  );
  expect(error.details).toMatchObject({
    diagnosticContext: { views: [{ viewIndex: 40, title: "Bill 40" }] },
  });
});

it("R006 keeps the authored circuit keys and device names together", async () => {
  const probe = cases.find((c) => c.code === "R006");
  if (!probe || !("packet" in probe)) throw Error("Missing R006 fixture");
  const error = failure(
    await renderSchematicPacket(probe.ir, probe.packet),
    "R006",
  );
  names(
    { message: error.message, details: error.details },
    "PX1",
    "supply",
    "output",
    "Sensor",
  );
});

it("YIELD R006 observed plan caps retain the native final legend owners", async () => {
  const ir = legendIr(core),
    before = JSON.stringify(ir);
  const error = failure(
    await renderSchematicPacket(ir, legendRequest(ir), presentation),
    "R006",
  );
  expect(error.details).toMatchObject({
    constraint: "legend-search-limit",
    searchCaps: ["axis-plans"],
    viewTitle: "K1 / control",
    legendEntries: [
      expect.objectContaining({
        designation: "PB1",
        deviceUid: device("PB1").uid,
      }),
      expect.objectContaining({
        designation: "PS1",
        deviceUid: device("PS1").uid,
      }),
    ],
  });
  assertNativeLegend(ir, error);
  names({ message: error.message }, "PB1", "PS1");
  expect(JSON.stringify(ir)).toBe(before);
}, 120000);

it("YIELD R006 sheet-limit fallback retains real legend identities through the public packet API", async () => {
  const ir = legendIr(core);
  rejectLegendCandidate("sheet-limit");
  const error = failure(
    await renderSchematicPacket(ir, legendRequest(ir), presentation),
    "R006",
  );
  expect(error.details).toMatchObject({
    constraint: "legend-search-limit",
    searchCaps: ["sheet-limit"],
  });
  assertNativeLegend(ir, error);
  expect(error.message).toContain("100-sheet packet limit");
  expect(error.message).not.toContain("page-cost bound");
}, 120000);

it("YIELD moved page-cost factory keeps the native authored views through a public failure", async () => {
  const ir = legendIr(core),
    costs = rejectLegendCandidate("page-cost");
  const error = failure(
    await renderSchematicPacket(ir, legendRequest(ir), presentation),
    "R006",
  );
  expect(
    costs.mock.results.some(
      (r) => r.type === "return" && r.value?.code === "R006",
    ),
  ).toBe(true);
  expect(error.details).toMatchObject({
    constraint: "page-cost-bound",
    views: [
      { viewIndex: 0, title: "M1 / power" },
      { viewIndex: 1, title: "K1 / control" },
    ],
  });
  names(
    { message: error.message, details: error.details },
    "M1 / power",
    "K1 / control",
  );
}, 120000);

it("YIELD zero candidates preserve the original device-scoped failure", async () => {
  const ir = legendIr(core);
  vi.spyOn(legendPagination, "legendPagination").mockImplementation(
    function* () {},
  );
  const error = failure(
    await renderSchematicPacket(ir, legendRequest(ir), presentation),
    "R006",
  );
  expect(error.message).not.toContain("Legend pagination");
  assertNativeLegend(ir, error);
}, 120000);

it.each([false, true])(
  "LOOP-SCALE cached fallback failure retains UID-selected device names (label fault: %s)",
  async (fault) => {
    const { ir, request } = await loopFixture(),
      before = JSON.stringify(ir);
    const capture = captureLoopFallback(fault);
    const error = failure(await renderSchematicPacket(ir, request), "R006");
    names({ message: error.message, details: error.details }, "AQ1", "V1");
    expect(error.details).toMatchObject({
      devices: expect.arrayContaining([
        expect.objectContaining({ designation: "AQ1" }),
        expect.objectContaining({ designation: "V1" }),
      ]),
    });
    const { outputs, chosen, reads } = capture();
    expect(outputs).toHaveLength(3);
    expect(chosen).toBe(outputs[1]);
    if (fault) {
      expect(reads).toBe(1);
      expect(error.message).toContain("out-of-bounds content");
    } else expect(error.message).toContain("cannot fit at readable");
    expect(JSON.stringify(ir)).toBe(before);
  },
  120000,
);
