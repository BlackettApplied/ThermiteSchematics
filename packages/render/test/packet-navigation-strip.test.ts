import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { parseSvg } from "./off-view-fixtures.js";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import {
  createSelfLoopIr,
  createTerminalIr,
} from "../../query/test/fixtures.js";
import { tableDrafts } from "../src/packet/reports.js";
import { appendTerminalStrips } from "../src/packet/terminal-strip.js";
import { assembleSheets } from "../src/packet/assembly.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { locateStripSheets } from "../src/packet/terminal-strip-landings.js";
import { finalizeWireSchedules } from "../src/packet/wire-schedule-locations.js";
import type { RenderedSheet } from "../src/packet/types.js";

const tb1Plan = {
  format: "documentation-view-request/0.1" as const,
  kind: "terminals" as const,
  device: "TB1",
};
const wires = {
  format: "documentation-view-request/0.1" as const,
  kind: "wires" as const,
};
function indexDeviceCell(sheet: RenderedSheet, number: number) {
  return [...parseSvg(sheet.svg).querySelectorAll("[data-report-row]")]
    .find((r) => r.getAttribute("data-report-row") === String(number))
    ?.querySelector('[data-report-column="3"]')
    ?.textContent?.trim();
}

function scheduleCells(sheets: readonly RenderedSheet[], key: string) {
  const row = sheets
    .filter((s) => s.view.kind === "wires")
    .flatMap((s) => [...parseSvg(s.svg).querySelectorAll("[data-report-row]")])
    .find((el) => el.getAttribute("data-report-row") === key);
  return [6, 7].map((column) =>
    row?.querySelector(`[data-report-column="${column}"]`)?.textContent?.trim(),
  );
}

function stripScheduleFixture(ir: ElectricalIr, device = tb1Plan.device) {
  const paper = normalizePaperPage();
  if (!paper.ok) throw Error(paper.error.message);
  const page = paper.value;
  const drafts = appendTerminalStrips(
    [{ ...tb1Plan, device }, wires].flatMap((view) => {
      const report = tableDrafts(
        ir,
        buildDocumentation(ir, view),
        undefined,
        page,
        true,
      );
      if (!report.ok) throw Error(report.error.message);
      return report.value;
    }),
  );
  const baseline = assembleSheets(ir, drafts, page);
  const issued = (alter: (svg: string) => string = (svg) => svg) => {
    const sheets = baseline.map((s) =>
      s.view.kind === "terminal-strip" ? { ...s, svg: alter(s.svg) } : s,
    );
    const locations = locateStripSheets(ir, drafts, sheets, page);
    finalizeWireSchedules(ir, structuredClone(drafts), sheets, page, locations);
    return sheets;
  };
  return { page, drafts, baseline, issued };
}

async function motorStarterStripFixture() {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const cable = c.ir.cables.find((k) => k.designation === "CBL1")!;
  return {
    ir: c.ir,
    key: JSON.stringify([cable.uid, "2-"]),
    ...stripScheduleFixture(c.ir),
  };
}

it("indexes filtered strip devices and distinguishes repeated strip fragments from inventories", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r = await renderSchematicPacket(
    c.ir,
    {
      format: "schematic-packet-request/0.1",
      index: true,
      references: { appearances: "drawings" },
      views: [tb1Plan, tb1Plan, wires],
    },
    c.presentation,
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const strips = r.value.sheets.filter((s) => s.view.kind === "terminal-strip");
  const indexes = r.value.sheets.filter((s) => s.view.kind === "index");
  expect(strips).toHaveLength(2);
  for (const sheet of strips) {
    const indexCells = indexes
      .map((s) => indexDeviceCell(s, sheet.number))
      .filter((v) => v !== undefined);
    expect(indexCells).toEqual(["TB1"]);
    expect(sheet.references).toEqual([
      expect.objectContaining({
        deviceUid: c.ir.devices.find((d) => d.designation === "TB1")!.uid,
        designation: "TB1",
        representation: "terminal-strip",
        zone: expect.stringMatching(/^[A-D][1-6]$/u),
      }),
    ]);
  }
  const references = r.value.sheets
    .filter((s) => s.view.kind === "references")
    .flatMap((s) =>
      [...parseSvg(s.svg).querySelectorAll("text")].map((t) => t.textContent),
    );
  const printed = references.join(" ");
  expect(printed).toContain("Terminal strip");
  for (const s of strips)
    expect(printed).toContain(`${s.number} / ${s.references[0]!.zone}`);
  expect(printed).not.toContain("Terminal / schedule");
  const cable = c.ir.cables.find((x) => x.designation === "CBL1")!;
  expect(
    scheduleCells(r.value.sheets, JSON.stringify([cable.uid, "2-"])),
  ).toEqual([
    expect.stringMatching(
      new RegExp(`^${String(strips[0]!.number).padStart(2, "0")}\\.`),
    ),
    "not drawn",
  ]);
});

it("requires a painted native strip body and the exact conductor path before crediting an endpoint", async () => {
  const { key, issued } = await motorStarterStripFixture();
  expect(scheduleCells(issued(), key)).toEqual([
    expect.stringMatching(/^\d+\.[A-D][1-6]$/u),
    "not drawn",
  ]);
  const removeCore = (svg: string, hide: boolean) =>
    svg.replace(
      /(<g data-strip-incidence="[^"]*2-[^"]*"[^>]*>\s*)(<path[^>]*\/>)/gu,
      (_, group: string, path: string) =>
        group + (hide ? path.replace("<path ", '<path opacity="0" ') : ""),
    );
  for (const hide of [false, true])
    expect(
      scheduleCells(
        issued((s) => removeCore(s, hide)),
        key,
      ),
    ).toEqual(["not drawn", "not drawn"]);
  const empty = issued((s) =>
    s.replace("data-terminal-strip=", 'display="none" data-terminal-strip='),
  );
  expect(scheduleCells(empty, key)).toEqual(["not drawn", "not drawn"]);
  expect(
    empty.find((s) => s.view.kind === "terminal-strip")?.references,
  ).toEqual([]);
});

