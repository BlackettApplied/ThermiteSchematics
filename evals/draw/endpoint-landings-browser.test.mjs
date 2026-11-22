import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { doubleLandings } from "./checks.mjs";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">${body}</svg>`;
const marker =
  '<g data-device-uid="PE-HMI"><circle data-layout-port="pe" data-terminal-key="PE" cx="103" cy="46.662" r=".7" fill="white" stroke="black"/></g>';
const route = (i, y = 46.662) =>
  `<g data-wiring-conductor="W-PE0${i}" data-layout-source-port="s${i}" data-layout-target-port="pe" data-endpoints='[{"deviceUid":"src${i}","terminalKey":"PE"},{"deviceUid":"PE-HMI","terminalKey":"PE"}]'><path d="M${73 + i * 5} ${y} H103" stroke="black" fill="none"/></g><g data-device-uid="src${i}"><circle data-layout-port="s${i}" data-terminal-key="PE" cx="${73 + i * 5}" cy="${y}" r=".7" fill="white" stroke="black"/></g>`;
it.each([46.662, 47])(
  "measures PE-HMI shared stubs at y=%s through exported ownership",
  async (y) => {
    const g = await openSheet(
        page,
        svg(marker + [1, 2, 3].map((i) => route(i, y)).join("")),
      ),
      f = doubleLandings(g);
    expect(f.filter((x) => x.kind === "merged-double-landing")).toHaveLength(3);
    expect(
      f.filter((x) => x.kind === "endpoint-off-owned-anchor"),
    ).toHaveLength(y === 47 ? 3 : 0);
  },
);
it.each([
  ["missing", () => ""],
  ["ambiguous", () => marker + marker],
  [
    "foreign",
    () => marker.replace('data-layout-port="pe"', 'data-layout-port="foreign"'),
  ],
])(
  "refuses %s owned markers even beside a coincident circle",
  async (_name, mutate) => {
    const g = await openSheet(page, svg(mutate() + route(1)));
    expect(
      doubleLandings(g).some(
        (f) => f.kind === "endpoint-landing-ownership-unavailable",
      ),
    ).toBe(true);
  },
);
it("does not borrow the same port name from another nested drawing", async () => {
  const g = await openSheet(
    page,
    svg(
      `<svg width="200" height="100" viewBox="0 0 200 100">${route(1)}</svg><svg width="200" height="100" viewBox="0 0 200 100">${marker}</svg>`,
    ),
  );
  expect(
    doubleLandings(g).some(
      (f) => f.kind === "endpoint-landing-ownership-unavailable",
    ),
  ).toBe(true);
});
it("accepts an owned terminal attachment end while rejecting a gap in its route", async () => {
  const stem =
    '<g data-device-uid="d"><g data-layout-port="a" data-terminal-attachment=\'["d","A1"]\' data-attachment-to=\'{"x":50,"y":20}\'><path d="M34 20 H50" stroke="black"/></g></g>';
  for (const offset of [0, 0.02]) {
    const g = await openSheet(
      page,
      svg(
        stem +
          `<g data-circuit-conductor="w" data-layout-source-port="a" data-layout-target-port="b"><path d="M${50 + offset} 20 H80" stroke="black"/></g><circle data-layout-port="b" cx="80" cy="20" r=".7"/>`,
      ),
    );
    expect(
      doubleLandings(g).filter((f) => f.kind === "endpoint-off-owned-anchor"),
    ).toHaveLength(offset ? 1 : 0);
  }
});

it("resolves reused layout port IDs within each exported circuit group", async () => {
  const body = `<g data-circuit-group="a">${marker}${route(1)}</g><g data-circuit-group="b" transform="translate(0 20)">${marker}${route(1)}</g>`;
  const g = await openSheet(page, svg(body));
  expect(doubleLandings(g)).toEqual([]);
});
it("does not borrow an anchor from another circuit group on the same sheet", async () => {
  const g = await openSheet(
    page,
    svg(
      `<g data-circuit-group="a">${route(1)}</g><g data-circuit-group="b">${marker}</g>`,
    ),
  );
  expect(
    doubleLandings(g).some(
      (f) => f.kind === "endpoint-landing-ownership-unavailable",
    ),
  ).toBe(true);
});
