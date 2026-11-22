import assert from "node:assert/strict";
import { expect, it } from "vitest";
import {
  agentRefusalFixture,
  pumpPower,
  sensorTrace,
} from "./agent-refusals-fixture.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";
import {
  observedRecoveryEngine,
  assertRecoveryInputs,
} from "./helpers/agent-recovery.js";

for (const flow of ["left-to-right", "top-to-bottom"] as const) {
  it.each(["sensor", "sensor-wire"] as const)(
    `prints #365's shared sensor landing in ${flow} (%s)`,
    async (name) => {
      const fixture = await agentRefusalFixture(name);
      try {
        const observed = observedRecoveryEngine();
        const result = await createSchematicRendererWithDependencies({
          layoutEngine: observed.engine,
        }).render(fixture.ir, { ...sensorTrace, flow });
        assert.ok(result.ok, JSON.stringify(result));
        expect(result.value.summary.conductiveElementIds).toHaveLength(9);
        expect(observed.inputs).toHaveLength(2);
        const [before, after] = observed.inputs;
        assert.ok(before && after);
        assertRecoveryInputs(before, after, "trace-order");
      } finally {
        await fixture.dispose();
      }
    },
  );

  it(`prints #366's pump phase labels in ${flow}`, async () => {
    const fixture = await agentRefusalFixture("pump");
    try {
      const observed = observedRecoveryEngine();
      const result = await createSchematicRendererWithDependencies({
        layoutEngine: observed.engine,
      }).render(fixture.ir, { ...pumpPower, flow });
      assert.ok(result.ok, JSON.stringify(result));
      expect(result.value.summary.conductiveElementIds).toHaveLength(13);
      for (const text of ["L1 480VAC", "L2 480VAC", "L3 480VAC", "PE"])
        expect(result.value.svg).toContain(text);
      expect(observed.inputs).toHaveLength(flow === "left-to-right" ? 1 : 2);
      if (flow === "top-to-bottom") {
        const [before, after] = observed.inputs;
        assert.ok(before && after);
        assertRecoveryInputs(before, after, [
          "L1 480VAC",
          "L2 480VAC",
          "L3 480VAC",
        ]);
        const netLabels = after.edges
          ?.flatMap((e) => e.labels ?? [])
          .filter((l) => l.id?.endsWith(',"net"]'));
        expect(netLabels).toHaveLength(4);
        expect(
          netLabels?.map(
            (l) => l.layoutOptions?.["org.eclipse.elk.edgeLabels.placement"],
          ),
        ).toEqual(["HEAD", "HEAD", "HEAD", "TAIL"]);
      }
    } finally {
      await fixture.dispose();
    }
  });
}
