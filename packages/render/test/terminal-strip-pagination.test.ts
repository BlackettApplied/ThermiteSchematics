import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { readFile } from "node:fs/promises";
import type { SchematicPacketRequest } from "../src/packet/types.js";
import { required } from "./fixtures.js";
import { longStrip } from "./terminal-strip-pagination-fixture.js";

function checkMarkerTargets(
  markers: ReturnType<typeof parseHTML>["document"]["documentElement"][],
  documents: { sheet: number; doc: ReturnType<typeof parseHTML>["document"] }[],
) {
  for (const marker of markers) {
    const target = marker.getAttribute("data-strip-target");
    const owner = documents.find(({ doc }) =>
      [...doc.querySelectorAll("[data-strip-terminal]")].some(
        (t) => t.getAttribute("data-strip-terminal") === target,
      ),
    );
    expect(owner).toBeDefined();
    expect(marker.textContent).toContain("XT-LONG continued");
    expect(marker.textContent).toMatch(
      new RegExp(`sheet ${String(owner!.sheet).padStart(2, "0")}\\.[A-D][1-6]`),
    );
    expect(marker.textContent).toContain(`terminal ${JSON.parse(target!)[1]}`);
  }
}
it("paginates a native device between terminals and resolves reciprocal final sheet destinations", async () => {
  const { ir, keys } = longStrip(),
    original = JSON.stringify(ir);
  const r = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    page: { size: "letter", orientation: "landscape" },
    index: true,
    references: false,
    views: [
      { format: "documentation-view-request/0.1", kind: "bom" },
      {
        format: "documentation-view-request/0.1",
        kind: "terminals",
        device: "XT-LONG",
      },
    ],
  });
  if (!r.ok) throw Error(JSON.stringify(r.error));
  expect(JSON.stringify(ir)).toBe(original);
  const strips = r.value.sheets.filter(
    (s) =>
      s.view.format === "documentation-view/0.1" &&
      s.view.kind === "terminal-strip",
  );
  expect(strips.length).toBeGreaterThan(1);
  const documents = strips.map((s) => ({
    sheet: s.number,
    doc: parseHTML(s.svg).document,
  }));
  expect(
    documents.flatMap(({ doc }) =>
      [...doc.querySelectorAll("[data-strip-terminal]")].map(
        (t) => JSON.parse(t.getAttribute("data-strip-terminal")!)[1],
      ),
    ),
  ).toEqual(keys);
  const chunks = documents.flatMap(({ doc }) => [
    ...doc.querySelectorAll("[data-terminal-strip]"),
  ]);
  const markers = documents.flatMap(({ doc }) => [
    ...doc.querySelectorAll("[data-strip-continuation]"),
  ]);
  expect(markers.length).toBe(2 * (chunks.length - 1));
  checkMarkerTargets(markers, documents);
  const bridges = documents.flatMap(({ doc }) => [
    ...doc.querySelectorAll("[data-strip-jumper]"),
  ]);
  expect(bridges.length).toBe(2);
  expect(
    bridges.map((b) => b.getAttribute("data-strip-jumper-end")).sort(),
  ).toEqual(["0", "1"]);
  expect(
    bridges.every(
      (b) =>
        b.getAttribute("data-strip-jumper") === "native-cross-sheet-jumper" &&
        b.textContent!.replace(/\s+/gu, " ").includes("continued on sheet"),
    ),
  ).toBe(true);
  for (const { doc } of documents)
    for (const t of doc.querySelectorAll("text"))
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
});
it("keeps generated supplementary inventories as tables without strip growth", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r = await renderSchematicPacket(
    c.ir,
    {
      format: "schematic-packet-request/0.1",
      index: false,
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Console feeder",
          conductors: ["W-C01"],
        },
      ],
    },
    c.presentation,
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  expect(
    r.value.sheets.some(
      (s) =>
        s.view.format === "documentation-view/0.1" &&
        s.view.kind === "terminal-strip",
    ),
  ).toBe(false);
  expect(
    r.value.sheets.some((s) =>
      parseHTML(s.svg).document.querySelector("[data-report-row]"),
    ),
  ).toBe(true);
});

type StripDocument = ReturnType<typeof parseHTML>["document"];
type StripElement = StripDocument["documentElement"];

function inventoryRows(docs: StripDocument[]) {
  return docs.flatMap((doc) =>
    [...doc.querySelectorAll("[data-strip-row]")].map((e) => [
      e.getAttribute("data-strip-row"),
      e.getAttribute("data-strip-ref"),
    ]),
  );
}

function stripRows(docs: StripDocument[]) {
  return docs.flatMap((doc) =>
    [...doc.querySelectorAll("[data-strip-terminal]")].map((e) => [
      e.getAttribute("data-inventory-row"),
      e.getAttribute("data-strip-ref"),
    ]),
  );
}