function editCoreLanding(
  svg: string,
  key: string,
  edit: (path: Element, rect: Element, label: Element) => void,
) {
  const doc = parseSvg(svg);
  const stub = [...doc.querySelectorAll("[data-strip-incidence]")].find(
    (g) => g.getAttribute("data-strip-incidence") === key,
  )!;
  const terminal = [...doc.querySelectorAll("[data-strip-terminal]")].find(
    (g) =>
      g.getAttribute("data-strip-terminal") ===
      stub.getAttribute("data-strip-at"),
  )!;
  edit(
    stub.querySelector("path")!,
    terminal.querySelector("rect")!,
    terminal.querySelector("text")!,
  );
  return doc.toString();
}

const landingControls = [
  {
    name: "stub start outside the terminal body",
    edit(path: Element, rect: Element) {
      const data = path.getAttribute("d")!;
      const start = /^M (-?[\d.]+) (-?[\d.]+)/u.exec(data)!;
      const left = Number(rect.getAttribute("x"));
      const right = left + Number(rect.getAttribute("width"));
      const x = Number(start[1]) < (left + right) / 2 ? left - 1 : right + 1;
      path.setAttribute("d", data.replace(start[0], `M ${x} ${start[2]}`));
    },
  },
  {
    name: "hidden rect under a visible stub",
    edit(_path: Element, rect: Element) {
      rect.setAttribute("opacity", "0");
    },
  },
  {
    name: "wrong painted terminal label",
    edit(_path: Element, _rect: Element, label: Element) {
      label.textContent = "WRONG";
    },
  },
];

it.each(landingControls)("withholds credit for a $name", async ({ edit }) => {
  const { issued, key } = await motorStarterStripFixture();
  expect(scheduleCells(issued(), key)).toEqual([
    expect.stringMatching(/^\d+\.[A-D][1-6]$/u),
    "not drawn",
  ]);
  const changed = issued((svg) => editCoreLanding(svg, key, edit));
  expect(scheduleCells(changed, key)).toEqual(["not drawn", "not drawn"]);
});

it("credits both strip ends of a self-loop only when both stubs are painted", () => {
  const ir = createSelfLoopIr();
  const { issued } = stripScheduleFixture(ir, "DEV.1");
  const key = ir.wires[0]!.uid;
  const [first, second] = scheduleCells(issued(), key);
  expect(first).toMatch(/^\d+\.[A-D][1-6]$/u);
  expect(second).toBe(first);
  for (const hidden of [0, 1]) {
    const changed = issued((svg) => {
      const doc = parseSvg(svg);
      const paths = doc.querySelectorAll(
        `[data-strip-incidence="${key}"] path`,
      );
      expect(paths).toHaveLength(2);
      paths[hidden]!.setAttribute("opacity", "0");
      return doc.toString();
    });
    expect(scheduleCells(changed, key)).toEqual(["not drawn", "not drawn"]);
  }
});

it("throws when a painted strip landing is outside its navigation field", async () => {
  const { ir, drafts, baseline, page } = await motorStarterStripFixture();
  const smallerFields = drafts.map((draft) =>
    draft.terminalStrip && draft.drawingBounds
      ? { ...draft, drawingBounds: { ...draft.drawingBounds, w: 1 } }
      : draft,
  );
  expect(() => locateStripSheets(ir, smallerFields, baseline, page)).toThrow(
    "Drawn strip landing is outside its navigation field",
  );
});

it("lists both strip locations for a device split across columns on one sheet", async () => {
  const terminalKeys = Array.from({ length: 28 }, (_, i) => String(i + 1));
  const ir = createTerminalIr([
    {
      uid: "wide-strip",
      designation: "TB1",
      terminalKeys,
    },
  ]);
  const type = ir.deviceTypes[0]!;
  type.terminals = terminalKeys.map((key) => ({ key, source: type.source }));
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    index: true,
    references: { appearances: "drawings" },
    views: [tb1Plan],
  });
  if (!result.ok) throw Error(result.error.message);
  const strips = result.value.sheets.filter(
    (s) => s.view.kind === "terminal-strip",
  );
  expect(strips).toHaveLength(1);
  const sheet = strips[0]!;
  const fragments = parseSvg(sheet.svg).querySelectorAll(
    "[data-terminal-strip]",
  );
  expect(fragments).toHaveLength(2);
  const anchors = sheet.references.filter(
    (r) => r.representation === "terminal-strip",
  );
  expect(anchors).toHaveLength(2);
  expect(anchors[0]!.xMm).toBeLessThan(anchors[1]!.xMm!);
  expect(anchors[0]!.zone).not.toBe(anchors[1]!.zone);
  const rows = result.value.sheets
    .filter((s) => s.view.kind === "references")
    .flatMap((s) => [...parseSvg(s.svg).querySelectorAll("[data-report-row]")]);
  expect(rows).toHaveLength(1);
  expect(
    rows[0]?.querySelector('[data-report-column="2"]')?.textContent?.trim(),
  ).toBe("Terminal strip");
  expect(
    rows[0]
      ?.querySelector('[data-report-column="3"]')
      ?.textContent?.trim()
      .split(/;\s*/u),
  ).toEqual(anchors.map(({ zone }) => `${sheet.number} / ${zone}`));
});
