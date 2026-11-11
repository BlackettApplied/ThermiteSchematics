import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  prepareSignalLoopDrawing,
  selectSignalLoop,
} from "../src/signal-loop.js";
import {
  seriesFixture,
  request,
  withCable,
  wire,
  uid,
} from "./series-loop-fixture.js";

export const assessed =
  "Three separate loop nets; loop power from PS1.output as wired. Not assessed: input mode (passive/active), isolation, loop voltage budget.";
const packet = (view: ReturnType<typeof request>, extra = {}) => ({
  format: "schematic-packet-request/0.1" as const,
  index: false,
  views: [view],
  ...extra,
});
const visible = (svg: string) =>
  [...parseHTML(svg).document.querySelectorAll("text")]
    .map((t) => t.textContent)
    .join(" ")
    .replace(/\s+/gu, " ");

it.each([false, true])(
  "draws all three nets at real terminals, high side %s",
  async (high) => {
    const f = await seriesFixture(undefined, high);
    try {
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const before = JSON.stringify(f.ir),
          selected = selectSignalLoop(f.ir, request({ flow }));
        const result = await renderSchematicPacket(
          f.ir,
          packet(request({ flow })),
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) continue;
        expect(result.value.sheets).toHaveLength(1);
        const svg = result.value.sheets[0]!.svg,
          { document } = parseHTML(svg);
        const ids = [...document.querySelectorAll("[data-loop-conductor]")]
          .map((e) => e.getAttribute("data-loop-conductor"))
          .sort();
        expect(ids).toEqual(selected.conductors.map((e) => e.id).sort());
        for (const c of selected.conductors)
          expect(
            document
              .querySelector(`[data-loop-conductor='${c.id}']`)
              ?.getAttribute("data-net-id"),
          ).toBe(c.net);
        expect(
          document.querySelectorAll('[data-circuit-mark="dc-output"]'),
        ).toHaveLength(1);
        expect(
          document.querySelectorAll('[data-source-enclosure="true"]'),
        ).toHaveLength(1);
        expect(visible(svg)).toContain("Loop power: PS1");
        expect(visible(svg)).toContain(assessed);
        expect(
          [...document.querySelectorAll("desc")]
            .map((e) => e.textContent)
            .join("\n"),
        ).toContain(assessed);
        expect(svg).not.toContain("Two separate signal nets");
        expect(JSON.stringify(f.ir)).toBe(before);
        expect(
          await renderSchematicPacket(f.ir, packet(request({ flow }))),
        ).toEqual(result);
        const golden = await readFile(
          new URL(
            `./goldens/series-loop/${high ? "high" : "low"}-${flow}.svg`,
            import.meta.url,
          ),
          "utf8",
        );
        expect(svg).toBe(golden);
      }
    } finally {
      await f.dispose();
    }
  },
);

it("draws a cable's individual cores on two device pairs across different legs truthfully and refuses to collapse them into one assembly", async () => {
  const f = await seriesFixture((m) => {
    withCable(m);
    const cable = m.objects.find((o) => o.kind === "cable");
    cable.conductors[1].endpoints = [
      { device: "TB1", terminal: "2" },
      { device: "AI1", terminal: "p" },
    ];
    m.objects = m.objects.filter((o) => o.uid !== uid(11));
    m.objects.push(wire(15, "TX1", "n", "TB1", "2"));
  });
  try {
    const selected = selectSignalLoop(f.ir, request());
    expect(selected.conductors.filter((c) => c.cable)).toHaveLength(3);
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const d = await prepareSignalLoopDrawing(f.ir, request({ flow }));
      const { document } = parseHTML(d.content);
      routeOracle(d.content, selected);
      expect(
        [...document.querySelectorAll("[data-loop-conductor]")]
          .map((e) => e.getAttribute("data-loop-conductor"))
          .sort(),
      ).toEqual(selected.conductors.map((c) => c.id).sort());
      await expect(
        prepareSignalLoopDrawing(
          f.ir,
          request({
            flow,
            cableAssemblies: [
              { cable: "CB1", connector: "X1", description: "Field cable" },
            ],
          }),
        ),
      ).rejects.toThrow(
        "A cable assembly must terminate on the same pair of devices for every core.",
      );
    }
  } finally {
    await f.dispose();
  }
});

