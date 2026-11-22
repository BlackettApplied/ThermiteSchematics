import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { routeQuality } from "./checks.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});

async function jogs({
  mark = "",
  lead = 11.25,
  owner = "left",
  offset = 0,
} = {}) {
  const g = await openSheet(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
      <g data-circuit-group="g1">
        <g data-device-uid="${owner}">
          <circle data-layout-port="${offset ? "physical" : "a"}" data-terminal-key="A" cx="${10 - offset}" cy="30" r=".65" fill="white" stroke="black"/>
          ${offset ? '<circle data-layout-port="a" data-circuit-landing-for="physical" data-terminal-key="A" cx="10" cy="30" r=".001" fill="none" stroke="none"/>' : ""}
        </g>
        <g data-device-uid="right"><circle data-layout-port="b" data-terminal-key="B" cx="50" cy="32.5" r=".65" fill="white" stroke="black"/></g>
        <g data-circuit-conductor="W1" data-layout-source-port="a" data-layout-target-port="b" data-endpoints='[{"deviceUid":"left","terminalKey":"A"},{"deviceUid":"right","terminalKey":"B"}]'>
          <path ${mark && `data-circuit-fan-in="${mark}"`} d="M10 30 H${lead} V32.5 H30 V33 H48.5 V32.5 H50" fill="none" stroke="black"/>
        </g>
      </g>
    </svg>`,
  );
  return routeQuality(g)
    .filter((f) => f.kind === "jog-under-3mm")
    .flatMap((f) => f.segments.map(({ segment }) => segment));
}

it("exempts only the marked terminal jogs at the marked end", async () => {
  expect(await jogs()).toEqual([1, 3, 5]);
  expect(await jogs({ mark: "source:1 target:5" })).toEqual([3]);
  expect(await jogs({ mark: "target:1 source:3 target:5" })).toEqual([1, 3]);
});

it("checks the 3 mm envelope against the owning physical terminal", async () => {
  expect(await jogs({ mark: "source:1 target:5", lead: 12 })).toEqual([1, 3]);
  expect(await jogs({ mark: "source:1 target:5", owner: "foreign" })).toEqual([
    1, 3,
  ]);
  expect(await jogs({ mark: "source:1 target:5", offset: 0.625 })).toEqual([
    1, 3,
  ]);
});
