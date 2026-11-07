import { expect, it } from "vitest";
import { SYMBOL_PROFILES } from "@thermite/schema";
import {
  selectSignalLoop,
  prepareSignalLoopDrawing,
} from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  seriesFixture,
  seriesRequest,
  request,
  wire,
  uid,
  coreSupply,
  withFeedThroughs,
  withCable,
  type SeriesModel,
} from "./series-loop-fixture.js";

const topology =
  "Series loop requires exactly one unbranched physical leg between each selected function pair on three distinct nets.";
const gate =
  "Series loop drawing is not available in this increment; use an explicit circuit view.";

it("pins the series-power catalog profile and its existing DC source role contract", () => {
  const support = SYMBOL_PROFILES.flatMap((p) =>
    p.support
      .filter((s) => s.family === "signal-loop" && s.role === "series-power")
      .map((s) => ({ profile: p.id, functions: s.functions })),
  );
  expect(support).toEqual([
    {
      profile: "thermite:dc-supply",
      functions: [
        {
          kind: "source",
          minTerminals: 2,
          maxTerminals: 2,
          terminalRoles: ["dc_positive_output", "dc_return_output"],
        },
      ],
    },
  ]);
});

it.each([false, true])(
  "selects three physical nets with authored polarity (high side: %s)",
  async (high) => {
    const f = await seriesFixture(undefined, high);
    try {
      const before = JSON.stringify(f.ir);
      const selected = selectSignalLoop(f.ir, request());
      expect(selected).toMatchObject({
        series: { polarity: { unverifiedEndpoints: [] }, supplyBranches: [] },
      });
      expect(new Set(selected.conductors.map((c) => c.net)).size).toBe(3);
      expect(selected.conductors).toHaveLength(3);
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "refuses drawing honestly in %s",
  async (flow) => {
    const f = await seriesFixture();
    try {
      const spec = request({ flow });
      await expect(prepareSignalLoopDrawing(f.ir, spec)).rejects.toMatchObject({
        message: gate,
      });
      const result = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        views: [spec],
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message: `Packet view[0] "TX1 - signal loop": ${gate}`,
        },
      });
      expect(result).not.toHaveProperty("value");
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  null,
  {},
  { device: "PS1" },
  { device: "PS1", function: "output", surprise: true },
  { device: " ", function: "output" },
])("rejects a malformed explicit selector: %j", async (loopPower) => {
  const f = await seriesFixture();
  try {
    expect(() => selectSignalLoop(f.ir, request({ loopPower }))).toThrow(
      "Invalid signal loop loopPower selector; expected {device, function}.",
    );
  } finally {
    await f.dispose();
  }
});

it.each([
  [
    { device: "missing", function: "output" },
    'Loop power device "missing" does not resolve uniquely.',
  ],
  [
    { device: "PS1", function: "missing" },
    "Loop power PS1.missing must identify a two-terminal source with the thermite:dc-supply profile or a registered alias.",
  ],
  [
    { device: "PLC1", function: "supply" },
    "Loop power PLC1.supply must identify a two-terminal source with the thermite:dc-supply profile or a registered alias.",
  ],
] as const)(
  "rejects ineligible power selection %j",
  async (loopPower, message) => {
    const f = await seriesFixture();
    try {
      expect(() => selectSignalLoop(f.ir, request({ loopPower }))).toThrow(
        message,
      );
    } finally {
      await f.dispose();
    }
  },
);

it("keeps the request closed", async () => {
  const f = await seriesFixture();
  try {
    expect(() => selectSignalLoop(f.ir, request({ invented: true }))).toThrow(
      "Invalid signal loop request;",
    );
  } finally {
    await f.dispose();
  }
});

