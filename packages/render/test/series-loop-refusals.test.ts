import { expect, it } from "vitest";
import { selectSignalLoop } from "../src/signal-loop.js";
import {
  seriesFixture,
  request,
  wire,
  uid,
  endpoint,
  withFieldChains,
} from "./series-loop-fixture.js";

it("refuses different ordered field stages even when both legs visit the same devices", async () => {
  const f = await seriesFixture((m) =>
    withFieldChains(m, ["TB1", "TB2"], ["TB2", "TB1"]),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop field legs must follow the same ordered feed-through stages.",
    );
  } finally {
    await f.dispose();
  }
});

it("refuses a repeated field stage even when both chains match in order", async () => {
  const f = await seriesFixture((m) =>
    withFieldChains(m, ["TB1", "TB2", "TB1"]),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop field legs must follow the same ordered feed-through stages.",
    );
  } finally {
    await f.dispose();
  }
});

it("refuses a repeated third-leg stage on different contacts of the same strip", async () => {
  const f = await seriesFixture((m) => {
    m.objects = m.objects.filter((o) => o.uid !== uid(12));
    m.objects.push(
      {
        kind: "device",
        uid: uid(40),
        designation: "TB2",
        type: "series:strip",
      },
      wire(100, "AI1", "n", "TB1", "5"),
      wire(101, "TB1", "5", "TB2", "5"),
      wire(102, "TB2", "5", "TB1", "6"),
      wire(103, "TB1", "6", "PS1", "n"),
    );
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop third leg must be an unbranched supported feed-through chain.",
    );
  } finally {
    await f.dispose();
  }
});

it("accepts exactly eight displayed devices", async () => {
  const f = await seriesFixture((m) =>
    withFieldChains(m, ["TB1", "TB2", "TB3", "TB4", "TB5"]),
  );
  try {
    expect(selectSignalLoop(f.ir, request()).series?.stages).toHaveLength(8);
  } finally {
    await f.dispose();
  }
});

it("refuses a cable core used as a supply-terminal branch", async () => {
  const f = await seriesFixture((m) => {
    m.types.push({
      kind: "cable_type",
      id: "series:branch",
      conductors: [{ id: "A", color: "red" }],
    });
    m.objects.push({
      kind: "cable",
      uid: uid(80),
      designation: "CB2",
      type: "series:branch",
      conductors: [
        {
          id: "A",
          usage: "in-use",
          endpoints: [endpoint("PS1", "p"), endpoint("PLC1", "p")],
        },
      ],
    });
  });
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop has an additional connection at PS1.p; use a circuit view that includes the branch.",
    );
  } finally {
    await f.dispose();
  }
});

it("walks beyond a feed-through to detect a source in a supply branch", async () => {
  const f = await seriesFixture((m) =>
    m.objects.push(
      { kind: "device", uid: uid(40), designation: "PS2", type: "series:ps" },
      wire(100, "PS1", "p", "TB1", "1"),
      wire(101, "TB1", "1", "PS2", "p"),
    ),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop has an additional connection at PS1.p; use a circuit view that includes the branch.",
    );
  } finally {
    await f.dispose();
  }
});

it("uses the series-only refusal for endpoints that are neither a valid input nor output view", async () => {
  const f = await seriesFixture(
    (m) => (m.types[2].functions.input.direction = "output"),
  );
  try {
    expect(() => selectSignalLoop(f.ir, request())).toThrow(
      "Series loop power is supported only for input views without auxiliary pairs.",
    );
    const direct = { ...request() };
    delete direct.loopPower;
    expect(() => selectSignalLoop(f.ir, direct)).toThrow(
      "Signal loop views require a two-wire transmitter to an input channel, or an output channel to an analog-actuator profile.",
    );
  } finally {
    await f.dispose();
  }
});
