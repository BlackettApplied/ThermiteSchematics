import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { buildDocumentation } from "@thermite/query";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { stripHeadingLines } from "../src/packet/terminal-strip-layout.js";
import {
  printableTextLeftOverhang,
  printableTextMetrics,
  printableTextRightExtent,
} from "../src/text-metrics.js";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { readFile } from "node:fs/promises";
import type {
  RenderedSheet,
  SchematicPacketRequest,
} from "../src/packet/types.js";

function fixture() {
  const keys = ["3", "1", "2"];
  const ir = createTerminalIr([
    { uid: "strip-uid", designation: "XT1", terminalKeys: keys },
    { uid: "panel-uid", designation: "P1", terminalKeys: keys },
    { uid: "field-uid", designation: "F1", terminalKeys: keys },
  ]);
  ir.deviceTypes[0]!.terminalOrder = keys;
  ir.devices[0]!.location = ir.devices[1]!.location = "Panel";
  ir.devices[2]!.location = "Field";
  const source = ir.devices[0]!.source;
  const end = (deviceUid: string, terminalKey: string) => ({
    terminal: { deviceUid, terminalKey },
    source,
  });
  ir.wires = [
    {
      uid: "wire-panel",
      designation: "W-P",
      aliases: [],
      source,
      endpoints: [end("strip-uid", "3"), end("panel-uid", "1")],
    },
    {
      uid: "wire-field",
      designation: "W-F",
      aliases: [],
      source,
      endpoints: [end("field-uid", "2"), end("strip-uid", "1")],
    },
  ];
  ir.jumpers = [
    {
      uid: "bridge-uid",
      designation: "J1",
      aliases: [],
      source,
      endpoints: [end("strip-uid", "3"), end("strip-uid", "2")],
    },
  ];
  return ir;
}
const view = {
  format: "documentation-view-request/0.1" as const,
  kind: "terminals" as const,
  device: "XT1",
};

