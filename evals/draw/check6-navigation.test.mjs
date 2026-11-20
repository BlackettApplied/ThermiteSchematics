import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import {
  createNavigationProject,
  renderNavigationFixture,
} from "./check6-navigation-fixture.mjs";
import { packetSemanticObservations } from "./navigation-strict.mjs";
import { observation } from "./evaluate.mjs";
import { mutatePortSvg, mutateElementSvg } from "./check6-svg-mutants.mjs";
import { assess, exitCode } from "./assessment.mjs";
import { attachIdentities, svgLocators } from "./locators.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as packing from "../../packages/render/dist/packet/circuit-part-packing.js";
let browser, context, page, project;
const fixtures = new Map();
beforeAll(async () => {
  project = await createNavigationProject();
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  if (process.env.THERMITE_CHECK6_FIXTURE_OUT)
    for (const flow of ["left-to-right", "top-to-bottom", "unpacked"])
      await fixtureFor(flow);
});
async function measureFixture(flow) {
  let x;
  if (flow === "unpacked") {
    const planner = packing.circuitPartRows;
    const spy = vi
      .spyOn(packing, "circuitPartRows")
      .mockImplementation((groups, field) =>
        planner(groups, { ...field, flow: "left-to-right" }),
      );
    try {
      x = await renderNavigationFixture(project, "top-to-bottom");
    } finally {
      spy.mockRestore();
    }
  } else x = await renderNavigationFixture(project, flow);
  x.geometries = [];
  for (const s of x.packet.sheets)
    x.geometries.push(await openSheet(page, s.svg));
  if (process.env.THERMITE_CHECK6_FIXTURE_OUT) {
    const dest = join(process.env.THERMITE_CHECK6_FIXTURE_OUT, flow);
    await mkdir(dest, { recursive: true });
    for (const sheet of x.packet.sheets)
      await writeFile(
        join(dest, `sheet-${String(sheet.number).padStart(3, "0")}.svg`),
        sheet.svg,
      );
    for (const key of ["packet", "ir", "request"])
      await writeFile(
        join(dest, key + ".json"),
        JSON.stringify(x[key], null, 2) + "\n",
      );
    await writeFile(
      join(dest, "strict-rows.json"),
      JSON.stringify(strictRows(x), null, 2) + "\n",
    );
  }
  return x;
}
function fixtureFor(flow) {
  // Render and measure each variant once, in the test that first needs it.
  // Focused runs also measure every variant their assertions consume.
  if (!fixtures.has(flow)) fixtures.set(flow, measureFixture(flow));
  return fixtures.get(flow);
}
afterAll(async () => {
  await context?.close();
  await browser?.close();
  if (project) await rm(project.directory, { recursive: true, force: true });
});
function strictRows(x) {
  return packetSemanticObservations(
    { id: "check6-fixture" },
    x.packet,
    x.geometries,
    x.ir,
    x.request,
    observation,
  ).filter((r) => r.id.includes("/check6-"));
}
it.each(["left-to-right", "top-to-bottom"])(
  "CHECK6 adopts both native navigation oracles (%s)",
  async (flow) => {
    const x = await fixtureFor(flow),
      rows = strictRows(x);
    expect([...new Set(rows.map((r) => r.owner))].sort()).toEqual([
      "#396",
      "#398",
    ]);
    expect(rows.every((r) => r.dq === "DQ-08" && r.status === "pass")).toBe(
      true,
    );
    expect(
      rows
        .filter((r) => r.owner === "#396")
        .flatMap((r) => r.evidence.obligations),
    ).toHaveLength(6);
    expect(
      rows
        .filter((r) => r.owner === "#398")
        .flatMap((r) => r.evidence.obligations),
    ).toHaveLength(16);
  },
);

