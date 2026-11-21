import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import {
  prepareSignalLoopDrawing,
  selectSignalLoop,
} from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  seriesFixture,
  request,
  withFieldChains,
  withFeedThroughs,
  withCable,
  wire,
  uid,
} from "./series-loop-fixture.js";
import {
  frozenSeriesFixture,
  frozenRequest,
  fieldSeriesFixture,
  fieldRequest,
} from "./series-loop-library-fixture.js";

export function segments(content: string) {
  const { document } = parseHTML(content);
  return [...document.querySelectorAll("[data-loop-conductor]")].flatMap((g) =>
    [...g.querySelectorAll("path")].flatMap((path) => {
      const pts = [
        ...path.getAttribute("d")!.matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
      ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      return pts.slice(1).map((b, i) => ({
        a: pts[i]!,
        b,
        id: g.getAttribute("data-loop-conductor"),
      }));
    }),
  );
}
export function sharedRuns(content: string) {
  const es = segments(content),
    out = [];
  for (let i = 0; i < es.length; i++)
    for (const b of es.slice(i + 1)) {
      const a = es[i]!;
      if (a.id === b.id) continue;
      const h =
          a.a.y === a.b.y &&
          b.a.y === b.b.y &&
          Math.abs(a.a.y - b.a.y) < 0.0001,
        v =
          a.a.x === a.b.x &&
          b.a.x === b.b.x &&
          Math.abs(a.a.x - b.a.x) < 0.0001;
      if (!h && !v) continue;
      const axis = h ? "x" : "y",
        overlap =
          Math.min(
            Math.max(a.a[axis], a.b[axis]),
            Math.max(b.a[axis], b.b[axis]),
          ) -
          Math.max(
            Math.min(a.a[axis], a.b[axis]),
            Math.min(b.a[axis], b.b[axis]),
          );
      if (overlap > 0.001) out.push([a.id, b.id, overlap]);
    }
  return out;
}
const packet = (
  view: any,
  page = { size: "tabloid", orientation: "landscape" },
) => ({
  format: "schematic-packet-request/0.1" as const,
  index: false,
  views: [view],
  page: page as any,
});

it("draws the frozen 0.1.0 supply, field terminal block and third-leg junction box without float refusals", async () => {
  const f = await frozenSeriesFixture();
  try {
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const view = { ...frozenRequest, flow };
      const d = await prepareSignalLoopDrawing(f.ir, view);
      for (const { a, b } of segments(d.content))
        expect(a.x === b.x || a.y === b.y).toBe(true);
      const r = await renderSchematicPacket(
        f.ir,
        packet(view, {
          size: "tabloid",
          orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
        }),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(r.value.sheets).toHaveLength(1);
    }
  } finally {
    await f.dispose();
  }
});
it("lays out the realistic high-side M12/bulkhead/strip/Siemens AI chain without a spurious non-orthogonal refusal", async () => {
  const f = await fieldSeriesFixture();
  try {
    const d = await prepareSignalLoopDrawing(f.ir, {
      ...fieldRequest,
      flow: "left-to-right",
    });
    expect(d.width).toBeGreaterThan(0);
    for (const { a, b } of segments(d.content))
      expect(a.x === b.x || a.y === b.y).toBe(true);
  } finally {
    await f.dispose();
  }
});
it("lays out a three-strip field chain without a spurious non-orthogonal refusal", async () => {
  const f = await seriesFixture((m) =>
    withFieldChains(m, ["TB1", "TB2", "TB3"]),
  );
  try {
    const d = await prepareSignalLoopDrawing(f.ir, request());
    expect(d.width).toBeGreaterThan(0);
    for (const { a, b } of segments(d.content))
      expect(a.x === b.x || a.y === b.y).toBe(true);
  } finally {
    await f.dispose();
  }
});
it.each(["left-to-right", "top-to-bottom"] as const)(
  "shows separate conductor landings on opposite strip faces in %s",
  async (flow) => {
    const f = await seriesFixture(withFeedThroughs);
    try {
      const d = await prepareSignalLoopDrawing(f.ir, request({ flow }));
      expect(sharedRuns(d.content)).toEqual([]);
      const { document } = parseHTML(d.content),
        strip = document.querySelector(
          '[data-device-uid="74000000-0000-4000-8000-000000000004"]',
        )!;
      for (const pin of ["1", "2"]) {
        const cs = [...strip.querySelectorAll("[data-loop-terminal]")]
          .filter(
            (e) => JSON.parse(e.getAttribute("data-loop-terminal")!)[1] === pin,
          )
          .flatMap((e) => [...e.querySelectorAll("circle")]);
        expect(cs).toHaveLength(2);
        const id = JSON.stringify([uid(4), pin]),
          link = [
            ...strip.querySelectorAll("[data-terminal-feed-through]"),
          ].find((e) => e.getAttribute("data-terminal-feed-through") === id);
        expect(link, `missing internal link for ${pin}`).toBeDefined();
        const ends = [
          ...link!
            .querySelector("path")!
            .getAttribute("d")!
            .matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
        ].map((m) => [Number(m[1]), Number(m[2])]);
        expect(ends.sort()).toEqual(
          cs
            .map((c) => [
              Number(c.getAttribute("cx")),
              Number(c.getAttribute("cy")),
            ])
            .sort(),
        );
        expect(
          Number(cs[0]!.getAttribute(flow === "left-to-right" ? "cx" : "cy")),
        ).not.toBe(
          Number(cs[1]!.getAttribute(flow === "left-to-right" ? "cx" : "cy")),
        );
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "rejects a spare core on a loop terminal before layout and refuses three spare landings on an unused contact in %s",
  async (flow) => {
    const f = await seriesFixture((m) => {
      withCable(m);
      const type = m.types.find((t) => t.kind === "cable_type"),
        cable = m.objects.find((o) => o.kind === "cable");
      for (const id of ["D", "E"]) {
        type.conductors.push({ id, color: "white" });
        cable.conductors.push({ ...structuredClone(cable.conductors[2]), id });
      }
    });
    try {
      const view = request({ flow }),
        selected = selectSignalLoop(f.ir, view);
      expect(selected.conductors.filter((c) => c.spare)).toHaveLength(3);
      const r = await renderSchematicPacket(f.ir, packet(view));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("R006");
        expect(r.error.message).toContain(
          "Series loop needs separate visible conductor landings at each feed-through; use a circuit view.",
        );
        expect(r).not.toHaveProperty("value");
      }
    } finally {
      await f.dispose();
    }
    const branched = await seriesFixture((m) => {
      withCable(m);
      const cable = m.objects.find((o) => o.kind === "cable");
      cable.conductors[2].endpoints[1].terminal = "1";
    });
    try {
      const r = await renderSchematicPacket(
        branched.ir,
        packet(request({ flow })),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("R006");
        expect(r.error.message).toContain(
          "Series loop has an additional connection at TB1.1; use a circuit view that includes the branch.",
        );
        expect(r).not.toHaveProperty("value");
      }
    } finally {
      await branched.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "fits the five-device high-side field library loop on tabloid in %s",
  async (flow) => {
    const f = await fieldSeriesFixture();
    try {
      const view = { ...fieldRequest, flow },
        r = await renderSchematicPacket(
          f.ir,
          packet(view, {
            size: "tabloid",
            orientation: flow === "left-to-right" ? "landscape" : "portrait",
          }),
        );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(r.value.sheets).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  },
);

it("keeps a third-leg cable assembly pin map consistent when a spare runs in the opposite layout direction", async () => {
  const f = await seriesFixture((m) => {
    withFeedThroughs(m);
    m.types[0].terminals.aux = { connection_policy: "shared" };
    m.objects = m.objects.filter((o) => o.uid !== uid(12));
    m.objects.push(wire(15, "AI1", "n", "TB1", "3"));
    m.types.push({
      kind: "cable_type",
      id: "series:return-cable",
      conductors: [
        { id: "A", color: "black" },
        { id: "B", color: "white" },
      ],
    });
    m.objects.push({
      kind: "cable",
      uid: uid(30),
      designation: "CB2",
      type: "series:return-cable",
      conductors: [
        {
          id: "A",
          usage: "in-use",
          endpoints: [
            { device: "PS1", terminal: "n" },
            { device: "TB1", terminal: "3" },
          ],
        },
        {
          id: "B",
          usage: "spare",
          endpoints: [
            { device: "PS1", terminal: "aux" },
            { device: "TB1", terminal: "4" },
          ],
        },
      ],
    });
  });
  try {
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const d = await prepareSignalLoopDrawing(
        f.ir,
        request({
          flow,
          cableAssemblies: [
            { cable: "CB2", connector: "X2", description: "Return cable" },
          ],
        }),
      );
      expect(d.content).toContain("Pin map: n:3, aux:4 spare");
      expect(sharedRuns(d.content)).toEqual([]);
    }
  } finally {
    await f.dispose();
  }
});
