import { assertTagRows } from "./helpers/tag-row-source.js";
import type { ElectricalIr } from "@thermite/compiler";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createQueryEngine } from "@thermite/query";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { prepareSchematicDrawing, renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket, printPacketHtml } from "../src/sheets.js";
import {
  transformerFixture,
  transformerFlows,
  transformerRequest,
} from "./transformer-control-fixture.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { SYMBOL_PROFILES } from "@thermite/schema";
import { packetPdf } from "../../cli/src/alpha-pdf.js";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const forbidden =
  /\b(?:AC|DC|polarity|ratio|ground(?:ed|ing)?|bond(?:ed|ing)?|voltage|ratings?|VA|VAC|VDC)\b|[+−]/i;
const normalizedText = (s: string) => s.replace(/\s+/gu, " ").trim();
/** Independently prove every permitted tag phrase comes exactly from authored IR. */
function authoredTagBlocks(
  document: ReturnType<typeof parseHTML>["document"],
  ir: ElectricalIr,
) {
  const blocks: string[] = [];
  for (const entry of document.querySelectorAll(
    "g[data-device-legend-entry]",
  )) {
    const uid = entry.getAttribute("data-tag-owner-uid"),
      d = ir.devices.find((d) => d.uid === uid)!;
    expect(d).toBeDefined();
    const type = ir.deviceTypes.find((t) => t.id === d.typeId)!;
    const expected = {
      designation: d.designation,
      description: d.description?.trim() ? d.description : type.description,
      part: type.catalog?.orderNumber,
    };
    const rows = [...entry.querySelectorAll("text")];
    expect(
      rows.every((row) => {
        const field = row.getAttribute("data-tag-field");
        return (
          field != null &&
          Object.hasOwn(expected, field) &&
          Boolean(expected[field as keyof typeof expected]?.trim())
        );
      }),
    ).toBe(true);
    // Removing an authored block must not also erase an injected unowned text
    // element, title, or raw text node from the forbidden-claim oracle.
    expect(entry.textContent).toBe(rows.map((row) => row.textContent).join(""));
    expect(rows.map((row) => row.getAttribute("data-tag-field"))).toEqual(
      Object.keys(expected).flatMap((field) =>
        rows
          .filter((row) => row.getAttribute("data-tag-field") === field)
          .map(() => field),
      ),
    );
    const fields: string[] = [];
    for (const [field, value] of Object.entries(expected)) {
      const actual = [
        ...entry.querySelectorAll(`text[data-tag-field="${field}"]`),
      ];
      assertTagRows(
        actual,
        field === "part" ? (value ?? "") : normalizedText(value ?? ""),
      );
      if (value?.trim()) fields.push(normalizedText(value));
    }
    blocks.push(fields.join(" "));
    entry.remove();
  }
  return blocks;
}
function noInferredClaims(svg: string, ir: ElectricalIr) {
  const document = parseHTML(svg).document;
  authoredTagBlocks(document, ir);
  expect(document.querySelector("svg")!.textContent).not.toMatch(forbidden);
}
function noInferredHtmlClaims(html: string, ir: ElectricalIr) {
  const document = parseHTML(html).document;
  document.querySelectorAll("script, style").forEach((e) => e.remove());
  authoredTagBlocks(document, ir);
  expect(document.body.textContent).not.toMatch(forbidden);
}
it("rejects an unauthored electrical claim hidden in a legitimate legend entry in SVG and HTML", async () => {
  const f = await transformerFixture();
  try {
    const result = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [transformerRequest("left-to-right")],
    });
    if (!result.ok) throw Error(result.error.message);
    const inject = (svg: string) =>
      svg.replace(
        /(<g data-device-legend-entry[^>]*>)/,
        "$1<text>480/120 VAC 250 VA</text>",
      );
    const svg = result.value.sheets[0]!.svg;
    expect(() => noInferredClaims(svg, f.ir)).not.toThrow();
    expect(() => noInferredClaims(inject(svg), f.ir)).toThrow();
    expect(() => noInferredHtmlClaims(result.value.html, f.ir)).not.toThrow();
    expect(() =>
      noInferredHtmlClaims(inject(result.value.html), f.ir),
    ).toThrow();
  } finally {
    await f.dispose();
  }
});
for (const mode of ["normal", "reversed", "array-reversed", "renamed"])
  it.each(transformerFlows)(
    `wiring-selected transformer ${mode} in %s`,
    async (flow) => {
      const f = await transformerFixture(mode);
      try {
        const before = JSON.stringify(f.ir);
        await compareProject(f.root);
        const request = transformerRequest(
          flow,
          mode === "renamed" ? "RY9" : "R1",
        );
        const result = await prepareSchematicDrawing(f.ir, request);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw Error(result.error.message);
        const source = result.value.graph.nodes.find(
          (n) => n.kind === "symbol" && n.symbolId === "ais:source-winding",
        )!;
        expect(source).toBeDefined();
        expect(
          source.labels.some((label) => label.printableText === "source"),
        ).toBe(true);
        const input =
            mode === "renamed" ? "P" : mode === "reversed" ? "X2" : "X1",
          ret = mode === "renamed" ? "Q" : mode === "reversed" ? "X1" : "X2";
        expect(
          source.ports.map((p) => [p.symbolPortId, p.label]).sort(),
        ).toEqual([
          ["feed", input],
          ["return", ret],
        ]);
        const engine = createQueryEngine(f.ir);
        const nets = source.ports.map((p) => {
          const n = engine.net({ by: "id", value: p.terminal });
          if (!n.ok) throw Error(n.error.message);
          expect(p.netId).toBe(n.value.net.id);
          return n.value.net.id;
        });
        expect(new Set(nets).size).toBe(2);
        const selected = result.value.summary;
        const wires = f.ir.wires
          .filter((w) => ["W3", "W4"].includes(w.designation!))
          .map((w) => ({ kind: "wire", uid: w.uid }));
        expect(selected.conductiveElementIds).toEqual(
          expect.arrayContaining(wires),
        );
        expect(selected.conductiveElementIds).toHaveLength(2);
        expect(
          selected.functionIds
            .map((id) => [
              f.ir.devices.find((d) => d.uid === id.deviceUid)!.designation,
              id.functionKey,
            ])
            .sort(),
        ).toEqual(
          mode === "renamed"
            ? [
                ["RY9", "coil"],
                ["Z77", "output"],
              ]
            : [
                ["R1", "coil"],
                ["T1", "secondary"],
              ],
        );
        expect(
          result.value.graph.nodes.filter((n) => n.kind === "rail"),
        ).toEqual([]);
        const drawn = await renderSchematic(f.ir, request);
        expect(drawn.ok).toBe(true);
        if (!drawn.ok) throw Error(drawn.error.message);
        noInferredClaims(drawn.value.svg, f.ir);
        expect(JSON.stringify(f.ir)).toBe(before);
      } finally {
        await f.dispose();
      }
    },
  );
