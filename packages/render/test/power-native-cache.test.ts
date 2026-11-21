import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/index.js";
import { circuitInlineTrace } from "../src/layout/circuit-inline-context.js";
import { elkPacketWorkTrace } from "../src/layout/elk-work.js";

const powerRoots = ["M1", "M2"] as const;
function machineViews() {
  return [
    ...powerRoots.map((value) => ({
      format: "schematic-view-request/0.1" as const,
      family: "power" as const,
      flow: "left-to-right" as const,
      root: { by: "designation" as const, value },
    })),
    ...["K1", "K2"].map((value) => ({
      format: "schematic-view-request/0.1" as const,
      family: "control" as const,
      flow: "left-to-right" as const,
      root: { by: "designation" as const, value },
    })),
    ...(
      [
        ["LS1", "PLC1"],
        ["LS2", "RIO1"],
      ] as const
    ).map(([value, to]) => ({
      format: "schematic-view-request/0.2" as const,
      flow: "left-to-right" as const,
      root: { by: "designation" as const, value },
      intent: {
        kind: "trace" as const,
        includePower: true,
        to: { by: "designation" as const, value: to },
      },
    })),
    {
      format: "schematic-view-request/0.2" as const,
      flow: "left-to-right" as const,
      root: { by: "designation" as const, value: "CBL1" },
      intent: { kind: "conductors" as const },
    },
    ...(["terminals", "io", "bom", "cables", "wires"] as const).map((kind) => ({
      format: "documentation-view-request/0.1" as const,
      kind,
    })),
  ];
}

it.each(["standard", "compact"] as const)(
  "reuses unchanged native ELK inputs when rejected power shifts view offsets (%s)",
  async (layout) => {
    const c = await compileProject(
      fileURLToPath(new URL("../../../examples/machine-demo", import.meta.url)),
    );
    if (!c.ok) throw Error("Fixture failed");
    const views = machineViews();
    const packet = { calls: 0, cacheHits: 0, outsideSearchCalls: 0 };
    let originalCalls = -1;
    const trace: NonNullable<Parameters<typeof circuitInlineTrace.run>[0]> = [];
    trace.push = function (context) {
      let phase = context.qualityPhase;
      Object.defineProperty(context, "qualityPhase", {
        get: () => phase,
        set: (value) => {
          if (value && !phase) originalCalls = packet.calls;
          phase = value;
        },
      });
      return Array.prototype.push.call(this, context);
    };
    const result = await elkPacketWorkTrace.run(packet, () =>
      circuitInlineTrace.run(trace, () =>
        renderSchematicPacket(
          c.ir,
          {
            format: "schematic-packet-request/0.1",
            layout,
            index: true,
            page: { size: "a3", orientation: "portrait" },
            views,
          },
          c.presentation,
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(originalCalls).toBeGreaterThan(0);
    // Two power views permit at most two new configurations; offset changes
    // need fresh drafts, but their unchanged native ELK inputs must hit the cache.
    expect(packet.calls - originalCalls).toBeLessThanOrEqual(powerRoots.length);
    expect(trace[0]!.viewDecisions.find((d) => d.view === 1)?.reason).toBe(
      "accepted",
    );
  },
  120000,
);

it("reuses exact inputs while retrieving the native legacy result after a logical cap", async () => {
  const c = await compileProject(
    fileURLToPath(new URL("../../../examples/motor-starter", import.meta.url)),
  );
  if (!c.ok) throw Error("Fixture failed");
  const { searchRootedCandidates } =
    await import("../src/packet/rooted-search.js");
  const { normalizePaperPage } = await import("../src/packet/page.js");
  const { circuitInlineContext, circuitLayoutContext } =
    await import("../src/layout/circuit-inline-context.js");
  const p = normalizePaperPage({ size: "letter", orientation: "portrait" });
  if (!p.ok) throw Error("Page failed");
  const context = circuitLayoutContext(),
    packet = { calls: 0, cacheHits: 0, outsideSearchCalls: 0 };
  await elkPacketWorkTrace.run(packet, () =>
    circuitInlineContext.run(context, async () => {
      const run = await searchRootedCandidates(
        c.ir,
        {
          format: "schematic-view-request/0.1",
          family: "power",
          flow: "left-to-right",
          root: { by: "designation", value: "M1" },
        },
        c.presentation,
        p.value,
        true,
      );
      expect(run.elkWork?.exhausted).toBe(true);
      expect(run.elkWork?.calls).toBe(48);
      // Every successful ELK output is stored: an exact repeat cannot dispatch again.
      expect(packet.calls).toBe(context.layouts.size);
      expect(packet.cacheHits).toBeGreaterThan(0);
    }),
  );
}, 120000);
