import { measurementCoverage } from "./measurement-coverage.mjs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { wireLocatorAudit } from "./wire-locators.mjs";
import { fixture, ink } from "./m3-fixture.mjs";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
const key = '["c","1"]';
const end = (deviceUid) => ({ terminal: { deviceUid, terminalKey: "1" } });
function cableFixture(from = "01.A1", to = "01.B3") {
  const f = fixture();
  f.ir.devices = [
    { uid: "a", designation: "A", typeId: "t" },
    { uid: "b", designation: "B", typeId: "t" },
  ];
  f.ir.deviceTypes[0].terminals = [{ key: "1" }];
  f.ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [{ id: "1", endpoints: [end("a"), end("b")] }],
    },
  ];
  f.ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  const values = ["C/1", "A.1", "B.1", "", "Connected", from, to];
  const cells = values.map((_, columnIndex) => ({
    row: key,
    documentId: "doc",
    reportRowScope: "row",
    columnIndex,
    bbox: { x: 20 + columnIndex * 20, y: 140, w: 20, h: 12 },
  }));
  const report = {
    texts: values.map((v, i) => ink(v, { ...cells[i] })),
    reportCells: cells,
  };
  const packet = {
    sheets: [
      {
        number: 1,
        view: {
          kind: "cable",
          format: "schematic-view/0.2",
          intent: "conductors",
        },
      },
      { number: 2, view: { kind: "wires", format: "documentation-view/0.1" } },
    ],
  };
  return {
    ir: f.ir,
    packet,
    report,
    grid: f.report.texts.filter((t) => t.sheetText),
  };
}
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240mm" height="220mm" viewBox="0 0 240 220">${body}</svg>`;
const caption = (uid, name, side, x, y) =>
  `<g data-tag-owner-uid="${uid}" data-tag-kind="reference" data-tag-field="designation" data-tag-block="c/1/${side}" data-tag-terminal-id='{ "deviceUid":"${uid}","terminalKey":"1" }'><text x="${x}" y="${y}" font-size="2.7">${name}.1</text></g>`;
const circle = (uid, x, y) =>
  `<circle data-device-uid="${uid}" data-terminal-key="1" cx="${x}" cy="${y}" r="1" fill="white" stroke="black"/>`;
function drawing({
  swapped = false,
  reordered = false,
  foreignCaption = false,
  closeCircles = false,
  missingCaption = false,
  sameCircle = false,
} = {}) {
  const circles = [
    circle("a", swapped ? 90 : 30, swapped ? 90 : 50),
    ...(sameCircle
      ? []
      : [
          circle(
            "b",
            closeCircles ? 30.005 : swapped ? 30 : 90,
            closeCircles ? 50 : swapped ? 50 : 90,
          ),
        ]),
  ];
  if (reordered) circles.reverse();
  return svg(
    `<g data-cable-uid="c" data-conductor-id="1"><path d="M30 50 L90 90" stroke="black" fill="none"/>${caption(foreignCaption ? "b" : "a", "A", "a", 29, 45)}${missingCaption ? "" : caption("b", "B", "z", 89, 85)}${circles.join("")}</g>`,
  );
}
async function audit(options = {}, from, to) {
  const f = cableFixture(from, to),
    g = await openSheet(page, drawing(options));
  g.texts.push(...f.grid);
  return wireLocatorAudit(f.packet, [g, f.report], f.ir);
}
it("256.cable correct native cable/end identities pass independently of circle DOM order", async () => {
  expect((await audit()).findings).toEqual([]);
  expect((await audit({ reordered: true })).findings).toEqual([]);
});
it("256.cable coherently swapped native end circles and printed locators change pass to fail", async () => {
  expect((await audit()).findings).toEqual([]);
  const result = await audit({ swapped: true }, "01.B3", "01.A1");
  expect(
    result.findings.some((f) => f.kind === "cable-end-identity-mismatch"),
  ).toBe(true);
  expect(result.findings.length > 0 ? "fail" : "pass").toBe("fail");
});
it("256.cable printed endpoint identity is checked against its native UID and terminal, not just its spelling", async () => {
  const result = await audit({ foreignCaption: true });
  expect(
    result.findings.some((f) => f.kind === "cable-end-identity-mismatch"),
  ).toBe(true);
});

function locatorObservation(audit, sheet) {
  const dependency = {
    id: `case/DQ-19/dependencies-${sheet}`,
    dq: "DQ-19",
    status: "fail",
    evidence: { findings: [{ kind: "unrelated-dependency" }] },
  };
  const locator = {
    id: `case/DQ-19/sheet-${String(sheet).padStart(3, "0")}`,
    dq: "DQ-19",
    status: audit.findings.some((f) => f.sheet === sheet) ? "fail" : "pass",
    evidence: { findings: audit.findings.filter((f) => f.sheet === sheet) },
  };
  measurementCoverage([dependency, locator], { texts: [], shapes: [] }, audit, {
    number: sheet,
  });
  expect(dependency.status).toBe("fail");
  expect(dependency.evidence.notMeasured).toBeUndefined();
  return locator;
}
it.each([
  ["circles within 0.01 mm", { closeCircles: true }, "not drawn", "not drawn"],
  ["missing end caption", { missingCaption: true }, "01.A1", "not drawn"],
  [
    "both ends selecting one circle",
    { sameCircle: true },
    "01.A1",
    "not drawn",
  ],
])(
  "r2.4 %s cannot become a measured DQ-19 pass",
  async (_name, options, from, to) => {
    const result = await audit(options, from, to);
    expect(result.notMeasured.length > 0 || result.findings.length > 0).toBe(
      true,
    );
    for (const sheet of [1, 2]) {
      const observation = locatorObservation(result, sheet);
      expect(observation.status).not.toBe("pass");
      if (!observation.evidence.findings.length)
        expect(observation.status).toBe("not-measured");
    }
  },
);