it("refuses a shared source/input terminal instead of counting a zero-length leg", async () => {
  const f = await seriesFixture((m) => {
    m.types[0].terminals.x = { connection_policy: "shared" };
    m.types[0].functions.input = {
      kind: "channel",
      direction: "input",
      terminals: ["p", "x"],
    };
    delete m.types[1].terminals.p.role;
    delete m.types[1].terminals.n.role;
    m.objects = m.objects.filter((o) => o.kind !== "wire");
    m.objects.push(
      wire(10, "TX1", "p", "PS1", "n"),
      wire(11, "TX1", "n", "PS1", "x"),
    );
  });
  try {
    const spec = request({ to: { device: "PS1", function: "input" } });
    expect(() => selectSignalLoop(f.ir, spec)).toThrow(topology);
    expect(
      await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        views: [spec],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        message: `Packet view[0] "Untitled view": ${topology}`,
      },
    });
  } finally {
    await f.dispose();
  }
});

it.each([
  ["absent profile", (m: SeriesModel) => delete m.types[0].symbol],
  [
    "wrong profile",
    (m: SeriesModel) => (m.types[0].symbol = "thermite:io-module"),
  ],
  [
    "wrong function kind",
    (m: SeriesModel) => (m.types[0].functions.output.kind = "other"),
  ],
  [
    "wrong terminal count",
    (m: SeriesModel) => m.types[0].functions.output.terminals.pop(),
  ],
] as const)("refuses a source with %s", async (_, edit) => {
  const f = await seriesFixture(edit);
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Loop power PS1.output must identify a two-terminal source with the thermite:dc-supply profile or a registered alias.",
    );
  } finally {
    await f.dispose();
  }
});

it("refuses an ambiguous UID/designation selector", async () => {
  const f = await seriesFixture((m) => (m.objects[4].designation = uid(1)));
  try {
    expect(() =>
      selectSignalLoop(
        f.ir,
        request({ loopPower: { device: uid(1), function: "output" } }),
      ),
    ).toThrow(`Loop power device "${uid(1)}" does not resolve uniquely.`);
  } finally {
    await f.dispose();
  }
});

it("refuses loop power on an output view", async () => {
  const f = await seriesFixture((m) => {
    m.types[1].symbol = "thermite:io-module";
    m.types[1].functions.signal = {
      kind: "channel",
      direction: "output",
      terminals: ["p", "n"],
    };
    m.types[2].symbol = "thermite:analog-actuator";
    m.types[2].functions.input = { kind: "other", terminals: ["p", "n"] };
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop power is supported only for input views without auxiliary pairs.",
    );
  } finally {
    await f.dispose();
  }
});

it("preserves selected net and conductor identities after object and endpoint reordering", async () => {
  const a = await seriesFixture();
  const b = await seriesFixture((m) => {
    m.objects.reverse();
    for (const o of m.objects) o.endpoints?.reverse();
  });
  const facts = (ir: typeof a.ir) =>
    selectSignalLoop(ir, request()).conductors.map((c) => [
      c.id,
      c.net,
      c.ends,
    ]);
  try {
    expect(facts(a.ir)).toEqual(facts(b.ir));
  } finally {
    await a.dispose();
    await b.dispose();
  }
});

it("uses roles even when names suggest the opposite polarity", async () => {
  const f = await seriesFixture((m) => {
    for (const t of m.types.slice(0, 3)) {
      t.terminals = {
        ...t.terminals,
        minus: t.terminals.p,
        plus: t.terminals.n,
      };
      delete t.terminals.p;
      delete t.terminals.n;
      for (const fn of Object.values(t.functions) as any[])
        fn.terminals = fn.terminals.map((k: string) =>
          k === "p" ? "minus" : "plus",
        );
    }
    for (const o of m.objects)
      for (const e of o.endpoints ?? [])
        e.terminal = e.terminal === "p" ? "minus" : "plus";
  });
  try {
    expect(
      selectSignalLoop(f.ir, request()).series?.polarity.unverifiedEndpoints,
    ).toEqual([]);
  } finally {
    await f.dispose();
  }
});

it("refuses auxiliary pairs before tracing", async () => {
  const f = await seriesFixture();
  try {
    expect(() =>
      selectSignalLoop(
        f.ir,
        request({
          auxiliary: [{ from: seriesRequest.from, to: seriesRequest.to }],
        }),
      ),
    ).toThrow(
      "Series loop power is supported only for input views without auxiliary pairs.",
    );
  } finally {
    await f.dispose();
  }
});