it("refuses a combined input and supply device rather than draw an ambiguous self connection", async () => {
  const f = await seriesFixture((m) => {
    m.types[0].terminals.i = {
      role: "analog_input_positive",
      connection_policy: "shared",
    };
    m.types[0].terminals.r = {
      role: "analog_input_negative",
      connection_policy: "shared",
    };
    m.types[0].functions.input = {
      kind: "channel",
      direction: "input",
      terminals: ["i", "r"],
    };
    for (const o of m.objects)
      for (const e of o.endpoints ?? [])
        if (e.device === "AI1") {
          e.device = "PS1";
          e.terminal = e.terminal === "p" ? "i" : "r";
        }
  });
  try {
    expect(() =>
      selectSignalLoop(
        f.ir,
        request({ to: { device: "PS1", function: "input" } }),
      ),
    ).toThrow(
      "Series loop power source PS1 cannot also be the input channel; use an explicit circuit view.",
    );
  } finally {
    await f.dispose();
  }
});

it("copies exact engine and distribution notes to sheet, desc and enabled references", async () => {
  const f = await seriesFixture((m) => {
    delete m.types[1].terminals.p.role;
    delete m.types[1].terminals.n.role;
    delete m.types[2].terminals.p.role;
    delete m.types[2].terminals.n.role;
    m.objects.push(
      wire(21, "PS1", "p", "PLC1", "p"),
      wire(20, "PS1", "n", "PLC1", "n"),
    );
  });
  try {
    const notes = [
      assessed.slice(0, -1) + "; polarity not verified: AI1.input, TX1.signal.",
      "Outside selected loop at PS1.p: 1 authored connections: W21 to PLC1.p.",
      "Outside selected loop at PS1.n: 1 authored connections: W20 to PLC1.n.",
    ];
    for (const references of [
      false,
      { appearances: "all" as const },
      { appearances: "drawings" as const },
    ]) {
      const r = await renderSchematicPacket(
        f.ir,
        packet(request({ notes: ["User note"] }), { index: true, references }),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) continue;
      const sheet = r.value.sheets[0]!.svg;
      for (const note of notes) {
        expect(visible(sheet)).toContain(note);
        expect(
          [...parseHTML(sheet).document.querySelectorAll("desc")]
            .map((e) => e.textContent)
            .join("\n"),
        ).toContain(note);
        if (references !== false)
          expect(
            r.value.sheets
              .filter(
                (s) =>
                  s.view.format === "documentation-view/0.1" &&
                  s.view.kind === "references",
              )
              .map((s) => visible(s.svg))
              .join(" "),
          ).toContain(note);
      }
      expect(visible(sheet)).toContain("User note");
    }
  } finally {
    await f.dispose();
  }
});

