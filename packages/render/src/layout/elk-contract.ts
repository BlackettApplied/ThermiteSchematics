import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import type { ElkAdapterBuild } from "./elk-adapter.js";
import { canonicalSerializable } from "../internal.js";
import { createElkEngine } from "./elk-runtime.js";
import { defaultElkMetadata } from "./elk-metadata.js";
import {
  type ElkOptionAssignment,
  type ElkOptionMetadataSnapshot,
  validateOptionAssignmentsAgainstMetadata,
} from "./options.js";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ELK adapter invariant: ${message}`);
}

export async function validateElkRuntimeOptions(
  build: Readonly<ElkAdapterBuild>,
  engine: Pick<ElkApi, "knownLayoutOptions"> = defaultElkMetadata(
    createElkEngine(),
  ),
): Promise<readonly ElkOptionMetadataSnapshot[]> {
  const targets: Record<ElkOptionAssignment["targetKind"], Set<string>> = {
    parent: new Set([build.graph.id]),
    node: new Set(),
    port: new Set(),
    "node-label": new Set(),
    edge: new Set(),
    "edge-label": new Set(),
  };
  const visit = (node: Readonly<ElkNode>): void => {
    if (node.id !== build.graph.id) targets.node.add(node.id);
    if (node.children !== undefined) targets.parent.add(node.id);
    for (const port of node.ports ?? []) targets.port.add(port.id);
    for (const label of node.labels ?? []) {
      invariant(typeof label.id === "string", `node ${node.id} label ID`);
      targets["node-label"].add(label.id);
    }
    for (const edge of node.edges ?? []) {
      targets.edge.add(edge.id);
      for (const label of edge.labels ?? []) {
        invariant(typeof label.id === "string", `edge ${edge.id} label ID`);
        targets["edge-label"].add(label.id);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(build.graph);
  for (const assignment of build.optionAssignments) {
    invariant(
      targets[assignment.targetKind].has(assignment.targetId),
      `${assignment.option} targets non-${assignment.targetKind} ${assignment.targetId}`,
    );
  }
  return validateOptionAssignmentsAgainstMetadata(
    await engine.knownLayoutOptions(),
    build.optionAssignments,
  );
}

/** The adapter owns its default factory; injected engines retain their queries. */
export function validateLayoutOptions(
  build: Readonly<ElkAdapterBuild>,
  engine: ElkApi,
  injectedEngine?: ElkApi,
) {
  return validateElkRuntimeOptions(
    build,
    injectedEngine ?? defaultElkMetadata(engine),
  );
}

export function serializeElkAdapterForTest(
  build: Readonly<ElkAdapterBuild>,
): string {
  return JSON.stringify(
    canonicalSerializable({
      graph: build.graph,
      optionAssignments: build.optionAssignments,
    }),
    undefined,
    2,
  );
}
