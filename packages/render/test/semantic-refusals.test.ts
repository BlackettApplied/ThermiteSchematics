import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  materializeAndCompileB4Tier2Fixture,
  selectB4Trace,
} from "./b4-fixtures.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { buildElkAdapterGraph } from "../src/layout/elk-adapter.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";

it("preserves dev label-ID wording and the raw geometric witness", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-semantic-refusal-"));
  try {
    const { ir } = await materializeAndCompileB4Tier2Fixture(
      root,
      "right-deep",
    );
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const selected = selectB4Trace(ir, flow),
        p = buildPresentationGraph({ ir, selected });
      if (!p.ok) throw Error(JSON.stringify(p.error));
      const a = buildElkAdapterGraph(p.value.graph, selected),
        raw = await createElkEngine().layout(structuredClone(a.graph));
      const r = normalizeAndValidateLayout(
        p.value.graph,
        a.graph,
        raw,
        SYMBOL_CATALOG,
      );
      expect(r.ok).toBe(false);
      if (r.ok) throw Error("Expected label collision");
      const label = JSON.stringify([
        "label",
        "edge",
        JSON.stringify(["wire", "00000000-0000-4000-8000-000000000416"]),
        "conductor",
      ]);
      expect(r.error.message).toBe(
        `Invalid layout: label ${label} overlaps edge L1-B (TB1.8 / terminal8 → JB1.X1.7 / terminal7).`,
      );
      expect(r.error.details?.originalMessage).toContain('["label","edge"');
      expect(r.error.details?.originalMessage).toContain(
        "00000000-0000-4000-8000-000000000416",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
