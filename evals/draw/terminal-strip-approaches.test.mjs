import { afterAll, beforeAll, expect, it } from "vitest";
import { displaySheet, drawingContextOptions, launch } from "./browser.mjs";
import { nativeStrip } from "./terminal-strip-native.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import { checkTerminalStrip } from "./terminal-strip-check.mjs";

let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});

const key = (end) => `[&quot;strip&quot;,&quot;${end}&quot;]`;
const text = (x, y, content) =>
  `<text x="${x}" y="${y}" font-size="2.5">${content}</text>`;
const path = (d) =>
  `<path fill="none" stroke="black" stroke-width="0.4" d="${d}"/>`;
const terminal = (end, y) =>
  `<g data-strip-terminal="${key(end)}" data-strip-ref="T1/R${end}"
     data-inventory-row="${key(end)}" data-report-row="${key(end)}">
    <rect x="60" y="${y}" width="12" height="8" stroke="black" fill="white"/>
    ${text(62, y + 3, end)}
    <text data-strip-row="${key(end)}" x="62" y="${y + 6}" font-size="2.5">T1/R${end}</text>
  </g>`;
const label = (id, at, peer, y) =>
  `<g data-strip-bridge-label="${id}" data-strip-at="${key(at)}">
  ${text(105, y, `B${id.at(-1)} ${id.toUpperCase()} → TB.${peer}`)}</g>`;

function svg(stub, second) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160mm" height="120mm"
      viewBox="0 0 160 120" data-sheet="2">
     <g data-sheet-kind="terminal-strip"><g data-terminal-strip="strip">
      ${text(15, 15, "TB — authored order")}
      ${text(15, 20, "hardware unspecified")}
      ${terminal("1", 40)}${terminal("2", 64)}${terminal("3", 88)}
      <g data-strip-jumper="j1">${path("M72 42 H88 V66 H72")}</g>
      <g data-strip-jumper="j2">${path(second)}</g>
      <g data-strip-incidence="w" data-strip-at="${key("1")}">
       ${path(stub)}${text(15, 40, "W → PE.1")}</g>
      ${label("j1", "1", "2", 40)}${label("j1", "2", "1", 64)}
      ${label("j2", "1", "3", 45)}${label("j2", "3", "1", 88)}
     </g></g></svg>`;
}

function native() {
  const end = (deviceUid, terminalKey) => ({
    terminal: { deviceUid, terminalKey },
  });
  return nativeStrip(
    {
      devices: [
        { uid: "strip", designation: "TB", typeId: "strip-type" },
        { uid: "peer", designation: "PE" },
      ],
      deviceTypes: [{ id: "strip-type", terminalOrder: ["1", "2", "3"] }],
      wires: [
        {
          uid: "w",
          designation: "W",
          endpoints: [end("strip", "1"), end("peer", "1")],
        },
      ],
      jumpers: ["2", "3"].map((peer, i) => ({
        uid: `j${i + 1}`,
        designation: `J${i + 1}`,
        endpoints: [end("strip", "1"), end("strip", peer)],
      })),
      cables: [],
    },
    ["strip"],
  );
}

const separateStub = "M60 42 H35";
const separateBridge = "M60 46 H48 V90 H60";

it.each([separateStub, "M72 42 H35"])(
  "accepts separate traceable approaches and terminal-boundary contact: %s",
  async (stub) => {
    await displaySheet(page, svg(stub, separateBridge));
    const ink = await page.evaluate(stripInkScript);
    expect(checkTerminalStrip(native(), ink).findings).toEqual([]);
  },
);

it.each([
  [
    "crossing stub",
    "M72 44 H96",
    separateBridge,
    "strip-approach-conductor-bridge",
  ],
  [
    "outside-body tee",
    "M72 44 H88",
    separateBridge,
    "strip-approach-conductor-bridge",
  ],
  [
    "coincident bridges",
    separateStub,
    "M72 42 H100 V90 H72",
    "strip-approach-shared-bridge",
  ],
])("exposes %s in the measured SVG", async (_, stub, bridge, kind) => {
  await displaySheet(page, svg(stub, bridge));
  const verdict = checkTerminalStrip(
    native(),
    await page.evaluate(stripInkScript),
  );
  expect(verdict.assessment).toBe("fail");
  expect(verdict.findings).toContainEqual(
    expect.objectContaining({
      kind,
      terminal: '["strip","1"]',
      sourceSheet: 2,
    }),
  );
});

it.each([
  ["hidden stroke", '<path opacity="0"', "strip-conductor-incidence"],
  ["missing stroke", '<path stroke-opacity="0"', "strip-conductor-incidence"],
  [
    "clipped stroke",
    '<path clip-path="url(#cut)"',
    "strip-approach-unmeasurable",
  ],
])(
  "fails closed on %s with the native identity and caption still present",
  async (_, opening, kind) => {
    const source = svg(separateStub, separateBridge)
      .replace(
        "<g data-sheet-kind=",
        '<defs><clipPath id="cut"><rect x="0" y="0" width="1" height="1"/></clipPath></defs><g data-sheet-kind=',
      )
      .replace(
        path(separateStub),
        path(separateStub).replace("<path", opening),
      );
    await displaySheet(page, source);
    const checked = checkTerminalStrip(
      native(),
      await page.evaluate(stripInkScript),
    );
    expect(checked.findings.map((f) => f.kind)).toEqual([kind]);
  },
);

it.each([
  [
    "misprinted heading",
    (source) => source.replace("TB — authored order", "TX — authored order"),
  ],
  [
    "clipped caption",
    (source) =>
      source
        .replace(
          "<g data-sheet-kind=",
          '<defs><clipPath id="cut"><rect width="1" height="1"/></clipPath></defs><g data-sheet-kind=',
        )
        .replace(
          text(62, 43, "1"),
          text(62, 43, "1").replace("<text", '<text clip-path="url(#cut)"'),
        ),
  ],
  [
    "hidden caption",
    (source) =>
      source.replace(
        text(62, 43, "1"),
        text(62, 43, "1").replace("<text", '<text opacity="0"'),
      ),
  ],
])("fails closed on a drawn crossing terminal with a %s", async (_, mutate) => {
  await displaySheet(page, mutate(svg("M72 44 H96", separateBridge)));
  const ink = await page.evaluate(stripInkScript);
  expect(ink.terminals[0].rect).not.toBeNull();
  expect(checkTerminalStrip(native(), ink)).toMatchObject({
    assessment: "fail",
    findings: expect.arrayContaining([
      expect.objectContaining({
        kind: "strip-approach-unmeasurable",
        terminal: '["strip","1"]',
        sourceSheet: 2,
      }),
    ]),
  });
});

it.each([
  ["no painted stroke", 'stroke="none"'],
  ["a rotated body", 'stroke="black" transform="rotate(8 66 44)"'],
])("rejects a terminal rectangle with %s", async (_, stroke) => {
  const source = svg(separateStub, separateBridge).replace(
    '<rect x="60" y="40" width="12" height="8" stroke="black"',
    `<rect x="60" y="40" width="12" height="8" ${stroke}`,
  );
  await displaySheet(page, source);
  const ink = await page.evaluate(stripInkScript);
  expect(ink.terminals[0].rect).toBeNull();
  expect(checkTerminalStrip(native(), ink).findings).toContainEqual(
    expect.objectContaining({
      kind: "strip-terminal-coverage",
      terminal: '["strip","1"]',
    }),
  );
});
