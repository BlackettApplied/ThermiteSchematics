import assert from "node:assert/strict";
import { bun } from "../support.mjs";

export const inspectK1 = [
  "thermite.mjs",
  "inspect",
  "K1",
  "--project",
  "examples/motor-starter",
  "--json",
];

const terminals = [
  "1/L1",
  "13",
  "14",
  "2/T1",
  "3/L2",
  "4/T2",
  "5/L3",
  "6/T3",
  "A1",
  "A2",
];
const functions = [
  ["aux13", ["13", "14"]],
  ["coil", ["A1", "A2"]],
  ["pole1", ["1/L1", "2/T1"]],
  ["pole2", ["3/L2", "4/T2"]],
  ["pole3", ["5/L3", "6/T3"]],
];

export function inspectOrder(result) {
  const { command, object } = JSON.parse(result.stdout);
  assert.equal(command, "inspect");
  assert.equal(object.designation, "K1");
  return {
    terminals: object.terminals.map(({ id }) => id.terminalKey),
    functions: object.functions.map(({ key, terminals: rows }) => [
      key,
      rows.map(({ id }) => id.terminalKey),
    ]),
  };
}

// The public command covers terminal and nested function rows. Direct tests
// independently exercise the designation priority, UID tie-break and equality
// that a single device's public output cannot distinguish.
const comparatorCases = `
import assert from "node:assert/strict";
import {
  compareCableConductorView, compareConductiveEdgeView, compareConductiveNeighbor,
  compareFunctionView, compareTerminalView, compareTraceComponent, compareTraceVisit,
} from "./packages/query/dist/ordering.js";
const terminal = (deviceDesignation, terminalKey, deviceUid) =>
  ({ deviceDesignation, id: { terminalKey, deviceUid } });
const ordered = [
  terminal("A", "10", "a"),
  terminal("A", "10", "b"),
  terminal("A", "2", "0"),
  terminal("B", "1", "0"),
  terminal("a", "1", "0"),
];
const snapshot = structuredClone(ordered);
for (const [i, left] of ordered.entries()) {
  for (const [j, right] of ordered.entries()) {
    assert.equal(Math.sign(compareTerminalView(left, right)) || 0, Math.sign(i - j));
  }
  assert.equal(Math.sign(compareTerminalView(left, structuredClone(left))) || 0, 0);
}
assert.deepEqual(ordered, snapshot);

// Each composite comparator must consult the terminal key when its other
// ordering keys tie, including both endpoint and both trace-root positions.
const [early, sameKey, late] = ordered;
const element = { kind: "wire", uid: "w", display: "W" };
const otherDevice = { uid: "d", designation: "D" };
const edge = (first, second) => ({ element, endpoints: [first, second] });
const cable = (first, second) =>
  ({ id: { cableUid: "c", conductorId: "1" }, display: "C.1", endpoints: [first, second] });
const neighbor = (first, second) =>
  ({ terminal: first, otherTerminal: second, otherDevice, element });
const visit = (first, second) =>
  ({ hops: 1, terminal: first, via: { from: second, element } });
const component = (first, second) =>
  ({ roots: [first, second], net: { id: "n", potentials: [] } });
for (const [compare, make] of [
  [compareCableConductorView, cable],
  [compareConductiveEdgeView, edge],
  [compareConductiveNeighbor, neighbor],
  [compareTraceVisit, visit],
  [compareTraceComponent, component],
]) {
  assert(compare(make(early, sameKey), make(late, sameKey)) < 0, compare.name);
  assert(compare(make(sameKey, early), make(sameKey, late)) < 0, compare.name);
}
const fn = (terminal) => ({ key: "f", kind: "contact", terminals: [terminal] });
assert(compareFunctionView(fn(early), fn(late)) < 0, "compareFunctionView");
`;

export function queryProof(ctx, repository) {
  const inspect = bun(ctx, repository, ...inspectK1);
  const comparator = bun(ctx, repository, "-e", comparatorCases);
  let result;
  try {
    if (inspect.exit === 0) result = inspectOrder(inspect);
  } catch {
    // Retain the CLI's raw result for malformed or incomplete output.
  }
  return {
    pass:
      comparator.exit === 0 &&
      !!result &&
      JSON.stringify(result.terminals) === JSON.stringify(terminals) &&
      JSON.stringify(result.functions) === JSON.stringify(functions),
    inspect,
    comparator,
  };
}
