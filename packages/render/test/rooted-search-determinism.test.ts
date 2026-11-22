import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { searchRootedCandidates } from "../src/packet/rooted-search.js";
import { normalizePaperPage } from "../src/packet/page.js";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";

const real = [
  ["machine-demo", "M1", "letter", "portrait", "standard"],
  ["machine-demo", "M2", "letter", "landscape", "compact"],
  ["machine-demo", "M2", "a3", "portrait", "compact"],
  ["machine-demo", "M1", "letter", "portrait", "compact"],
  ["conveyor-line", "M1", "letter", "portrait", "compact"],
] as const;
it.each(real)(
  "replays reviewed %s %s %s %s %s TTB search exactly in a quality phase",
  async (project, root, size, orientation, layout) => {
    const c = await compileProject(
      fileURLToPath(new URL("../../../examples/" + project, import.meta.url)),
    );
    if (!c.ok) throw Error("Fixture failed");
    const page = normalizePaperPage({ size, orientation });
    if (!page.ok) throw Error("Page failed");
    const view = {
      format: "schematic-view-request/0.1",
      family: "power",
      flow: "top-to-bottom",
      root: { by: "designation", value: root },
    } as const;
    const context = circuitLayoutContext();
    await circuitInlineContext.run(context, async () => {
      const a = await searchRootedCandidates(
        c.ir,
        view,
        c.presentation,
        page.value,
        layout === "compact",
      );
      context.qualityPhase = true;
      const b = await searchRootedCandidates(
        c.ir,
        view,
        c.presentation,
        page.value,
        layout === "compact",
      );
      expect(b).toEqual(a);
      expect(a.elkWork).toBeUndefined();
    });
  },
  120000,
);
it("the same capped LTR search has identical depth and result cold, warm and quality-rerun", async () => {
  const c = await compileProject(
    fileURLToPath(new URL("../../../examples/motor-starter", import.meta.url)),
  );
  if (!c.ok) throw Error("Fixture failed");
  const page = normalizePaperPage({ size: "letter", orientation: "portrait" });
  if (!page.ok) throw Error("Page failed");
  const view = {
    format: "schematic-view-request/0.1",
    family: "power",
    flow: "left-to-right",
    root: { by: "designation", value: "M1" },
  } as const;
  const context = circuitLayoutContext();
  await circuitInlineContext.run(context, async () => {
    const a = await searchRootedCandidates(
      c.ir,
      view,
      c.presentation,
      page.value,
      true,
    );
    const b = await searchRootedCandidates(
      c.ir,
      view,
      c.presentation,
      page.value,
      true,
    );
    context.qualityPhase = true;
    const d = await searchRootedCandidates(
      c.ir,
      view,
      c.presentation,
      page.value,
      true,
    );
    const result = ({ elkWork: _work, ...run }: typeof a) => run;
    expect(result(b)).toEqual(result(a));
    expect(result(d)).toEqual(result(a));
    expect(a.elkWork?.calls).toBe(48);
    expect(a.elkWork?.exhausted).toBe(true);
    expect(b.elkWork?.calls).toBe(a.elkWork?.calls);
    expect(d.elkWork?.calls).toBe(a.elkWork?.calls);
  });
}, 120000);
