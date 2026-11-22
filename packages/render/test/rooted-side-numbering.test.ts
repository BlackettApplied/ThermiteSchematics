import { expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import type { Draft, Link } from "../src/packet/types.js";
import { stackSections } from "../src/packet/fold-stack.js";
import {
  continuationHeaderWidth,
  continuationLabel,
} from "../src/packet/continuation-label.js";
import { appendViewDrafts, assembleSheets } from "../src/packet/assembly.js";
import { referenceTables } from "../src/packet/references.js";
import { tableDrafts } from "../src/packet/reports.js";
import { continuationOracle } from "./continuation-oracle.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
function pair(
  end: 0 | 1,
  id: number,
  to: number,
  wire: ElectricalIr["wires"][number],
): Link {
  const l: Link = {
    id: `C00${id}`,
    conductor: wire.properties?.label ?? wire.designation,
    designation: wire.designation,
    netId: `N${id}`,
    provenance: { kind: "wire", uid: wire.uid },
    end,
    to,
    x: 80 + id * 40,
    y: 80 + id * 35,
    side: end ? "left" : "right",
  };
  const width = continuationHeaderWidth(1000);
  l.label = continuationLabel(l, width, width);
  return l;
}
it("prints right-hand device references and C999/C1000 peers on final sheets 99/100", async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const motor = compiled.ir.devices.find((d) => d.designation === "M1")!;
  const wires = compiled.ir.wires;
  const base = sideCandidate(3).drafts[0]!;
  const b = { x: 20, y: 40, w: 240, h: 160 };
  const a: Draft = {
    ...base,
    drawingBounds: b,
    links: [pair(0, 1, 3, wires[0]!)],
    references: [],
  };
  const right: Draft = {
    ...base,
    drawingBounds: b,
    links: [pair(0, 2, 3, wires[1]!)],
    content: `<rect data-device-uid="${motor.uid}" x="75" y="45" width="10" height="10"/>`,
    references: [
      {
        deviceUid: motor.uid,
        designation: motor.designation,
        functions: [],
        xMm: 80,
        yMm: 50,
        zone: "A2",
      },
    ],
  };
  const last: Draft = {
    ...base,
    drawingBounds: b,
    links: [pair(1, 1, 1, wires[0]!), pair(1, 2, 2, wires[1]!)],
    references: [],
  };
  const incoming = stackSections(
    [a, right, last],
    [60, 50, 240],
    [[0, 1], [2]],
    b,
    "x",
  );
  // 60 mm +14 mm: x=80 becomes154, in column4 (20+3*40 to20+4*40).
  expect(incoming[0]!.references![0]).toMatchObject({
    xMm: 154,
    yMm: 50,
    zone: "A4",
  });
  const prior: Draft[] = Array.from({ length: 98 }, () => ({
    ...base,
    links: [],
    references: [],
    content: "",
    view: {
      format: "documentation-view/0.1",
      kind: "bom",
      title: "Prior report",
    },
  }));
  expect(appendViewDrafts(prior, incoming, 0, "standard", 998)).toBe(1000);
  const ir = compiled.ir;
  const table = referenceTables(
    ir,
    prior,
    { page: sidePage },
    undefined,
  ).tables.find((t) => t.kind === "references")!;
  expect(table.rows.find((r) => r.cells[0] === "M1")!.cells[2]).toBe("99 / A4");
  const report = tableDrafts(ir, table, compiled.presentation, sidePage);
  if (!report.ok) throw Error(JSON.stringify(report));
  // Reuse an earlier report page; the complete test packet stays at100 sheets.
  prior[0] = report.value[0]!;
  const sheets = assembleSheets(ir, prior, sidePage);
  expect(sheets).toHaveLength(100);
  expect(sheets[0]!.svg).toContain("99 / A4");
  expect(sheets[0]!.svg).not.toContain("99 / A2");
  expect(sheets[98]!.svg).toContain("translate(74 0)");
  expect(sheets[98]!.svg).toMatch(/C999 \/ 100\.[A-D][1-6]/u);
  expect(sheets[98]!.svg).toMatch(/C1000 \/ 100\.[A-D][1-6]/u);
  expect(sheets[99]!.svg).toMatch(/C1000 \/ 99\.[A-D][1-6]/u);
  expect(continuationOracle(ir, { sheets } as never).ends).toBe(4);
});