it.each([
  ["missing leg", (m: any) => m.objects.pop()],
  [
    "reconnection",
    (m: any) => m.objects.push(wire(20, "TX1", "p", "AI1", "p")),
  ],
  [
    "alternative route",
    (m: any) => m.objects.push(wire(20, "PS1", "p", "TX1", "p")),
  ],
  [
    "second source in a leg",
    (m: any) => {
      m.objects.push({
        kind: "device",
        uid: uid(9),
        designation: "PS2",
        type: "series:ps",
      });
      m.objects[5].endpoints[1] = { device: "PS2", terminal: "p" };
      m.objects.push(wire(20, "PS2", "n", "TX1", "p"));
    },
  ],
] as const)("refuses %s", async (_, edit) => {
  const f = await seriesFixture(edit);
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(topology);
  } finally {
    await f.dispose();
  }
});

it("counts PLC supply and authored return-to-PE branches", async () => {
  const f = await seriesFixture((m) => {
    m.types[3].terminals["1"].role = "protective_earth";
    m.objects.push(
      wire(20, "PS1", "p", "PLC1", "p"),
      wire(21, "PS1", "n", "PLC1", "n"),
      { ...wire(22, "PS1", "n", "TB1", "1"), kind: "jumper" },
    );
  });
  try {
    const selected = selectSignalLoop(f.ir, request());
    expect(selected).toMatchObject({
      series: {
        supplyBranches: [
          {
            conductor: { id: uid(20) },
            destination: { deviceUid: uid(5), terminalKey: "p" },
          },
          {
            conductor: { id: uid(21) },
            destination: { deviceUid: uid(5), terminalKey: "n" },
          },
          {
            conductor: { id: uid(22) },
            destination: { deviceUid: uid(4), terminalKey: "1" },
          },
        ],
      },
    });
    expect(selected.conductors).toHaveLength(3);
    expect(
      selected.series?.supplyBranches.filter(
        (b) => b.terminal.terminalKey === "p",
      ),
    ).toHaveLength(1);
    expect(
      selected.series?.supplyBranches.filter(
        (b) => b.terminal.terminalKey === "n",
      ),
    ).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

it.each(["0.1.0", "0.2.0"] as const)(
  "accepts a renamed %s PSU clone using its registered profile",
  async (version) => {
    const f = await seriesFixture((m) => coreSupply(m, version));
    try {
      const selected = selectSignalLoop(
        f.ir,
        request({ loopPower: { device: uid(1), function: "dc_output" } }),
      );
      expect(selected.series?.power.type.id).toBe("series:ps");
      expect(selected.series?.power.type.symbol).toBe(
        version === "0.1.0" ? "iec:dc-power-supply" : "thermite:dc-supply",
      );
      expect(selected.conductors).toHaveLength(3);
    } finally {
      await f.dispose();
    }
  },
);

it("accepts matching field stages and a separate feed-through on the third leg", async () => {
  const f = await seriesFixture((m) => {
    withFeedThroughs(m);
    m.objects = m.objects.filter((o) => o.uid !== uid(12));
    m.objects.push(
      wire(12, "AI1", "n", "TB1", "4"),
      wire(15, "TB1", "4", "PS1", "n"),
    );
  });
  try {
    expect(selectSignalLoop(f.ir, request()).conductors).toHaveLength(6);
  } finally {
    await f.dispose();
  }
});

it.each([
  [
    "unequal field stages",
    (m: SeriesModel) => {
      m.objects.find((o) => o.uid === uid(10)).endpoints[1] = {
        device: "TB1",
        terminal: "1",
      };
      m.objects.push(wire(20, "TB1", "1", "TX1", "p"));
    },
    "Series loop field legs must follow the same ordered feed-through stages.",
  ],
  [
    "unsupported field stage",
    (m: SeriesModel) => {
      withFeedThroughs(m);
      m.types[3].symbol = "thermite:dc-supply";
    },
    "Series loop field legs must follow the same ordered feed-through stages.",
  ],
  [
    "unsupported third stage",
    (m: SeriesModel) => {
      m.objects.find((o) => o.uid === uid(12)).endpoints[1] = {
        device: "PLC1",
        terminal: "n",
      };
      m.objects.push(wire(20, "PLC1", "n", "PS1", "n"));
    },
    "Series loop third leg must be an unbranched supported feed-through chain.",
  ],
  [
    "intermediate branch",
    (m: SeriesModel) => {
      withFeedThroughs(m);
      m.objects.push(wire(20, "TB1", "1", "PLC1", "p"));
    },
    "Series loop has an additional connection at TB1.1; use a circuit view that includes the branch.",
  ],
  [
    "second parallel source",
    (m: SeriesModel) => {
      m.objects.push(
        { kind: "device", uid: uid(9), designation: "PS2", type: "series:ps" },
        wire(20, "PS1", "p", "PS2", "p"),
        wire(21, "PS1", "n", "PS2", "n"),
      );
    },
    "Series loop has an additional connection at PS1.p; use a circuit view that includes the branch.",
  ],
] as const)("refuses %s", async (_, edit, message) => {
  const f = await seriesFixture(edit);
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(message);
  } finally {
    await f.dispose();
  }
});

it("refuses more than eight displayed devices", async () => {
  const f = await seriesFixture((m) => {
    m.objects = m.objects.filter((o) => ![uid(10), uid(11)].includes(o.uid));
    for (let i = 1; i <= 6; i++)
      m.objects.push({
        kind: "device",
        uid: uid(40 + i),
        designation: `T${i}`,
        type: "series:strip",
      });
    for (const [offset, pin, target, terminal] of [
      [50, "1", "PS1", "p"],
      [60, "2", "AI1", "p"],
    ] as const) {
      m.objects.push(wire(offset, "TX1", pin === "1" ? "p" : "n", "T1", pin));
      for (let i = 1; i < 6; i++)
        m.objects.push(wire(offset + i, `T${i}`, pin, `T${i + 1}`, pin));
      m.objects.push(wire(offset + 6, "T6", pin, target, terminal));
    }
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop exceeds eight displayed devices.",
    );
  } finally {
    await f.dispose();
  }
});

it("keeps the complete cable inventory, including a two-ended spare", async () => {
  const f = await seriesFixture(withCable);
  try {
    const result = selectSignalLoop(f.ir, request());
    expect(result.conductors).toHaveLength(6);
    expect(result.conductors.filter((c) => c.spare)).toHaveLength(1);
    expect(result.series?.legs).toHaveLength(3);
  } finally {
    await f.dispose();
  }
});

it.each([
  [
    "unassigned",
    (c: any) => c.conductors.pop(),
    "Cable CB1 has unassigned or loose cores;",
  ],
  [
    "loose",
    (c: any) => (c.conductors[2].endpoints[1] = null),
    "Cable CB1 has unassigned or loose cores;",
  ],
  [
    "active extra",
    (c: any) => (c.conductors[2].usage = "in-use"),
    "A cable has an additional active core outside this two-wire loop;",
  ],
  [
    "active spare",
    (c: any) => (c.conductors[0].usage = "spare"),
    "An active signal path uses a core explicitly marked spare.",
  ],
  [
    "off-loop",
    (c: any) =>
      (c.conductors[2].endpoints[1] = { device: "PLC1", terminal: "p" }),
    "A cable leaves the selected device chain;",
  ],
] as const)("refuses a cable with %s cores", async (_, edit, message) => {
  const f = await seriesFixture((m) => {
    withCable(m);
    edit(m.objects.find((o) => o.kind === "cable"));
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(message);
  } finally {
    await f.dispose();
  }
});

it("refuses an onward branch hidden behind a spare core", async () => {
  const f = await seriesFixture((m) => {
    withCable(m);
    m.objects.push(wire(22, "TB1", "3", "PLC1", "p"));
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop has an additional connection at TB1.3; use a circuit view that includes the branch.",
    );
  } finally {
    await f.dispose();
  }
});

it("names a forbidden endpoint branch", async () => {
  const f = await seriesFixture((m) =>
    m.objects.push(wire(20, "TX1", "n", "TB1", "1")),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop has an additional connection at TX1.n; use a circuit view that includes the branch.",
    );
  } finally {
    await f.dispose();
  }
});