function routeOracle(
  content: string,
  selected: ReturnType<typeof selectSignalLoop>,
) {
  const { document } = parseHTML(content);
  const pos = (value: string | null) => {
    const m = value!.match(/translate\(([-.\d]+) ([-.\d]+)\)/)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const nodes = [...document.querySelectorAll("[data-device-uid]")].map(
    (g) => ({
      ...pos(g.getAttribute("transform")),
      w: Number(g.getAttribute("data-body-width")),
      h: Number(g.getAttribute("data-body-height")),
      group: g,
    }),
  );
  const terminal = new Map<string, { x: number; y: number }[]>();
  for (const b of nodes)
    for (const g of b.group.querySelectorAll("[data-loop-terminal]"))
      for (const c of g.querySelectorAll("circle")) {
        const id = g.getAttribute("data-loop-terminal")!;
        terminal.set(id, [
          ...(terminal.get(id) ?? []),
          {
            x: b.x + Number(c.getAttribute("cx")),
            y: b.y + Number(c.getAttribute("cy")),
          },
        ]);
      }
  const groups = [...document.querySelectorAll("[data-loop-conductor]")];
  expect(
    groups.map((g) => g.getAttribute("data-loop-conductor")).sort(),
  ).toEqual(selected.conductors.map((c) => c.id).sort());
  for (const c of selected.conductors) {
    const g = groups.find(
      (g) => g.getAttribute("data-loop-conductor") === c.id,
    )!;
    expect(g.getAttribute("data-net-id")).toBe(c.net);
    const ends = JSON.parse(g.getAttribute("data-terminal-ends")!);
    const keys = (es: typeof ends) =>
      es.map((e: any) => JSON.stringify([e.deviceUid, e.terminalKey])).sort();
    expect(keys(ends)).toEqual(keys(c.ends));
    const paths = [...g.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    const all = paths.map((p) =>
      [...p.getAttribute("d")!.matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g)].map(
        (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
      ),
    );
    const first = all[0]![0]!,
      last = all.at(-1)!.at(-1)!;
    for (const p of [first, last])
      expect(
        Math.min(
          ...keys(ends).flatMap((k: string) =>
            (terminal.get(k) ?? []).map((t) =>
              Math.hypot(p.x - t.x, p.y - t.y),
            ),
          ),
        ),
      ).toBeLessThan(0.002);
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(1);
    for (const ps of all)
      for (let i = 1; i < ps.length; i++) {
        const a = ps[i - 1]!,
          b = ps[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const box of nodes)
          expect(
            a.x === b.x
              ? a.x > box.x + 0.01 &&
                  a.x < box.x + box.w - 0.01 &&
                  Math.max(a.y, b.y) > box.y + 0.01 &&
                  Math.min(a.y, b.y) < box.y + box.h - 0.01
              : a.y > box.y + 0.01 &&
                  a.y < box.y + box.h - 0.01 &&
                  Math.max(a.x, b.x) > box.x + 0.01 &&
                  Math.min(a.x, b.x) < box.x + box.w - 0.01,
          ).toBe(false);
      }
  }
  for (const b of nodes)
    expect(
      [...b.group.children].filter((c) =>
        ["path", "line"].includes(c.localName),
      ),
    ).toHaveLength(0);
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "conserves every conductor without commoned or through-body stubs in %s",
  async (flow) => {
    const f = await seriesFixture(withCable);
    try {
      const spec = request({ flow });
      const selected = selectSignalLoop(f.ir, spec);
      const d = await prepareSignalLoopDrawing(f.ir, spec);
      routeOracle(d.content, selected);
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "retains real core terminals and spares with an assembly and explicit cabinet in %s",
  async (flow) => {
    const f = await seriesFixture((m) => {
      withCable(m);
      m.types[3].symbol = "thermite:bulkhead-connector";
      m.objects.push(wire(21, "PS1", "n", "PLC1", "n"));
    });
    try {
      const spec = request({
        flow,
        notes: ["User assembly note"],
        cableAssemblies: [
          { cable: "CB1", connector: "X1", description: "Field harness" },
        ],
        enclosures: [
          {
            label: "Cabinet",
            devices: ["TB1", "PS1", "AI1"],
            wallDevice: "TB1",
          },
        ],
      });
      const d = await prepareSignalLoopDrawing(f.ir, spec);
      routeOracle(d.content, selectSignalLoop(f.ir, spec));
      expect(d.content).toContain("data-wall-device-uid");
      expect(visible(d.content)).toContain("Pin map: p:1, n:2, spare:3 spare");
      const r = await renderSchematicPacket(
        f.ir,
        packet(spec, {
          page: {
            size: "tabloid",
            orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
          },
        }),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(visible(r.value.sheets[0]!.svg)).toContain(assessed);
        expect(visible(r.value.sheets[0]!.svg)).toContain(
          "Outside selected loop at PS1.n: 1 authored connections: W21 to PLC1.n.",
        );
      }
    } finally {
      await f.dispose();
    }
  },
);

it("refuses notes that cannot fit without hiding or shrinking them", async () => {
  const f = await seriesFixture();
  try {
    const r = await renderSchematicPacket(
      f.ir,
      packet(
        request({
          flow: "top-to-bottom",
          notes: Array.from({ length: 6 }, () => "W".repeat(240)),
        }),
        { page: { size: "letter", orientation: "landscape" } },
      ),
    );
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        message: expect.stringContaining(
          'Packet view[0] "TX1 - signal loop": Series loop notes and diagram cannot fit at readable size.',
        ),
      },
    });
    expect(r).not.toHaveProperty("value");
  } finally {
    await f.dispose();
  }
});

it("prints a counted PE bond and every other outside connection without changing the selected nets", async () => {
  const f = await seriesFixture((m) => {
    m.objects.find((o) => o.designation === "TB1").designation = "PE1";
    m.objects.push(
      wire(22, "PS1", "n", "PLC1", "n"),
      wire(20, "PS1", "n", "PE1", "1"),
      wire(21, "PS1", "p", "PLC1", "p"),
    );
  });
  try {
    const s = selectSignalLoop(f.ir, request());
    expect(
      new Set(s.series!.legs.flatMap((l) => l.edges.map((e) => e.net))).size,
    ).toBe(3);
    expect(s.series!.supplyBranches).toHaveLength(3);
    const r = await renderSchematicPacket(
      f.ir,
      packet(request(), { index: true }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const notes = [
      "Outside selected loop at PS1.p: 1 authored connections: W21 to PLC1.p.",
      "Outside selected loop at PS1.n: 2 authored connections: W20 to PE1.1; W22 to PLC1.n.",
    ];
    for (const note of notes) {
      expect(visible(r.value.sheets[0]!.svg)).toContain(note);
      expect(
        [...parseHTML(r.value.sheets[0]!.svg).document.querySelectorAll("desc")]
          .map((d) => d.textContent)
          .join("\n"),
      ).toContain(note);
      expect(
        r.value.sheets
          .filter(
            (s) =>
              s.view.format === "documentation-view/0.1" &&
              s.view.kind === "references",
          )
          .map((s) => visible(s.svg))
          .join(" "),
      ).toContain(note);
    }
  } finally {
    await f.dispose();
  }
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps engine notes visible at 2.5 mm independently of drawing scale in %s",
  async (flow) => {
    const f = await seriesFixture();
    try {
      const r = await renderSchematicPacket(f.ir, packet(request({ flow })));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const { document } = parseHTML(r.value.sheets[0]!.svg),
        group = document.querySelector("[data-engine-notes]");
      expect(group).not.toBeNull();
      const texts = [...group!.querySelectorAll("text")];
      expect(
        texts
          .map((t) => t.textContent)
          .join(" ")
          .replace(/\s+/g, " "),
      ).toContain(assessed);
      for (const t of texts) {
        expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
        let e: any = t;
        while (e) {
          expect(e.getAttribute?.("display")).not.toBe("none");
          expect(e.getAttribute?.("visibility")).not.toBe("hidden");
          expect(e.getAttribute?.("opacity") ?? "1").not.toBe("0");
          expect(e.getAttribute?.("style") ?? "").not.toMatch(
            /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size/,
          );
          expect(e.getAttribute?.("transform") ?? "").not.toContain("scale");
          e = e.parentElement;
        }
      }
      const lines = texts.map((t) => Number(t.getAttribute("y")));
      expect(Math.max(...lines)).toBeLessThan(r.value.page.heightMm - 40);
    } finally {
      await f.dispose();
    }
  },
);

it("reserves note space before fitting a borderline readable diagram", async () => {
  const f = await seriesFixture();
  try {
    const notes = Array.from(
      { length: 6 },
      (_, i) => `Installation note ${i}: ${"Wide text ".repeat(20).trimEnd()}`,
    );
    const result = await renderSchematicPacket(
      f.ir,
      packet(request({ flow: "top-to-bottom", notes })),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const svg = result.value.sheets[0]!.svg,
      { document } = parseHTML(svg);
    const diagram = [...document.querySelectorAll("g[transform]")].find((g) =>
      g.getAttribute("transform")!.includes("scale("),
    )!;
    const scale = Number(
      diagram.getAttribute("transform")!.match(/scale\(([-.\d]+)\)/)![1],
    );
    expect(scale).toBeGreaterThanOrEqual(2.5 / 2.7);
    expect(scale).toBeLessThan(1);
    expect(visible(svg)).toContain(assessed);
    for (const note of notes) expect(visible(svg)).toContain(note);
    for (const t of document.querySelectorAll("[data-engine-notes] text"))
      expect(t.getAttribute("font-size")).toBe("2.5");
  } finally {
    await f.dispose();
  }
});

it("retains distinct engine notes in references for repeated same-title series views in compact packets", async () => {
  const f = await seriesFixture((m) => {
    for (const [index, fn, kind, roles] of [
      [0, "output2", "source", ["dc_positive_output", "dc_return_output"]],
      [1, "signal2", "other", ["loop_positive", "loop_negative"]],
      [
        2,
        "input2",
        "channel",
        ["analog_input_positive", "analog_input_negative"],
      ],
    ] as const) {
      m.types[index].terminals.q = {
        role: roles[0],
        connection_policy: "shared",
      };
      m.types[index].terminals.r = {
        role: roles[1],
        connection_policy: "shared",
      };
      m.types[index].functions[fn] = {
        kind,
        terminals: ["q", "r"],
        ...(kind === "channel" ? { direction: "input" } : {}),
      };
    }
    m.objects.push(
      wire(30, "PS1", "q", "TX1", "q"),
      wire(31, "TX1", "r", "AI1", "q"),
      wire(32, "AI1", "r", "PS1", "r"),
    );
  });
  try {
    const second = request({
      from: { device: "TX1", function: "signal2" },
      to: { device: "AI1", function: "input2" },
      loopPower: { device: "PS1", function: "output2" },
    });
    const r = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "portrait" },
      layout: "compact",
      index: true,
      views: [request(), second],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const refs = r.value.sheets
      .filter(
        (s) =>
          s.view.format === "documentation-view/0.1" &&
          s.view.kind === "references",
      )
      .map((s) => visible(s.svg))
      .join(" ");
    expect(refs).toContain(assessed);
    expect(refs).toContain(assessed.replace("PS1.output", "PS1.output2"));
  } finally {
    await f.dispose();
  }
});

it("wraps wide reference-note identifiers without clipping or losing the complete text", async () => {
  const f = await seriesFixture((m) => {
    const w = wire(21, "PS1", "n", "PLC1", "n");
    w.designation = "W".repeat(220);
    m.objects.push(w);
  });
  try {
    const r = await renderSchematicPacket(
      f.ir,
      packet(request(), { index: true }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const note = `Outside selected loop at PS1.n: 1 authored connections: ${"W".repeat(220)} to PLC1.n.`;
    const refs = r.value.sheets.filter(
      (s) =>
        s.view.format === "documentation-view/0.1" &&
        s.view.kind === "references",
    );
    expect(refs).toHaveLength(1);
    const { document } = parseHTML(refs[0]!.svg),
      texts = [...document.querySelectorAll("text")];
    expect(texts.map((t) => t.textContent).join("")).toContain(note);
    const { measureText } = await import("../src/text-metrics.js");
    const lines = texts.filter((t) => t.textContent!.includes("WWWWWWWWWW"));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines)
      expect(
        measureText(line.textContent!, Number(line.getAttribute("font-size")))
          .width,
      ).toBeLessThanOrEqual(
        r.value.page.widthMm - 2 * r.value.page.marginMm - 36,
      );
  } finally {
    await f.dispose();
  }
});
