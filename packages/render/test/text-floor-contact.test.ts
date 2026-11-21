import { expect, it } from "vitest";
import { breakerAuxiliaryFixture } from "./breaker-auxiliary-fixture.js";
import { emitCircuitContactCaption } from "../src/symbols/circuit-caption.js";
import { reserveCircuitCaptions } from "../src/symbols/circuit-caption-reservation.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { CaptionPlacementError } from "../src/symbols/caption-ink.js";

it("grows a horizontal owner before ELK rather than newly omitting its enlarged caption", async () => {
  const f = await breakerAuxiliaryFixture();
  try {
    const device = f.ir.devices.find((d) => d.designation === "Q1");
    const type = f.ir.deviceTypes.find((t) => t.id === device?.typeId);
    const fn = f.ir.functions.find((fn) => fn.id.functionKey === "no");
    if (!device || !type || !fn) throw Error("Missing synthetic contact");
    const sizes: number[] = [];
    const input = (width: number) => ({
      type,
      fn,
      device,
      mark: "contact-no",
      x: width / 2,
      y: 6,
      width,
      height: 12,
      centers: [
        {
          key: fn.id.functionKey,
          bounds: {
            left: width / 2 - 0.1,
            right: width / 2 + 0.1,
            top: 5.9,
            bottom: 6.1,
          },
        },
      ],
      segments: [],
      occupied: [],
      diagnostics: [],
      text: (_x: number, _y: number, value: string, size: number) => {
        sizes.push(size);
        return value;
      },
    });
    const old = printableTextMetrics("NO", 2.3),
      initial = old.right - old.left + 1.05;
    expect(() => emitCircuitContactCaption(input(initial))).toThrow(
      CaptionPlacementError,
    );
    const node = { width: initial, device, relationLabels: [], pins: [] };
    reserveCircuitCaptions([node], false, (n) =>
      emitCircuitContactCaption(input(n.width)),
    );
    expect(node.width).toBeGreaterThan(initial);
    expect(sizes).toEqual([2.5]);
    expect(emitCircuitContactCaption(input(node.width))).toContain("NO");
  } finally {
    await f.dispose();
  }
});
