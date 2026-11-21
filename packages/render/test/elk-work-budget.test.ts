import { expect, it } from "vitest";
import {
  cachedCircuitLayout,
  circuitInlineContext,
  circuitLayoutCacheKey,
  type CircuitInlineContext,
} from "../src/layout/circuit-inline-context.js";
import {
  elkPacketWorkTrace,
  ElkWorkBudgetError,
  elkWorkLedger,
  elkWorkScope,
} from "../src/layout/elk-work.js";
import { InlineLabelFitError } from "../src/layout/inline-label-error.js";

function context(): CircuitInlineContext {
  return {
    cursor: 0,
    runs: [],
    selected: new Set(),
    layouts: new Map(),
    qualityPhase: false,
    permittedInputs: new Set(),
    viewDecisions: [],
  };
}

it("charges cache hits as logical requests and refuses request 49 independently of warmth", async () => {
  const state = context();
  for (const warm of [false, true]) {
    const work = elkWorkLedger("synthetic", 48);
    let dispatches = 0;
    await circuitInlineContext.run(state, () =>
      elkWorkScope.run(work, async () => {
        for (let i = 0; i < 48; i++)
          await cachedCircuitLayout({ id: String(i) }, async (input) => ({
            ...input,
            call: ++dispatches,
          }));
        expect(work.calls).toBe(48);
        expect(dispatches).toBe(warm ? 0 : 48);
        await expect(
          cachedCircuitLayout({ id: "0" }, async (input) => input),
        ).rejects.toBeInstanceOf(InlineLabelFitError);
        expect(work.calls).toBe(48);
        expect(work.cacheHits).toBe(warm ? 48 : 0);
      }),
    );
  }
});

it.each([
  [-0, 0],
  [NaN, null],
  [undefined, null],
])("keeps distinct ELK values in the cache key (%s, %s)", (a, b) => {
  expect(circuitLayoutCacheKey({ value: a })).not.toBe(
    circuitLayoutCacheKey({ value: b }),
  );
});

it("counts failed work and uncached dispatches without depending on a packet context", async () => {
  const work = elkWorkLedger("synthetic failure", 48),
    error = new TypeError("native failure");
  await elkWorkScope.run(work, async () => {
    await expect(
      cachedCircuitLayout({}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(work.calls).toBe(1);
    expect(work.cacheHits).toBe(0);
  });
});

it("replays budget exhaustion before the quality miss veto", async () => {
  const state = context(),
    work = elkWorkLedger("quality stop", 48);
  state.qualityPhase = true;
  work.calls = 48;
  await circuitInlineContext.run(state, () =>
    elkWorkScope.run(work, async () => {
      await expect(
        cachedCircuitLayout(
          { id: "unreached original input" },
          async (input) => input,
        ),
      ).rejects.toBeInstanceOf(ElkWorkBudgetError);
    }),
  );
});

it("charges a vetoed logical request without reporting ELK dispatch work", async () => {
  const state = context(),
    work = elkWorkLedger("quality veto", 48);
  const packet = { calls: 0, cacheHits: 0, outsideSearchCalls: 0 };
  state.qualityPhase = true;
  let dispatched = 0;
  const input = { id: "forbidden quality input" };
  const layout = async () => ({ id: String(++dispatched) });
  await elkPacketWorkTrace.run(packet, () =>
    circuitInlineContext.run(state, () =>
      elkWorkScope.run(work, async () => {
        await expect(cachedCircuitLayout(input, layout)).rejects.toBeInstanceOf(
          InlineLabelFitError,
        );
        expect(work.calls).toBe(1);
        expect(work.dispatches).toBe(0);
        expect(packet.calls).toBe(0);
        expect(dispatched).toBe(0);
        state.permittedInputs.add(circuitLayoutCacheKey(input));
        await cachedCircuitLayout(input, layout);
        await cachedCircuitLayout(input, layout);
        expect(work.calls).toBe(3);
        expect(work.dispatches).toBe(1);
        expect(work.cacheHits).toBe(1);
        expect(packet.calls).toBe(1);
        expect(dispatched).toBe(1);
      }),
    ),
  );
});