function assertSplitEnd(
  element: StripElement,
  doc: StripDocument,
  key: string,
) {
  expect(element.getAttribute("data-strip-at")).toBe(key);
  const body = required(
    [...doc.querySelectorAll("[data-strip-terminal]")].find(
      (e) => e.getAttribute("data-strip-terminal") === key,
    ),
  );
  const rect = required(body.querySelector("rect") ?? undefined);
  const path = required(
    element.querySelector("path")?.getAttribute("d") ?? undefined,
  );
  const [, x, y] = required(
    path.match(/^M ([-\d.]+) ([-\d.]+) /u) ?? undefined,
  );
  const left = Number(rect.getAttribute("x"));
  const top = Number(rect.getAttribute("y"));
  const right = left + Number(rect.getAttribute("width"));
  expect(
    Math.min(Math.abs(Number(x) - left), Math.abs(Number(x) - right)),
  ).toBeLessThan(0.002);
  expect(Number(y)).toBeGreaterThan(top);
  expect(Number(y)).toBeLessThan(top + Number(rect.getAttribute("height")));
}

function assertConsoleRows(
  ir: ElectricalIr,
  docs: StripDocument[],
  all: StripDocument[],
) {
  const xt = required(
    ir.devices.find((device) => device.designation === "XT-HMI"),
  );
  const type = required(ir.deviceTypes.find((model) => model.id === xt.typeId));
  const order = required(type.terminalOrder);
  const expected = order.map((key, i) => [
    JSON.stringify([xt.uid, key]),
    `T1/R${i + 1}`,
  ]);
  expect(stripRows(docs)).toEqual(expected);
  expect(inventoryRows(all)).toEqual(expected);
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "preserves split XT-HMI terminal order, inventory and physical jumper ends in the %s corpus variant",
  async (flow) => {
    const compiled = await compileProject("examples/operator-console");
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const { ir, presentation } = compiled;
    const request: SchematicPacketRequest = JSON.parse(
      await readFile("examples/operator-console/packet.request.json", "utf8"),
    );
    const views = request.views.map((v) => ("flow" in v ? { ...v, flow } : v));
    const r = await renderSchematicPacket(
      ir,
      { ...request, views },
      presentation,
    );
    if (!r.ok) throw Error(r.error.message);
    const strip = r.value.sheets.filter(
      (sheet) => sheet.view.kind === "terminal-strip",
    );
    expect(strip).toHaveLength(2);
    const docs = strip.map((s) => parseHTML(s.svg).document);
    assertConsoleRows(
      ir,
      docs,
      r.value.sheets.map((s) => parseHTML(s.svg).document),
    );
    const split = docs.flatMap((doc, i) =>
      [...doc.querySelectorAll("[data-strip-jumper-end]")].map((element) => ({
        element,
        doc,
        sheet: required(strip[i]).number,
      })),
    );
    expect(split).toHaveLength(4);
    for (const designation of ["J-HMI-4-13", "J-HMI-12-14"]) {
      const source = required(
        ir.jumpers.find((j) => j.designation === designation),
      );
      for (const [end, { terminal }] of source.endpoints.entries()) {
        const entry = required(
          split.find(
            ({ element }) =>
              element.getAttribute("data-strip-jumper") === source.uid &&
              element.getAttribute("data-strip-jumper-end") === String(end),
          ),
        );
        assertSplitEnd(
          entry.element,
          entry.doc,
          JSON.stringify([terminal.deviceUid, terminal.terminalKey]),
        );
        const peer = required(
          split.find(
            ({ element, sheet }) =>
              sheet !== entry.sheet &&
              element.getAttribute("data-strip-jumper") === source.uid,
          ),
        );
        expect(entry.element.textContent?.replace(/\s+/gu, " ")).toMatch(
          new RegExp(`continued on sheet ${peer.sheet}\\.[A-D][1-6]`, "u"),
        );
      }
    }
  },
);

it("keeps a device-filtered TB1 in its authored 2, 1 order with the same inventory identities", async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const { ir, presentation } = compiled;
  const tb1 = required(ir.devices.find((d) => d.designation === "TB1"));
  const type = required(ir.deviceTypes.find((d) => d.id === tb1.typeId));
  type.terminalOrder = [
    "2",
    "1",
    ...type.terminals
      .map((t) => t.key)
      .filter((key) => key !== "1" && key !== "2"),
  ];
  const r = await renderSchematicPacket(
    ir,
    {
      format: "schematic-packet-request/0.1",
      index: false,
      views: [
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          filter: { devices: ["TB1"] },
        },
      ],
    },
    presentation,
  );
  if (!r.ok) throw Error(r.error.message);
  const docs = r.value.sheets.map((sheet) => parseHTML(sheet.svg).document);
  const rows = stripRows(docs);
  expect(rows).toEqual(
    type.terminalOrder.map((key, i) => [
      JSON.stringify([tb1.uid, key]),
      `T1/R${i + 1}`,
    ]),
  );
  expect(inventoryRows(docs)).toEqual(rows);
});
