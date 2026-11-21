import type { ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import * as runtime from "../src/layout/elk-runtime.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  seriesFixture,
  request,
  withCable,
  wire,
} from "./series-loop-fixture.js";
const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());
function changeLayout(edit: (g: ElkNode) => void) {
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    return {
      layout: async (g: any) => {
        const result = await engine.layout(g);
        edit(result);
        return result;
      },
    } as any;
  });
}
const invalids: [string, (g: ElkNode) => void, string][] = [
  [
    "out-of-bounds label",
    (g) => {
      g.edges![0]!.labels![0]!.x = g.width! + 20;
    },
    "Signal loop contains unplaced or out-of-bounds content.",
  ],
  [
    "label over device",
    (g) => {
      const l = g.edges![0]!.labels![0]!,
        n = g.children![1]!;
      l.x = n.x! + 2;
      l.y = n.y! + 2;
    },
    "Signal loop labels overlap other drawing content.",
  ],
  [
    "route through body",
    (g) => {
      const s = g.edges![0]!.sections![0]!,
        n = g.children![1]!,
        cx = n.x! + n.width! / 2,
        cy = n.y! + n.height! / 2;
      s.bendPoints = [
        { x: s.startPoint.x, y: cy },
        { x: cx, y: cy },
        { x: cx, y: s.endPoint.y },
      ];
    },
    "Signal loop route crosses a device body.",
  ],
  [
    "genuinely diagonal route",
    (g) => {
      const s = g.edges![0]!.sections![0]!;
      s.bendPoints = [{ x: s.startPoint.x + 0.1, y: s.startPoint.y + 0.2 }];
    },
    "Non-orthogonal signal loop route.",
  ],
  [
    "label concealing another conductor",
    (g) => {
      for (const e of g.edges!.slice(1)) e.labels = [];
      const s = g.edges![1]!.sections![0]!,
        ps = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      let a = ps[0]!,
        b = ps[1]!;
      for (let i = 1; i < ps.length; i++)
        if (
          Math.hypot(ps[i]!.x - ps[i - 1]!.x, ps[i]!.y - ps[i - 1]!.y) >
          Math.hypot(b.x - a.x, b.y - a.y)
        ) {
          a = ps[i - 1]!;
          b = ps[i]!;
        }
      const l = g.edges![0]!.labels![0]!;
      l.x = (a.x + b.x) / 2 - 1;
      l.y = (a.y + b.y) / 2 - 1;
      l.width = 2;
      l.height = 2;
    },
    "A signal loop label conceals another conductor.",
  ],
  [
    "overlapping conductor runs",
    (g) => {
      for (const e of g.edges!) e.labels = [];
      for (const e of g.edges!.slice(0, 2)) {
        const section = e.sections![0]!,
          a = section.startPoint,
          b = section.endPoint,
          y = g.height! - 2;
        section.bendPoints = [
          { x: a.x + 1, y: a.y },
          { x: a.x + 1, y },
          { x: b.x - 1, y },
          { x: b.x - 1, y: b.y },
        ];
      }
    },
    "Series loop routes share a conductor run; use another orientation or flow, or a circuit view.",
  ],
];
it.each(invalids)("refuses an injected %s", async (_, edit, message) => {
  const f = await seriesFixture();
  try {
    changeLayout(edit);
    await expect(prepareSignalLoopDrawing(f.ir, request())).rejects.toThrow(
      message,
    );
    const r = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      views: [request()],
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        message: `Packet view[0] "TX1 - signal loop": ${message}`,
      },
    });
    expect(r).not.toHaveProperty("value");
  } finally {
    await f.dispose();
  }
});

