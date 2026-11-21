import { expect, it } from "vitest";
import {
  prepareSignalLoopDrawing,
  selectSignalLoop,
} from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { parseHTML } from "linkedom";
import {
  directFixture,
  directPacket,
  directView,
  flows,
} from "./direct-loop-fixture.js";

const unknownInputs = [
  [undefined, undefined],
  ["analog_input_positive", undefined],
  ["analog_input_positive", "analog_input_positive"],
  ["analog_input_negative", "analog_input_negative"],
  ["analog_input_0_positive", "analog_input_1_negative"],
  ["analog_input_2_positive", "analog_input_2_negative"],
  ["analog_input_00_positive", "analog_input_00_negative"],
  ["Analog_input_positive", "analog_input_negative"],
  ["analog_input_positive_extra", "analog_input_negative_extra"],
  ["signal", "signal"],
  ["loop_positive", "loop_negative"],
] as const;
const unknownTransmitters = [
  [undefined, undefined],
  ["loop_positive", undefined],
  ["loop_positive", "loop_positive"],
  ["loop_negative", "loop_negative"],
  ["Loop_positive", "loop_negative"],
  ["loop_positive_extra", "loop_negative_extra"],
  ["signal", "signal"],
  ["analog_input_positive", "analog_input_negative"],
] as const;

it.each([
  ...unknownInputs.map((roles) => ({
    index: 2,
    name: "AI1 terminals p–n",
    roles,
  })),
  ...unknownTransmitters.map((roles) => ({
    index: 1,
    name: "TX1 terminals p–n",
    roles,
  })),
])(
  "leaves $name unverified for exact non-vocabulary roles $roles",
  async ({ index, name, roles }) => {
    const f = await directFixture((m) => {
      [m.types[index].terminals.p.role, m.types[index].terminals.n.role] =
        roles;
      // A readable name/description and the other endpoint cannot supply missing roles.
      m.types[index].terminals.p.description = "positive +";
      m.types[index].terminals.n.description = "negative -";
      for (const o of m.objects)
        for (const e of o.endpoints ?? [])
          if (e.device === "TX1") e.terminal = e.terminal === "p" ? "n" : "p";
    });
    try {
      for (const flow of flows) {
        const view = directView({ flow });
        expect(selectSignalLoop(f.ir, view).unverifiedEndpoints).toEqual([
          name,
        ]);
        const d = await prepareSignalLoopDrawing(f.ir, view);
        expect(d.engineNotes).toEqual([`polarity not verified: ${name}.`]);
        expect(d.note).toContain(`polarity not verified: ${name}.`);
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  ["analog_input_positive", "analog_input_negative"],
  ["analog_input_0_positive", "analog_input_0_negative"],
  ["analog_input_1_positive", "analog_input_1_negative"],
] as const)("uses the shared exact AI pair %s / %s", async (p, n) => {
  const f = await directFixture((m) => {
    m.types[2].terminals.p.role = p;
    m.types[2].terminals.n.role = n;
    m.types[1].functions.signal.terminals.reverse();
    m.types[2].functions.input.terminals.reverse();
  });
  try {
    for (const flow of flows) {
      const d = await prepareSignalLoopDrawing(f.ir, directView({ flow }));
      expect(d).not.toHaveProperty("engineNotes");
      expect(d.content).not.toContain("polarity not verified");
    }
  } finally {
    await f.dispose();
  }
});

it.each([1, 2])(
  "refuses either endpoint's authored role reversal: type %s",
  async (index) => {
    const f = await directFixture((m) => {
      const t = m.types[index];
      [t.terminals.p.role, t.terminals.n.role] = [
        t.terminals.n.role,
        t.terminals.p.role,
      ];
    });
    try {
      const leg =
        index === 1
          ? "TX1.n (loop_positive) reaches AI1.n (analog_input_0_negative)"
          : "TX1.p (loop_positive) reaches AI1.p (analog_input_0_negative)";
      for (const flow of flows) {
        const r = await renderSchematicPacket(
          f.ir,
          directPacket(directView({ flow })),
        );
        expect(r).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            message: `Packet view[0] "TX1 - signal loop": Signal loop polarity: ${leg}; correct the wiring or the authored roles.`,
          },
        });
        expect(r).not.toHaveProperty("value");
      }
    } finally {
      await f.dispose();
    }
  },
);

it("keeps roles authoritative after terminal, device and function renames and reorders", async () => {
  const f = await directFixture((m) => {
    for (const [i, fn] of [
      [1, "signal"],
      [2, "input"],
    ] as const) {
      const t = m.types[i];
      // Deliberately misleading names. The role strings alone give polarity.
      t.terminals["-"] = t.terminals.p;
      t.terminals["+"] = t.terminals.n;
      delete t.terminals.p;
      delete t.terminals.n;
      t.functions.renamed = t.functions[fn];
      t.functions.renamed.terminals = ["+", "-"];
      delete t.functions[fn];
    }
    for (const o of m.objects) {
      if (o.designation === "TX1") o.designation = "Z_TX";
      if (o.designation === "AI1") o.designation = "A_AI";
      for (const e of o.endpoints ?? []) {
        e.device = e.device === "TX1" ? "Z_TX" : "A_AI";
        e.terminal = e.terminal === "p" ? "-" : "+";
      }
    }
    m.objects.reverse();
  });
  try {
    const view = directView({
      from: { device: "Z_TX", function: "renamed" },
      to: { device: "A_AI", function: "renamed" },
    });
    expect(selectSignalLoop(f.ir, view).unverifiedEndpoints).toEqual([]);
    for (const flow of flows) {
      const d = await prepareSignalLoopDrawing(f.ir, { ...view, flow });
      expect(d).not.toHaveProperty("engineNotes");
    }
    const unknown = structuredClone(f.ir);
    for (const t of unknown.terminals) delete t.role;
    const d = await prepareSignalLoopDrawing(unknown, view);
    expect(d.engineNotes).toEqual([
      "polarity not verified: A_AI terminals + / -, Z_TX terminals + / -.",
    ]);
    const { document } = parseHTML(d.content);
    expect(document.querySelector("desc")!.textContent).toBe(d.engineNotes![0]);
  } finally {
    await f.dispose();
  }
});

it("preserves the selector refusal for single-terminal analog_input functions", async () => {
  const f = await directFixture((m) => {
    m.types[2].terminals.p.role = "analog_input";
    m.types[2].terminals.n.role = "analog_common";
    m.types[2].functions.input.terminals = ["p"];
  });
  try {
    expect(() => selectSignalLoop(f.ir, directView())).toThrow(
      "AI1.input must identify a two-terminal function.",
    );
  } finally {
    await f.dispose();
  }
});
