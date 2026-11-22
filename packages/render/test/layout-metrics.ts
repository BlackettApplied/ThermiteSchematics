import { readFileSync } from "node:fs";
import type { LayoutPoint, SchematicFlow } from "../src/types.js";

// Regenerate with bun scripts/update-render-ordering-goldens.mjs --write after a build.
export const orderingMetrics = JSON.parse(
  readFileSync(
    new URL("snapshots/semantic-ordering/layout-metrics.json", import.meta.url),
    "utf8",
  ),
) as {
  sizes: Record<string, [number, number]>;
  trace: Record<
    SchematicFlow,
    {
      routes: Record<string, LayoutPoint[]>;
      node: LayoutPoint;
      port: LayoutPoint;
      label: LayoutPoint;
    }
  >;
  controls: Record<
    SchematicFlow,
    {
      size: [number, number];
      routes: Record<string, LayoutPoint[]>;
      intersection: LayoutPoint;
    }
  >;
  sideBranches: Record<string, string>;
};