const invalid = [
  ["same", "T1.X1", "T1.X1"],
  ["short", "T1.X1", "T1.X2"],
  ["mixed", "T1.X1", "T1.Y2"],
  ["cross-device", "T1.X1", "T2.X2"],
  ["blocked", "T1.X1", "T2.X2"],
  ["far-pair", "T1.X1", "T2.X2"],
] as const;
for (const [mode, a, b] of invalid)
  it.each(transformerFlows)(
    `refuses transformer ${mode} in %s`,
    async (flow) => {
      const f = await transformerFixture(mode);
      try {
        const result = await renderSchematic(f.ir, transformerRequest(flow));
        expect(result.ok).toBe(false);
        if (result.ok) throw Error("Expected pair refusal");
        expect(result.error.code).toBe("R002");
        expect(result.error.message).toBe(
          `Incomplete control view: input and return must reach distinct terminals on distinct nets of the same transformer source function; reached ${a} and ${b}.`,
        );
      } finally {
        await f.dispose();
      }
    },
  );
it.each(transformerFlows)(
  "refuses equally ranked transformer pairs in %s",
  async (flow) => {
    const f = await transformerFixture("ambiguous");
    try {
      for (const ir of [
        f.ir,
        {
          ...f.ir,
          devices: [...f.ir.devices].reverse(),
          functions: [...f.ir.functions].reverse(),
          wires: [...f.ir.wires].reverse(),
        },
      ]) {
        const r = await renderSchematic(ir, transformerRequest(flow));
        expect(r.ok).toBe(false);
        if (r.ok) throw Error("Expected ambiguity");
        expect(r.error.code).toBe("R002");
        expect(r.error.message).toBe(
          "Incomplete control view: multiple transformer source pairs match the input and return paths; use an explicit circuit view.",
        );
      }
    } finally {
      await f.dispose();
    }
  },
);
for (const side of ["input", "return"])
  it.each(transformerFlows)(
    `preserves absent ${side} path in %s`,
    async (flow) => {
      const f = await transformerFixture(`no-${side}`);
      try {
        const r = await renderSchematic(f.ir, transformerRequest(flow));
        expect(r.ok).toBe(false);
        if (r.ok) throw Error("Expected absent path");
        expect(r.error.code).toBe("R002");
        expect(r.error.message).toBe(
          `Incomplete control view: no ${side} path reaches a required boundary. Device "R1", function "coil". Path stopped at R1.${side === "input" ? "A1" : "A2"} (function coil).`,
        );
      } finally {
        await f.dispose();
      }
    },
  );
