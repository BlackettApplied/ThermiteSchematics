import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";

for (const series of [false, true])
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `prints the authored RM3 + / - pin pairs unambiguously, series ${series}, in %s`,
    async (flow) => {
      const root = resolve(
        "packages/core-library/test/fixtures",
        series ? "series-loop" : "rm3",
      );
      const c = await compileProject(root);
      if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
      const input = JSON.parse(
        await readFile(
          join(root, series ? "rm3.request.json" : "loop.request.json"),
          "utf8",
        ),
      );
      const view = {
        ...(series ? input.views[0] : input),
        flow,
        cableAssemblies: [
          {
            cable: "CBL3",
            connector: "PAIR",
            description: "Synthetic single-pair cable; hardware unspecified",
          },
        ],
      };
      const before = JSON.stringify(c.ir);
      const drawing = await prepareSignalLoopDrawing(c.ir, view);
      const visible = [
        ...parseHTML(drawing.content).document.querySelectorAll("text"),
      ]
        .map((t) => t.textContent)
        .join(" ");
      expect(visible).toContain(series ? "Pin map: +:5, -:6" : "+:5, -:6");
      expect(visible).not.toContain("+-5");
      expect(visible).not.toContain("--6");
      const result = await renderSchematicPacket(c.ir, {
        format: "schematic-packet-request/0.1",
        index: false,
        page: {
          size: "tabloid",
          orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
        },
        views: [view],
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) expect(result.value.sheets).toHaveLength(1);
      expect(JSON.stringify(c.ir)).toBe(before);
    },
  );

it("keeps signed names and internal hyphens intact without widening or rewrapping the map", async () => {
  const { pinMapPair } = await import("../src/signal-loop/pin-map.js");
  const { measureText, wrapText } = await import("../src/text-metrics.js");
  const cases = [
    ["+", "5", false, "+:5"],
    ["-", "6", false, "-:6"],
    ["~", "L1", false, "~:L1"],
    ["±", "1", true, "±:1 spare"],
    ["A-B", "X-1", true, "A-B:X-1 spare"],
  ] as const;
  const old: string[] = [],
    current: string[] = [];
  for (const [a, b, spare, expected] of cases) {
    const value = pinMapPair({
      ends: [
        { deviceUid: "from", terminalKey: a },
        { deviceUid: "to", terminalKey: b },
      ],
      spare,
    });
    expect(value).toBe(expected);
    expect(measureText(value, 2.7).unknownGlyphs).toEqual([]);
    const previous = `${a}-${b}${spare ? " spare" : ""}`;
    expect(measureText(value, 2.7).width).toBe(
      measureText(previous, 2.7).width,
    );
    old.push(previous);
    current.push(value);
  }
  expect(wrapText(current.join(", "), 55, 2.7).map((s) => s.length)).toEqual(
    wrapText(old.join(", "), 55, 2.7).map((s) => s.length),
  );
});

for (const series of [false, true])
  for (const colonAt of ["from", "to"] as const)
    it.each(["left-to-right", "top-to-bottom"] as const)(
      `refuses a colon in the ${colonAt} pin-map name, series ${series}, in %s`,
      async (flow) => {
        const { seriesFixture, withCable } =
          await import("./series-loop-fixture.js");
        const { directFixture, withDirectFieldStage } =
          await import("./direct-loop-fixture.js");
        const edit = (m: import("./series-loop-fixture.js").SeriesModel) => {
          if (series) withCable(m);
          else withDirectFieldStage(m, true);
          const device = colonAt === "from" ? "TX1" : "TB1";
          const old = colonAt === "from" ? "p" : "1";
          const name = colonAt === "from" ? "X1:1" : "X2:5";
          const type = m.types[colonAt === "from" ? 1 : 3];
          type.terminals[name] = type.terminals[old];
          delete type.terminals[old];
          for (const fn of Object.values(type.functions) as {
            terminals: string[];
          }[])
            fn.terminals = fn.terminals.map((t) => (t === old ? name : t));
          for (const object of m.objects)
            for (const end of object.endpoints ??
              object.conductors?.flatMap((c: any) => c.endpoints) ??
              [])
              if (end?.device === device && end.terminal === old)
                end.terminal = name;
        };
        const f = await (series ? seriesFixture(edit) : directFixture(edit));
        try {
          const view = {
            format: "signal-loop-view-request/0.1" as const,
            from: { device: "TX1", function: "signal" },
            to: { device: "AI1", function: "input" },
            ...(series
              ? { loopPower: { device: "PS1", function: "output" } }
              : {}),
            flow,
            cableAssemblies: [
              {
                cable: "CB1",
                connector: "PAIR",
                description: "Synthetic cable assembly",
              },
            ],
          };
          const pair = colonAt === "from" ? '["X1:1","1"]' : '["p","X2:5"]';
          const message = `Pin map pair ${pair}: pin maps cannot show terminal names containing ":"; use an explicit circuit view.`;
          await expect(prepareSignalLoopDrawing(f.ir, view)).rejects.toThrow(
            message,
          );
          const result = await renderSchematicPacket(f.ir, {
            format: "schematic-packet-request/0.1",
            index: false,
            views: [view],
          });
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: "R006",
              reason: "unprintable-layout",
              message: `Packet view[0] "TX1 - signal loop": ${message}`,
            },
          });
          expect(result).not.toHaveProperty("value");
          const { cableAssemblies: _, ...withoutMap } = view;
          await expect(
            prepareSignalLoopDrawing(f.ir, withoutMap),
          ).resolves.toHaveProperty("content");
        } finally {
          await f.dispose();
        }
      },
    );

it.each(["left-to-right", "top-to-bottom"] as const)(
  "uses the address or authored analog role for series-loop selected captions in %s",
  async (flow) => {
    const { seriesFixture, seriesRequest } =
      await import("./series-loop-fixture.js");
    const fixture = await seriesFixture();
    try {
      for (const address of [undefined, "IW 42 <authored>"]) {
        const ir = structuredClone(fixture.ir);
        const device = ir.devices.find((d) => d.designation === "AI1")!;
        if (address !== undefined)
          device.io = {
            addressSpace: "Synthetic",
            channels: { input: { address } },
          };
        const before = JSON.stringify(ir);
        const drawing = await prepareSignalLoopDrawing(ir, {
          ...seriesRequest,
          flow,
        });
        const visible = [
          ...parseHTML(drawing.content).document.querySelectorAll("text"),
        ]
          .map((t) => t.textContent)
          .join(" ");
        expect(visible).toContain(`${address ?? "AI"} / selected channel`);
        expect(visible).not.toContain("input / selected channel");
        expect(drawing.references).toContainEqual(
          expect.objectContaining({
            deviceUid: device.uid,
            functions: ["input"],
          }),
        );
        const result = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          views: [{ ...seriesRequest, flow }],
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(JSON.stringify(ir)).toBe(before);
      }
    } finally {
      await fixture.dispose();
    }
  },
);
