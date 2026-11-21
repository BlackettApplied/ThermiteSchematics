import assert from "node:assert/strict";
import { expect, it } from "vitest";
import {
  agentRefusalFixture,
  pumpPower,
  sensorTrace,
} from "./agent-refusals-fixture.js";
import { agentPresentation } from "./helpers/agent-recovery.js";
import { rootedRecovery } from "../src/layout/rooted-recovery.js";
import {
  buildElkAdapterGraph,
  layoutPresentationGraph,
} from "../src/layout/elk-adapter.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import {
  normalizeAndValidateLayout,
  type LayoutFailureKind,
  type LayoutValidationOutcome,
} from "../src/layout/validate-output.js";
import type { PresentationGraph } from "../src/types.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";

function failure(
  graph: PresentationGraph,
  failureKind: LayoutFailureKind,
): LayoutValidationOutcome {
  return {
    ok: false,
    failureKind,
    error: {
      code: "R004",
      message: "control",
      family: graph.view.family,
      root: graph.view.root.designation,
    },
  };
}

it("retries only the measured failure and the same physical pass-through", async () => {
  const fixture = await agentRefusalFixture("sensor");
  try {
    const { graph } = agentPresentation(fixture.ir, {
      ...sensorTrace,
      flow: "left-to-right",
    });
    const reason = failure(graph, "ambiguous-intersection");
    expect(rootedRecovery(graph, reason)).toBe("trace-order");
    for (const kind of [
      "contract-violation",
      "symbol-intersection",
      "net-label-intersection",
    ] as const)
      expect(rootedRecovery(graph, failure(graph, kind))).toBeUndefined();
    const withoutTerminals = {
      ...graph,
      nodes: graph.nodes.filter(
        (n) => n.kind !== "symbol" || n.classification !== "terminal",
      ),
    };
    expect(rootedRecovery(withoutTerminals, reason)).toBeUndefined();
    const mismatched = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.kind !== "symbol" || n.classification !== "terminal"
          ? n
          : {
              ...n,
              ports: n.ports.map((p, i) => ({
                ...p,
                terminal: {
                  ...p.terminal,
                  terminalKey: p.terminal.terminalKey + i,
                },
              })),
            },
      ),
    };
    expect(rootedRecovery(mismatched, reason)).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

it("requires a phase conductor overlap in vertical power views", async () => {
  const fixture = await agentRefusalFixture("pump");
  try {
    const { graph, selected } = agentPresentation(fixture.ir, {
      ...pumpPower,
      flow: "top-to-bottom",
    });
    const overlap = (designation: string) => {
      const edge = graph.edges.find(
        (e) =>
          e.conductor?.kind === "wire" &&
          e.conductor.designation === designation,
      );
      assert.ok(edge?.netLabel);
      return { labelId: edge.netLabel.id, edgeId: edge.id };
    };
    const phase = overlap("W105"),
      earth = overlap("W113");
    const failureWithOverlaps = {
      ...failure(graph, "net-label-intersection"),
      netLabelOverlaps: [phase, earth],
    };
    expect(rootedRecovery(graph, failureWithOverlaps, selected)).toEqual(
      new Set([phase.labelId, earth.labelId]),
    );
    expect(
      rootedRecovery(
        graph,
        { ...failureWithOverlaps, netLabelOverlaps: [earth] },
        selected,
      ),
    ).toBeUndefined();
    expect(
      rootedRecovery(graph, failure(graph, "contract-violation")),
    ).toBeUndefined();
    const horizontal = agentPresentation(fixture.ir, {
      ...pumpPower,
      flow: "left-to-right",
    });
    expect(
      rootedRecovery(
        horizontal.graph,
        failureWithOverlaps,
        horizontal.selected,
      ),
    ).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

it("leaves root fan-out to its existing search budget", async () => {
  const fixture = await agentRefusalFixture("sensor");
  try {
    const { graph } = agentPresentation(fixture.ir, {
      ...sensorTrace,
      flow: "left-to-right",
    });
    const rootUid = fixture.ir.devices.find((d) => d.designation === "B1")?.uid;
    const signal = graph.nodes
      .find((n) => n.kind === "symbol" && n.deviceUid === rootUid)
      ?.ports.find((p) => p.symbolPortId === "signal");
    assert.ok(signal);
    const forked = {
      ...graph,
      edges: graph.edges.map((e) =>
        e.sourcePortId === signal.id || e.targetPortId === signal.id
          ? { ...e, kind: "boundary-segment" as const }
          : e,
      ),
    };
    expect(
      rootedRecovery(forked, failure(forked, "ambiguous-intersection")),
    ).toBeUndefined();
  } finally {
    await fixture.dispose();
  }
});

it("rejects a detached recovered endpoint and preserves the original refusal", async () => {
  const fixture = await agentRefusalFixture("sensor");
  try {
    const { graph } = agentPresentation(fixture.ir, {
      ...sensorTrace,
      flow: "left-to-right",
    });
    const build = buildElkAdapterGraph(graph);
    const engine = createElkEngine(),
      layout = engine.layout.bind(engine);
    let calls = 0,
      first: LayoutValidationOutcome | undefined;
    engine.layout = async (input, options) => {
      const output = await layout(input, options);
      if (++calls === 1)
        first = normalizeAndValidateLayout(
          graph,
          build.graph,
          output,
          SYMBOL_CATALOG,
        );
      else {
        const section = output.edges?.[0]?.sections?.[0];
        assert.ok(section);
        const prior = section.bendPoints?.at(-1) ?? section.startPoint;
        const end = section.endPoint;
        if (Math.abs(prior.x - end.x) > 0.001)
          end.x += Math.sign(prior.x - end.x) * 0.5;
        else end.y += Math.sign(prior.y - end.y) * 0.5;
      }
      return output;
    };
    const result = await layoutPresentationGraph(graph, { engine });
    assert.ok(first && !first.ok);
    expect(result).toEqual(first);
    expect(calls).toBe(2);
  } finally {
    await fixture.dispose();
  }
});
