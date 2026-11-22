import type { PhysicalConductor } from "../../src/circuit/types.js";
import {
  circuitRouteState,
  circuitTopology,
} from "../../src/circuit/layout-routes.js";

export function threeWayCircuit(vertical: boolean, disjoint = false) {
  const terminal = (terminalKey: string) => ({
    deviceUid: "native",
    terminalKey,
  });
  const conductor = (id: string, a: string, b: string): PhysicalConductor => ({
    id,
    name: id,
    label: id,
    ends: [terminal(a), terminal(b)],
    netId: id === "C" && disjoint ? "disjoint-net" : "same-net",
    detail: "",
    jumper: false,
  });
  const cs = [
    conductor("A", "left", "T"),
    conductor("B", "T", "right"),
    conductor("C", disjoint ? "foreign" : "T", "bottom"),
  ];
  const state = circuitRouteState(
    { id: "true-junction", width: 30, height: 30, children: [] },
    [],
    cs,
    { id: "native-three-way" },
    {
      key: (t) => JSON.stringify([t.deviceUid, t.terminalKey]),
      fkey: (f) => f.id.functionKey,
      compare: (a, b) => a.localeCompare(b),
      n: (v) => String(v),
      text: () => "",
      conductorLabelLines: (c) => [c.label],
      circuitDeviceTags: () => [],
      emitNode: () => "",
    },
  );
  const point = (x: number, y: number) =>
    vertical ? { x: 10 - y, y: 10 + x } : { x: 10 + x, y: 10 + y };
  state.routes.push(
    { index: 0, points: [point(-8, 0), point(0, 0)] },
    { index: 1, points: [point(0, 0), point(8, 0)] },
    { index: 2, points: [point(0, 0), point(0, 8)] },
  );
  return circuitTopology(state);
}
