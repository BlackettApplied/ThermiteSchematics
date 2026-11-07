import { expect, it } from "vitest";
import { selectSignalLoop } from "../src/signal-loop.js";
import { seriesFixture, request } from "./series-loop-fixture.js";
import {
  readLoopPolarity,
  assertLoopPolarityEntry,
} from "../src/signal-loop/polarity.js";

it.each(["Series loop polarity", "Signal loop polarity"])(
  "uses the caller's polarity prefix: %s",
  async (prefix) => {
    const f = await seriesFixture();
    try {
      const source = f.ir.functions.find(
        (fn) => fn.id.functionKey === "output",
      );
      const tx = f.ir.functions.find((fn) => fn.id.functionKey === "signal");
      const departure = source?.terminals[0],
        arrival = tx?.terminals[1];
      if (!tx || !departure || !arrival)
        throw Error("Missing fixture terminals");
      expect(() =>
        assertLoopPolarityEntry(
          f.ir,
          departure,
          arrival,
          readLoopPolarity(f.ir, tx.terminals, "transmitter"),
          prefix,
        ),
      ).toThrow(
        new Error(
          `${prefix}: PS1.p (dc_positive_output) reaches TX1.n (loop_negative); correct the wiring or the authored roles.`,
        ),
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  [
    "TX1",
    1,
    "loop_negative",
    "PS1.p (dc_positive_output) reaches TX1.p (loop_negative)",
  ],
  [
    "AI1",
    2,
    "analog_input_0_negative",
    "TX1.n (loop_negative) reaches AI1.p (analog_input_0_negative)",
  ],
] as const)(
  "refuses reversed %s with both leg terminals and roles",
  async (_, index, role, leg) => {
    const f = await seriesFixture((m) => {
      const t = m.types[index];
      [t.terminals.p.role, t.terminals.n.role] = [role, t.terminals.p.role];
    });
    try {
      expect(() => selectSignalLoop(f.ir, request())).toThrow(
        `Series loop polarity: ${leg}; correct the wiring or the authored roles.`,
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  ["dc_return_output", "dc_positive_output"],
  [undefined, undefined],
  ["dc_positive_output", "dc_positive_output"],
] as const)(
  "refuses invalid source roles %s / %s in authored order",
  async (a, b) => {
    const f = await seriesFixture((m) => {
      m.types[0].terminals.p.role = a;
      m.types[0].terminals.n.role = b;
    });
    try {
      expect(() => selectSignalLoop(f.ir, request())).toThrow(
        `Series loop power PS1.output: expected dc_positive_output then dc_return_output in authored function order; found PS1.p (${a ?? "<unspecified>"}) and PS1.n (${b ?? "<unspecified>"}).`,
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  ["analog_input_positive", "analog_input_negative"],
  ["analog_input_0_positive", "analog_input_0_negative"],
  ["analog_input_1_positive", "analog_input_1_negative"],
] as const)(
  "recognises only the exact AI pair %s / %s regardless of function order",
  async (a, b) => {
    const f = await seriesFixture((m) => {
      m.types[2].terminals.p.role = a;
      m.types[2].terminals.n.role = b;
      m.types[2].functions.input.terminals.reverse();
      m.types[1].functions.signal.terminals.reverse();
    });
    try {
      expect(selectSignalLoop(f.ir, request())).toMatchObject({
        series: { polarity: { unverifiedEndpoints: [] } },
      });
      const ai = f.ir.devices.find((d) => d.designation === "AI1")!;
      const terminals = f.ir.terminals.filter((t) => t.id.deviceUid === ai.uid);
      const p = terminals.find((t) => t.id.terminalKey === "p")!,
        n = terminals.find((t) => t.id.terminalKey === "n")!;
      [p.role, n.role] = [n.role, p.role];
      expect(() => selectSignalLoop(f.ir, request())).toThrow(
        `Series loop polarity: TX1.n (loop_negative) reaches AI1.p (${b}); correct the wiring or the authored roles.`,
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  [undefined, undefined],
  ["signal", "signal"],
  ["analog_input_0_positive", "analog_input_1_negative"],
  ["analog_input_2_positive", "analog_input_2_negative"],
  ["analog_input_00_positive", "analog_input_00_negative"],
  ["analog_input_positive", undefined],
  ["analog_input_positive", "analog_input_positive"],
  ["Analog_input_positive", "analog_input_negative"],
  ["analog_input_positive_extra", "analog_input_negative_extra"],
  ["loop_positive", "loop_negative"],
] as const)(
  "leaves non-vocabulary AI roles unverified: %s / %s",
  async (a, b) => {
    const f = await seriesFixture((m) => {
      m.types[2].terminals.p.role = a;
      m.types[2].terminals.n.role = b;
    });
    try {
      expect(selectSignalLoop(f.ir, request())).toMatchObject({
        series: { polarity: { unverifiedEndpoints: ["AI1.input"] } },
      });
    } finally {
      await f.dispose();
    }
  },
);

it("reports role-free endpoints once each in stable order, without name inference", async () => {
  const f = await seriesFixture((m) => {
    for (const index of [1, 2])
      for (const key of ["p", "n"]) delete m.types[index].terminals[key].role;
  });
  try {
    expect(selectSignalLoop(f.ir, request())).toMatchObject({
      series: {
        polarity: { unverifiedEndpoints: ["AI1.input", "TX1.signal"] },
      },
    });
  } finally {
    await f.dispose();
  }
});

it("requires source roles in authored function order", async () => {
  const f = await seriesFixture((m) =>
    m.types[0].functions.output.terminals.reverse(),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop power PS1.output: expected dc_positive_output then dc_return_output in authored function order; found PS1.n (dc_return_output) and PS1.p (dc_positive_output).",
    );
  } finally {
    await f.dispose();
  }
});

it.each([false, true])(
  "refuses physical polarity reversal with high-side input: %s",
  async (high) => {
    const f = await seriesFixture((m) => {
      for (const o of m.objects)
        for (const end of o.endpoints ?? [])
          if (end.device === "TX1")
            end.terminal = end.terminal === "p" ? "n" : "p";
    }, high);
    try {
      expect(() => selectSignalLoop(f.ir, request())).toThrow(
        high
          ? "Series loop polarity: AI1.n (analog_input_0_negative) reaches TX1.n (loop_negative); correct the wiring or the authored roles."
          : "Series loop polarity: PS1.p (dc_positive_output) reaches TX1.n (loop_negative); correct the wiring or the authored roles.",
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each([
  ["signal", "signal"],
  ["loop_positive", undefined],
  ["loop_positive", "loop_positive"],
  ["Loop_positive", "loop_negative"],
  ["analog_input_positive", "analog_input_negative"],
] as const)(
  "leaves non-vocabulary transmitter roles unverified: %s / %s",
  async (a, b) => {
    const f = await seriesFixture((m) => {
      m.types[1].terminals.p.role = a;
      m.types[1].terminals.n.role = b;
    });
    try {
      expect(
        selectSignalLoop(f.ir, request()).series?.polarity.unverifiedEndpoints,
      ).toEqual(["TX1.signal"]);
    } finally {
      await f.dispose();
    }
  },
);
