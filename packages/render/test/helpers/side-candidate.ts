import type { PreparedSchematicDrawing } from "../../src/renderer.js";
import type { RootedCandidate } from "../../src/packet/rooted-build.js";
import { rootedDraft } from "../../src/packet/rooted-draft.js";
import { continuationHeaderWidth } from "../../src/packet/continuation-label.js";
export const sidePage = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
  widthMm: 431.8,
  heightMm: 279.4,
} as const;
export const fixtureInk =
  '<defs><clipPath id="fixture"><rect width="10" height="10"/></clipPath></defs><path id="stroke" clip-path="url(#fixture)" d="M 100 40 L 140 40"/>';
/** Deliberately tiny geometric fixture, independent of ELK and the composer. */
export function sideCandidate(rows = 2, omit = -1): RootedCandidate {
  const nodes = Array.from({ length: rows }, (_, i) => ({
    id: `node-${i}`,
    deviceUid: `device-${i}`,
    designation: `D${i}`,
    kind: "symbol",
    functionIds: [],
    labels: [],
    primitiveOrigin: { x: 0, y: 0 },
    symbolSize: { width: 40, height: 40 },
  })).filter((_, i) => i !== omit);
  const prepared = {
    view: {
      format: "schematic-view/0.1",
      family: "control",
      flow: "top-to-bottom",
      root: { deviceUid: "device-0", designation: "D0" },
    },
    titleContext: {
      projectName: "Symmetric fixture",
      revision: "A",
      toolVersion: "test",
      lines: [],
    },
    graph: {
      nodes,
      locationGroups: [],
      edges: [
        {
          id: "wire",
          kind: "conductor",
          elementIds: [{ kind: "wire", uid: "w1" }],
        },
      ],
    },
    layout: {
      width: 300,
      height: rows * 150 - 40,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: "symbol",
        x: 100,
        y: Number(n.id.slice(5)) * 150 + 40,
        width: 40,
        height: 40,
      })),
      labels: [],
      ports: [],
      edges: [
        {
          id: "wire",
          points: [
            { x: 120, y: 80 },
            { x: 120, y: (rows - 1) * 150 + 80 },
          ],
        },
      ],
    },
  } as unknown as PreparedSchematicDrawing;
  const grid = {
    xs: [0, 340],
    ys: Array.from({ length: rows + 1 }, (_, i) => i * 150),
  };
  const b = { x: 28, y: 55, w: 200, h: 160 },
    scale = 0.25;
  const drafts = Array.from({ length: rows }, (_, i) =>
    rootedDraft(prepared, grid, 0, i, b, scale, fixtureInk),
  );
  for (let row = 1; row < rows; row++) {
    const common = {
      id: `C${String(row).padStart(3, "0")}`,
      conductor: "W1",
      designation: "W1",
      provenance: { kind: "wire" as const, uid: "w1" },
      netId: "N1",
      x: 63,
    };
    drafts[row - 1]!.links.push({
      ...common,
      end: 0,
      to: row + 1,
      y: 92.5,
      side: "bottom",
    });
    drafts[row]!.links.push({ ...common, end: 1, to: row, y: 55, side: "top" });
  }
  const width = continuationHeaderWidth(1000);
  return {
    prepared,
    grid,
    drafts,
    scale,
    proximity: 0,
    localityExcess: 0,
    jogs: new Map(),
    detours: new Map(),
    bank: {
      width,
      headerWidth: width,
      single: false,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
  };
}