function locationCells(sheets: readonly RenderedSheet[], key: string) {
  return sheets
    .filter((s) => s.view.kind === "wires")
    .flatMap((s) =>
      [...parseHTML(s.svg).document.querySelectorAll("[data-report-row]")]
        .filter((r) => r.getAttribute("data-report-row") === key)
        .map((r) =>
          [6, 7].map((i) =>
            r.querySelector(`[data-report-column="${i}"]`)?.textContent?.trim(),
          ),
        ),
    )[0];
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "fills exact strip-only wire, jumper and core cells while retaining established schematic destinations in %s",
  async (flow) => {
    const c = await compileProject("examples/conveyor-line");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const power = {
      format: "schematic-view-request/0.1" as const,
      family: "power" as const,
      flow,
      root: { by: "designation" as const, value: "M1" },
    };
    const request: SchematicPacketRequest = {
      format: "schematic-packet-request/0.1",
      index: false,
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        power,
        { format: "documentation-view-request/0.1", kind: "wires" },
      ],
    };
    const before = await renderSchematicPacket(c.ir, request, c.presentation);
    const after = await renderSchematicPacket(
      c.ir,
      {
        ...request,
        views: [...request.views, { ...view, device: "TB1" }],
      },
      c.presentation,
    );
    if (!before.ok || !after.ok)
      throw Error(JSON.stringify({ before: before.ok, after: after.ok }));
    const strip = after.value.sheets.find(
      (s) => s.view.kind === "terminal-strip",
    )!;
    const sheetPrefix = String(strip.number).padStart(2, "0");
    const cable = c.ir.cables.find((x) => x.designation === "CBL1")!;
    for (const key of [
      c.ir.wires.find((w) => w.designation === "W-CTL-004")!.uid,
      c.ir.jumpers.find((j) => j.designation === "JP1")!.uid,
      JSON.stringify([cable.uid, "2-"]),
    ]) {
      const old = locationCells(before.value.sheets, key)!;
      const cells = locationCells(after.value.sheets, key)!;
      expect(old).toContain("not drawn");
      expect(
        cells.some(
          (v, i) => old[i] === "not drawn" && v?.startsWith(sheetPrefix + "."),
        ),
      ).toBe(true);
      for (const [i, value] of old.entries())
        if (value !== "not drawn") expect(cells[i]).toBe(value);
    }
    const core = locationCells(
      after.value.sheets,
      JSON.stringify([cable.uid, "2-"]),
    );
    expect(core).toContain("not drawn"); // JB1 is outside this strip's filter.
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "routes split XT-HMI jumper endpoints to the physical fragment in %s",
  async (flow) => {
    const c = await compileProject("examples/operator-console");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const request: SchematicPacketRequest = JSON.parse(
      await readFile("examples/operator-console/packet.request.json", "utf8"),
    );
    const views = request.views.map((v) => ("flow" in v ? { ...v, flow } : v));
    const r = await renderSchematicPacket(
      c.ir,
      { ...request, index: false, views },
      c.presentation,
    );
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const strips = r.value.sheets.filter(
      (s) => s.view.kind === "terminal-strip",
    );
    expect(strips).toHaveLength(2);
    for (const name of ["J-HMI-4-13", "J-HMI-12-14"]) {
      const jumper = c.ir.jumpers.find((j) => j.designation === name)!;
      const cells = locationCells(r.value.sheets, jumper.uid)!;
      const remoteEnd = jumper.endpoints.findIndex((e) =>
        ["13", "14"].includes(e.terminal.terminalKey),
      );
      const remote = cells[remoteEnd];
      // The opposite endpoint has a schematic landing as well as a strip body.
      expect(cells[1 - remoteEnd]).toMatch(/^0[1-9]\.[A-D][1-6]$/u);
      expect(remote).toMatch(
        new RegExp(
          `^${String(strips[1]!.number).padStart(2, "0")}\\.[A-D][1-6]$`,
        ),
      );
    }
  },
);
async function drawing(ir = fixture()) {
  const before = JSON.stringify(ir);
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    index: false,
    views: [view],
  });
  expect(JSON.stringify(ir)).toBe(before);
  if (!result.ok) throw Error(result.error.message);
  return {
    ir,
    packet: result.value,
    document: parseHTML(result.value.sheets.map((s) => s.svg).join("\n"))
      .document,
  };
}
it("draws authored terminal order and only native jumper geometry with reciprocal inventory references", async () => {
  const { ir, packet, document } = await drawing();
  const terminals = [...document.querySelectorAll("[data-strip-terminal]")];
  expect(
    terminals.map((e) => JSON.parse(e.getAttribute("data-strip-terminal")!)),
  ).toEqual(["3", "1", "2"].map((key) => ["strip-uid", key]));
  expect(terminals.every((t) => t.querySelector("rect"))).toBe(true);
  expect(terminals.map((t) => t.getAttribute("data-strip-ref"))).toEqual([
    "T1/R1",
    "T1/R2",
    "T1/R3",
  ]);
  for (const t of terminals) {
    const key = JSON.parse(t.getAttribute("data-strip-terminal")!)[1];
    expect([...t.querySelectorAll("text")].map((e) => e.textContent)).toEqual([
      key,
      t.getAttribute("data-strip-ref"),
      "S01",
    ]);
  }

  const bridges = [...document.querySelectorAll("[data-strip-jumper]")];
  expect(bridges.map((b) => b.getAttribute("data-strip-jumper"))).toEqual([
    "bridge-uid",
  ]);
  expect(bridges[0]!.querySelector("path")).toBeTruthy();
  for (const t of terminals) {
    const id = t.getAttribute("data-strip-terminal")!;
    const row = [...document.querySelectorAll("[data-report-row]")].find(
      (r) => r.getAttribute("data-report-row") === id,
    )!;
    expect(row.getAttribute("data-strip-ref")).toBe(
      t.getAttribute("data-strip-ref"),
    );
    expect(t.getAttribute("data-inventory-row")).toBe(id);
    expect(
      [...document.querySelectorAll("text")]
        .map((t) => t.textContent)
        .join(" "),
    ).toContain(t.getAttribute("data-strip-ref"));
  }
  expect(document.querySelectorAll("[data-report-row]").length).toBe(
    buildDocumentation(ir, view).rows.length,
  );
  expect(packet.sheets.length).toBeLessThanOrEqual(2);
  for (const label of ["W-P", "W-F", "P1.1", "F1.2", "hardware unspecified"])
    expect(
      [...document.querySelectorAll("text")]
        .map((t) => t.textContent)
        .join(" "),
    ).toContain(label);
  for (const t of document.querySelectorAll("text"))
    expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
});
it("does not derive a bridge from a shared net or device function", async () => {
  const ir = fixture();
  ir.jumpers = [];
  const { document } = await drawing(ir);
  expect(document.querySelectorAll("[data-strip-jumper]").length).toBe(0);
  expect(document.querySelectorAll("[data-strip-terminal]").length).toBe(3);
});
it("keeps missing order and hardware visibly unspecified", async () => {
  const ir = fixture();
  delete ir.deviceTypes[0]!.terminalOrder;
  const { document } = await drawing(ir);
  expect(
    [...document.querySelectorAll("text")].map((t) => t.textContent).join(" "),
  ).toContain("order unspecified");
  expect(
    [...document.querySelectorAll("text")].map((t) => t.textContent).join(" "),
  ).toContain("hardware unspecified");
  expect(document.querySelector("[data-strip-accessory]")).toBeNull();
});
it("is deterministic and affects only terminal-plan sheets", async () => {
  const a = await drawing(),
    b = await drawing();
  expect(a.packet).toEqual(b.packet);
  const result = await renderSchematicPacket(fixture(), {
    format: "schematic-packet-request/0.1",
    index: false,
    views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
  });
  if (!result.ok) throw Error(result.error.message);
  expect(
    result.value.sheets.some((s) => s.svg.includes("data-strip-terminal")),
  ).toBe(false);
});
it("uses painted ink only for bundled glyphs and reduces strip heading wrap width only by actual left shift", () => {
  const fallback = "Field cable 🌐 cabinet";
  const fallbackMetrics = printableTextMetrics(fallback, 2.6);
  expect(printableTextRightExtent(fallback, 2.6)).toBeGreaterThanOrEqual(
    Math.max(fallbackMetrics.advance, fallbackMetrics.right),
  );
  expect(printableTextLeftOverhang("🌐 Field", 2.6)).toBe(0);
  expect(printableTextLeftOverhang("𝒿 🌐", 2.6, true)).toBeGreaterThan(0);

  const bundled = "Field cable cabinet";
  const bundledMetrics = printableTextMetrics(bundled, 2.6);
  expect(printableTextRightExtent(bundled, 2.6)).toBe(bundledMetrics.right);

  const heading = "𝒿B1 — order unspecified; declaration listing";
  const exactRight = printableTextRightExtent(heading, 2.5, true);
  // Width between unshifted extent and column-0 shifted extent (+0.446 mm):
  // column 0 shifts and wraps, while column 1 does not move and stays on one line.
  const tightWidth = exactRight + 0.2;
  const fieldLeft = 28;
  expect(
    stripHeadingLines(heading, tightWidth, fieldLeft + 0.5, fieldLeft).length,
  ).toBe(2);
  expect(
    stripHeadingLines(
      heading,
      tightWidth,
      fieldLeft + 0.5 + tightWidth + 8,
      fieldLeft,
    ),
  ).toEqual([heading]);
});
