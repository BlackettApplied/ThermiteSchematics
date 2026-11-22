import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { stackSections } from "../src/packet/fold-stack.js";
import { referenceTables } from "../src/packet/references.js";
import { tableDrafts } from "../src/packet/reports.js";
import { assembleSheets } from "../src/packet/assembly.js";
import type { Draft } from "../src/packet/types.js";

it("prints the shifted sheet/zone for a device on the second stacked strip", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  const motor = c.ir.devices.find((d) => d.designation === "M1")!;
  const page = {
    size: "tabloid",
    orientation: "landscape",
    widthMm: 431.8,
    heightMm: 279.4,
    marginMm: 10,
  } as const;
  const b = { x: 20, y: 40, w: 240, h: 160 };
  const base: Draft = {
    view: {
      format: "schematic-view/0.1",
      family: "power",
      root: { deviceUid: motor.uid, designation: motor.designation },
      flow: "left-to-right",
    },
    title: {
      projectName: "Stacked reference",
      revision: "A",
      toolVersion: "test",
      lines: [],
    },
    content: '<rect x="25" y="45" width="10" height="10"/>',
    links: [],
    references: [],
    drawingBounds: b,
  };
  const second: Draft = {
    ...base,
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
  // A2 starts at y=40; 60 mm of first strip +14 mm gap shifts y=50 to 124,
  // in row C. Column 2 is unchanged. The printed reference is sheet 1 / C2.
  const folded = stackSections([base, second], [60, 50], [[0, 1]], b);
  expect(folded[0]!.references![0]).toMatchObject({
    xMm: 80,
    yMm: 124,
    zone: "C2",
  });
  const table = referenceTables(c.ir, folded, { page }, undefined).tables.find(
    (t) => t.kind === "references",
  )!;
  expect(table.rows.find((r) => r.cells[0] === "M1")!.cells[2]).toBe("1 / C2");
  const report = tableDrafts(c.ir, table, c.presentation, page);
  if (!report.ok) throw Error(JSON.stringify(report));
  const sheets = assembleSheets(c.ir, [...folded, ...report.value], page);
  expect(sheets[0]!.svg).toContain("translate(0 74)");
  expect(sheets[1]!.svg).toContain("1 / C2");
  expect(sheets[1]!.svg).not.toContain("1 / A2");
});
