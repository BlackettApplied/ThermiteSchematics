import { expect, it } from "vitest";
import { titleFields } from "./title-fields.mjs";
import { compactRevisionSource } from "./title-revision-source.mjs";
import { authoredCircuitShapes } from "./issued-circuit-coverage.mjs";
import { continuationTypography } from "./continuation-typography.mjs";
const panel = { x: 10, y: 80, w: 180, h: 20 };
const t = (text, y = 85) => ({
  text,
  element: text,
  bbox: { x: 15, y, w: 100, h: 2 },
  anchor: { x: 15, y },
});
const title =
  "Drawing number: 1 Drawn by: A Checked: B Approved by: C Customer: D REV A Revision history";
it("DQ-18 reads the revision from authored metadata with sheet override precedence", () => {
  const presentation = { format: "project-presentation/0.3", revision: "P" };
  const packet = {
    navigation: {
      occurrences: [
        {
          destination: { sheet: 7 },
          provenance: { view: { authoredOrder: 1 } },
        },
      ],
    },
  };
  const sheet = { number: 7, sheetKey: "exact", view: {} };
  const request = {
    views: [{}, {}],
    titleData: {
      defaults: { revision: "D" },
      byView: [{ viewIndex: 2, revision: "V" }],
      bySheet: [{ sheetKey: "exact", revision: null }],
    },
  };
  expect(compactRevisionSource(presentation, packet, sheet, request)).toEqual({
    label: "REV:",
    value: null,
  });
  request.titleData.bySheet = [];
  expect(compactRevisionSource(presentation, packet, sheet, request)).toEqual({
    label: "REV:",
    value: "V",
  });
  expect(compactRevisionSource(presentation, {}, sheet, request)).toEqual({
    label: "REV:",
    unavailable: true,
  });
});
it("DQ-18 only painted labelled fields in the measured title panel count", () => {
  const g = { height: 100, titleBlock: panel, texts: [t(title)] };
  expect(titleFields(g)).toEqual([]);
  g.texts = [t(title.replace("Drawn by: A ", "")), t("not drawn", 75)];
  expect(titleFields(g)).toEqual([
    expect.objectContaining({ missing: ["drawn"] }),
  ]);
  g.texts.push(t("Drawn by: forged", 75));
  expect(titleFields(g)).toEqual([
    expect.objectContaining({ missing: ["drawn"] }),
  ]);
  g.texts[0].text += " not drawn";
  expect(titleFields(g)).toEqual([
    expect.objectContaining({ missing: ["drawn"] }),
  ]);
  g.texts = [t(title, 75)];
  expect(titleFields(g)[0].missing.length).toBe(7);
  g.texts = [{ ...t(title), reviewPainted: false }];
  expect(titleFields(g)[0].missing.length).toBe(7);
  delete g.titleBlock;
  expect(titleFields(g)[0].missing.length).toBe(7);
});
it("#238 L1 rejects genuine authored circuit ink on a rooted sheet with the matching circuit title", () => {
  const ir = {
    devices: [{ uid: "d", designation: "D" }],
    functions: [{ id: { deviceUid: "d", functionKey: "f" } }],
  };
  const request = {
    views: [
      {
        format: "circuit-view-request/0.1",
        title: "Circuit",
        groups: [
          {
            id: "main",
            functions: [
              { device: { by: "designation", value: "D" }, key: "f" },
            ],
          },
        ],
      },
    ],
  };
  const sheet = { view: { title: "Circuit" } },
    g = {
      shapes: [{ circuitGroup: "main", deviceUid: "d", functionKey: "f" }],
    };
  expect(authoredCircuitShapes(sheet, g, ir, request)).toHaveLength(1);
  expect(
    authoredCircuitShapes(
      { view: { ...sheet.view, root: { deviceUid: "d" } } },
      g,
      ir,
      request,
    ),
  ).toEqual([]);
});
it("#238 L2 rejects ambiguous native designation selectors", () => {
  const ir = {
    devices: [{ uid: "d", designation: "D" }],
    functions: [{ id: { deviceUid: "d", functionKey: "f" } }],
  };
  const request = {
    views: [
      {
        format: "circuit-view-request/0.1",
        title: "Circuit",
        groups: [
          {
            id: "main",
            functions: [
              { device: { by: "designation", value: "D" }, key: "f" },
            ],
          },
        ],
      },
    ],
  };
  const sheet = { view: { title: "Circuit" } },
    g = {
      shapes: [{ circuitGroup: "main", deviceUid: "d", functionKey: "f" }],
    };
  expect(authoredCircuitShapes(sheet, g, ir, request)).toHaveLength(1);
  ir.devices.push({ uid: "other", designation: "D" });
  expect(authoredCircuitShapes(sheet, g, ir, request)).toEqual([]);
});
function blocks(gap) {
  const cs = [1, 2].map((n) => ({
    id: "C00" + n,
    toSheet: 2,
    conductor: "W" + n,
    sourceElement: { kind: "wire", uid: "w" + n },
  }));
  const rows = cs.map((c, i) => ({
    ...t(c.id + " / 02.A1 / " + c.conductor, 40),
    continuationLink: "a" + i,
    bbox: { x: 30 + i * (20 + gap), y: 40, w: 20, h: 2 },
  }));
  return continuationTypography(
    { number: 1, continuations: cs },
    {
      texts: rows,
      connectors: cs.map((c, i) => ({ ...c, element: "a" + i })),
      shapes: [],
    },
    {
      wires: cs.map((c, i) => ({
        uid: "w" + (i + 1),
        designation: c.conductor,
      })),
    },
  );
}
it("CT block gap enforces 2.5 mm minus the established 0.17 mm measurement epsilon", () => {
  expect(blocks(2.5).findings).toEqual([]);
  expect(blocks(2.331).findings).toEqual([]);
  expect(blocks(2.329).findings.map((f) => f.kind)).toContain(
    "continuation-block-gap",
  );
  expect(blocks(1).measurements[0]).toMatchObject({
    minimumMm: 2.5,
    epsilonMm: 0.17,
    assessment: "measured",
  });
});
it("DQ-18 panel right and bottom edges require full ink containment", () => {
  for (const edge of ["right", "bottom"]) {
    const row = t(title);
    if (edge === "right") row.bbox.x = panel.x + panel.w - row.bbox.w;
    else row.bbox.y = panel.y + panel.h - row.bbox.h;
    const g = { titleBlock: panel, texts: [row] };
    expect(titleFields(g)).toEqual([]);
    row.bbox[edge === "right" ? "x" : "y"] += 0.002;
    expect(titleFields(g)).toHaveLength(1);
    expect(titleFields(g)[0].missing).toHaveLength(7);
  }
});
it("CT intact per-glyph rows retain ink bounds when em bounds straddle the gap", () => {
  const cs = [1, 2].map((n) => ({
    id: "C00" + n,
    toSheet: 2,
    conductor: "W" + n,
    sourceElement: { kind: "wire", uid: "w" + n },
  }));
  const rows = cs.map((c, i) => ({
    ...t(`${c.id} / 02.A1 / ${c.conductor}`, 40),
    continuationLink: "a" + i,
    bbox: { x: 30 + i * 22.4, y: 40, w: 20, h: 2 },
    continuationRuns: [
      {
        text: `${c.id} / 02.A1 / ${c.conductor}`,
        anchor: { x: 30 + i * 22.4, y: 40 },
        bbox: { x: 30 + i * 22.4, y: 39, w: 20.4, h: 4 },
      },
    ],
  }));
  const check = () =>
    continuationTypography(
      { number: 1, continuations: cs },
      {
        texts: rows,
        connectors: cs.map((c, i) => ({ ...c, element: "a" + i })),
        shapes: [],
      },
      {
        wires: cs.map((c, i) => ({
          uid: "w" + (i + 1),
          designation: c.conductor,
        })),
      },
    );
  expect(check().findings).toEqual([]);
  expect(check().measurements[0].gapMm).toBeCloseTo(2.4);
  rows[1].bbox.x -= 0.1;
  expect(check().findings.map((f) => f.kind)).toContain(
    "continuation-block-gap",
  );
});