for (const mode of ["missing-roles", "wrong-shape"])
  it.each(transformerFlows)(
    `keeps unsupported transformer ${mode} refused in %s`,
    async (flow) => {
      const f = await transformerFixture(mode);
      try {
        const r = await renderSchematic(f.ir, transformerRequest(flow));
        expect(r.ok).toBe(false);
        if (r.ok) throw Error("Expected unsupported shape");
        expect(r.error.code).toBe("R002");
      } finally {
        await f.dispose();
      }
    },
  );
it.each(transformerFlows)(
  "preserves authored tags without inferred ratings or electrical claims in SVG HTML or direct PDF in %s",
  async (flow) => {
    const f = await transformerFixture();
    try {
      const r = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        views: [transformerRequest(flow)],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) throw Error(r.error.message);
      expect(
        r.value.sheets.some((s) => s.svg.includes("ais:source-winding")),
      ).toBe(true);
      const html = printPacketHtml(
        r.value.sheets,
        r.value.page,
        "Transformer control",
      );
      noInferredHtmlClaims(html, f.ir);
      for (const s of r.value.sheets) noInferredClaims(s.svg, f.ir);
      const pdf = await packetPdf(r.value, "Transformer control");
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({
        data: new Uint8Array(pdf),
        useSystemFonts: false,
        isEvalSupported: false,
      });
      const doc = await task.promise;
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const text = await page.getTextContent();
          let printed = normalizedText(
            text.items.map((x) => ("str" in x ? x.str : "")).join(" "),
          );
          const source = parseHTML(r.value.sheets[i - 1]!.svg).document;
          for (const block of authoredTagBlocks(source, f.ir)) {
            expect(printed).toContain(block);
            printed = printed.replace(block, "");
          }
          expect(printed).not.toMatch(forbidden);
        }
      } finally {
        await task.destroy();
      }
    } finally {
      await f.dispose();
    }
  },
);
it("admits secondary control only and leaves primary and loads unsupported", async () => {
  const f = await transformerFixture();
  try {
    const p = SYMBOL_PROFILES.find((p) => p.id === "thermite:transformer")!;
    expect(
      p.support.filter((s) => ["power", "loads"].includes(s.family)),
    ).toEqual([]);
    const m = projectDeviceTypeSymbolMappings(f.ir).find(
      (m) => m.typeId === "core:control-transformer",
    )!;
    expect(
      m.functions.map((r) => [r.functionKey, r.symbolId, r.traversalRole]),
    ).toEqual([["secondary", "ais:source-winding", "source-boundary"]]);
  } finally {
    await f.dispose();
  }
});

it("rejects repeated terminal identity independently of supplied net labels", async () => {
  const { transformerPairCompatible } =
    await import("../src/selection/transformer.js");
  // Defensive policy contract: a malformed caller's different net labels cannot
  // turn one real terminal into two ends. Real-project nets are tested above.
  const candidate = (netId: string) => ({
    classRank: 2,
    distance: 1,
    boundary: {
      kind: "source" as const,
      terminal: { deviceUid: "device", terminalKey: "X" },
      netId,
      label: "X",
    },
    functionIds: [{ deviceUid: "device", functionKey: "secondary" }],
  });
  expect(
    transformerPairCompatible(candidate("net-a"), candidate("net-b")),
  ).toBe(false);
});
