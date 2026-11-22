import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/index.js";
import { renderTitleFrameBenchmark } from "../src/internal/title-data/entry.js";
import * as searches from "../src/packet/rooted-search.js";
import * as quality from "../src/layout/circuit-route-quality.js";
import { circuitInlineContext } from "../src/layout/circuit-inline-context.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { circuitLayoutContext } from "../src/layout/circuit-inline-context.js";
afterEach(() => vi.restoreAllMocks());
const view = (flow: "left-to-right" | "top-to-bottom", root: string) => ({
  format: "schematic-view-request/0.1" as const,
  family: "power" as const,
  flow,
  root: { by: "designation" as const, value: root },
});
it("searches the same TTB view to the same depth alone and after LTR power", async () => {
  const c = await compileProject(
    fileURLToPath(new URL("../../../examples/machine-demo", import.meta.url)),
  );
  if (!c.ok) throw Error("Fixture failed");
  const p = normalizePaperPage({ size: "letter", orientation: "landscape" });
  if (!p.ok) throw Error("Page failed");
  const alone = await searches.searchRootedCandidates(
    c.ir,
    view("top-to-bottom", "M2"),
    c.presentation,
    p.value,
    true,
  );
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await searches.searchRootedCandidates(
      c.ir,
      view("left-to-right", "M1"),
      c.presentation,
      p.value,
      true,
    );
    const mixed = await searches.searchRootedCandidates(
      c.ir,
      view("top-to-bottom", "M2"),
      c.presentation,
      p.value,
      true,
    );
    expect(mixed).toEqual(alone);
    expect(mixed.elkWork).toBeUndefined();
  });
}, 120000);
it.each([false, true])(
  "keeps unselected mixed-flow sheets byte-exact through quality rerenders (title %s)",
  async (title) => {
    const c = await compileProject(
      fileURLToPath(new URL("../../../examples/machine-demo", import.meta.url)),
    );
    if (!c.ok) throw Error("Fixture failed");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page: { size: "letter" as const, orientation: "landscape" as const },
      layout: "compact" as const,
      views: [view("left-to-right", "M1"), view("top-to-bottom", "M2")],
    };
    const render = () =>
      title
        ? renderTitleFrameBenchmark(
            c.ir,
            { ...request, format: "schematic-packet-request/0.2" },
            { format: "project-presentation/0.3" },
          )
        : renderSchematicPacket(c.ir, request, c.presentation);
    const eligibility = vi
      .spyOn(quality, "circuitHasJogs")
      .mockReturnValue(false);
    const original = await render();
    eligibility.mockRestore();
    const search = searches.searchRootedCandidates;
    const seen: { flow?: string; phase: boolean; attempts: number }[] = [];
    vi.spyOn(searches, "searchRootedCandidates").mockImplementation(
      async (...args) => {
        const phase = !!circuitInlineContext.getStore()?.qualityPhase;
        const result = await search(...args);
        seen.push({ flow: args[1].flow, phase, attempts: result.attempts });
        return result;
      },
    );
    const after = await render();
    if (!original.ok || !after.ok)
      throw Error(JSON.stringify({ original, after }));
    const ttb = (packet: typeof after.value) =>
      packet.sheets.filter((s) => s.view.flow === "top-to-bottom");
    expect(ttb(original.value).length).toBeGreaterThan(0);
    expect(JSON.stringify(ttb(after.value))).toBe(
      JSON.stringify(ttb(original.value)),
    );
    const ttbSearches = seen.filter((s) => s.flow === "top-to-bottom");
    expect(new Set(ttbSearches.map((s) => s.attempts)).size).toBe(1);
    if (title) expect(ttbSearches.some((s) => s.phase)).toBe(true);
  },
  120000,
);
