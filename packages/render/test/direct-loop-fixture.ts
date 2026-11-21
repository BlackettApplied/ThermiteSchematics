import type { SignalLoopViewRequest } from "../src/signal-loop.js";
import {
  seriesFixture,
  endpoint,
  uid,
  wire,
  type SeriesModel,
} from "./series-loop-fixture.js";

export const directView = (extra: Partial<SignalLoopViewRequest> = {}) => ({
  format: "signal-loop-view-request/0.1" as const,
  from: { device: "TX1", function: "signal" },
  to: { device: "AI1", function: "input" },
  ...extra,
});
export function directPacket(
  view = directView(),
  extra: Record<string, unknown> = {},
) {
  return {
    format: "schematic-packet-request/0.1" as const,
    page: {
      size: "tabloid" as const,
      orientation:
        view.flow === "top-to-bottom"
          ? ("portrait" as const)
          : ("landscape" as const),
    },
    views: [view],
    ...extra,
  };
}
export function directFixture(edit?: (m: SeriesModel) => void) {
  return seriesFixture((m) => {
    m.objects = m.objects.filter(
      (o) => o.kind === "device" && ["TX1", "AI1"].includes(o.designation),
    );
    m.objects.push(
      wire(10, "TX1", "p", "AI1", "p"),
      wire(11, "TX1", "n", "AI1", "n"),
    );
    edit?.(m);
  });
}
export function roleFree(m: SeriesModel) {
  for (const i of [1, 2])
    for (const pin of ["p", "n"]) delete m.types[i].terminals[pin].role;
}

/** Two independent physical paths through a feed-through; each leg may cross. */
export function withDirectFieldStage(
  m: SeriesModel,
  cable: boolean,
  cableCross = false,
  stripCross = false,
) {
  m.objects = m.objects.filter((o) => o.kind === "device");
  m.objects.push({
    kind: "device",
    uid: uid(4),
    designation: "TB1",
    type: "series:strip",
  });
  if (cable) {
    m.types.push({
      kind: "cable_type",
      id: "series:pair",
      conductors: [
        { id: "A", color: "red" },
        { id: "B", color: "black" },
      ],
    });
    m.objects.push({
      kind: "cable",
      uid: uid(30),
      designation: "CB1",
      type: "series:pair",
      conductors: ["p", "n"].map((pin, i) => ({
        id: i === 0 ? "A" : "B",
        usage: "in-use",
        endpoints: [
          endpoint("TX1", pin),
          endpoint("TB1", String((cableCross ? 1 - i : i) + 1)),
        ],
      })),
    });
  } else {
    m.objects.push(
      wire(10, "TX1", "p", "TB1", "1"),
      wire(11, "TX1", "n", "TB1", "2"),
    );
  }
  m.objects.push(
    wire(12, "TB1", "1", "AI1", stripCross ? "n" : "p"),
    wire(13, "TB1", "2", "AI1", stripCross ? "p" : "n"),
  );
}
export const flows = ["left-to-right", "top-to-bottom"] as const;
