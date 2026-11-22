import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { physicalLandingAudit } from "./physical-landings.mjs";
import { wireLabelSupportAudit } from "./wire-label-support.mjs";
import { conversionQualifierAudit } from "./qualifier-oracle.mjs";
import {
  landingFixture,
  qualifierFixture,
  wire,
  end,
} from "./tranche3-fixtures.mjs";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await browser.newPage(drawingContextOptions);
  await page.emulateMedia({ media: "print" });
});
afterAll(async () => {
  await browser?.close();
});
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="100mm" viewBox="0 0 150 100">${body}</svg>`;
function physical(shared, dot = true) {
  const { ir } = landingFixture();
  const paths = [
    ["A", "M10 50 H100"],
    ["B", shared ? "M10 70 H70 V50 H100" : "M10 70 H100 V50"],
  ]
    .map(
      ([id, d]) =>
        `<path data-wire-uid="${id}" data-endpoints='${JSON.stringify(ir.wires.find((w) => w.uid === id).endpoints.map((e) => e.terminal))}' d="${d}" fill="none" stroke="black" stroke-width=".4"/>`,
    )
    .join("");
  return svg(
    paths +
      `<g data-device-uid="D"><circle data-terminal-key="T" cx="100" cy="50" r=".65" stroke="black" fill="white"/></g>` +
      (shared && dot
        ? '<circle class="junction-dot" cx="70" cy="50" r=".65" fill="black"/>'
        : ""),
  );
}
it("N3 browser: separate approaches pass and shared ink fails independently of dots", async () => {
  const { ir } = landingFixture();
  expect(
    physicalLandingAudit(await openSheet(page, physical(false)), ir).findings,
  ).toEqual([]);
  for (const dot of [true, false])
    expect(
      physicalLandingAudit(await openSheet(page, physical(true, dot)), ir)
        .findings.length,
    ).toBeGreaterThan(0);
});
const circuitDot = (x, y, extra = "") =>
  `<circle data-circuit-junction="true" cx="${x}" cy="${y}" r=".55" fill="black" ${extra}/>`;
it("N3 circuit positive: a painted dot at a native >=3-way node is authorized", async () => {
  const { ir } = landingFixture();
  ir.wires.push(wire("C", end("Z"), end("D")));
  const third = `<path data-wire-uid="C" data-endpoints='${JSON.stringify(ir.wires[2].endpoints.map((e) => e.terminal))}' d="M10 30 H100 V50" fill="none" stroke="black" stroke-width=".4"/>`;
  const source = physical(false).replace(
    "</svg>",
    third + circuitDot(100, 50) + "</svg>",
  );
  const g = await openSheet(page, source);
  expect(g.tranche3.circuitJunctions).toHaveLength(1);
  expect(physicalLandingAudit(g, ir).findings).toEqual([]);
});
it("N3 circuit mutation killed: a free-air dot has no native node; legacy shapes stay unchanged", async () => {
  const { ir } = landingFixture(),
    original = await openSheet(page, physical(false)),
    source = physical(false).replace("</svg>", circuitDot(70, 50) + "</svg>"),
    g = await openSheet(page, source);
  expect(g.shapes).toEqual(original.shapes);
  expect(g.terminals).toEqual(original.terminals);
  expect(g.tranche3.circuitJunctions).toHaveLength(1);
  const findings = physicalLandingAudit(g, ir).findings;
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    kind: "junction-dot-without-native-node",
    nativeDegree: 0,
  });
  expect(Math.abs(findings[0].point.x - 70)).toBeLessThan(0.01);
  expect(Math.abs(findings[0].point.y - 50)).toBeLessThan(0.01);
});
it("N3 circuit mutation killed: two native incidences cannot authorize a dot", async () => {
  const { ir } = landingFixture();
  const source = physical(false).replace(
    "</svg>",
    circuitDot(100, 50) + "</svg>",
  );
  const result = physicalLandingAudit(await openSheet(page, source), ir);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({
    kind: "junction-dot-without-native-node",
    nativeDegree: 2,
  });
});
it.each([
  'opacity="0"',
  'fill-opacity="0"',
  'style="fill:white"',
  'style="display:none"',
])(
  "N3 circuit positive: unpainted dot does not invent a junction (%s)",
  async (extra) => {
    const { ir } = landingFixture();
    const source = physical(false).replace(
      "</svg>",
      circuitDot(70, 50, extra) + "</svg>",
    );
    const g = await openSheet(page, source);
    expect(g.tranche3.circuitJunctions).toEqual([]);
    expect(physicalLandingAudit(g, ir).findings).toEqual([]);
  },
);
function conversion(kind, transform = "", ink = true) {
  const mark =
    kind === "ac-input"
      ? `<polyline points="12,20 14,16 16,14 18,16 22,24 24,26 26,24 28,20" opacity="${ink ? 1 : 0}"/>`
      : '<line x1="12" x2="28" y1="15" y2="15"/><line x1="12" x2="15" y1="22" y2="22"/><line x1="17" x2="22" y1="22" y2="22"/><line x1="24" x2="28" y1="22" y2="22"/>';
  return svg(
    `<g data-device-uid="D" data-circuit-functions='[{"deviceUid":"D","functionKey":"f"}]'><g data-source-enclosure="true"><rect width="80" height="80" stroke="black" fill="none"/></g><g data-function-key="f" data-function-id='["D","f"]'><g data-circuit-mark="${kind}" data-upright="true" transform="${transform}" stroke="black" stroke-width=".4" fill="none"><rect x="10" y="10" width="20" height="20"/>${mark}</g></g><circle data-terminal-key="L" data-device-uid="D" cx="0" cy="10" r=".5"/><circle data-terminal-key="N" data-device-uid="D" cx="0" cy="20" r=".5"/></g>`,
  );
}
it.each(["ac-input", "dc-output"])(
  "N6 browser positive and rotation mutations: %s",
  async (kind) => {
    const { ir, sheet } = qualifierFixture(kind);
    expect(
      conversionQualifierAudit(
        await openSheet(page, conversion(kind)),
        ir,
        sheet,
      ).findings,
    ).toEqual([]);
    for (const angle of kind === "ac-input" ? [90, 270] : [90, 180, 270]) {
      const g = await openSheet(
        page,
        conversion(kind, `rotate(${angle} 20 20)`),
      );
      expect(
        conversionQualifierAudit(g, ir, sheet).findings.length,
      ).toBeGreaterThan(0);
    }
  },
);
it("N6 browser mutations: erased ink and displaced group fail closed", async () => {
  const { ir, sheet } = qualifierFixture();
  for (const source of [
    conversion("ac-input", "", false),
    conversion("ac-input", "translate(100 0)"),
  ]) {
    expect(
      conversionQualifierAudit(await openSheet(page, source), ir, sheet)
        .findings.length,
    ).toBeGreaterThan(0);
  }
});
it("N4 browser: a right-edge touch cannot support a label over another wire", async () => {
  const { ir } = landingFixture();
  ir.wires[0].properties = { label: "LS1-SWITCHED-RETURN" };
  const paths = [
    ["A", "M80 0 V70"],
    ["B", "M10 34 H120"],
  ]
    .map(
      ([uid, d]) =>
        `<path data-wire-uid="${uid}" data-endpoints='${JSON.stringify(ir.wires.find((w) => w.uid === uid).endpoints.map((e) => e.terminal))}' d="${d}" fill="none" stroke="black" stroke-width=".4"/>`,
    )
    .join("");
  const g = await openSheet(
    page,
    svg(
      paths +
        '<g data-wire-label="A"><text x="80" y="36" text-anchor="end" font-size="4" font-family="monospace">LS1-SWITCHED-RETURN</text></g>',
    ),
  );
  expect(
    wireLabelSupportAudit(g, ir).reviewCandidates.some(
      (f) => f.kind === "wire-label-support-review",
    ),
  ).toBe(true);
});

it("N6 positive: the point-symmetric AC tilde remains equivalent under a half-turn", async () => {
  const { ir, sheet } = qualifierFixture("ac-input");
  expect(
    conversionQualifierAudit(
      await openSheet(page, conversion("ac-input", "rotate(180 20 20)")),
      ir,
      sheet,
    ).findings,
  ).toEqual([]);
});
