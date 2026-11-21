import type { SchematicFlow } from "../types.js";
import type {
  StructuralRole,
  ClosedRoleAssignment,
  TraceDagIndex,
  TraceSignalDagEdge,
  ClosedRoleTemplate,
  ClosedComponentTemplate,
  TraceSignalDag,
  TraceOrigin,
} from "./model.js";
import type { SymbolSide } from "../symbols/types.js";
import {
  outgoingTraceEdges,
  traceOrigin,
  nextNonTraceVia,
  isTraceMerge,
  compareTraceOrigin,
  traceContinuationCount,
  traceDagIndex,
  incomingTraceEdges,
} from "./trace-dag.js";

export function structuralSide(
  flow: SchematicFlow,
  role: StructuralRole,
): SymbolSide {
  const right: Readonly<Record<StructuralRole, SymbolSide>> = {
    P: "east",
    Q: "north",
    R: "west",
    S: "south",
  };
  const down: Readonly<Record<StructuralRole, SymbolSide>> = {
    P: "south",
    Q: "east",
    R: "north",
    S: "west",
  };
  return (flow === "left-to-right" ? right : down)[role];
}

export function closedAssignment(
  flow: SchematicFlow,
  incidence: ClosedRoleAssignment["incidence"],
  role: StructuralRole,
  order: number,
): ClosedRoleAssignment {
  return { incidence, role, side: structuralSide(flow, role), order };
}

export function rootClosedTemplate(
  flow: SchematicFlow,
  outputs: readonly TraceSignalDagEdge[],
): ClosedRoleTemplate {
  if (outputs.length === 2 || outputs.length === 3) {
    const roles =
      outputs.length === 2 ? (["P", "Q"] as const) : (["P", "Q", "S"] as const);
    return {
      kind: "root",
      components: [
        {
          index: 0,
          assignments: [
            ...outputs.map((edge, order) =>
              closedAssignment(
                flow,
                { kind: "edge", edgeId: edge.id },
                roles[order] as "P" | "Q" | "S",
                order,
              ),
            ),
            closedAssignment(flow, { kind: "attachment" }, "R", outputs.length),
          ],
        },
      ],
    };
  }
  if (outputs.length === 4) {
    return fourOutputRootTemplate(flow, outputs);
  }
  throw new Error(`Closed root degree ${outputs.length} is outside 2..4.`);
}

function fourOutputRootTemplate(
  flow: SchematicFlow,
  outputs: readonly TraceSignalDagEdge[],
): ClosedRoleTemplate {
  return {
    kind: "root",
    components: [
      {
        index: 0,
        assignments: [
          closedAssignment(
            flow,
            { kind: "edge", edgeId: (outputs[0] as TraceSignalDagEdge).id },
            "P",
            0,
          ),
          closedAssignment(
            flow,
            { kind: "edge", edgeId: (outputs[1] as TraceSignalDagEdge).id },
            "Q",
            1,
          ),
          closedAssignment(flow, { kind: "attachment" }, "R", 2),
          closedAssignment(flow, { kind: "link-out", index: 0 }, "S", 3),
        ],
      },
      {
        index: 1,
        assignments: [
          closedAssignment(
            flow,
            { kind: "edge", edgeId: (outputs[2] as TraceSignalDagEdge).id },
            "P",
            0,
          ),
          closedAssignment(
            flow,
            { kind: "edge", edgeId: (outputs[3] as TraceSignalDagEdge).id },
            "S",
            1,
          ),
          closedAssignment(flow, { kind: "link-in", index: 0 }, "Q", 2),
        ],
      },
    ],
  };
}

function mergeCombClosedTemplate(
  flow: SchematicFlow,
  inputs: readonly TraceSignalDagEdge[],
  output: TraceSignalDagEdge,
): ClosedRoleTemplate {
  const components: ClosedComponentTemplate[] = [
    {
      index: 0,
      assignments: [
        closedAssignment(
          flow,
          { kind: "edge", edgeId: (inputs[0] as TraceSignalDagEdge).id },
          "S",
          0,
        ),
        closedAssignment(
          flow,
          { kind: "edge", edgeId: (inputs[1] as TraceSignalDagEdge).id },
          "R",
          1,
        ),
        closedAssignment(flow, { kind: "attachment" }, "Q", 2),
        closedAssignment(flow, { kind: "link-out", index: 0 }, "P", 3),
      ],
    },
  ];
  appendMergeCombComponents(inputs, components, flow, output);
  return { kind: "merge", components };
}

