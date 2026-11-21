import { expect, it } from "vitest";
import { selectSignalLoop } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { seriesFixture, request, uid } from "./series-loop-fixture.js";

const cases = [
  {
    name: "auxiliary pair and supply as transmitter",
    extra: {
      from: { device: "PS1", function: "output" },
      auxiliary: [{ from: request().from, to: request().to }],
    },
    message:
      "Series loop power source PS1 cannot also be the transmitter; use an explicit circuit view.",
  },
  {
    name: "non-transmitter from function",
    extra: { from: { device: "PLC1", function: "supply" } },
    message:
      "Series loop from PLC1.supply is not a supported two-wire transmitter; use an explicit circuit view.",
  },
  {
    name: "non-input to function",
    extra: { to: { device: "PLC1", function: "supply" } },
    message:
      "Series loop to PLC1.supply is not an input channel; use an explicit circuit view.",
  },
  {
    name: "supply selected as input",
    extra: { to: { device: "PS1", function: "output" } },
    message:
      "Series loop power source PS1 cannot also be the input channel; use an explicit circuit view.",
  },
  {
    name: "supply selected as transmitter by designation",
    extra: { from: { device: "PS1", function: "output" } },
    message:
      "Series loop power source PS1 cannot also be the transmitter; use an explicit circuit view.",
  },
  {
    name: "supply selected as transmitter by UID",
    extra: { from: { device: uid(1), function: "output" } },
    message:
      "Series loop power source PS1 cannot also be the transmitter; use an explicit circuit view.",
  },
  {
    name: "genuine auxiliary pair",
    extra: { auxiliary: [{ from: request().from, to: request().to }] },
    message:
      "Series loop power is supported only for input views without auxiliary pairs.",
  },
];
for (const c of cases)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `explains ${c.name} in %s`,
    async (flow) => {
      const f = await seriesFixture();
      try {
        const view = request({ ...c.extra, flow });
        expect(() => selectSignalLoop(f.ir, view)).toThrow(c.message);
        const result = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          views: [view],
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            reason: "unprintable-layout",
            message: `Packet view[0] "Untitled view": ${c.message}`,
          },
        });
        expect(result).not.toHaveProperty("value");
      } finally {
        await f.dispose();
      }
    },
  );

it.each(["left-to-right", "top-to-bottom"] as const)(
  "pins the separate-device refusal for a transmitter and input on one device in %s",
  async (flow) => {
    const f = await seriesFixture((m) => {
      m.types[1].terminals.i = {
        role: "analog_input_positive",
        connection_policy: "shared",
      };
      m.types[1].terminals.r = {
        role: "analog_input_negative",
        connection_policy: "shared",
      };
      m.types[1].functions.input = {
        kind: "channel",
        direction: "input",
        terminals: ["i", "r"],
      };
      for (const object of m.objects)
        for (const end of object.endpoints ?? [])
          if (end.device === "AI1") {
            end.device = "TX1";
            end.terminal = end.terminal === "p" ? "i" : "r";
          }
    });
    try {
      const message =
        "Series loop requires the transmitter, input and loop power on three separate devices; use an explicit circuit view for combined devices.";
      const view = request({ flow, to: { device: "TX1", function: "input" } });
      expect(() => selectSignalLoop(f.ir, view)).toThrow(message);
      const result = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        views: [view],
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message: `Packet view[0] "Untitled view": ${message}`,
        },
      });
      expect(result).not.toHaveProperty("value");
    } finally {
      await f.dispose();
    }
  },
);
