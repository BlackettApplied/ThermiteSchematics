import { expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { parseSvg, offViewFixture, control } from "./off-view-fixtures.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { wireScheduleLocations } from "../src/packet/wire-schedule-locations.js";
import type { Draft, RenderedSheet } from "../src/packet/types.js";

const terminal = (deviceUid: string) => ({ deviceUid, terminalKey: "T" });
const native = () =>
  ({
    wires: [
      {
        uid: "w",
        endpoints: [{ terminal: terminal("a") }, { terminal: terminal("b") }],
      },
    ],
    jumpers: [],
    cables: [],
    cableConductors: [],
    indexes: { netIdByTerminal: [] },
  }) as unknown as ElectricalIr;
const draft = {
  view: { kind: "wiring" },
  drawingBounds: { x: 0, y: 0, w: 120, h: 80 },
} as Draft;
const marker = (uid: string, x: number, y: number) =>
  `<circle cx="${x}" cy="${y}" r="1" data-device-uid="${uid}" data-terminal-key="T"/>`;
const route = '<path data-wire-uid="w" d="M 0 0 H 100 V 60"/>';
const svg = (body: string) =>
  `<svg width="120" height="80" viewBox="0 0 120 80">${body}</svg>`;
const ink = () =>
  `<g transform="translate(10 10)">${marker("a", 0, 0)}${marker("b", 100, 60)}${route}</g>`;
function locations(body = ink(), ir = native(), ds = [draft], number = 7) {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("paper");
  return wireScheduleLocations(
    ir,
    ds,
    [{ number, svg: svg(body) } as RenderedSheet],
    page.value,
  );
}

it("locates native endpoint slots using final sheets, transforms and the NAV formatter", () => {
  expect(locations().get("w")).toEqual(["07.A1", "07.D6"]);
  expect(
    locations(ink().replace("M 0 0 H 100 V 60", "M 100 60 V 0 H 0")).get("w"),
  ).toEqual(["07.A1", "07.D6"]);
  const ir = native();
  ir.jumpers = [{ ...ir.wires[0]!, uid: "j" }];
  expect(
    locations(
      ink().replace('data-wire-uid="w"', 'data-jumper-uid="j"'),
      ir,
    ).get("j"),
  ).toEqual(["07.A1", "07.D6"]);
  ir.cables = [
    {
      uid: "c",
      assignments: [
        { id: "1", endpoints: [null, { terminal: terminal("b") }] },
      ],
    },
  ] as ElectricalIr["cables"];
  expect(
    locations(
      ink().replace(
        'data-wire-uid="w"',
        'data-cable-uid="c" data-conductor-id="1"',
      ),
      ir,
    ).get('["c","1"]'),
  ).toEqual([undefined, "07.D6"]);
});
it("retains native ownership from device groups and explicit loop terminal identities", () => {
  const owned = ink().replace(
    marker("a", 0, 0),
    `<g data-device-uid="a">${marker("a", 0, 0).replace(' data-device-uid="a"', "")}</g>`,
  );
  expect(locations(owned).get("w")).toEqual(["07.A1", "07.D6"]);
  const loop = ink().replace(
    marker("a", 0, 0),
    '<circle data-loop-terminal="[&quot;a&quot;,&quot;T&quot;]" cx="0" cy="0" r="1"/>',
  );
  expect(locations(loop).get("w")).toEqual(["07.A1", "07.D6"]);
});
it("uses every issued native endpoint landing, even when its wire is omitted", () => {
  for (const body of [
    ink().replace(route, ""),
    ink().replace('data-wire-uid="w"', 'data-wire-uid="other"'),
  ]) {
    expect(locations(body).get("w")).toEqual(["07.A1", "07.D6"]);
  }
});
it("never substitutes another native terminal, hidden or clipped ink, or a report row", () => {
  for (const body of [
    ink().replaceAll('data-terminal-key="T"', 'data-terminal-key="OTHER"'),
    `<g display="none">${ink()}</g>`,
  ]) {
    expect(locations(body).has("w")).toBe(false);
  }
  const clipped = `<defs><clipPath id="cut"><rect x="0" y="0" width="60" height="80"/></clipPath></defs><g clip-path="url(#cut)">${ink()}</g>`;
  expect(locations(clipped).get("w")).toEqual(["07.A1"]);
  expect(
    locations(ink(), native(), [{ ...draft, documentationTable: true }]).size,
  ).toBe(0);
  expect(locations(ink().replace(marker("b", 100, 60), "")).get("w")).toEqual([
    "07.A1",
  ]);
});
it("refuses a drawn endpoint whose grid location cannot be resolved", () => {
  expect(() =>
    locations(ink(), native(), [
      { ...draft, drawingBounds: { x: 0, y: 0, w: 50, h: 40 } },
    ]),
  ).toThrow(/Drawn endpoint|outside drawing field/);
});
it.each(["left-to-right", "top-to-bottom"] as const)(
  "prints locations in requested and automatic schedules without changing native facts (%s)",
  async (flow) => {
    const compiled = await offViewFixture();
    try {
      const requested = await renderSchematicPacket(compiled.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          { format: "documentation-view-request/0.1", kind: "wires" },
          control(flow),
          {
            format: "wiring-view-request/0.1",
            title: "One wire",
            conductors: ["W1"],
          },
        ],
      });
      expect(requested.ok, JSON.stringify(requested)).toBe(true);
      if (!requested.ok) throw Error(JSON.stringify(requested.error));
      const cells = requested.value.sheets
        .filter((s) => s.view.kind === "wires")
        .flatMap((s) =>
          [
            ...parseSvg(s.svg).querySelectorAll(
              '[data-report-row] [data-report-column="6"], [data-report-row] [data-report-column="7"]',
            ),
          ].map((c) => c.textContent!.trim()),
        );
      // W1 is explicitly drawn by the independent wiring request. Both native
      // terminal landings must print locators; a resolver miss is never empty.
      const w1 = compiled.ir.wires.find((w) => w.designation === "W1")!;
      const w3 = compiled.ir.wires.find((w) => w.designation === "W3")!;
      const endpointCells = (key: string) =>
        requested.value.sheets.flatMap((sheet) =>
          [...parseSvg(sheet.svg).querySelectorAll("[data-report-row]")]
            .filter((row) => row.getAttribute("data-report-row") === key)
            .flatMap((row) =>
              [6, 7].map((column) =>
                row
                  .querySelector(`[data-report-column="${column}"]`)!
                  .textContent!.trim(),
              ),
            ),
        );
      expect(endpointCells(w1.uid)).toHaveLength(2);
      expect(
        endpointCells(w1.uid).every((s) => /^\d{2,3}\.[A-D][1-6]$/u.test(s)),
      ).toBe(true);
      // W3 is omitted, but its PS1.+ endpoint is the same printed native landing.
      expect(endpointCells(w3.uid)[0]).toBe(endpointCells(w1.uid)[0]);
      expect(cells.some((s) => /^\d{2,3}\.[A-D][1-6]$/u.test(s))).toBe(true);
      expect(cells).toContain("not drawn");
      expect(
        cells.every(
          (s) => s === "not drawn" || /^\d{2,3}\.[A-D][1-6]$/u.test(s),
        ),
      ).toBe(true);
      const automatic = await renderSchematicPacket(compiled.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          control(flow),
          {
            format: "wiring-view-request/0.1",
            title: "One wire",
            conductors: ["W1"],
          },
        ],
      });
      expect(automatic.ok, JSON.stringify(automatic)).toBe(true);
      if (!automatic.ok) throw Error(JSON.stringify(automatic.error));
      const auto = automatic.value.sheets.filter(
        (s) => s.view.kind === "wires",
      );
      expect(auto.length).toBeGreaterThan(0);
      for (const sheet of auto) {
        const ink = parseSvg(sheet.svg);
        expect(
          ink.querySelector('[data-column-name="From sheet.zone"]'),
        ).not.toBeNull();
        expect(
          ink.querySelector('[data-column-name="To sheet.zone"]'),
        ).not.toBeNull();
      }
    } finally {
      await compiled.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "a cable view's drawn native endpoints never print not drawn (%s)",
  async (flow) => {
    const fixture = await offViewFixture();
    try {
      const result = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "CBL1" },
            family: "control",
            intent: { kind: "conductors" },
            flow,
          },
          { format: "documentation-view-request/0.1", kind: "wires" },
        ],
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw Error(JSON.stringify(result.error));
      const cable = fixture.ir.cables.find((c) => c.designation === "CBL1")!;
      const values = (id: string) =>
        result.value.sheets.flatMap((s) =>
          [...parseSvg(s.svg).querySelectorAll("[data-report-row]")]
            .filter(
              (r) =>
                r.getAttribute("data-report-row") ===
                JSON.stringify([cable.uid, id]),
            )
            .flatMap((r) =>
              [6, 7].map((column) =>
                r
                  .querySelector(`[data-report-column="${column}"]`)!
                  .textContent!.trim(),
              ),
            ),
        );
      expect(values("1").every((s) => /^\d{2,3}\.[A-D][1-6]$/u.test(s))).toBe(
        true,
      );
      expect(values("1")).toHaveLength(2);
      expect(values("2")[0]).toMatch(/^\d{2,3}\.[A-D][1-6]$/u);
      expect(values("2")[1]).toBe("not drawn");
    } finally {
      await fixture.dispose();
    }
  },
);

it("locates a terminal drawn only as a keyed pin-list row", () => {
  const row =
    '<g data-device-uid="a"><text data-pin-terminal="[&quot;a&quot;,&quot;T&quot;]" x="3" y="10" font-size="2.7">T pin</text></g>';
  expect(locations(row + marker("b", 110, 70)).get("w")).toEqual([
    "07.A1",
    "07.D6",
  ]);
  expect(locations(`<g display="none">${row}</g>`).has("w")).toBe(false);
});
it("first issued sheet wins, then the first painted appearance in SVG order", () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("paper");
  const first = svg(
    marker("a", 10, 10) + marker("a", 100, 70) + marker("b", 110, 70),
  );
  const later = svg(marker("a", 100, 70) + marker("b", 10, 10));
  const result = wireScheduleLocations(
    native(),
    [draft, draft],
    [
      { number: 2, svg: first },
      { number: 9, svg: later },
    ] as RenderedSheet[],
    page.value,
  );
  expect(result.get("w")).toEqual(["02.A1", "02.D6"]);
});
