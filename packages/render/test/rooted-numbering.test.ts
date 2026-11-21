import { expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import type { Draft, Link } from "../src/packet/types.js";
import { contentPages } from "../src/packet/rooted-content.js";
import { appendViewDrafts, assembleSheets } from "../src/packet/assembly.js";
import {
  continuationHeaderWidth,
  continuationLabel,
} from "../src/packet/continuation-label.js";
import { maximumContinuationSerial } from "../src/packet/continuation-reservation.js";
import { continuationOracle } from "./continuation-oracle.js";
const page = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
  widthMm: 431.8,
  heightMm: 279.4,
} as const;
const view = {
  format: "schematic-view/0.1",
  family: "control",
  flow: "left-to-right",
  root: { deviceUid: "K", designation: "K" },
} as const;
const draft = (links: Link[] = []): Draft => ({
  view,
  title: {
    projectName: "Numbering",
    revision: "A",
    toolVersion: "test",
    lines: [],
  },
  links,
  content: "",
  note: "",
  references: [],
  drawingBounds: { x: 28, y: 47, w: 375.8, h: 180 },
  rootedContent: { figures: 1, conductors: 1 },
});
it("reserves C999/C1000 and sheet 99/100 before final omission and reciprocal numbering", () => {
  const ceiling = maximumContinuationSerial(
    { layout: { edges: [{ points: [{}, {}] }] } } as never,
    998,
  );
  expect(ceiling).toBe(1037);
  const header = continuationHeaderWidth(ceiling);
  const make = (i: number, end: 0 | 1, to: number): Link => {
    const l: Link = {
      id: `C00${i}`,
      conductor: `W${i}`,
      designation: `W${i}`,
      netId: `N${i}`,
      provenance: { kind: "wire", uid: `w${i}` },
      to,
      end,
      x: 100 + i * 50 + (end ? 100 : 0),
      y: 80 + i * 40,
      side: end ? "left" : "right",
    };
    l.label = continuationLabel(l, header, header);
    return l;
  };
  const a = draft([make(1, 0, 3), make(2, 0, 3)]),
    b = draft([make(1, 1, 2), make(2, 1, 2)]),
    empty = draft();
  empty.rootedContent = { figures: 0, conductors: 0 };
  const incoming = contentPages([empty, a, b]);
  if (typeof incoming === "string") throw Error(incoming);
  const prior = Array.from({ length: 98 }, () => ({
    ...draft(),
    view: {
      format: "documentation-view/0.1" as const,
      kind: "bom" as const,
      title: "Prior report",
    },
  }));
  expect(appendViewDrafts(prior, incoming, 0, "standard", 998)).toBe(1000);
  const ir = {
    indexes: { netIdByTerminal: [] },
    wires: [1, 2].map((i) => ({ uid: `w${i}`, designation: `W${i}` })),
    jumpers: [],
    cables: [],
    cableConductors: [],
  } as unknown as ElectricalIr;
  const sheets = assembleSheets(ir, prior, page);
  expect(sheets).toHaveLength(100);
  expect(sheets[98]!.svg).toMatch(/C999 \/ 100\.[A-D][1-6]/u);
  expect(sheets[98]!.svg).toMatch(/C1000 \/ 100\.[A-D][1-6]/u);
  expect(sheets[99]!.svg).toMatch(/C1000 \/ 99\.[A-D][1-6]/u);
  expect(continuationOracle(ir, { sheets } as never).ends).toBe(4);
});
