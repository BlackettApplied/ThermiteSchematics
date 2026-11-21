import { afterEach, expect, it, vi } from "vitest";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import {
  circuitLayoutRun,
  layoutCircuitGroup,
} from "../src/layout/circuit-inline.js";
import { fragmentDefects } from "../src/packet/route-fragments.js";
import { parallelLabelGraph } from "./circuit-inline.fixture.js";

afterEach(() => vi.restoreAllMocks());
it.each([false, true])(
  "repairs label-induced jogs on parallel fixed ports (vertical=%s)",
  async (vertical) => {
    const input = parallelLabelGraph(vertical);
    const original = await createElkEngine().layout(structuredClone(input));
    const jogs = (graph: typeof original) =>
      graph.edges!.flatMap((e) =>
        e.sections!.flatMap(
          (s) =>
            fragmentDefects(
              [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
              1,
            ).jogs,
        ),
      );
    expect(jogs(original).length).toBeGreaterThan(0);
    const run = circuitLayoutRun();
    await layoutCircuitGroup(input, run);
    run.quality = true;
    const selected = await layoutCircuitGroup(input, run);
    expect(jogs(selected)).toHaveLength(0);
    expect(selected.edges!.flatMap((e) => e.labels ?? [])).toHaveLength(3);
    expect(selected.children!.map((n) => n.ports)).toEqual(
      original.children!.map((n) => n.ports),
    );
  },
);

it.each([false, true])(
  "sweeps measured width, height, lines and Unicode with exact whole-group fallback (vertical=%s)",
  async (vertical) => {
    const { measureText } = await import("../src/text-metrics.js");
    const { circuitRouteMetrics, circuitConductorGuard } =
      await import("../src/layout/circuit-route-quality.js");
    const { circuitLabelGuard } =
      await import("../src/layout/circuit-native-guard.js");
    const outcomes = new Set<string>();
    for (const name of ["W1", "W10", "AO1+", "W-PWR-002", "Ωµ−", "éА1"])
      for (const extra of [0, 8, 24])
        for (const lines of [1, 2, 3]) {
          const input = parallelLabelGraph(vertical);
          for (const edge of input.edges!)
            Object.assign(edge.labels![0]!, {
              text: Array(lines).fill(name).join("\n"),
              width: measureText(name, 2.5).width + 1.5 + extra,
              height: 3.8 + (lines - 1) * 3.1,
            });
          const native = await createElkEngine().layout(structuredClone(input));
          const run = circuitLayoutRun();
          const original = await layoutCircuitGroup(input, run);
          const clean = (g: typeof native) =>
            JSON.parse(
              JSON.stringify(g, (k, v) => (k === "$H" ? undefined : v)),
            );
          expect(clean(original)).toEqual(clean(native));
          run.quality = true;
          const after = await layoutCircuitGroup(input, run);
          const fallback = JSON.stringify(after) === JSON.stringify(original);
          outcomes.add(fallback ? "fallback" : "inline");
          expect(circuitLabelGuard(after, input)).toBe(true);
          if (fallback) expect(after).toEqual(original);
          else {
            expect(circuitConductorGuard(after, original)).toBe(true);
            expect(
              after.edges!.every((e) => circuitRouteMetrics(e).bends === 0),
            ).toBe(true);
          }
          expect(run.attempts).toBeLessThanOrEqual(2);
          // Reading a saved candidate or baseline must not spend another layout.
          expect(await layoutCircuitGroup(input, run)).toEqual(after);
          expect(run.attempts).toBeLessThanOrEqual(2);
        }
    expect(outcomes).toEqual(new Set(["inline", "fallback"]));
  },
);