it("accepts sub-micrometre axis noise and emits snapped orthogonal coordinates", async () => {
  const f = await seriesFixture();
  try {
    changeLayout((g) => {
      const edge = g.edges!.find((e) => {
        const s = e.sections![0]!,
          ps = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        return ps.length > 2 && Math.abs(ps[0]!.y - ps[1]!.y) < 1e-6;
      })!;
      const s = edge.sections![0]!,
        shift =
          Math.round(s.startPoint.y * 1000) / 1000 + 0.0004998 - s.startPoint.y;
      for (const n of g.children!) n.y! += shift;
      for (const e of g.edges!) {
        for (const l of e.labels ?? []) l.y! += shift;
        for (const section of e.sections!) {
          for (const p of [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ])
            p.y += shift;
        }
      }
      g.height! += 0.01;
      s.bendPoints![0]!.y += 4e-7;
    });
    const d = await prepareSignalLoopDrawing(f.ir, request());
    const { document } = parseHTML(d.content);
    for (const path of document.querySelectorAll(
      "[data-loop-conductor] path",
    )) {
      const ps = [
        ...path.getAttribute("d")!.matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
      ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      for (let i = 1; i < ps.length; i++)
        expect(ps[i]!.x === ps[i - 1]!.x || ps[i]!.y === ps[i - 1]!.y).toBe(
          true,
        );
    }
  } finally {
    await f.dispose();
  }
});

it("escapes one complete SVG description containing engine and distribution notes", async () => {
  const f = await seriesFixture((m) => {
    m.objects.push({
      ...wire(21, "PS1", "n", "PLC1", "n"),
      designation: 'W<&>"1',
    });
  });
  try {
    const d = await prepareSignalLoopDrawing(f.ir, request());
    const { document } = parseHTML(d.content),
      descs = [...document.querySelectorAll("desc")];
    expect(descs).toHaveLength(1);
    expect(descs[0]!.textContent).toBe(d.engineNotes!.join("\n"));
    expect(descs[0]!.textContent).toContain('W<&>"1 to PLC1.n.');
    expect(d.content).toContain('W&lt;&amp;&gt;"1');
  } finally {
    await f.dispose();
  }
});
it.each(["left-to-right", "top-to-bottom"] as const)(
  "retains dashed spare cores and the assembly non-join statement in %s",
  async (flow) => {
    const f = await seriesFixture(withCable);
    try {
      const spec = request({
          flow,
          cableAssemblies: [
            { cable: "CB1", connector: "X1", description: "Field cable" },
          ],
        }),
        d = await prepareSignalLoopDrawing(f.ir, spec),
        { document } = parseHTML(d.content);
      const cs = [...document.querySelectorAll("[data-loop-conductor]")],
        spare = cs.find((e) =>
          e.getAttribute("data-loop-conductor")!.includes('"conductorId":"C"'),
        )!;
      expect(spare).toBeDefined();
      expect(spare.querySelectorAll("path")).toHaveLength(1);
      for (const path of spare.querySelectorAll("path"))
        expect(path.getAttribute("stroke-dasharray")).toBe("2 1");
      for (const e of cs.filter((e) => e !== spare))
        for (const path of e.querySelectorAll("path"))
          expect(path.hasAttribute("stroke-dasharray")).toBe(false);
      expect(d.note).toContain(
        "Assembly pin maps identify separate core routes; no shared electrical net is implied.",
      );
      const source = d.references.find((r) => r.designation === "PS1")!;
      expect(source.functions).toEqual(["output"]);
    } finally {
      await f.dispose();
    }
  },
);
it.each(["letter", "tabloid"] as const)(
  "suggests another orientation and flow on %s without advising larger than tabloid",
  async (size) => {
    const f = await seriesFixture((m) => {
      for (const type of m.types)
        type.description =
          "Synthetic field interface qualification for note-space fit";
    });
    try {
      const r = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        index: false,
        page: { size, orientation: "landscape" },
        views: [
          request({
            flow: "top-to-bottom",
            notes: Array.from({ length: 6 }, () => "W".repeat(240)),
          }),
        ],
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.message).toContain("orientation");
      expect(r.error.message).toContain("flow");
      if (size === "tabloid")
        expect(r.error.message).not.toContain("larger paper");
      else expect(r.error.message).toContain("larger paper");
    } finally {
      await f.dispose();
    }
  },
);
