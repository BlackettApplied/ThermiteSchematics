import assert from "node:assert/strict";
import { expect } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { createElkEngine } from "../../src/layout/elk-runtime.js";
import { normalizeSchematicView } from "../../src/view-spec.js";
import {
  selectSemanticSubgraph,
  selectTraceSubgraph,
} from "../../src/selection.js";
import { buildPresentationGraph } from "../../src/presentation.js";
import type { SchematicViewRequest } from "../../src/types.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";

export function observedRecoveryEngine() {
  const engine = createElkEngine(),
    layout = engine.layout.bind(engine);
  const inputs: ElkNode[] = [];
  engine.layout = async (input, options) => {
    inputs.push(structuredClone(input));
    return layout(input, options);
  };
  return { engine, inputs };
}

/** Ignore exactly the admitted layout options; all native geometry and
 * identity, labels and text reservations must otherwise be identical. */
export function restoreRecoveryOptions(candidate: ElkNode, before: ElkNode) {
  const result = structuredClone(candidate);
  result.layoutOptions = before.layoutOptions;
  for (const edge of result.edges ?? []) {
    const original = before.edges?.find((e) => e.id === edge.id);
    assert.ok(original);
    for (const label of edge.labels ?? []) {
      const old = original.labels?.find((l) => l.id === label.id);
      assert.ok(old);
      label.layoutOptions = old.layoutOptions;
    }
  }
  return result;
}

export function assertRecoveryInputs(
  before: ElkNode,
  after: ElkNode,
  recovery: "trace-order" | readonly string[],
) {
  expect(restoreRecoveryOptions(after, before)).toEqual(before);
  expect(after.layoutOptions).toEqual({
    ...before.layoutOptions,
    ...(recovery === "trace-order"
      ? { "org.eclipse.elk.layered.considerModelOrder.strategy": "NONE" }
      : {}),
  });
  for (const edge of after.edges ?? []) {
    const original = before.edges?.find((e) => e.id === edge.id);
    assert.ok(original);
    for (const label of edge.labels ?? []) {
      const old = original.labels?.find((l) => l.id === label.id);
      assert.ok(old);
      const net = label.id?.endsWith(',"net"]');
      expect(label.layoutOptions).toEqual({
        ...old.layoutOptions,
        ...(net &&
        recovery !== "trace-order" &&
        recovery.includes(label.text ?? "")
          ? { "org.eclipse.elk.edgeLabels.placement": "HEAD" }
          : {}),
      });
    }
  }
}

export function agentPresentation(
  ir: ElectricalIr,
  request: SchematicViewRequest,
) {
  const normalized = normalizeSchematicView(ir, request);
  assert.ok(normalized.ok);
  const view = normalized.value.view;
  const selected =
    view.format === "schematic-view/0.2" && view.intent === "trace"
      ? selectTraceSubgraph({
          ir,
          ...normalized.value,
          view,
          target: view.target,
          includePower: view.includePower,
        })
      : selectSemanticSubgraph({ ir, ...normalized.value });
  assert.ok(selected.ok);
  const built = buildPresentationGraph({ ir, selected: selected.value });
  assert.ok(built.ok);
  return { graph: built.value.graph, selected: selected.value };
}