it("CHECK6 native parts pack and final element/port destinations renumber", async () => {
  const packed = await fixtureFor("top-to-bottom");
  const unpacked = await fixtureFor("unpacked");
  const parts = (fixture) =>
    fixture.packet.sheets.flatMap((s, i) =>
      fixture.geometries[i].tranche4.circuitParts.map((p) => ({
        sheet: s.number,
        part: p.part,
        terminals: p.terminals.map((t) => [t.deviceUid, t.terminal]).sort(),
      })),
    );
  const before = parts(unpacked),
    after = parts(packed);
  expect(strictRows(unpacked).every((r) => r.status === "pass")).toBe(true);
  expect(unpacked.request).toEqual(packed.request);
  expect(unpacked.ir).toEqual(packed.ir);
  expect(new Set(before.map((p) => p.sheet)).size).toBe(2);
  expect(new Set(after.map((p) => p.sheet)).size).toBe(1);
  expect(after.map(({ sheet, ...p }) => p)).toEqual(
    before.map(({ sheet, ...p }) => p),
  );
  for (const owner of ["#396", "#398"]) {
    const obligations = (fixture) =>
      strictRows(fixture)
        .filter((r) => r.owner === owner)
        .flatMap((r) => r.evidence.obligations);
    const old = obligations(unpacked),
      current = obligations(packed);
    expect(current).toHaveLength(old.length);
    const oldCircuitSheets = new Set(before.map((p) => p.sheet));
    const reduction =
      oldCircuitSheets.size - new Set(after.map((p) => p.sheet)).size;
    for (const [i, o] of current.entries()) {
      const previous = old[i].targetSheet;
      const expected = oldCircuitSheets.has(previous)
        ? after[0].sheet
        : previous - reduction;
      expect(o.targetSheet).toBe(expected);
    }
  }
});

function strictExit(x, rows) {
  for (const r of rows) {
    const s = x.packet.sheets.find((s) => s.number === r.sheet);
    attachIdentities(
      [r],
      svgLocators(s.svg, x.ir, s.view),
      s.view,
      x.ir,
      "check6-fixture",
    );
  }
  assess(
    rows,
    { format: "thermite-draw-expectations/2.0", markers: [] },
    new Set(["check6-fixture"]),
  );
  return exitCode(rows);
}
async function mutatedFixture(flow, owner, kind) {
  const x = await fixtureFor(flow),
    rows = strictRows(x);
  const o = rows
    .filter((r) => r.owner === owner)
    .flatMap((r) => r.evidence.obligations)
    .find((o) =>
      owner === "#396"
        ? o.sourceFunction === "aux95"
        : o.designation === "N05" && o.portKey === "IN",
    );
  expect(o).toBeDefined();
  const i = x.packet.sheets.findIndex((s) => s.number === o.sheet),
    packet = { ...x.packet, sheets: x.packet.sheets.map((s) => ({ ...s })) };
  packet.sheets[i].svg =
    owner === "#396"
      ? mutateElementSvg(packet.sheets[i].svg, kind)
      : mutatePortSvg(packet.sheets[i].svg, o, kind);
  const geometries = [...x.geometries];
  geometries[i] = await openSheet(page, packet.sheets[i].svg);
  return { ...x, packet, geometries };
}
for (const flow of ["left-to-right", "top-to-bottom"]) {
  it.each([
    "swap",
    "missing",
    "anonymous",
    "wrong zone",
    "metadata-only",
    "borrowing",
    "stale sheet",
  ])(`CHECK6 strict SVG per-port negative ${flow}: %s`, async (kind) => {
    const x = await mutatedFixture(flow, "#398", kind),
      rows = strictRows(x).filter((r) => r.owner === "#398");
    expect(
      rows.some((r) =>
        r.evidence.findings.some(
          (f) => f.designation === "N05" && f.portKey === "IN",
        ),
      ),
    ).toBe(true);
    expect(strictExit(x, rows)).toBe(1);
  });
  it.each(["missing", "metadata-only", "stale sheet"])(
    `CHECK6 strict SVG element negative ${flow}: %s`,
    async (kind) => {
      const x = await mutatedFixture(flow, "#396", kind),
        rows = strictRows(x).filter((r) => r.owner === "#396");
      expect(
        rows.some((r) =>
          r.evidence.findings.some(
            (f) =>
              f.deviceUid ===
              x.ir.devices.find((d) => d.designation === "OL1").uid,
          ),
        ),
      ).toBe(true);
      expect(strictExit(x, rows)).toBe(1);
    },
  );
}
