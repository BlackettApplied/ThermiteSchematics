import { expect, it } from "vitest";
import { selectSignalLoop } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  seriesFixture,
  request,
  withFeedThroughs,
  wire,
  uid,
  type SeriesModel,
} from "./series-loop-fixture.js";

it.each([
  [
    "TX",
    (m: SeriesModel) => {
      m.types[1].functions.signal.kind = "source";
    },
    "TX1.p",
    "TX1.signal",
  ],
  [
    "AI",
    (m: SeriesModel) => {
      m.types[2].functions.extra = { kind: "source", terminals: ["p", "n"] };
    },
    "AI1.p",
    "AI1.extra",
  ],
  [
    "strip",
    (m: SeriesModel) => {
      withFeedThroughs(m);
      m.types[3].functions.extra = { kind: "source", terminals: ["1", "2"] };
    },
    "TB1.1",
    "TB1.extra",
  ],
  [
    "TX with DC source roles",
    (m: SeriesModel) => {
      m.types[1].functions.signal.kind = "source";
      m.types[1].terminals.p.role = "dc_positive_output";
      m.types[1].terminals.n.role = "dc_return_output";
    },
    "TX1.p",
    "TX1.signal",
  ],
] as const)(
  "refuses an additional %s source on a leg without inventing a branch",
  async (_, edit, terminal, fn) => {
    const f = await seriesFixture(edit);
    try {
      const message = `Series loop terminal ${terminal} belongs to source function ${fn}; selected loop power is PS1.output.`;
      expect(() => selectSignalLoop(f.ir, request())).toThrow(
        new Error(message),
      );
      expect(
        await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          views: [request()],
        }),
      ).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message: `Packet view[0] "Untitled view": ${message}`,
        },
      });
    } finally {
      await f.dispose();
    }
  },
);

it.each(["other", "absent"] as const)(
  "counts a branch interface with %s functions without inferring a source from roles",
  async (kind) => {
    const f = await seriesFixture((m) => {
      const type = structuredClone(m.types[0]);
      type.id = "series:unassessed";
      type.functions =
        kind === "other"
          ? { output: { kind: "other", terminals: ["p", "n"] } }
          : {};
      m.types.push(type);
      m.objects.push(
        { kind: "device", uid: uid(40), designation: "PS2", type: type.id },
        wire(100, "PS1", "p", "PS2", "p"),
        wire(101, "PS1", "n", "PS2", "n"),
      );
    });
    try {
      const selected = selectSignalLoop(f.ir, request());
      expect(selected.series?.supplyBranches).toHaveLength(2);
      expect(
        selected.series?.supplyBranches.map((b) => b.destination.deviceUid),
      ).toEqual([uid(40), uid(40)]);
      expect(selected.conductors).toHaveLength(3);
    } finally {
      await f.dispose();
    }
  },
);
