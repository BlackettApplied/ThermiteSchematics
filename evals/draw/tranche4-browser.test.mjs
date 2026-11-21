import { nativePortInk } from "./native-port-ink.mjs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { ir4, wire4, end } from "./tranche4-fixtures.mjs";
import { conductorIdentityAudit } from "./conductor-identity-oracle.mjs";
import { junctionRayAudit } from "./junction-rays-oracle.mjs";
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
function markerSource(kind, n = 3, fill = "black", erase = false) {
  const ir = ir4(),
    ends = [
      { x: 20, y: 50 },
      { x: 80, y: 50 },
      { x: 50, y: 80 },
    ];
  const paths = ends
    .slice(0, n)
    .map((q, i) => {
      const w = wire4("W" + i, "" + i, [end("D"), end("E")]);
      ir.wires.push(w);
      return `<path data-wire-uid="${w.uid}" data-endpoints='${JSON.stringify(w.endpoints.map((e) => e.terminal))}' d="M50 50 L${q.x} ${q.y}" fill="none" stroke="black" stroke-width=".4" ${erase && i === 2 ? 'opacity="0"' : ""}/>`;
    })
    .join("");
  const marker = `<g data-device-uid="D"><circle class="${kind === "wiring" ? "terminal-marker" : ""}" data-terminal-key="T" cx="50" cy="50" r=".65" fill="${fill}" stroke="black" stroke-width=".25"/></g>`;
  return { ir, source: svg(paths + marker) };
}
it.each(["circuit", "wiring"])(
  "N14 browser positive: real three-ray %s marker; shape flag grants no authorization",
  async (kind) => {
    const x = markerSource(kind),
      g = await openSheet(page, x.source);
    expect(g.tranche4.markers).toHaveLength(1);
    expect(g.tranche4.markers[0].filled).toBe(true);
    expect(junctionRayAudit(g, x.ir).findings).toEqual([]);
  },
);
it.each(["circuit", "wiring"])(
  "N14 browser mutations killed: ordinary filled %s endpoint and hidden third approach",
  async (kind) => {
    for (const [n, erase] of [
      [1, false],
      [2, false],
      [3, true],
    ]) {
      const x = markerSource(kind, n, "black", erase),
        g = await openSheet(page, x.source);
      expect(junctionRayAudit(g, x.ir).findings.map((f) => f.kind)).toContain(
        "filled-endpoint-without-three-native-rays",
      );
    }
    const x = markerSource(kind, 1, "white");
    expect(
      junctionRayAudit(await openSheet(page, x.source), x.ir).findings,
    ).toEqual([]);
  },
);
it.each(["data-circuit-junction", "data-wiring-junction"])(
  "N14 browser mutation killed: free-air %s dot is not a native endpoint",
  async (attr) => {
    const x = markerSource("circuit");
    x.source = x.source.replace(
      "</svg>",
      `<circle ${attr}="true" cx="30" cy="30" r=".65" fill="black"/></svg>`,
    );
    const result = junctionRayAudit(await openSheet(page, x.source), x.ir);
    expect(result.findings.map((f) => f.kind)).toContain(
      "filled-junction-native-node-unavailable",
    );
  },
);
function cardSource(value = "101", extra = "") {
  const ir = ir4();
  ir.wires = [wire4()];
  const body = `<g data-off-view-conductors='[{"kind":"wire","uid":"A"}]' data-off-view-terminal-id='{"deviceUid":"D","terminalKey":"T"}'><rect x="30" y="20" width="75" height="20" fill="white" stroke="black"/><text class="off-view-heading" x="32" y="25" font-size="3.5">Off-view at K1.T</text><text x="32" y="32" font-size="3.5" ${extra}>${value} → K2.T</text></g>`;
  return { ir, body };
}
it("N8 browser positive: paired alias; entirely clipped duplicate card is outside visible population", async () => {
  const x = cardSource("W-A (101)"),
    source = svg(x.body + `<g transform="translate(200 0)">${x.body}</g>`),
    g = await openSheet(page, source);
  expect(g.tranche4.cards).toHaveLength(1);
  expect(conductorIdentityAudit({ number: 1 }, g, x.ir).findings).toEqual([]);
});
it.each([
  ["W-A", ""],
  ["W-A (10)", ""],
  ["101", 'opacity="0"'],
])("N8 browser mutation killed: %s %s", async (value, extra) => {
  const x = cardSource(value, extra),
    g = await openSheet(page, svg(x.body));
  expect(g.tranche4.cards).toHaveLength(1);
  expect(
    conductorIdentityAudit({ number: 1 }, g, x.ir).findings.length,
  ).toBeGreaterThan(0);
});

function portLinkSource(extra = "", target = 100) {
  const ports = [
    ["D", 20],
    ["E", 100],
  ]
    .map(
      ([uid, x]) =>
        `<g data-device-uid="${uid}"><g data-connector-port="X"><circle cx="${x}" cy="50" r="1" fill="white" stroke="black"/><text x="${x}" y="56" font-size="3">X</text></g></g>`,
    )
    .join("");
  const edge = `<g data-connector-assembly="R" data-assembly-endpoints='[{"deviceUid":"D","portKey":"X"},{"deviceUid":"E","portKey":"X"}]'><path d="M20 50 H${target}" stroke="black" stroke-width=".4" fill="none" stroke-dasharray="2 4" ${extra}/></g>`;
  return svg(edge + ports);
}
it("N11/N17 browser positive: dashed native relation reaches measured ports without an invented dash-gap limit", async () => {
  const g = await openSheet(page, portLinkSource());
  expect(g.tranche4.assemblies).toHaveLength(1);
  expect(
    nativePortInk(g.tranche4.assemblies[0], g.tranche4.ports, "assembly"),
  ).toBe(true);
});
it.each([
  ["endpoint displaced", "", 90],
  ["ink erased", 'opacity="0"', 100],
])("N11/N17 browser mutation killed: %s", async (_name, extra, target) => {
  const g = await openSheet(page, portLinkSource(extra, target));
  expect(
    nativePortInk(g.tranche4.assemblies[0], g.tranche4.ports, "assembly"),
  ).toBeFalsy();
});
