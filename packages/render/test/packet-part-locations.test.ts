import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { parseSvg } from "./off-view-fixtures.js";

const cases = [
  "network-pagination",
  "circuit-pagination",
  "motor-starter-documentation",
];
const fixtures = new Map();
beforeAll(async () => {
  for (const name of cases) {
    const c = await compileProject(
      `examples/${name === "motor-starter-documentation" ? "motor-starter" : name}`,
    );
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    fixtures.set(name, c.ir);
  }
});
it.each(cases)(
  "resolves native part references to measured final sheet.zone (%s)",
  async (name) => {
    const ir = fixtures.get(name);
    const request = JSON.parse(
      await readFile(
        name === "motor-starter-documentation"
          ? "examples/alpha/motor-starter-documentation.packet.json"
          : `examples/${name}/packet.json`,
        "utf8",
      ),
    );
    for (const view of request.views)
      if (view.format === "circuit-view-request/0.1")
        view.flow = "top-to-bottom";
    const result = await renderSchematicPacket(ir, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.value.sheets.flatMap((s) => [
      ...parseSvg(s.svg).querySelectorAll(
        "[data-circuit-continuation], [data-communication-continuation-device]",
      ),
    ]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const tokens = [
        ...(ref.textContent ?? "").matchAll(
          /P(\d+)\/S(\d+)(?:\.([A-D][1-6]))?/g,
        ),
      ];
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((m) => m[3])).toBe(true);
      for (const token of tokens)
        expect(
          result.value.sheets.some((s) => s.number === Number(token[2])),
        ).toBe(true);
    }
    if (name === "network-pagination") {
      expect(result.value.sheets).toHaveLength(17);
      const portRefs = result.value.sheets.flatMap((s) => [
        ...parseSvg(s.svg).querySelectorAll("[data-native-part-port]"),
      ]);
      expect(portRefs.length).toBeGreaterThan(0);
      for (const p of portRefs) {
        const key = p.getAttribute("data-native-part-port");
        expect(p.textContent).toContain(` port ${key} → `);
        expect(p.textContent).toMatch(/\d{2}\.[A-D][1-6]/);
      }
      for (const port of ["B1", "B2", "B3", "IN", "OUT"])
        expect(
          portRefs.some(
            (p) => p.getAttribute("data-native-part-port") === port,
          ),
        ).toBe(true);
    }
  },
);

import { mirrorFixture } from "./packet-mirror-fixture.js";
import { resolveNativePartLocations } from "../src/packet/native-part-locations.js";
import { emitCommunicationContinuationBlock } from "../src/packet/continuations.js";
import { escapeXmlAttribute as attr } from "../src/svg/escape.js";
import { required } from "../src/presentation/util.js";
it("keeps port identity attached to its own measured destination rather than the device's first port", () => {
  const ir = required(fixtures.get("network-pagination"), "Missing network IR");
  const f = mirrorFixture(ir, [[], [], []]);
  const uid = "native-hub";
  const ports = [
    ["OUT", 350, 50],
    ["IN", 80, 100],
    ["B1", 160, 170],
    ["B2", 280, 220],
  ] as const;
  for (const [i, d] of f.drafts.entries()) {
    const selected = i === 2 ? ports.slice(2) : ports.slice(i, i + 1);
    d.content = `<g data-device-uid="${uid}">${selected.map(([key, x, y]) => `<g data-communication-port="${key}" transform="translate(${x} ${y})"><circle r="0.7"/></g>`).join("")}</g>`;
    d.topologyCoverage = [
      {
        kind: "communication",
        relationIds: [],
        deviceUids: [uid],
        ports: selected.map(([portKey]) => ({ deviceUid: uid, portKey })),
      },
    ];
  }
  const source = required(f.drafts[0], "Missing source part");
  source.communicationBlock = {
    view: 1,
    part: 1,
    x: 0,
    y: 0,
    width: 360,
    rows: [
      {
        deviceUid: uid,
        label: "HUB",
        targets: [
          { part: 2, sheet: 2 },
          { part: 3, sheet: 3 },
        ],
        ports: ["IN", "B1", "B2"].map((key) => ({ key, targets: [] })),
      },
    ],
  };
  resolveNativePartLocations(f.drafts);
  const row = required(source.communicationBlock.rows[0], "Missing hub row");
  expect(row.ports).toEqual([
    { key: "IN", targets: [{ part: 2, sheet: 2, zone: "B2" }] },
    { key: "B1", targets: [{ part: 3, sheet: 3, zone: "C3" }] },
    { key: "B2", targets: [{ part: 3, sheet: 3, zone: "D5" }] },
  ]);
  const ink = parseSvg(
    emitCommunicationContinuationBlock(source.communicationBlock),
  );
  expect(ink.querySelector('[data-native-part-port="B2"]')?.textContent).toBe(
    "HUB port B2 → 03.D5",
  );
});
it("uses the named circuit terminal in the named part, including after a prior sheet", () => {
  const ir = required(fixtures.get("circuit-pagination"), "Missing circuit IR"),
    f = mirrorFixture(ir, [[], [], []]);
  const terminal = JSON.stringify(["native-device", "95"]),
    source = required(f.drafts[0], "Missing source"),
    target = required(f.drafts[2], "Missing target");
  target.content = `<g data-circuit-part="2"><g data-circuit-group="named-group"><g data-terminal-id="${attr(terminal)}"><circle cx="250" cy="170" r=".65"/></g></g><g data-circuit-group="wrong-group"><g data-terminal-id="${attr(terminal)}"><circle cx="10" cy="10" r=".65"/></g></g></g>`;
  source.circuitBlocks = [
    {
      group: "named-group",
      part: 1,
      x: 0,
      y: 0,
      width: 360,
      rows: [
        { id: terminal, label: "DEVICE.95", targets: [{ part: 2, sheet: 3 }] },
      ],
    },
  ];
  resolveNativePartLocations(f.drafts);
  expect(source.circuitBlocks[0]?.rows[0]?.targets).toEqual([
    { part: 2, sheet: 3, zone: "C5" },
  ]);
  target.content = target.content.replace(
    '<circle cx="250"',
    '<circle display="none" cx="250"',
  );
  expect(() => resolveNativePartLocations(f.drafts)).toThrow(
    /visible terminal/,
  );
});