function appendMergeCombComponents(
  inputs: readonly TraceSignalDagEdge[],
  components: ClosedComponentTemplate[],
  flow: SchematicFlow,
  output: TraceSignalDagEdge,
) {
  for (
    let componentIndex = 1;
    componentIndex <= inputs.length - 2;
    componentIndex++
  ) {
    const last = componentIndex === inputs.length - 2;
    components.push({
      index: componentIndex,
      assignments: last
        ? [
            closedAssignment(
              flow,
              {
                kind: "edge",
                edgeId: (inputs[inputs.length - 1] as TraceSignalDagEdge).id,
              },
              "S",
              0,
            ),
            closedAssignment(flow, { kind: "edge", edgeId: output.id }, "P", 1),
            closedAssignment(
              flow,
              { kind: "link-in", index: componentIndex - 1 },
              "R",
              2,
            ),
          ]
        : [
            closedAssignment(
              flow,
              {
                kind: "edge",
                edgeId: (inputs[componentIndex + 1] as TraceSignalDagEdge).id,
              },
              "S",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "link-in", index: componentIndex - 1 },
              "R",
              1,
            ),
            closedAssignment(
              flow,
              { kind: "link-out", index: componentIndex },
              "P",
              2,
            ),
          ],
    });
  }
}

function twoInputMergeClosedTemplate(
  dag: TraceSignalDag,
  index: TraceDagIndex,
  flow: SchematicFlow,
  inputs: readonly TraceSignalDagEdge[],
  output: TraceSignalDagEdge,
): ClosedRoleTemplate {
  const { straightIndex, outputRole } = twoInputMergeRoles(
    inputs,
    dag,
    index,
    output,
  );
  return {
    kind: "merge",
    components: [
      {
        index: 0,
        assignments: [
          ...inputs.map((input, localIndex) =>
            closedAssignment(
              flow,
              { kind: "edge", edgeId: input.id },
              localIndex === straightIndex ? "R" : "S",
              localIndex,
            ),
          ),
          closedAssignment(
            flow,
            { kind: "edge", edgeId: output.id },
            outputRole,
            2,
          ),
          closedAssignment(
            flow,
            { kind: "attachment" },
            outputRole === "P" ? "Q" : "P",
            3,
          ),
        ],
      },
    ],
  };
}

function twoInputMergeRoles(
  inputs: readonly TraceSignalDagEdge[],
  dag: TraceSignalDag,
  index: TraceDagIndex,
  output: TraceSignalDagEdge,
): { straightIndex: number; outputRole: StructuralRole } {
  const origins = inputs.map((input) => traceOrigin(dag, index, input));
  const continuationIndexes = origins
    .map((origin, localIndex) => ({ origin, localIndex }))
    .filter(({ origin }) => origin.kind === "CONTINUATION")
    .map(({ localIndex }) => localIndex);
  const continuationCount = continuationIndexes.length;
  const next = nextNonTraceVia(index, output);
  let straightIndex: number;
  if (continuationCount === 1) {
    if (
      outgoingTraceEdges(index, dag.root).length === 3 &&
      !isTraceMerge(index, next)
    ) {
      straightIndex = continuationIndexes[0] === 0 ? 1 : 0;
    } else {
      straightIndex = continuationIndexes[0] as number;
    }
  } else {
    straightIndex = (
      origins
        .map((origin, localIndex) => [origin, localIndex] as const)
        .sort(compareTraceOrigin)[0] as readonly [TraceOrigin, number]
    )[1];
  }

  let outputRole: StructuralRole;
  if (outgoingTraceEdges(index, dag.root).length === 3) {
    outputRole = "Q";
  } else if (!isTraceMerge(index, next)) {
    outputRole = continuationCount > 0 ? "Q" : "P";
  } else {
    outputRole = traceContinuationCount(dag, index, next) >= 2 ? "Q" : "P";
  }
  return { straightIndex, outputRole };
}

export function selectClosedTraceRoles(
  dag: TraceSignalDag,
  currentVertex: string,
  flow: SchematicFlow,
): ClosedRoleTemplate {
  const index = traceDagIndex(dag);
  const inputs = incomingTraceEdges(index, currentVertex);
  const outputs = outgoingTraceEdges(index, currentVertex);
  if (
    currentVertex === dag.root &&
    inputs.length === 0 &&
    outputs.length >= 2 &&
    outputs.length <= 4
  ) {
    return rootClosedTemplate(flow, outputs);
  }
  if (inputs.length === 1 && outputs.length === 1) {
    return {
      kind: "via",
      components: [
        {
          index: 0,
          assignments: [
            closedAssignment(
              flow,
              { kind: "edge", edgeId: (inputs[0] as TraceSignalDagEdge).id },
              "R",
              0,
            ),
            closedAssignment(
              flow,
              { kind: "edge", edgeId: (outputs[0] as TraceSignalDagEdge).id },
              "P",
              1,
            ),
          ],
        },
      ],
    };
  }
  if (inputs.length === 2 && outputs.length === 1) {
    return twoInputMergeClosedTemplate(
      dag,
      index,
      flow,
      inputs,
      outputs[0] as TraceSignalDagEdge,
    );
  }
  if ((inputs.length === 3 || inputs.length === 4) && outputs.length === 1) {
    return mergeCombClosedTemplate(
      flow,
      inputs,
      outputs[0] as TraceSignalDagEdge,
    );
  }
  throw new Error(
    `Closed role selector does not cover (${inputs.length},${outputs.length}) at ${currentVertex}.`,
  );
}
